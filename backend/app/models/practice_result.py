"""
models/practice_result.py
Stored result of a single practice attempt against a target event.
"""

import uuid

from sqlalchemy import Column, String, Integer, Float, DateTime, JSON
from sqlalchemy.sql import func

from app.database import Base


class PracticeResult(Base):
    """One detected event from a user's practice session."""

    __tablename__ = "practice_results"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    course_id = Column(String, nullable=False, index=True)
    segment_id = Column(String, nullable=True, index=True)
    target_event_id = Column(String, nullable=True, index=True)
    detected_pitch = Column(Float, nullable=True)
    detected_time = Column(Float, nullable=True)
    result_type = Column(String, nullable=False)  # correct / wrong-pitch / wrong-chord / miss / extra / timing
    timing_offset = Column(Float, default=0.0)
    confidence = Column(Float, default=0.0)
    error_type = Column(String, nullable=True)
    session_id = Column(String, nullable=True, index=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<PracticeResult {self.id} {self.result_type}>"
