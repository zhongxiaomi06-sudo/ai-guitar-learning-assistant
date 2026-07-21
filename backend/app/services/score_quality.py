"""
services/score_quality.py
Validate a generated score and decide whether it is usable for practice.
"""

from typing import Any, Dict, List, Tuple


MAX_REALISTIC_FRET = 19
MIN_NOTES_PER_MINUTE = 2  # at least 2 notes per minute of video
MAX_NOTES_PER_MINUTE = 1000  # sanity upper bound


def validate_score_quality(score: Dict[str, Any]) -> Tuple[bool, str]:
    """Return (usable, reason) for a generated Canonical Score.

    A usable score must contain a reasonable number of notes, avoid
    unrealistic fret positions, and span the expected duration.
    """
    duration = float(score.get("duration") or 0)
    bars = score.get("bars", [])
    if not bars:
        return False, "未生成任何小节"

    total_notes = 0
    max_fret = 0
    min_fret = 99
    notes_per_string: Dict[int, int] = {}

    for bar in bars:
        for beat in bar.get("beats", []):
            for note in beat.get("notes", []):
                total_notes += 1
                fret = note.get("fret", 0)
                max_fret = max(max_fret, fret)
                min_fret = min(min_fret, fret)
                string = note.get("string", 0)
                notes_per_string[string] = notes_per_string.get(string, 0) + 1

    if total_notes == 0:
        return False, "未识别到任何音符，请确认视频包含清晰的吉他声音"

    minutes = max(duration / 60.0, 0.1)
    notes_per_minute = total_notes / minutes
    if notes_per_minute < MIN_NOTES_PER_MINUTE:
        return False, f"识别到的音符过少（{total_notes} 个），可能不适合跟练"

    if notes_per_minute > MAX_NOTES_PER_MINUTE:
        return False, "识别到的音符过多且细碎，可能是噪声或误检"

    if max_fret > MAX_REALISTIC_FRET:
        return False, f"识别到不现实的把位（最高 {max_fret} 品），请检查视频内容"

    if min_fret > 12 and total_notes < 10:
        return False, "音符集中且位置偏高，识别结果可能不可靠"

    # Require at least 2 strings to be used; a single-string melody is fine,
    # but zero or one string with very few notes is suspicious.
    if len(notes_per_string) < 1:
        return False, "未识别到有效的弦位分布"

    return True, ""
