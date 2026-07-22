"""Tests for the unified timeline builder, including A/V offset handling."""

from app.services.timeline import build_timeline


def _score_with_offset(offset):
    return {
        "title": "demo",
        "bpm": 90,
        "timeSignature": [4, 4],
        "duration": 4.0,
        "avOffset": offset,
        "bars": [
            {
                "index": 1,
                "startTime": 0.0,
                "endTime": 2.0,
                "beats": [
                    {
                        "notes": [
                            {"string": 1, "fret": 0, "midi": 64, "startTime": 0.5, "endTime": 0.9, "confidence": 0.9},
                        ],
                    },
                ],
            },
        ],
    }


def test_timeline_applies_av_offset_to_video_time_only():
    score = _score_with_offset(0.04)
    timeline = build_timeline("course-1", score)
    assert len(timeline) == 1
    event = timeline[0]
    # audioTime preserves the audio-derived onset; videoTime shifts onto video clock
    assert abs(event["audioTime"] - 0.5) < 1e-9
    assert abs(event["videoTime"] - 0.54) < 1e-9
    # startTime stays audio-derived for downstream score consumers
    assert abs(event["startTime"] - 0.5) < 1e-9


def test_timeline_without_offset_keeps_video_and_audio_equal():
    score = _score_with_offset(0.0)
    event = build_timeline("course-2", score)[0]
    assert event["videoTime"] == event["audioTime"]
    assert abs(event["videoTime"] - 0.5) < 1e-9


def test_timeline_ignores_non_finite_or_negative_offset():
    for bad in [-0.1, "nan", "inf", None, "garbage"]:
        score = _score_with_offset(bad)
        event = build_timeline("course-3", score)[0]
        # Falls back to 0 offset → videoTime == audioTime
        assert event["videoTime"] == event["audioTime"]


def test_timeline_event_carries_hand_shapes_and_chord():
    # Two simultaneous notes on different strings form a chord-like beat.
    score = {
        "title": "chord",
        "bpm": 80,
        "timeSignature": [4, 4],
        "duration": 2.0,
        "bars": [
            {
                "index": 1,
                "startTime": 0.0,
                "endTime": 2.0,
                "beats": [
                    {
                        "notes": [
                            {"string": 2, "fret": 1, "midi": 60, "startTime": 0.3, "endTime": 0.6, "confidence": 0.9},
                            {"string": 5, "fret": 3, "midi": 48, "startTime": 0.3, "endTime": 0.6, "confidence": 0.9},
                        ],
                    },
                ],
            },
        ],
    }
    events = build_timeline("course-4", score)
    assert len(events) == 2
    # Left-hand shape should carry finger positions for both strings
    shape = events[0]["leftHandShape"]
    assert isinstance(shape["fingerPositions"], list)
    assert len(shape["fingerPositions"]) >= 1
    # Transitions are annotated with commonFingers / nextShift keys
    assert "commonFingers" in shape
    assert "nextShift" in shape


def test_timeline_detects_barre_for_contiguous_same_fret_strings():
    # F-chord-like shape: three strings barred at fret 1 on contiguous strings.
    score = {
        "title": "barre",
        "bpm": 80,
        "timeSignature": [4, 4],
        "duration": 2.0,
        "bars": [
            {
                "index": 1,
                "startTime": 0.0,
                "endTime": 2.0,
                "beats": [
                    {
                        "notes": [
                            {"string": 1, "fret": 1, "midi": 65, "startTime": 0.0, "endTime": 0.4, "confidence": 0.9},
                            {"string": 2, "fret": 1, "midi": 60, "startTime": 0.0, "endTime": 0.4, "confidence": 0.9},
                            {"string": 3, "fret": 1, "midi": 56, "startTime": 0.0, "endTime": 0.4, "confidence": 0.9},
                        ],
                    },
                ],
            },
        ],
    }
    events = build_timeline("course-barre", score)
    shape = events[0]["leftHandShape"]
    barre = shape["barreRange"]
    assert barre is not None, "expected a barre across strings 1-3 at fret 1"
    assert barre["fret"] == 1
    assert barre["stringStart"] == 1
    assert barre["stringEnd"] == 3
    # All barre-covered positions share the barre finger (1)
    barre_fingers = [p["finger"] for p in shape["fingerPositions"] if p["fret"] == barre["fret"]]
    assert barre_fingers == [1, 1, 1]


def test_timeline_next_shift_compares_current_and_following_beat():
    score = {
        "title": "shift",
        "bpm": 80,
        "timeSignature": [4, 4],
        "duration": 3.0,
        "bars": [
            {
                "index": 1,
                "startTime": 0.0,
                "endTime": 2.0,
                "beats": [
                    {"notes": [{"string": 1, "fret": 2, "midi": 66, "startTime": 0.0, "endTime": 0.4, "confidence": 0.9}]},
                    {"notes": [{"string": 1, "fret": 7, "midi": 71, "startTime": 0.5, "endTime": 0.9, "confidence": 0.9}]},
                ],
            },
        ],
    }
    events = build_timeline("course-shift", score)
    first_shape = events[0]["leftHandShape"]
    shift = first_shape["nextShift"]
    assert shift is not None
    assert shift["direction"] == "up", "moving from fret 2 to fret 7 is an upward shift"
    assert shift["targetFret"] == 7


def test_timeline_common_fingers_marks_retained_fingers_across_beats():
    # Beat 1: chord at (2,1),(5,3). Beat 2: chord at (2,1),(5,5) — string 2 fret 1 retained.
    score = {
        "title": "retain",
        "bpm": 80,
        "timeSignature": [4, 4],
        "duration": 3.0,
        "bars": [
            {
                "index": 1,
                "startTime": 0.0,
                "endTime": 2.0,
                "beats": [
                    {
                        "notes": [
                            {"string": 2, "fret": 1, "midi": 60, "startTime": 0.0, "endTime": 0.4, "confidence": 0.9},
                            {"string": 5, "fret": 3, "midi": 48, "startTime": 0.0, "endTime": 0.4, "confidence": 0.9},
                        ],
                    },
                    {
                        "notes": [
                            {"string": 2, "fret": 1, "midi": 60, "startTime": 0.5, "endTime": 0.9, "confidence": 0.9},
                            {"string": 5, "fret": 5, "midi": 50, "startTime": 0.5, "endTime": 0.9, "confidence": 0.9},
                        ],
                    },
                ],
            },
        ],
    }
    events = build_timeline("course-retain", score)
    # The first event of beat 2 (index 2) should report the retained finger.
    second_beat_shape = events[2]["leftHandShape"]
    common = second_beat_shape["commonFingers"]
    assert common, "expected at least one common (retained) finger"
    retained = [(c["string"], c["fret"]) for c in common]
    assert (2, 1) in retained, "string 2 fret 1 should be retained from beat 1"

