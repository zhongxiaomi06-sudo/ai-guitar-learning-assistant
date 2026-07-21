"""
api/courses.py
Course endpoints: upload, list, detail, delete, video/score access.
"""

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.course import Course as CourseModel
from app.schemas.course import CourseCreate, CourseResponse, CourseUpdate
from app.services.storage import get_storage, StorageService

router = APIRouter(prefix="/api/v1/courses", tags=["courses"])


@router.post("/upload", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
async def upload_course(
    title: Optional[str] = Form(None),
    video: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage),
):
    """Upload a local video file and create a course."""
    course_id = uuid.uuid4().hex[:12]
    filename = video.filename or "video.mp4"
    ext = filename.split(".")[-1].lower()
    video_key = f"{course_id}.{ext}"

    storage_path = storage.save(video_key, video.file)

    course = CourseModel(
        id=course_id,
        title=title or filename,
        video_path=storage_path,
        status="pending",
        progress=0,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.post("/from-url", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
async def create_from_url(
    payload: CourseCreate,
    db: Session = Depends(get_db),
):
    """Create a course from a video URL. The actual download is a future async task."""
    course_id = uuid.uuid4().hex[:12]
    course = CourseModel(
        id=course_id,
        title=payload.title,
        source_url=payload.source_url,
        status="pending",
        progress=0,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.get("", response_model=List[CourseResponse])
async def list_courses(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """List all courses."""
    return db.query(CourseModel).order_by(CourseModel.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/{course_id}", response_model=CourseResponse)
async def get_course(
    course_id: str,
    db: Session = Depends(get_db),
):
    """Get course details."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.patch("/{course_id}", response_model=CourseResponse)
async def update_course(
    course_id: str,
    payload: CourseUpdate,
    db: Session = Depends(get_db),
):
    """Update course metadata."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, field, value)

    db.commit()
    db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: str,
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage),
):
    """Delete a course and its stored files."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if course.video_path:
        storage.delete(course.video_path)
    if course.score_path:
        storage.delete(course.score_path)

    db.delete(course)
    db.commit()
    return None


@router.get("/{course_id}/video")
async def get_video(
    course_id: str,
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage),
):
    """Stream the course video file."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course or not course.video_path:
        raise HTTPException(status_code=404, detail="Video not found")

    local_path = storage.get_path(course.video_path)
    if not local_path:
        raise HTTPException(status_code=404, detail="Video file not found")

    return FileResponse(local_path, media_type="video/mp4")


@router.get("/{course_id}/score")
async def get_score(
    course_id: str,
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage),
):
    """Return the course score JSON."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course or not course.score_path:
        raise HTTPException(status_code=404, detail="Score not found")

    local_path = storage.get_path(course.score_path)
    if not local_path:
        raise HTTPException(status_code=404, detail="Score file not found")

    return FileResponse(local_path, media_type="application/json")
