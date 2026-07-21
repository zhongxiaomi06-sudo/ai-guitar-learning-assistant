"""
services/segments.py
Generate practice segments from a Canonical Score.

Segments divide a piece into learnable chunks (intro, theme, transitions,
outro). Each segment carries difficulty hints and pass criteria so the
adaptive practice engine can decide what to loop, slow down, or skip.
"""

import json
from typing import Any, Dict, List, Optional, Tuple

from app.services.storage import StorageService, get_storage


DEFAULT_SEGMENT_LENGTH_BARS = 4


def _segment_name(index: int, start_bar: int, end_bar: int) -> str:
    """Assign a readable name based on position."""
    labels = [
        ("前奏", 0),
        ("主题句", 1),
        ("过渡段", 2),
        ("副歌", 3),
        ("结尾", 4),
    ]
    for label, mod in labels:
        if start_bar <= mod + 1:
            return label
    if end_bar >= 13:
        return "结尾"
    return f"片段 {index + 1}"


def _segment_tags(notes: List[Dict[str, Any]]) -> List[str]:
    """Tag a segment based on its notes."""
    if not notes:
        return []
    tags: List[str] = []
    frets = {note["fret"] for note in notes}
    strings = {note["string"] for note in notes}
    max_fret = max((note["fret"] for note in notes), default=0)
    min_fret = min((note["fret"] for note in notes), default=0)
    if max_fret - min_fret >= 4:
        tags.append("快速换把")
    if max_fret >= 5:
        tags.append("大跨度移动")
    if len(strings) >= 3:
        tags.append("交替拨弦")
    if max_fret == 0 and min_fret == 0:
        tags.append("空弦为主")
    if max_fret >= 7:
        tags.append("横按和弦")
    return tags[:3]


def _segment_difficulty(notes: List[Dict[str, Any]]) -> Tuple[int, int]:
    """Estimate left-hand and right-hand difficulty on a 1-5 scale."""
    if not notes:
        return 1, 1

    frets = [note["fret"] for note in notes]
    strings = {note["string"] for note in notes}
    fret_range = max(frets) - min(frets)

    left = 1 + min(4, max(fret_range // 3, max(frets) // 5))
    right = 1 + min(4, len(strings) - 1)
    return left, right


def _pass_criteria(difficulty: int) -> Dict[str, Any]:
    """Return pass criteria scaled to segment difficulty."""
    return {
        "minAccuracy": max(0.75, 0.95 - difficulty * 0.04),
        "minChordCompleteness": max(0.70, 0.90 - difficulty * 0.03),
        "maxTimingErrors": max(3, 6 - difficulty),
        "consecutiveCorrect": 2,
    }


def build_segments(course_id: str, score: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Split a Canonical Score into practice segments.

    Args:
        course_id: the course identifier
        score: parsed Canonical Score JSON

    Returns:
        List of PracticeSegment-like objects.
    """
    bars = score.get("bars", [])
    if not bars:
        return []

    segments: List[Dict[str, Any]] = []
    segment_length = DEFAULT_SEGMENT_LENGTH_BARS
    total_bars = len(bars)

    start_bar = 0
    segment_index = 0
    while start_bar < total_bars:
        # Adjust the last segment so it is not too short.
        remaining = total_bars - start_bar
        if remaining <= segment_length + 1:
            end_bar = total_bars
        else:
            end_bar = start_bar + segment_length

        segment_bars = bars[start_bar:end_bar]
        notes: List[Dict[str, Any]] = []
        for bar in segment_bars:
            for beat in bar.get("beats", []):
                notes.extend(beat.get("notes", []))

        start_time = segment_bars[0]["startTime"]
        end_time = segment_bars[-1]["endTime"]
        left_diff, right_diff = _segment_difficulty(notes)
        difficulty = max(left_diff, right_diff)

        segments.append({
            "id": f"seg_{course_id}_{segment_index + 1:02d}",
            "courseId": course_id,
            "startMeasure": start_bar + 1,
            "endMeasure": end_bar,
            "startTime": start_time,
            "endTime": end_time,
            "speed": 1.0,
            "targetErrorTypes": [],
            "passCriteria": _pass_criteria(difficulty),
            "status": "locked" if segment_index > 0 else "practicing",
            "name": _segment_name(segment_index, start_bar + 1, end_bar),
            "difficulty": difficulty,
            "leftDifficulty": left_diff,
            "rightDifficulty": right_diff,
            "tags": _segment_tags(notes),
        })

        start_bar = end_bar
        segment_index += 1

    return segments


def get_segments(
    course_id: str,
    storage: StorageService,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Load a course score and return its practice segments."""
    from app.models.course import Course as CourseModel
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
        if not course or not course.score_path:
            return None, "Score not found for this course"
    finally:
        db.close()

    local_path = storage.get_path(course.score_path)
    if not local_path:
        return None, "Score file not found"

    try:
        with open(local_path, "r", encoding="utf-8") as f:
            score = json.load(f)
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return None, "Score file is not valid JSON"

    return build_segments(course_id, score), None
