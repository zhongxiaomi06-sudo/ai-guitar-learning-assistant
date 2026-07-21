"""Background audio-to-tab task with an isolated database session."""

import logging

logger = logging.getLogger(__name__)


def transcribe_course_task(course_id: str):
    """Transcribe one course after the HTTP response has been returned.

    FastAPI executes this sync function in its background thread pool. A fresh
    SQLAlchemy session is required because request-scoped sessions are closed
    as soon as the response lifecycle ends.
    """
    from app.database import SessionLocal
    from app.models.course import Course as CourseModel
    from app.services.audio_pipeline import AudioPipeline
    from app.services.pipeline_errors import PipelineError

    db = SessionLocal()
    try:
        AudioPipeline().process_course(course_id, db)
    except Exception as exc:
        db.rollback()

        error_code = "pipeline_error"
        user_message = "解析失败"
        if isinstance(exc, PipelineError):
            error_code = exc.error_code
            user_message = exc.user_message

        try:
            # A manual score upload (or a newer task) may have completed while
            # this worker was running. Only the task that still owns the
            # processing state may turn it into an error.
            course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
            if course and course.status == "processing":
                metadata = dict(course.metadata_json or {})
                metadata["last_error"] = {
                    "code": error_code,
                    "message": user_message,
                }
                db.query(CourseModel).filter(
                    CourseModel.id == course_id,
                    CourseModel.status == "processing",
                ).update(
                    {
                        CourseModel.status: "error",
                        CourseModel.progress: 0,
                        CourseModel.metadata_json: metadata,
                    },
                    synchronize_session=False,
                )
                db.commit()
        except Exception:
            db.rollback()
            logger.error(
                "Could not persist audio-to-tab failure state for course %s",
                course_id,
            )

        # Do not emit exception messages or command lines: media sources can
        # be short-lived object-storage URLs containing signed query strings.
        logger.error(
            "Audio-to-tab pipeline failed for course %s (%s)",
            course_id,
            type(exc).__name__,
        )
    finally:
        db.close()
