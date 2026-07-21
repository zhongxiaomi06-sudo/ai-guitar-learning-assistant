from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

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
    # Processing state is owned by the parser/score endpoints. Allowing a
    # generic metadata PATCH to set it could create overlapping jobs or mark a
    # course ready without a score.
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    duration: Optional[float] = Field(default=None, ge=0, le=600)
    bpm: Optional[int] = Field(default=None, ge=0, le=400)
    time_signature: Optional[str] = Field(default=None, pattern=r"^\d{1,2}/\d{1,2}$")
    key: Optional[str] = Field(default=None, min_length=1, max_length=16)

    @field_validator("time_signature")
    @classmethod
    def validate_time_signature(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        numerator, denominator = (int(part) for part in value.split("/"))
        if not 1 <= numerator <= 32 or denominator not in {1, 2, 4, 8, 16}:
            raise ValueError("unsupported time signature")
        return value


class CourseResponse(CourseBase):
    id: str
    video_path: Optional[str] = None
    score_path: Optional[str] = None
    status: CourseStatus
    progress: int = Field(ge=0, le=100)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)
