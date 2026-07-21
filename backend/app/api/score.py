"""
api/score.py
Score upload and retrieval helpers.
"""

import json
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.course import Course as CourseModel
from app.schemas.course import CourseResponse
from app.services.storage import FileTooLargeError, InvalidStorageKeyError, StorageService, get_storage

router = APIRouter(prefix="/api/v1/courses", tags=["scores"])
settings = get_settings()
JSON_CONTENT_TYPES = {"application/json", "text/json", "application/octet-stream", ""}


@router.post("/{course_id}/score", response_model=CourseResponse)
async def upload_score(
    course_id: str,
    score: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage),
):
    """Upload a score JSON for an existing course."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    filename = score.filename or "score.json"
    content_type = (score.content_type or "").partition(";")[0].lower()
    if not filename.lower().endswith(".json") or content_type not in JSON_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Score uploads must be JSON files")
    if score.size is not None and score.size > settings.max_score_upload_bytes:
        raise HTTPException(status_code=413, detail="Score upload is too large")

    raw_score = await score.read(settings.max_score_upload_bytes + 1)
    if len(raw_score) > settings.max_score_upload_bytes:
        raise HTTPException(status_code=413, detail="Score upload is too large")
    try:
        score_payload = json.loads(raw_score.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Score file is not valid UTF-8 JSON") from exc
    if not isinstance(score_payload, dict):
        raise HTTPException(status_code=422, detail="Score JSON must contain an object")
    if "bars" in score_payload and not isinstance(score_payload["bars"], list):
        raise HTTPException(status_code=422, detail="Score JSON 'bars' must be an array")

    score_key = f"{course_id}_score.json"

    try:
        storage_path = storage.save(
            score_key,
            BytesIO(raw_score),
            max_bytes=settings.max_score_upload_bytes,
        )
    except FileTooLargeError as exc:
        raise HTTPException(status_code=413, detail="Score upload is too large") from exc
    except InvalidStorageKeyError as exc:
        raise HTTPException(status_code=400, detail="Invalid storage key") from exc

    previous_score_path = course.score_path
    course.score_path = storage_path
    course.status = "ready"
    course.progress = 100
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(storage_path)
        raise
    if previous_score_path and previous_score_path != storage_path:
        storage.delete(previous_score_path)
    db.refresh(course)
    return course
