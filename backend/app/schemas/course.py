from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

CourseStatus = Literal["pending", "processing", "ready", "error", "completed"]


class CourseBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(..., min_length=1, max_length=255)
    source_url: Optional[str] = None
    duration: float = Field(default=0.0, ge=0, le=86400)
    bpm: int = Field(default=0, ge=0, le=400)
    time_signature: str = Field(default="4/4", pattern=r"^\d{1,2}/\d{1,2}$")
    key: str = Field(default="C", min_length=1, max_length=16)
    metadata_json: Dict[str, Any] = Field(default_factory=dict)


class CourseCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(..., min_length=1, max_length=255)
    source_url: HttpUrl


class CourseUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    duration: Optional[float] = Field(default=None, ge=0, le=86400)
    bpm: Optional[int] = Field(default=None, ge=0, le=400)
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    status: Optional[CourseStatus] = None


class CourseResponse(CourseBase):
    id: str
    video_path: Optional[str] = None
    score_path: Optional[str] = None
    status: CourseStatus
    progress: int = Field(ge=0, le=100)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)
