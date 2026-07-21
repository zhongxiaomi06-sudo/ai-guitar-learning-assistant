"""
scripts/seed_demo.py
Seed a local demo course that uses the pre-built demo video and score.

Usage:
    cd backend
    .venv\\Scripts\\activate
    python scripts/seed_demo.py

The script will:
1. Create the database tables if they don't exist.
2. Look for the demo video in storage/videos/.
3. Look for the demo score in storage/scores/.
4. Create a course record in the database pointing to these files.
5. Print the demo course ID and URLs for the frontend.
"""

import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models.course import Course
from app.schemas.score import CanonicalScore
from app.services.storage import LocalStorageService, get_storage


DEMO_VIDEO_FILENAMES = [
    "bcf4b374c965.mp4",
]

DEMO_SCORE_FILENAMES = [
    "bcf4b374c965_score.json",
    "bcf4b374c965_auto_score.json",
]


def _find_demo_file(base: Path, candidates: list, subfolder: str) -> Path:
    for name in candidates:
        path = base / subfolder / name
        if path.is_file():
            return path
    return None


def main():
    settings = get_settings()
    storage = get_storage()

    if not isinstance(storage, LocalStorageService):
        print("seed_demo.py only supports local filesystem storage", file=sys.stderr)
        sys.exit(1)

    base_path = Path(settings.storage_local_path).resolve()
    video_path = _find_demo_file(base_path, DEMO_VIDEO_FILENAMES, "videos")
    score_path = _find_demo_file(base_path, DEMO_SCORE_FILENAMES, "scores")

    if not video_path:
        print(f"Demo video not found in {base_path / 'videos'}", file=sys.stderr)
        print("Please run the pipeline first or place a demo video in storage/videos/", file=sys.stderr)
        sys.exit(1)

    if not score_path:
        print(f"Demo score not found in {base_path / 'scores'}", file=sys.stderr)
        print("Please run the pipeline first or place a demo score in storage/scores/", file=sys.stderr)
        sys.exit(1)

    # Validate the score so we can copy the correct metadata into the course.
    try:
        score = CanonicalScore.model_validate_json(score_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Demo score is not a valid canonical score: {exc}", file=sys.stderr)
        sys.exit(1)

    # Create tables if needed.
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Re-use an existing demo course if one already points to this score.
        existing = db.query(Course).filter(Course.score_path == f"scores/{score_path.name}").first()
        if existing:
            print(f"Demo course already exists: {existing.id}")
        else:
            course_id = f"demo_{uuid.uuid4().hex[:8]}"
            course = Course(
                id=course_id,
                title="拥抱 - 演示课程",
                video_path=f"videos/{video_path.name}",
                score_path=f"scores/{score_path.name}",
                source_url="",
                duration=score.duration,
                bpm=round(score.bpm),
                time_signature=f"{score.time_signature[0]}/{score.time_signature[1]}",
                key=score.key or "C",
                status="ready",
                progress=100,
                metadata_json={
                    "demo": True,
                    "seeded_at": score_path.stat().st_mtime,
                },
            )
            db.add(course)
            db.commit()
            db.refresh(course)
            existing = course
            print(f"Created demo course: {existing.id}")

        print(f"  Title: {existing.title}")
        print(f"  Video: {existing.video_path}")
        print(f"  Score: {existing.score_path}")
        print(f"  Duration: {existing.duration}s")
        print(f"  BPM: {existing.bpm}")
        print(f"  Time signature: {existing.time_signature}")
        print(f"  Status: {existing.status}")
        print()
        print(f"  Open in frontend: http://localhost:5173/?course={existing.id}#/home")
        print(f"  Health check: http://127.0.0.1:8000/health")
        print(f"  Course API: http://127.0.0.1:8000/api/v1/courses/{existing.id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
