"""
services/score_builder.py
Convert solved notes into a Canonical Score JSON matching the frontend Project type.
"""

import uuid
from typing import Any, Dict, List


def _merge_notes_in_beat(notes: List[Dict[str, Any]],
                         gap_threshold: float = 0.05) -> List[Dict[str, Any]]:
    """Merge overlapping or adjacent notes that share the same string/fret.

    This removes duplicate detections and produces longer, more playable notes.
    """
    if not notes:
        return notes

    # Sort by string, fret, then start time
    notes = sorted(notes, key=lambda n: (n["string"], n["fret"], n["start"]))
    merged = [notes[0]]

    for n in notes[1:]:
        last = merged[-1]
        if n["string"] == last["string"] and n["fret"] == last["fret"] and \
           (n["start"] - last["end"]) <= gap_threshold:
            last["end"] = max(last["end"], n["end"])
            last["startTime"] = round(last["start"], 4)
            last["endTime"] = round(last["end"], 4)
        else:
            merged.append(n)

    # Sort back by start time
    merged.sort(key=lambda n: n["start"])
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
    """Build a canonical Score JSON from solved notes.

    Args:
        title: course title
        source_video_url: source video URL (may be empty)
        duration: video duration in seconds
        bpm: beats per minute
        time_signature: [numerator, denominator]
        key: musical key
        solved_notes: list of solved notes from tab_solver

    Returns:
        Score JSON dict matching the frontend Project type.
    """
    beats_per_bar = time_signature[0]
    seconds_per_beat = 60.0 / bpm
    seconds_per_bar = seconds_per_beat * beats_per_bar

    total_bars = max(1, int(duration / seconds_per_bar))
    bars = []

    for bar_idx in range(total_bars):
        bar_start = bar_idx * seconds_per_bar
        bar_end = bar_start + seconds_per_bar

        # Find notes in this bar
        bar_notes = [
            n for n in solved_notes
            if (bar_start <= n["start"] < bar_end) or
               (n["start"] < bar_start and n["end"] > bar_start)
        ]

        # Group notes into beats within the bar (assign each note to its starting beat)
        beats = []
        for beat_idx in range(beats_per_bar):
            beat_start = bar_start + beat_idx * seconds_per_beat
            beat_end = beat_start + seconds_per_beat
            beat_notes = [
                n for n in bar_notes
                if beat_start <= n["start"] < beat_end
            ]
            # Normalize note dicts and merge duplicates within the beat
            beat_note_dicts = [
                {
                    "string": n["string"],
                    "fret": n["fret"],
                    "startTime": round(n["start"], 4),
                    "endTime": round(n["end"], 4),
                    "midi": n["midi"],
                    "start": n["start"],
                    "end": n["end"],
                }
                for n in beat_notes
            ]
            beat_note_dicts = _merge_notes_in_beat(beat_note_dicts)
            beats.append({
                "startTime": round(beat_start, 4),
                "endTime": round(beat_end, 4),
                "notes": [
                    {
                        "string": n["string"],
                        "fret": n["fret"],
                        "startTime": round(n["start"], 4),
                        "endTime": round(n["end"], 4),
                        "midi": n["midi"],
                    }
                    for n in beat_note_dicts
                ],
            })

        bars.append({
            "index": bar_idx + 1,
            "startTime": round(bar_start, 4),
            "endTime": round(bar_end, 4),
            "beats": beats,
        })

    return {
        "id": uuid.uuid4().hex[:12],
        "title": title,
        "sourceVideoUrl": source_video_url,
        "localVideoPath": "",
        "duration": duration,
        "bpm": bpm,
        "timeSignature": time_signature,
        "key": key,
        "bars": bars,
        "createdAt": 0,
        "updatedAt": 0,
    }
