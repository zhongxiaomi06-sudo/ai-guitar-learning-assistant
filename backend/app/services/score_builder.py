"""
services/score_builder.py
Convert solved notes into frontend-compatible Canonical Score JSON.
"""

import json
import math
import time
import uuid
from numbers import Integral, Real
from typing import Any, Dict, List, Tuple

from app.services.tab_solver import DEFAULT_MAX_FRET, MAX_MIDI, MIN_MIDI, STRING_OPEN_MIDI

MAX_SCORE_DURATION_SECONDS = 600.0
MIN_BPM = 1.0
MAX_BPM = 400.0
MAX_BEATS_PER_BAR = 32
SUPPORTED_BEAT_UNITS = {1, 2, 4, 8, 16}


def _finite_real(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(f"{field} must be a real number")
    normalized = float(value)
    if not math.isfinite(normalized):
        raise ValueError(f"{field} must be finite")
    return normalized


def _strict_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise TypeError(f"{field} must be an integer")
    return int(value)


def _bounded_text(
    value: object,
    field: str,
    *,
    max_length: int,
    allow_empty: bool,
) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{field} must be a string")
    if len(value) > max_length:
        raise ValueError(f"{field} must contain at most {max_length} characters")
    if not allow_empty and not value.strip():
        raise ValueError(f"{field} must not be empty")
    return value


def _validate_time_signature(time_signature: object) -> Tuple[int, int]:
    if not isinstance(time_signature, (list, tuple)) or len(time_signature) != 2:
        raise TypeError("time_signature must contain exactly two integers")
    beats_per_bar = _strict_int(time_signature[0], "time_signature[0]")
    beat_unit = _strict_int(time_signature[1], "time_signature[1]")
    if not 1 <= beats_per_bar <= MAX_BEATS_PER_BAR:
        raise ValueError(f"time signature numerator must be between 1 and {MAX_BEATS_PER_BAR}")
    if beat_unit not in SUPPORTED_BEAT_UNITS:
        raise ValueError("time signature denominator must be one of 1, 2, 4, 8, or 16")
    return beats_per_bar, beat_unit


def _normalize_solved_note(note: object, index: int) -> Dict[str, Any]:
    if not isinstance(note, dict):
        raise TypeError(f"solved_notes[{index}] must be an object")

    required = ("start", "end", "midi", "string", "fret")
    missing = [field for field in required if field not in note]
    if missing:
        raise ValueError(f"solved_notes[{index}] is missing: {', '.join(missing)}")

    start = _finite_real(note["start"], f"solved_notes[{index}].start")
    end = _finite_real(note["end"], f"solved_notes[{index}].end")
    midi = _strict_int(note["midi"], f"solved_notes[{index}].midi")
    string_number = _strict_int(note["string"], f"solved_notes[{index}].string")
    fret = _strict_int(note["fret"], f"solved_notes[{index}].fret")

    if start < 0:
        raise ValueError(f"solved_notes[{index}].start must be non-negative")
    if end <= start:
        raise ValueError(f"solved_notes[{index}].end must be greater than start")
    if end > MAX_SCORE_DURATION_SECONDS:
        raise ValueError(
            f"solved_notes[{index}].end exceeds {MAX_SCORE_DURATION_SECONDS:g} seconds"
        )
    if not MIN_MIDI <= midi <= MAX_MIDI:
        raise ValueError(f"solved_notes[{index}].midi must be between {MIN_MIDI} and {MAX_MIDI}")
    if not 1 <= string_number <= len(STRING_OPEN_MIDI):
        raise ValueError(f"solved_notes[{index}].string must be between 1 and 6")
    if not 0 <= fret <= DEFAULT_MAX_FRET:
        raise ValueError(
            f"solved_notes[{index}].fret must be between 0 and {DEFAULT_MAX_FRET}"
        )

    expected_midi = STRING_OPEN_MIDI[string_number - 1] + fret
    if midi != expected_midi:
        raise ValueError(
            f"solved_notes[{index}] MIDI {midi} does not match string "
            f"{string_number}, fret {fret} (expected {expected_midi})"
        )

    normalized: Dict[str, Any] = {
        "start": start,
        "end": end,
        "midi": midi,
        "string": string_number,
        "fret": fret,
    }
    if "confidence" in note:
        confidence = _finite_real(
            note["confidence"],
            f"solved_notes[{index}].confidence",
        )
        if not 0.0 <= confidence <= 1.0:
            raise ValueError(f"solved_notes[{index}].confidence must be between 0 and 1")
        normalized["confidence"] = confidence
    return normalized


def _normalize_solved_notes(solved_notes: object) -> List[Dict[str, Any]]:
    if not isinstance(solved_notes, (list, tuple)):
        raise TypeError("solved_notes must be a list or tuple")
    normalized = [
        _normalize_solved_note(note, index)
        for index, note in enumerate(solved_notes)
    ]
    return sorted(
        normalized,
        key=lambda note: (note["start"], note["string"], note["fret"]),
    )


def _merge_notes_in_beat(
    notes: List[Dict[str, Any]],
    gap_threshold: float = 0.05,
) -> List[Dict[str, Any]]:
    """Merge adjacent detections that resolve to the same string and fret."""
    if not notes:
        return []

    ordered = sorted(notes, key=lambda note: (note["string"], note["fret"], note["start"]))
    merged = [dict(ordered[0])]
    for note in ordered[1:]:
        previous = merged[-1]
        if (
            note["string"] == previous["string"]
            and note["fret"] == previous["fret"]
            and note["start"] - previous["end"] <= gap_threshold
        ):
            previous["end"] = max(previous["end"], note["end"])
        else:
            merged.append(dict(note))
    merged.sort(key=lambda note: (note["start"], note["string"], note["fret"]))
    return merged


def build_score(
    title: str,
    source_video_url: str,
    duration: float,
    bpm: int,
    time_signature: List[int],
    key: str,
    solved_notes: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Build a bounded, JSON-safe score matching the frontend's current shape."""
    normalized_title = _bounded_text(
        title,
        "title",
        max_length=255,
        allow_empty=False,
    )
    normalized_source_video_url = _bounded_text(
        source_video_url,
        "source_video_url",
        max_length=4096,
        allow_empty=True,
    )
    normalized_key = _bounded_text(
        key,
        "key",
        max_length=32,
        allow_empty=False,
    )

    normalized_duration = _finite_real(duration, "duration")
    if not 0.0 <= normalized_duration <= MAX_SCORE_DURATION_SECONDS:
        raise ValueError(
            f"duration must be between 0 and {MAX_SCORE_DURATION_SECONDS:g} seconds"
        )

    normalized_bpm = _finite_real(bpm, "bpm")
    if not MIN_BPM <= normalized_bpm <= MAX_BPM:
        raise ValueError(f"bpm must be between {MIN_BPM:g} and {MAX_BPM:g}")

    beats_per_bar, beat_unit = _validate_time_signature(time_signature)
    normalized_notes = _normalize_solved_notes(solved_notes)
    note_end = max((note["end"] for note in normalized_notes), default=0.0)
    effective_duration = max(normalized_duration, note_end)
    if effective_duration > MAX_SCORE_DURATION_SECONDS:
        raise ValueError(f"score duration must not exceed {MAX_SCORE_DURATION_SECONDS:g} seconds")

    # BPM is defined in quarter notes. Convert the notated denominator unit to
    # seconds before splitting bars and beats.
    seconds_per_beat = (60.0 / normalized_bpm) * (4.0 / beat_unit)
    seconds_per_bar = seconds_per_beat * beats_per_bar
    total_bars = max(1, math.ceil(effective_duration / seconds_per_bar))

    note_buckets: List[List[List[Dict[str, Any]]]] = [
        [[] for _ in range(beats_per_bar)]
        for _ in range(total_bars)
    ]
    for note in normalized_notes:
        bar_index = min(total_bars - 1, int(note["start"] / seconds_per_bar))
        offset = note["start"] - bar_index * seconds_per_bar
        beat_index = min(beats_per_bar - 1, int(offset / seconds_per_beat))
        note_buckets[bar_index][beat_index].append(note)

    bars: List[Dict[str, Any]] = []
    for bar_index in range(total_bars):
        bar_start = bar_index * seconds_per_bar
        beats: List[Dict[str, Any]] = []
        for beat_index in range(beats_per_bar):
            beat_start = bar_start + beat_index * seconds_per_beat
            merged_notes = _merge_notes_in_beat(note_buckets[bar_index][beat_index])
            beats.append({
                "startTime": round(beat_start, 4),
                "endTime": round(beat_start + seconds_per_beat, 4),
                "notes": [
                    {
                        "string": note["string"],
                        "fret": note["fret"],
                        "startTime": round(note["start"], 4),
                        "endTime": round(note["end"], 4),
                        "midi": note["midi"],
                    }
                    for note in merged_notes
                ],
            })

        bars.append({
            "index": bar_index + 1,
            "startTime": round(bar_start, 4),
            "endTime": round(bar_start + seconds_per_bar, 4),
            "beats": beats,
        })

    created_at = int(time.time() * 1000)
    score: Dict[str, Any] = {
        "id": uuid.uuid4().hex[:12],
        "title": normalized_title,
        "sourceVideoUrl": normalized_source_video_url,
        "localVideoPath": "",
        "duration": effective_duration,
        "bpm": normalized_bpm,
        "timeSignature": [beats_per_bar, beat_unit],
        "key": normalized_key,
        "bars": bars,
        "createdAt": created_at,
        "updatedAt": created_at,
    }
    # Guard the persistence boundary against Python's non-standard NaN/Infinity JSON.
    json.dumps(score, allow_nan=False)
    return score
