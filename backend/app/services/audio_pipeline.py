"""
services/audio_pipeline.py
End-to-end audio → Score JSON pipeline.
"""

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict

from app.services.storage import get_storage, StorageService
from app.services.transcription import extract_audio, get_video_duration, transcribe_audio
from app.services.tab_solver import solve_notes
from app.services.score_builder import build_score

logger = logging.getLogger(__name__)


class AudioPipeline:
    """Pipeline: video → audio → Basic Pitch → tab → Score JSON."""

    def __init__(self, storage: StorageService = None):
        self.storage = storage or get_storage()

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

        work_dir = output_dir or tempfile.mkdtemp(prefix="guitar_pipeline_")
        os.makedirs(work_dir, exist_ok=True)

        # Use actual video duration if not provided
        if duration <= 0:
            duration = get_video_duration(video_path)

        try:
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
            if output_dir is None and os.path.exists(work_dir):
                import shutil
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

        # Save score JSON to storage
        import json
        score_key = f"{course_id}_score.json"
        score_path_local = os.path.join(tempfile.mkdtemp(), score_key)
        with open(score_path_local, "w", encoding="utf-8") as f:
            json.dump(score, f, ensure_ascii=False)

        with open(score_path_local, "rb") as f:
            storage_path = self.storage.save(score_key, f)

        course.score_path = storage_path
        course.status = "ready"
        db_session.commit()
        db_session.refresh(course)

        return course
