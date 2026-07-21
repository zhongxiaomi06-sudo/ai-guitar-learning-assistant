"""
api/practice.py
Endpoints for practice results, segments, and the unified timeline.
"""

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.practice_result import PracticeResult as PracticeResultModel
from app.schemas.practice_result import (
    PracticeResultCreate,
    PracticeResultResponse,
    PracticeResultSummary,
)
from app.services.segments import get_segments
from app.services.storage import StorageService, get_storage
from app.services.timeline import get_timeline

router = APIRouter(prefix="/api/v1", tags=["practice"])


@router.get("/courses/{course_id}/timeline", response_model=List[Dict[str, Any]])
async def get_course_timeline(
    course_id: str,
    storage: StorageService = Depends(get_storage),
):
    """Return a unified, seekable timeline for the course score."""
    timeline, error = get_timeline(course_id, storage)
    if error:
        raise HTTPException(status_code=404, detail=error)
    return timeline


@router.get("/courses/{course_id}/segments", response_model=List[Dict[str, Any]])
async def get_course_segments(
    course_id: str,
    storage: StorageService = Depends(get_storage),
):
    """Return auto-generated practice segments for the course score."""
    segments, error = get_segments(course_id, storage)
    if error:
        raise HTTPException(status_code=404, detail=error)
    return segments


@router.post("/practice/results", response_model=PracticeResultResponse, status_code=201)
async def create_practice_result(
    payload: PracticeResultCreate,
    db: Session = Depends(get_db),
):
    """Store a single detected practice event."""
    result = PracticeResultModel(
        course_id=payload.course_id,
        segment_id=payload.segment_id,
        target_event_id=payload.target_event_id,
        detected_pitch=payload.detected_pitch,
        detected_time=payload.detected_time,
        result_type=payload.result_type,
        timing_offset=payload.timing_offset,
        confidence=payload.confidence,
        error_type=payload.error_type,
        session_id=payload.session_id,
        metadata_json=payload.metadata_json,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


@router.get("/practice/results", response_model=List[PracticeResultResponse])
async def list_practice_results(
    course_id: str = Query(None),
    segment_id: str = Query(None),
    session_id: str = Query(None),
    result_type: str = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List stored practice results with optional filters."""
    query = db.query(PracticeResultModel)
    if course_id:
        query = query.filter(PracticeResultModel.course_id == course_id)
    if segment_id:
        query = query.filter(PracticeResultModel.segment_id == segment_id)
    if session_id:
        query = query.filter(PracticeResultModel.session_id == session_id)
    if result_type:
        query = query.filter(PracticeResultModel.result_type == result_type)
    return query.order_by(PracticeResultModel.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/practice/summary/{course_id}", response_model=PracticeResultSummary)
async def get_practice_summary(
    course_id: str,
    segment_id: str = Query(None),
    session_id: str = Query(None),
    db: Session = Depends(get_db),
):
    """Return aggregated statistics for a course, segment, or session."""
    query = db.query(PracticeResultModel).filter(PracticeResultModel.course_id == course_id)
    if segment_id:
        query = query.filter(PracticeResultModel.segment_id == segment_id)
    if session_id:
        query = query.filter(PracticeResultModel.session_id == session_id)

    total = query.count()
    if total == 0:
        return PracticeResultSummary(
            course_id=course_id,
            segment_id=segment_id,
            session_id=session_id,
            total=0,
            correct=0,
            wrong_pitch=0,
            wrong_chord=0,
            miss=0,
            extra=0,
            timing=0,
            accuracy=0.0,
            average_timing_offset_ms=0.0,
        )

    counts = {
        row[0]: row[1]
        for row in query.with_entities(
            PracticeResultModel.result_type,
            func.count(PracticeResultModel.id),
        ).group_by(PracticeResultModel.result_type)
        .all()
    }
    avg_timing = query.with_entities(func.avg(PracticeResultModel.timing_offset)).scalar() or 0.0

    correct = counts.get("correct", 0)
    accuracy = correct / total if total else 0.0

    return PracticeResultSummary(
        course_id=course_id,
        segment_id=segment_id,
        session_id=session_id,
        total=total,
        correct=correct,
        wrong_pitch=counts.get("wrong-pitch", 0),
        wrong_chord=counts.get("wrong-chord", 0),
        miss=counts.get("miss", 0),
        extra=counts.get("extra", 0),
        timing=counts.get("timing", 0),
        accuracy=round(accuracy, 4),
        average_timing_offset_ms=round(avg_timing * 1000, 2),
    )
