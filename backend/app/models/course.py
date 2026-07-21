from sqlalchemy import Column, String, Integer, Float, DateTime, JSON, Text
from sqlalchemy.sql import func

from app.database import Base


class Course(Base):
    """Course / project metadata for a guitar learning session."""

    __tablename__ = "courses"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    source_url = Column(Text, nullable=True)
    video_path = Column(String, nullable=True)  # storage key or local path
    score_path = Column(String, nullable=True)  # storage key or local path
    duration = Column(Float, default=0.0)
    bpm = Column(Integer, default=0)
    time_signature = Column(String, default="4/4")
    key = Column(String, default="C")
    metadata_json = Column(JSON, default=dict)
    status = Column(String, default="pending")  # pending / processing / ready / error / completed
    progress = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
