"""
schemas/practice_result.py
Pydantic models for practice result submission and querying.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


class PracticeResultCreate(BaseModel):
    """A single event detected during practice."""

    course_id: str = Field(min_length=1, max_length=255)
    segment_id: Optional[str] = Field(default=None, max_length=255)
    target_event_id: Optional[str] = Field(default=None, max_length=255)
    detected_pitch: Optional[float] = None
    detected_time: Optional[float] = None
    result_type: str = Field(
        pattern=r"^(correct|wrong-pitch|wrong-chord|miss|extra|timing)$",
    )
    timing_offset: float = 0.0
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    error_type: Optional[str] = Field(default=None, max_length=255)
    session_id: Optional[str] = Field(default=None, max_length=255)
    metadata_json: Dict[str, Any] = Field(default_factory=dict)


class PracticeResultResponse(PracticeResultCreate):
    """Stored practice result with its server-assigned id."""

    id: str

    model_config = {"from_attributes": True}


class PracticeResultSummary(BaseModel):
    """Aggregated summary for a course or segment."""

    course_id: str
    segment_id: Optional[str] = None
    session_id: Optional[str] = None
    total: int
    correct: int
    wrong_pitch: int
    wrong_chord: int
    miss: int
    extra: int
    timing: int
    accuracy: float = Field(ge=0.0, le=1.0)
    average_timing_offset_ms: float


class PracticeResultFilter(BaseModel):
    """Query parameters for listing practice results."""

    course_id: Optional[str] = None
    segment_id: Optional[str] = None
    session_id: Optional[str] = None
    result_type: Optional[str] = None
    limit: int = Field(default=100, ge=1, le=1000)
    skip: int = Field(default=0, ge=0)
