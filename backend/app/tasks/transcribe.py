"""
tasks/transcribe.py
Celery task placeholder for async transcription.
For now, the pipeline is run synchronously via the API endpoint.
"""

import logging

logger = logging.getLogger(__name__)


def transcribe_course_task(course_id: str):
    """Celery task: transcribe a course video to a score.

    This is a placeholder; actual Celery integration will be added in stage 3.
    For now, use the synchronous endpoint in api/courses.py.
    """
    logger.info("transcribe_course_task called for %s (Celery not yet wired)", course_id)
    raise NotImplementedError("Celery integration is pending")
