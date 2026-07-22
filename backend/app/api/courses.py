"""
api/courses.py
Course endpoints: upload, list, detail, delete, video/score access.
"""

import mimetypes
import uuid
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote, urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.course import Course as CourseModel
from app.schemas.course import CourseCreate, CourseResponse, CourseUpdate
from app.services.quality_check import analyze_audio
from app.services.storage import FileTooLargeError, InvalidStorageKeyError, StorageService, get_storage
from app.services.transcription import extract_audio
from app.tasks.transcribe import transcribe_course_task

router = APIRouter(prefix="/api/v1/courses", tags=["courses"])
settings = get_settings()

VIDEO_CONTENT_TYPES = {
    ".mp4": {"video/mp4", "application/mp4", "application/octet-stream"},
    ".mov": {"video/quicktime", "application/octet-stream"},
    ".webm": {"video/webm", "application/octet-stream"},
}


def _storage_response(location: str, media_type: Optional[str] = None):
    """Serve local files and redirect object-storage URLs without confusing FileResponse."""
    if urlparse(location).scheme in {"http", "https"}:
        return RedirectResponse(location, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    resolved_media_type = media_type or mimetypes.guess_type(location)[0] or "application/octet-stream"
    return FileResponse(location, media_type=resolved_media_type)


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
    suffix = Path(filename).suffix.lower()
    allowed_content_types = VIDEO_CONTENT_TYPES.get(suffix)
    content_type = (video.content_type or "").partition(";")[0].lower()

    if not allowed_content_types or (content_type and content_type not in allowed_content_types):
        raise HTTPException(status_code=415, detail="Only MP4, MOV, and WebM video uploads are supported")
    if video.size is not None and video.size > settings.max_video_upload_bytes:
        raise HTTPException(status_code=413, detail="Video upload is too large")

    clean_title = (title or filename).strip()
    if not clean_title or len(clean_title) > 255:
        raise HTTPException(status_code=422, detail="Title must contain 1 to 255 characters")
    video_key = f"{course_id}{suffix}"

    try:
        storage_path = storage.save(video_key, video.file, max_bytes=settings.max_video_upload_bytes)
    except FileTooLargeError as exc:
        raise HTTPException(status_code=413, detail="Video upload is too large") from exc
    except InvalidStorageKeyError as exc:
        raise HTTPException(status_code=400, detail="Invalid storage key") from exc

    course = CourseModel(
        id=course_id,
        title=clean_title,
        video_path=storage_path,
        status="pending",
        progress=0,
    )
    try:
        db.add(course)
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(storage_path)
        raise
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
        source_url=str(payload.source_url),
        status="pending",
        progress=0,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.get("", response_model=List[CourseResponse])
async def list_courses(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
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
        if field == "title" and value is not None:
            value = value.strip()
            if not value:
                raise HTTPException(status_code=422, detail="Title cannot be blank")
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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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

    media_type = mimetypes.guess_type(course.video_path)[0]
    if settings.media_accel_redirect_prefix:
        internal_uri = f"{settings.media_accel_redirect_prefix}{quote(Path(local_path).name)}"
        return Response(
            status_code=status.HTTP_200_OK,
            media_type=media_type,
            headers={
                "X-Accel-Redirect": internal_uri,
                "Cache-Control": "public, max-age=3600, immutable",
            },
        )
    return _storage_response(local_path, media_type=media_type)


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

    return _storage_response(local_path, media_type="application/json")


@router.post("/{course_id}/quality")
async def check_quality(
    course_id: str,
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage),
):
    """Extract audio and report input quality for the uploaded video."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course or not course.video_path:
        raise HTTPException(status_code=404, detail="Video not found")

    local_path = storage.get_path(course.video_path)
    if not local_path:
        raise HTTPException(status_code=404, detail="Video file not found")

    import tempfile

    with tempfile.TemporaryDirectory(prefix="guitar_quality_") as work_dir:
        audio_path = f"{work_dir}/analysis.wav"
        try:
            extract_audio(local_path, audio_path, sample_rate=22050)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Audio extraction failed: {exc}",
            ) from exc

        ok, report = analyze_audio(audio_path)
        # Store the report in course metadata so the UI can show it later.
        metadata = dict(course.metadata_json or {})
        metadata["quality_check"] = report
        course.metadata_json = metadata
        db.commit()
        db.refresh(course)
        return {"ok": ok, "report": report}


@router.post(
    "/{course_id}/parse",
    response_model=CourseResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def parse_course(
    course_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage),
):
    """Queue the audio → tab pipeline without blocking the API event loop."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if not course.video_path:
        raise HTTPException(status_code=400, detail="Course has no video")
    if course.status == "processing":
        raise HTTPException(status_code=409, detail="Course is already being parsed")
    if course.status == "ready" and course.score_path:
        return course
    if not storage.get_path(course.video_path):
        raise HTTPException(status_code=404, detail="Video file not found")

    # Atomically claim the course using the state we just observed. Without a
    # compare-and-set, two near-simultaneous requests can both enqueue an
    # expensive transcription task before either session sees "processing".
    expected_status = course.status
    expected_score_path = course.score_path
    claim = db.query(CourseModel).filter(
        CourseModel.id == course_id,
        CourseModel.status == expected_status,
    )
    if expected_score_path is None:
        claim = claim.filter(CourseModel.score_path.is_(None))
    else:
        claim = claim.filter(CourseModel.score_path == expected_score_path)

    try:
        claimed = claim.update(
            {CourseModel.status: "processing", CourseModel.progress: 1},
            synchronize_session=False,
        )
        if claimed != 1:
            db.rollback()
            raise HTTPException(status_code=409, detail="Course state changed; retry the request")
        db.commit()
        db.refresh(course)
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise

    background_tasks.add_task(transcribe_course_task, course_id)
    return course
