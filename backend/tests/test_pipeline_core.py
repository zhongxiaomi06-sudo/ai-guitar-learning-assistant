import json
import math

import pytest

from app.services.score_builder import build_score
from app.services.tab_solver import (
    DEFAULT_MAX_FRET,
    MAX_BEAM_WIDTH,
    MAX_PLAYABLE_MIDI,
    STRING_OPEN_MIDI,
    find_best_path,
    midi_to_candidates,
    same_time_group,
    solve_notes,
)


def note(**overrides):
    value = {
        "start": 0.0,
        "end": 0.2,
        "midi": 64,
        "confidence": 0.9,
        "string": 1,
        "fret": 0,
    }
    value.update(overrides)
    return value


def score(**overrides):
    values = {
        "title": "Test",
        "source_video_url": "",
        "duration": 1.0,
        "bpm": 120,
        "time_signature": [4, 4],
        "key": "C",
        "solved_notes": [],
    }
    values.update(overrides)
    return build_score(**values)


def test_standard_tuning_and_19_fret_range_are_consistent():
    assert STRING_OPEN_MIDI == (64, 59, 55, 50, 45, 40)
    assert DEFAULT_MAX_FRET == 19
    assert MAX_PLAYABLE_MIDI == 83
    assert midi_to_candidates(40) == [(5, 0)]
    assert midi_to_candidates(64)[0] == (0, 0)
    assert midi_to_candidates(83) == [(0, 19)]
    assert midi_to_candidates(84) == []

    for midi in range(40, MAX_PLAYABLE_MIDI + 1):
        for string_index, fret in midi_to_candidates(midi):
            assert 0 <= string_index < 6
            assert 0 <= fret <= DEFAULT_MAX_FRET
            assert STRING_OPEN_MIDI[string_index] + fret == midi


@pytest.mark.parametrize("max_fret", [-1, 37, 1.5, True, math.nan])
def test_midi_candidates_reject_invalid_max_fret(max_fret):
    with pytest.raises((TypeError, ValueError)):
        midi_to_candidates(64, max_fret=max_fret)


@pytest.mark.parametrize("midi", [-1, 128, 64.5, True, math.nan])
def test_midi_candidates_require_a_valid_integer_midi(midi):
    with pytest.raises((TypeError, ValueError)):
        midi_to_candidates(midi)


def test_solver_fully_enumerates_feasible_six_note_chord():
    # This ordering was a regression for partial-candidate beam pruning: a
    # complete unique-string fingering exists, but the old solver returned [].
    pitches = [49, 60, 76, 58, 45, 57]
    solved = solve_notes([(0.0, 0.2, midi, 0.9) for midi in pitches])

    assert len(solved) == 6
    assert {item["midi"] for item in solved} == set(pitches)
    assert len({item["string"] for item in solved}) == 6
    assert all(
        STRING_OPEN_MIDI[item["string"] - 1] + item["fret"] == item["midi"]
        for item in solved
    )


def test_solver_drops_excess_polyphony_instead_of_fabricating_duplicate_strings():
    notes = [
        (0.0, 0.2, midi, 0.9)
        for midi in (40, 45, 50, 55, 59, 64, 67)
    ]
    solved = solve_notes(notes)

    assert len(solved) == 6
    assert len({item["string"] for item in solved}) == len(solved)
    assert all(1 <= item["string"] <= 6 for item in solved)
    assert all(0 <= item["fret"] <= DEFAULT_MAX_FRET for item in solved)


def test_solver_drops_integer_pitches_outside_configured_guitar_range():
    assert solve_notes([(0.0, 0.2, 39, 0.9)]) == []
    assert solve_notes([(0.0, 0.2, 84, 0.9)]) == []


@pytest.mark.parametrize(
    "invalid_note",
    [
        (math.nan, 0.2, 64, 0.9),
        (0.0, math.inf, 64, 0.9),
        (-0.1, 0.2, 64, 0.9),
        (0.2, 0.2, 64, 0.9),
        (0.3, 0.2, 64, 0.9),
        (0.0, 0.2, 64.5, 0.9),
        (0.0, 0.2, True, 0.9),
        (0.0, 0.2, 64, math.inf),
        (0.0, 0.2, 64, -0.1),
        (0.0, 0.2, 64, 1.1),
        (0.0, 0.2, 64),
    ],
)
def test_solver_rejects_invalid_note_events(invalid_note):
    with pytest.raises((TypeError, ValueError)):
        solve_notes([invalid_note])


@pytest.mark.parametrize("beam_width", [0, -1, MAX_BEAM_WIDTH + 1, 1.5, True, math.nan])
def test_solver_rejects_invalid_beam_width(beam_width):
    with pytest.raises((TypeError, ValueError)):
        find_best_path([(0.0, 0.2, 64, 0.9)], beam_width=beam_width)


def test_solver_orders_public_results_but_low_level_path_requires_sorted_input():
    solved = solve_notes([(1.0, 1.2, 64, 0.9), (0.0, 0.2, 59, 0.9)])
    assert [item["start"] for item in solved] == [0.0, 1.0]

    with pytest.raises(ValueError, match="sorted"):
        same_time_group([(1.0, 1.2, 64, 0.9), (0.0, 0.2, 59, 0.9)])


def test_solver_empty_input_is_safe():
    assert solve_notes([]) == []
    assert find_best_path([]) == []
    assert same_time_group([]) == []


def test_score_builder_keeps_last_partial_bar_and_notes():
    built = score(
        title="Partial bar",
        duration=2.1,
        bpm=120,
        solved_notes=[note(start=2.05, end=2.09)],
    )

    assert len(built["bars"]) == 2
    assert built["bars"][1]["beats"][0]["notes"][0]["midi"] == 64


def test_score_builder_respects_eighth_note_denominator():
    built = score(duration=1.6, bpm=120, time_signature=[6, 8])

    # At 120 quarter notes/minute, a 6/8 bar lasts 1.5 seconds.
    assert len(built["bars"]) == 2
    assert built["bars"][0]["endTime"] == 1.5


def test_score_builder_merges_adjacent_duplicate_detections_in_one_beat():
    built = score(
        solved_notes=[
            note(start=0.0, end=0.2),
            note(start=0.22, end=0.4),
        ],
    )
    notes = built["bars"][0]["beats"][0]["notes"]

    assert len(notes) == 1
    assert notes[0]["startTime"] == 0.0
    assert notes[0]["endTime"] == 0.4


def test_score_builder_derives_duration_and_emits_strict_frontend_json():
    built = score(duration=0, solved_notes=[note(end=0.25)])

    assert built["duration"] == 0.25
    assert built["timeSignature"] == [4, 4]
    assert {
        "id", "title", "sourceVideoUrl", "localVideoPath", "duration",
        "bpm", "timeSignature", "key", "bars", "createdAt", "updatedAt",
    } <= built.keys()
    event = built["bars"][0]["beats"][0]["notes"][0]
    assert {"string", "fret", "startTime", "endTime", "midi"} <= event.keys()
    json.dumps(built, allow_nan=False)


def test_score_builder_does_not_extend_a_trusted_media_duration():
    with pytest.raises(ValueError, match="declared media duration"):
        score(
            duration=1.0,
            solved_notes=[note(start=0.9, end=1.1)],
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", ""),
        ("title", "   "),
        ("title", "x" * 256),
        ("title", 123),
        ("source_video_url", "x" * 4097),
        ("source_video_url", None),
        ("key", ""),
        ("key", "x" * 33),
        ("key", 123),
    ],
)
def test_score_builder_rejects_invalid_text_fields(field, value):
    with pytest.raises((TypeError, ValueError)):
        score(**{field: value})


@pytest.mark.parametrize("bpm", [0, 0.5, -1, 400.1, math.nan, math.inf, True])
def test_score_builder_rejects_invalid_bpm(bpm):
    with pytest.raises((TypeError, ValueError)):
        score(bpm=bpm)


@pytest.mark.parametrize("duration", [-1, 600.1, math.nan, math.inf, True])
def test_score_builder_rejects_invalid_duration(duration):
    with pytest.raises((TypeError, ValueError)):
        score(duration=duration)


@pytest.mark.parametrize(
    "time_signature",
    [
        [4],
        [4, 4, 8],
        [4.5, 4],
        [True, 4],
        [0, 4],
        [33, 4],
        [4, 3],
        "4/4",
    ],
)
def test_score_builder_rejects_invalid_time_signature(time_signature):
    with pytest.raises((TypeError, ValueError)):
        score(time_signature=time_signature)


@pytest.mark.parametrize(
    "invalid_note",
    [
        note(start=math.nan),
        note(end=math.inf),
        note(start=-0.1),
        note(start=0.2, end=0.2),
        note(end=600.1),
        note(midi=64.5),
        note(midi=65),
        note(string=0),
        note(string=7),
        note(string=1.5),
        note(string=True),
        note(fret=-1),
        note(fret=20),
        note(fret=0.5),
        note(fret=True),
        note(confidence=math.inf),
        note(confidence=-0.1),
        note(confidence=1.1),
        {"start": 0.0},
        "not-an-object",
    ],
)
def test_score_builder_rejects_invalid_solved_notes(invalid_note):
    with pytest.raises((TypeError, ValueError)):
        score(solved_notes=[invalid_note])
