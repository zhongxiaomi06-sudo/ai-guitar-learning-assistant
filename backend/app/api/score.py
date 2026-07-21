"""
api/score.py
Score upload and retrieval helpers.
"""

import json
import logging
import uuid
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.course import Course as CourseModel
from app.schemas.course import CourseResponse
from app.schemas.score import CanonicalScore
from app.services.storage import FileTooLargeError, InvalidStorageKeyError, StorageService, get_storage

router = APIRouter(prefix="/api/v1/courses", tags=["scores"])
settings = get_settings()
logger = logging.getLogger(__name__)
JSON_CONTENT_TYPES = {"application/json", "text/json", "application/octet-stream", ""}


def _reject_non_standard_json_number(value: str):
    raise ValueError(f"invalid JSON number: {value}")


def _delete_score_best_effort(storage: StorageService, path: str, purpose: str) -> None:
    try:
        deleted = storage.delete(path)
    except Exception:
        logger.warning("Could not delete %s score object", purpose)
        return
    if not deleted:
        logger.warning("Could not find %s score object during cleanup", purpose)


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
        score_payload = json.loads(
            raw_score.decode("utf-8"),
            parse_constant=_reject_non_standard_json_number,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Score file is not valid UTF-8 JSON") from exc
    if not isinstance(score_payload, dict):
        raise HTTPException(status_code=422, detail="Score JSON must contain an object")

    try:
        canonical_score = CanonicalScore.model_validate(
            score_payload,
            context={"course_duration": course.duration},
        )
        serialized_score = json.dumps(
            canonical_score.model_dump(mode="json", by_alias=True),
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Score JSON is not a valid canonical score") from exc
    if len(serialized_score) > settings.max_score_upload_bytes:
        raise HTTPException(status_code=413, detail="Score upload is too large")

    # A unique object key keeps an existing score intact until the database
    # reference has successfully switched to this upload.
    score_key = f"{course_id}_score_{uuid.uuid4().hex[:8]}.json"

    try:
        storage_path = storage.save(
            score_key,
            BytesIO(serialized_score),
            max_bytes=settings.max_score_upload_bytes,
        )
    except FileTooLargeError as exc:
        raise HTTPException(status_code=413, detail="Score upload is too large") from exc
    except InvalidStorageKeyError as exc:
        raise HTTPException(status_code=400, detail="Invalid storage key") from exc

    previous_score_path = course.score_path
    from sqlalchemy import update

    score_match = CourseModel.score_path.is_(None)
    if previous_score_path is not None:
        score_match = CourseModel.score_path == previous_score_path
    try:
        result = db.execute(
            update(CourseModel)
            .where(CourseModel.id == course_id, score_match)
            .values(
                score_path=storage_path,
                status="ready",
                progress=100,
                duration=course.duration or canonical_score.duration,
                bpm=round(canonical_score.bpm),
                time_signature=(
                    f"{canonical_score.time_signature[0]}/"
                    f"{canonical_score.time_signature[1]}"
                ),
                key=canonical_score.key,
            ),
            execution_options={"synchronize_session": "fetch"},
        )
        if result.rowcount != 1:
            db.rollback()
            _delete_score_best_effort(storage, storage_path, "superseded")
            raise HTTPException(status_code=409, detail="Course score changed; retry the upload")
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        _delete_score_best_effort(storage, storage_path, "uncommitted")
        raise
    if previous_score_path and previous_score_path != storage_path:
        _delete_score_best_effort(storage, previous_score_path, "previous")
    db.refresh(course)
    return course
