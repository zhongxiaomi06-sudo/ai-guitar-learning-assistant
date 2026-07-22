import logging

from app.database import SessionLocal
from app.models.course import Course
from app.services import audio_pipeline
from app.tasks.transcribe import transcribe_course_task


class FailingPipeline:
    def process_course(self, course_id, db_session):
        raise RuntimeError("signed-url-secret")


def _create_course(status):
    db = SessionLocal()
    try:
        course = Course(
            id=f"course-{status}",
            title="Task state",
            video_path="video.mp4",
            status=status,
            progress=50,
        )
        db.add(course)
        db.commit()
        return course.id
    finally:
        db.close()


def _course_state(course_id):
    db = SessionLocal()
    try:
        course = db.query(Course).filter(Course.id == course_id).one()
        return course.status, course.progress
    finally:
        db.close()


def test_failed_task_only_marks_a_course_it_still_owns(monkeypatch, caplog):
    processing_id = _create_course("processing")
    ready_id = _create_course("ready")
    monkeypatch.setattr(audio_pipeline, "AudioPipeline", FailingPipeline)

    with caplog.at_level(logging.ERROR):
        transcribe_course_task(processing_id)
        transcribe_course_task(ready_id)

    assert _course_state(processing_id) == ("error", 0)
    assert _course_state(ready_id) == ("ready", 50)
    assert "signed-url-secret" not in caplog.text
