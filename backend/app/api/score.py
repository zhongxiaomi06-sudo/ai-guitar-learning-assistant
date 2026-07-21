"""
api/score.py
Score upload and retrieval helpers.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.course import Course as CourseModel
from app.schemas.course import CourseResponse
from app.services.storage import get_storage, StorageService

router = APIRouter(prefix="/api/v1/courses", tags=["scores"])


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
    ext = filename.split(".")[-1].lower()
    score_key = f"{course_id}_score.{ext}"

    storage_path = storage.save(score_key, score.file)
    course.score_path = storage_path
    course.status = "ready"
    db.commit()
    db.refresh(course)
    return course
