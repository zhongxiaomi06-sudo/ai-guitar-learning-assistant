"""
services/timeline.py
Build a unified, seekable timeline of performance events from a Canonical Score.

The timeline is the central contract between the backend score and the frontend
player: every event carries a video time, an audio time, pitch/string/fret data,
and enough hand-shape hints for the UI to render fretboard / picking diagrams
without re-implementing music-theory logic in the browser.
"""

import json
import math
from typing import Any, Dict, List, Optional, Tuple

from app.services.storage import StorageService, get_storage


# Standard tuning, string 1 (high E) to string 6 (low E).
STRING_OPEN_MIDI = (64, 59, 55, 50, 45, 40)


def _chord_name(notes: List[Dict[str, Any]]) -> Optional[str]:
    """Derive a simple chord label from simultaneous notes.

    For MVP we label common triads built from the root. This is a presentation
    hint only; the frontend may display or ignore it.
    """
    if not notes:
        return None
    pitches = sorted({note["midi"] % 12 for note in notes})
    if not pitches:
        return None

    root = pitches[0]
    root_name = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][root]

    # Simple major / minor / power triad detection by pitch classes.
    semitones = {(p - root) % 12 for p in pitches}
    if {4, 7}.issubset(semitones):
        return root_name
    if {3, 7}.issubset(semitones):
        return f"{root_name}m"
    if {7}.issubset(semitones):
        return f"{root_name}5"
    return root_name


def _midi_to_note_name(midi: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return names[midi % 12] + str(midi // 12 - 1)


def _finger_for_fret(fret: int) -> int:
    """Pick a sensible left-hand finger for a fretted note (1-4)."""
    if fret == 0:
        return 0
    # Very rough mapping; a real fingering engine would consider context.
    return ((fret - 1) % 4) + 1


def _hand_shape(note: Dict[str, Any]) -> Dict[str, Any]:
    """Generate a left-hand shape hint for a single note."""
    string = note["string"]
    fret = note["fret"]
    return {
        "type": "open" if fret == 0 else "single",
        "fingerPositions": [
            {
                "finger": _finger_for_fret(fret),
                "string": string,
                "fret": fret,
            }
        ],
    }


def _pick_shape(note: Dict[str, Any], direction: str = "down") -> Dict[str, Any]:
    """Generate a right-hand picking hint for a single note."""
    return {
        "direction": direction,
        "strings": [note["string"]],
        "finger": "i" if note["string"] <= 3 else "m",
    }


def _build_event(
    event_id: str,
    course_id: str,
    bar_index: int,
    beat_index: int,
    note: Dict[str, Any],
) -> Dict[str, Any]:
    """Create a single PerformanceEvent-like object from a score note."""
    string_number = note["string"]
    fret = note["fret"]
    midi = note["midi"]
    open_midi = STRING_OPEN_MIDI[string_number - 1]
    # Audio time is the same as the video time for this MVP (no A/V offset).
    video_time = note["startTime"]
    audio_time = note["startTime"]

    return {
        "id": event_id,
        "courseId": course_id,
        "measureIndex": bar_index,
        "beatIndex": beat_index,
        "type": "note",
        "startTime": note["startTime"],
        "endTime": note["endTime"],
        "beatPosition": beat_index + 1,
        "pitch": midi,
        "pitchName": _midi_to_note_name(midi),
        "string": string_number,
        "fret": fret,
        "chord": None,  # populated by the chord grouping pass below
        "fingering": {
            "finger": _finger_for_fret(fret),
            "string": string_number,
            "fret": fret,
        },
        "leftHandShape": _hand_shape(note),
        "rightHandShape": _pick_shape(note),
        "tolerance": 0.08,  # 80 ms teaching-friendly tolerance
        "confidence": 1.0,
        "videoTime": video_time,
        "audioTime": audio_time,
        "openMidi": open_midi,
    }


def build_timeline(course_id: str, score: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten a Canonical Score into a sorted list of unified timeline events.

    Args:
        course_id: the course identifier
        score: parsed Canonical Score JSON

    Returns:
        List of event dictionaries compatible with PROJECT.md section 7.4.
    """
    events: List[Dict[str, Any]] = []
    event_counter = 0

    for bar_index, bar in enumerate(score.get("bars", []), start=1):
        for beat_index, beat in enumerate(bar.get("beats", []), start=1):
            beat_notes = beat.get("notes", [])
            chord = _chord_name(beat_notes)
            for note in beat_notes:
                event_counter += 1
                event_id = f"evt_{course_id}_{event_counter:04d}"
                event = _build_event(
                    event_id=event_id,
                    course_id=course_id,
                    bar_index=bar_index,
                    beat_index=beat_index,
                    note=note,
                )
                event["chord"] = chord
                events.append(event)

    events.sort(key=lambda e: (e["startTime"], e["string"]))
    return events


def get_timeline(
    course_id: str,
    storage: StorageService,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Load a course score and return its timeline.

    Returns:
        (timeline, None) on success, or (None, error_message) on failure.
    """
    from app.models.course import Course as CourseModel

    # Avoid importing heavy database modules at module load time.
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

    return build_timeline(course_id, score), None
