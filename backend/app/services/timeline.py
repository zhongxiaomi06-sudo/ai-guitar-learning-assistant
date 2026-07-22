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


def _detect_barre(positions: List[Dict[str, int]]) -> Optional[Dict[str, int]]:
    """Detect a barre across contiguous strings at the same fret.

    A barre is one finger (conventionally the index, finger 1) laid flat across
    multiple strings. Returns the barre range, or None when no plausible barre
    exists (fewer than two fretted notes on contiguous strings at one fret).
    """
    fretted = [p for p in positions if p["fret"] > 0]
    if len(fretted) < 2:
        return None
    by_fret = {}
    for pos in fretted:
        by_fret.setdefault(pos["fret"], []).append(pos["string"])
    for fret, strings in by_fret.items():
        if len(strings) < 2:
            continue
        ordered = sorted(strings)
        # Contiguous (or near-contiguous) string range → plausible barre
        if ordered[-1] - ordered[0] >= 1:
            return {
                "fret": fret,
                "stringStart": ordered[0],
                "stringEnd": ordered[-1],
                "finger": 1,
            }
    return None


def _assign_fingers(positions: List[Dict[str, int]]) -> List[Dict[str, int]]:
    """Assign fingers to a set of string/fret positions for a chord.

    Open strings use finger 0. When a barre is detected, its strings are all
    covered by finger 1 (the barre finger); remaining fretted notes draw from
    fingers 2-4 so the index is free to barre. Falls back to a modulo mapping
    when the primary fingers are exhausted.
    """
    if not positions:
        return []

    barre = _detect_barre(positions)
    barre_finger = barre["finger"] if barre else None
    # Pool of fingers available for non-barre fretted notes.
    pool = [f for f in (1, 2, 3, 4) if f != barre_finger] or [2, 3, 4]

    ordered = sorted(positions, key=lambda p: (p["fret"], -p["string"]))
    assigned = []
    used = set()

    for pos in ordered:
        if pos["fret"] == 0:
            assigned.append({**pos, "finger": 0})
            continue
        if (
            barre
            and pos["fret"] == barre["fret"]
            and barre["stringStart"] <= pos["string"] <= barre["stringEnd"]
        ):
            assigned.append({**pos, "finger": barre_finger})
            used.add(barre_finger)
            continue
        finger = next((f for f in pool if f not in used), None)
        if finger is None:
            finger = ((pos["fret"] - 1) % 4) + 1
        used.add(finger)
        assigned.append({**pos, "finger": finger})

    return sorted(assigned, key=lambda p: p["string"])


def _hand_shape(note: Dict[str, Any], chord_positions: List[Dict[str, int]] = None) -> Dict[str, Any]:
    """Generate a left-hand shape hint for a single note or chord."""
    if chord_positions:
        positions = _assign_fingers(chord_positions)
        barre = _detect_barre(chord_positions)
        return {
            "type": "chord" if len(positions) > 1 else "single",
            "fingerPositions": positions,
            "barreRange": barre,
        }

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
        "barreRange": None,
    }


def _pick_shape(notes: List[Dict[str, Any]], direction: str = "down") -> Dict[str, Any]:
    """Generate a right-hand picking hint for one or more notes."""
    strings = sorted({n["string"] for n in notes})
    # Multiple simultaneous strings suggest a strum; a single string a pluck.
    is_strum = len(strings) >= 3
    return {
        "direction": "down" if is_strum else direction,
        "strings": strings,
        "finger": "P" if is_strum else ("i" if strings and strings[0] <= 3 else "m"),
    }


def _common_fingers(current: Dict[str, Any], previous: Optional[Dict[str, Any]]) -> List[Dict[str, int]]:
    """Return finger positions retained from the previous beat's shape.

    A finger is "common" when the same finger stays on the same string and fret
    across the transition — the basis for "保留食指" style coaching hints.
    """
    if not previous or not isinstance(previous, dict):
        return []
    current_positions = current.get("fingerPositions") or []
    previous_positions = previous.get("fingerPositions") or []
    previous_set = {(p.get("finger"), p.get("string"), p.get("fret")) for p in previous_positions}
    common = []
    for pos in current_positions:
        key = (pos.get("finger"), pos.get("string"), pos.get("fret"))
        if key in previous_set and pos.get("finger"):
            common.append({
                "finger": int(pos["finger"]),
                "string": int(pos["string"]),
                "fret": int(pos["fret"]),
            })
    return common


def _next_shift(current: Optional[Dict[str, Any]], following: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Estimate the next position shift relative to the current beat.

    Compares the average fret of fretted notes in the current and following
    beat to suggest a shift direction and target. Returns None when either
    beat lacks fretted positions.
    """
    def _avg_fret(shape):
        if not shape:
            return None
        frets = [p.get("fret", 0) for p in (shape.get("fingerPositions") or []) if p.get("fret", 0) > 0]
        if not frets:
            return None
        return sum(frets) / len(frets)

    cur_avg = _avg_fret(current)
    next_avg = _avg_fret(following)
    if cur_avg is None or next_avg is None:
        return None
    delta = next_avg - cur_avg
    if abs(delta) < 0.5:
        direction = "stay"
    elif delta > 0:
        direction = "up"
    else:
        direction = "down"
    return {
        "direction": direction,
        "targetFret": int(round(next_avg)),
        "deltaFrets": round(delta, 2),
    }


def _build_event(
    event_id: str,
    course_id: str,
    bar_index: int,
    beat_index: int,
    note: Dict[str, Any],
    chord: Optional[str],
    left_hand_shape: Dict[str, Any],
    right_hand_shape: Dict[str, Any],
    av_offset: float = 0.0,
) -> Dict[str, Any]:
    """Create a single PerformanceEvent-like object from a score note."""
    string_number = note["string"]
    fret = note["fret"]
    midi = note["midi"]
    open_midi = STRING_OPEN_MIDI[string_number - 1]
    # audioTime stays in the audio-derived timeline; videoTime maps onto the
    # HTML5 video clock, accounting for any detected A/V start offset.
    audio_time = note["startTime"]
    video_time = audio_time + av_offset

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
        "chord": chord,
        "fingering": {
            "finger": _finger_for_fret(fret),
            "string": string_number,
            "fret": fret,
        },
        "leftHandShape": left_hand_shape,
        "rightHandShape": right_hand_shape,
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

    # Audio-vs-video start offset (encoder delay, edit lists). Note start times
    # are audio-derived; videoTime maps them onto the HTML5 video clock.
    av_offset = 0.0
    try:
        av_offset = float(score.get("avOffset") or 0.0)
    except (TypeError, ValueError):
        av_offset = 0.0
    if not math.isfinite(av_offset) or av_offset < 0:
        av_offset = 0.0

    # First pass: build per-beat hand shapes so the second pass can annotate
    # commonFingers (fingers retained from the previous beat) and nextShift
    # (the upcoming position change), which drive the left-hand coaching hints.
    beat_shapes: List[Dict[str, Any]] = []
    for bar_index, bar in enumerate(score.get("bars", []), start=1):
        for beat_index, beat in enumerate(bar.get("beats", []), start=1):
            beat_notes = beat.get("notes", [])
            chord_positions = [
                {"string": n["string"], "fret": n["fret"]}
                for n in beat_notes
            ]
            left_hand_shape = _hand_shape(
                beat_notes[0] if beat_notes else {"string": 1, "fret": 0},
                chord_positions,
            )
            beat_shapes.append(left_hand_shape)

    # Second pass: annotate each shape with commonFingers / nextShift, then emit events.
    events: List[Dict[str, Any]] = []
    event_counter = 0
    bar_beat_iter = (
        (bar_index, beat_index, beat)
        for bar_index, bar in enumerate(score.get("bars", []), start=1)
        for beat_index, beat in enumerate(bar.get("beats", []), start=1)
    )
    for shape_index, (bar_index, beat_index, beat) in enumerate(bar_beat_iter):
        beat_notes = beat.get("notes", [])
        chord = _chord_name(beat_notes)
        right_hand_shape = _pick_shape(beat_notes)
        left_hand_shape = beat_shapes[shape_index]
        previous_shape = beat_shapes[shape_index - 1] if shape_index > 0 else None
        following_shape = beat_shapes[shape_index + 1] if shape_index + 1 < len(beat_shapes) else None
        common = _common_fingers(left_hand_shape, previous_shape)
        shift = _next_shift(left_hand_shape, following_shape)
        annotated_shape = {
            **left_hand_shape,
            "commonFingers": common,
            "nextShift": shift,
        }
        for note in beat_notes:
            event_counter += 1
            event_id = f"evt_{course_id}_{event_counter:04d}"
            event = _build_event(
                event_id=event_id,
                course_id=course_id,
                bar_index=bar_index,
                beat_index=beat_index,
                note=note,
                chord=chord,
                left_hand_shape=annotated_shape,
                right_hand_shape=right_hand_shape,
                av_offset=av_offset,
            )
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
