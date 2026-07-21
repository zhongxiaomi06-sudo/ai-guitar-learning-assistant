from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime


class CourseBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    source_url: Optional[str] = None
    duration: float = 0.0
    bpm: int = 0
    time_signature: str = "4/4"
    key: str = "C"
    metadata_json: Dict[str, Any] = Field(default_factory=dict)


class CourseCreate(CourseBase):
    pass


class CourseUpdate(BaseModel):
    title: Optional[str] = None
    duration: Optional[float] = None
    bpm: Optional[int] = None
    progress: Optional[int] = None
    status: Optional[str] = None


class CourseResponse(CourseBase):
    id: str
    video_path: Optional[str] = None
    score_path: Optional[str] = None
    status: str
    progress: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
