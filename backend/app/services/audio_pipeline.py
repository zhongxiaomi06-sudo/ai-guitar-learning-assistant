"""
services/audio_pipeline.py
End-to-end audio → Score JSON pipeline.
"""

import logging
import os
import shutil
import tempfile
from typing import Any, Dict, Optional

from app.config import get_settings
from app.services.storage import get_storage, StorageService
from app.services.transcription import extract_audio, get_video_duration, transcribe_audio
from app.services.tab_solver import solve_notes
from app.services.score_builder import build_score

logger = logging.getLogger(__name__)
settings = get_settings()


def _delete_score_best_effort(storage: StorageService, storage_path: str, purpose: str) -> None:
    """Delete a score object without changing an already committed job result."""
    try:
        deleted = storage.delete(storage_path)
    except Exception:
        logger.warning("Could not delete %s score object", purpose)
        return
    if not deleted:
        logger.warning("Could not find %s score object during cleanup", purpose)


class AudioPipeline:
    """Pipeline: video → audio → Basic Pitch → tab → Score JSON."""

    def __init__(self, storage: Optional[StorageService] = None):
        # The local CLI only calls run() and must not initialize a configured
        # MinIO client (or create buckets) as an unrelated side effect.
        self._storage = storage

    @property
    def storage(self) -> StorageService:
        """Create the configured storage adapter only when course I/O needs it."""
        if self._storage is None:
            self._storage = get_storage()
        return self._storage

    def run(
        self,
        video_path: str,
        title: str = "",
        source_video_url: str = "",
        duration: float = 0.0,
        bpm: int = 72,
        time_signature: list = None,
        key: str = "C",
        output_dir: str = None,
    ) -> Dict[str, Any]:
        """Run the full pipeline on a local video file.

        Args:
            video_path: path to the input video
            title: song/course title
            source_video_url: original source URL
            duration: video duration (used for bar splitting)
            bpm: BPM for bar quantization
            time_signature: e.g. [4, 4]
            key: musical key
            output_dir: optional directory for intermediate files

        Returns:
            Canonical Score JSON dict.
        """
        if time_signature is None:
            time_signature = [4, 4]

        owns_work_dir = output_dir is None
        work_dir = output_dir or tempfile.mkdtemp(prefix="guitar_pipeline_")
        try:
            os.makedirs(work_dir, exist_ok=True)

            # Duration probing belongs inside the cleanup boundary: malformed
            # media must not leak a newly created pipeline directory.
            if duration <= 0:
                duration = get_video_duration(video_path)

            # 1. Extract audio
            audio_path = os.path.join(work_dir, "analysis.wav")
            extract_audio(video_path, audio_path, sample_rate=22050)

            # 2. Transcribe to note events
            note_events = transcribe_audio(audio_path)
            logger.info("Transcribed %d notes", len(note_events))

            if not note_events:
                logger.warning("No notes detected in audio")
                return build_score(
                    title=title,
                    source_video_url=source_video_url,
                    duration=duration,
                    bpm=bpm,
                    time_signature=time_signature,
                    key=key,
                    solved_notes=[],
                )

            # 3. Solve string/fret positions
            solved_notes = solve_notes(note_events)
            logger.info("Solved %d notes to strings/frets", len(solved_notes))

            # 4. Build score
            score = build_score(
                title=title,
                source_video_url=source_video_url,
                duration=duration,
                bpm=bpm,
                time_signature=time_signature,
                key=key,
                solved_notes=solved_notes,
            )

            return score

        finally:
            # Clean up intermediate audio files only if we created a temp dir
            if owns_work_dir and os.path.exists(work_dir):
                shutil.rmtree(work_dir, ignore_errors=True)

    def process_course(self, course_id: str, db_session) -> Dict[str, Any]:
        """Run the pipeline on a course stored in the database and upload the score.

        Args:
            course_id: course ID
            db_session: SQLAlchemy session

        Returns:
            Updated course metadata.
        """
        from app.models.course import Course as CourseModel

        course = db_session.query(CourseModel).filter(CourseModel.id == course_id).first()
        if not course:
            raise ValueError(f"Course {course_id} not found")
        if course.status != "processing":
            logger.info(
                "Skipped a transcription job that is no longer processing for course %s",
                course_id,
            )
            return course
        if not course.video_path:
            raise ValueError(f"Course {course_id} has no video")

        video_local_path = self.storage.get_path(course.video_path)
        if not video_local_path:
            raise ValueError(f"Video file not found for course {course_id}")

        score = self.run(
            video_path=video_local_path,
            title=course.title,
            source_video_url=course.source_url or "",
            duration=course.duration or 0.0,
            bpm=course.bpm or 72,
            time_signature=[int(x) for x in (course.time_signature or "4/4").split("/")],
            key=course.key or "C",
        )

        # Save score JSON to a new key, then atomically switch the database
        # reference. This keeps the previous score recoverable if commit fails.
        import json
        import uuid

        score_key = f"{course_id}_score_{uuid.uuid4().hex[:8]}.json"
        with tempfile.TemporaryDirectory(prefix="guitar_score_") as score_dir:
            score_path_local = os.path.join(score_dir, score_key)
            with open(score_path_local, "w", encoding="utf-8") as score_file:
                json.dump(score, score_file, ensure_ascii=False)

            with open(score_path_local, "rb") as score_file:
                storage_path = self.storage.save(
                    score_key,
                    score_file,
                    max_bytes=settings.max_score_upload_bytes,
                )

        previous_score_path = course.score_path
        score_duration = float(score.get("duration") or course.duration or 0)
        score_bpm = int(score.get("bpm") or course.bpm or 0)
        signature = score.get("timeSignature")
        score_signature = course.time_signature
        if isinstance(signature, list) and len(signature) == 2:
            score_signature = f"{signature[0]}/{signature[1]}"

        # Do not mutate the loaded ORM object before this conditional update:
        # an autoflush would otherwise overwrite a manual score unconditionally.
        from sqlalchemy import update

        try:
            result = db_session.execute(
                update(CourseModel)
                .where(
                    CourseModel.id == course_id,
                    CourseModel.status == "processing",
                )
                .values(
                    score_path=storage_path,
                    status="ready",
                    progress=100,
                    duration=score_duration,
                    bpm=score_bpm,
                    time_signature=score_signature,
                ),
                execution_options={"synchronize_session": "fetch"},
            )
            if result.rowcount != 1:
                db_session.rollback()
                _delete_score_best_effort(self.storage, storage_path, "superseded")
                logger.info(
                    "Discarded a superseded transcription result for course %s",
                    course_id,
                )
                try:
                    db_session.refresh(course)
                except Exception:
                    logger.warning("Could not refresh a superseded course result")
                return course
            db_session.commit()
        except Exception:
            db_session.rollback()
            _delete_score_best_effort(self.storage, storage_path, "uncommitted")
            raise

        if previous_score_path and previous_score_path != storage_path:
            _delete_score_best_effort(self.storage, previous_score_path, "previous")
        try:
            db_session.refresh(course)
        except Exception:
            # The ready state is already committed. A transient refresh failure
            # must not make the background task mark the course as failed.
            logger.warning("Could not refresh committed course metadata")

        return course
