"""
services/tab_solver.py
Map MIDI pitches to guitar strings and frets using a bounded beam search.
"""

import math
from numbers import Integral, Real
from typing import Any, Dict, List, Sequence, Tuple

# Standard tuning: E2 A2 D3 G3 B3 E4 (MIDI: 40, 45, 50, 55, 59, 64).
# The array is ordered from string 1 (high E) to string 6 (low E).
STRING_OPEN_MIDI = (64, 59, 55, 50, 45, 40)
DEFAULT_MAX_FRET = 19
MAX_SUPPORTED_FRET = 36
MIN_MIDI = 0
MAX_MIDI = 127
MIN_PLAYABLE_MIDI = min(STRING_OPEN_MIDI)
MAX_PLAYABLE_MIDI = max(STRING_OPEN_MIDI) + DEFAULT_MAX_FRET
MAX_SIMULTANEOUS_NOTES = len(STRING_OPEN_MIDI)
MAX_BEAM_WIDTH = math.factorial(MAX_SIMULTANEOUS_NOTES)

NoteEvent = Tuple[float, float, int, float]
Position = Tuple[int, int]
Chord = Tuple[Position, ...]


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


def _validate_max_fret(max_fret: object) -> int:
    normalized = _strict_int(max_fret, "max_fret")
    if not 0 <= normalized <= MAX_SUPPORTED_FRET:
        raise ValueError(f"max_fret must be between 0 and {MAX_SUPPORTED_FRET}")
    return normalized


def _validate_beam_width(beam_width: object) -> int:
    normalized = _strict_int(beam_width, "beam_width")
    if not 1 <= normalized <= MAX_BEAM_WIDTH:
        raise ValueError(f"beam_width must be between 1 and {MAX_BEAM_WIDTH}")
    return normalized


def _normalize_note(note: Sequence[object], index: int) -> NoteEvent:
    if not isinstance(note, (list, tuple)) or len(note) != 4:
        raise TypeError(f"notes[{index}] must contain start, end, midi, confidence")

    start = _finite_real(note[0], f"notes[{index}].start")
    end = _finite_real(note[1], f"notes[{index}].end")
    midi = _strict_int(note[2], f"notes[{index}].midi")
    confidence = _finite_real(note[3], f"notes[{index}].confidence")

    if start < 0:
        raise ValueError(f"notes[{index}].start must be non-negative")
    if end <= start:
        raise ValueError(f"notes[{index}].end must be greater than start")
    if not MIN_MIDI <= midi <= MAX_MIDI:
        raise ValueError(f"notes[{index}].midi must be between {MIN_MIDI} and {MAX_MIDI}")
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"notes[{index}].confidence must be between 0 and 1")

    return start, end, midi, confidence


def _normalize_notes(notes: object, *, require_sorted: bool) -> List[NoteEvent]:
    if not isinstance(notes, (list, tuple)):
        raise TypeError("notes must be a list or tuple")
    normalized = [_normalize_note(note, index) for index, note in enumerate(notes)]
    if require_sorted and any(
        normalized[index][0] < normalized[index - 1][0]
        for index in range(1, len(normalized))
    ):
        raise ValueError("notes must be sorted by start time")
    return normalized


def midi_to_candidates(midi: int, max_fret: int = DEFAULT_MAX_FRET) -> List[Position]:
    """Return every playable ``(zero-based string, fret)`` for a MIDI pitch."""
    normalized_midi = _strict_int(midi, "midi")
    normalized_max_fret = _validate_max_fret(max_fret)
    if not MIN_MIDI <= normalized_midi <= MAX_MIDI:
        raise ValueError(f"midi must be between {MIN_MIDI} and {MAX_MIDI}")

    candidates: List[Position] = []
    for string_index, open_midi in enumerate(STRING_OPEN_MIDI):
        fret = normalized_midi - open_midi
        if 0 <= fret <= normalized_max_fret:
            candidates.append((string_index, fret))
    return candidates


def _same_time_group_validated(
    notes: Sequence[NoteEvent],
    time_threshold: float,
) -> List[List[int]]:
    if not notes:
        return []

    groups: List[List[int]] = []
    current_group = [0]
    for index in range(1, len(notes)):
        if notes[index][0] - notes[current_group[0]][0] <= time_threshold:
            current_group.append(index)
        else:
            groups.append(current_group)
            current_group = [index]
    groups.append(current_group)
    return groups


def same_time_group(
    notes: List[NoteEvent],
    time_threshold: float = 0.05,
) -> List[List[int]]:
    """Group sorted note indices that start within ``time_threshold`` seconds."""
    normalized_notes = _normalize_notes(notes, require_sorted=True)
    normalized_threshold = _finite_real(time_threshold, "time_threshold")
    if normalized_threshold < 0:
        raise ValueError("time_threshold must be non-negative")
    return _same_time_group_validated(normalized_notes, normalized_threshold)


def chord_finger_span(positions: Sequence[Position]) -> int:
    """Compute a chord's fretted-note span; open strings do not move the hand."""
    frets = [fret for _, fret in positions if fret > 0]
    return max(frets) - min(frets) if frets else 0


def chord_cost(positions: Sequence[Position]) -> float:
    """Prefer open strings, compact shapes, and lower fretboard positions."""
    cost = 0.0
    span = chord_finger_span(positions)
    if span > 4:
        cost += (span - 4) ** 2 * 1.5

    open_count = sum(1 for _, fret in positions if fret == 0)
    cost -= open_count * 2.0

    for _, fret in positions:
        if fret > 12:
            cost += fret - 12
        elif fret > 7:
            cost += (fret - 7) * 0.3
        elif fret > 5:
            cost += (fret - 5) * 0.1

    strings = [string for string, _ in positions]
    if len(strings) != len(set(strings)):
        cost += 1000.0
    if span >= 4 and open_count == 0:
        cost += span * 0.5
    return cost


def transition_cost(prev: Sequence[Position], curr: Sequence[Position]) -> float:
    """Cost of moving from one chord or note to the next."""
    if not prev or not curr:
        return 0.0

    prev_frets = [fret for _, fret in prev]
    curr_frets = [fret for _, fret in curr]
    avg_prev = sum(prev_frets) / len(prev_frets)
    avg_curr = sum(curr_frets) / len(curr_frets)
    cost = abs(avg_curr - avg_prev) * 0.5

    prev_by_string = {string: fret for string, fret in prev}
    for string, fret in curr:
        if string in prev_by_string:
            cost += abs(fret - prev_by_string[string]) ** 2 * 0.15

    cost += abs(chord_finger_span(curr) - chord_finger_span(prev)) * 0.3
    if avg_prev > 0 and abs(avg_curr - avg_prev) > 7:
        cost += 2.0
    return cost


def _candidate_chords(
    notes: Sequence[NoteEvent],
    group: Sequence[int],
    max_fret: int,
) -> List[Chord]:
    """Enumerate every complete group fingering with one note per string.

    At most six notes are accepted. With six strings, the complete search has
    at most ``6!`` leaves, so enumerating before beam pruning is bounded and
    avoids the false negatives caused by pruning partial assignments.
    """
    if not group or len(group) > MAX_SIMULTANEOUS_NOTES:
        return []

    candidate_sets = [midi_to_candidates(notes[index][2], max_fret) for index in group]
    if any(not candidates for candidates in candidate_sets):
        return []

    complete: List[Chord] = []

    def visit(note_index: int, positions: Chord, used_strings: int) -> None:
        if note_index == len(candidate_sets):
            complete.append(positions)
            return
        for string_index, fret in candidate_sets[note_index]:
            string_bit = 1 << string_index
            if used_strings & string_bit:
                continue
            visit(
                note_index + 1,
                positions + ((string_index, fret),),
                used_strings | string_bit,
            )

    visit(0, (), 0)
    complete.sort(key=lambda candidate: (chord_cost(candidate), candidate))
    return complete


def _select_playable_group(
    notes: Sequence[NoteEvent],
    group: Sequence[int],
    max_fret: int,
) -> List[int]:
    """Choose the largest unique-string subset, then maximize confidence."""
    # mask -> (summed confidence, selected original indices)
    states: Dict[int, Tuple[float, Tuple[int, ...]]] = {0: (0.0, ())}

    for original_index in group:
        candidates = midi_to_candidates(notes[original_index][2], max_fret)
        if not candidates:
            continue

        next_states = dict(states)
        confidence = notes[original_index][3]
        for used_mask, (total_confidence, selected) in states.items():
            for string_index, _ in candidates:
                string_bit = 1 << string_index
                if used_mask & string_bit:
                    continue
                new_mask = used_mask | string_bit
                candidate = (total_confidence + confidence, selected + (original_index,))
                current = next_states.get(new_mask)
                if current is None or (candidate[0], tuple(-i for i in candidate[1])) > (
                    current[0],
                    tuple(-i for i in current[1]),
                ):
                    next_states[new_mask] = candidate
        states = next_states

    _, best = max(
        states.items(),
        key=lambda item: (
            item[0].bit_count(),
            item[1][0],
            tuple(-index for index in item[1][1]),
        ),
    )
    selected = set(best[1])
    return [index for index in group if index in selected]


def _prepare_playable_notes(notes: object, max_fret: int) -> List[NoteEvent]:
    """Validate, order, and remove pitches that cannot share unique strings."""
    normalized = _normalize_notes(notes, require_sorted=False)
    ordered = sorted(normalized, key=lambda note: (note[0], note[2], -note[3]))
    playable: List[NoteEvent] = []
    for group in _same_time_group_validated(ordered, 0.05):
        selected = _select_playable_group(ordered, group, max_fret)
        playable.extend(ordered[index] for index in selected)
    return playable


def find_best_path(
    notes: List[NoteEvent],
    beam_width: int = 8,
    max_fret: int = DEFAULT_MAX_FRET,
) -> List[Position]:
    """Find positions aligned with a validated, start-time-sorted note list."""
    normalized_notes = _normalize_notes(notes, require_sorted=True)
    normalized_beam_width = _validate_beam_width(beam_width)
    normalized_max_fret = _validate_max_fret(max_fret)
    if not normalized_notes:
        return []

    group_candidates: List[List[Chord]] = []
    for group in _same_time_group_validated(normalized_notes, 0.05):
        candidates = _candidate_chords(normalized_notes, group, normalized_max_fret)
        if not candidates:
            return []
        group_candidates.append(candidates)

    # State: cumulative cost, previous chord, flattened path. Candidate chords
    # are fully enumerated before the beam is applied to complete DP states.
    states: List[Tuple[float, Chord | None, Chord]] = [(0.0, None, ())]
    for candidates in group_candidates:
        new_states: List[Tuple[float, Chord, Chord]] = []
        for previous_cost, previous_chord, previous_path in states:
            for candidate in candidates:
                cost = previous_cost + chord_cost(candidate)
                if previous_chord is not None:
                    cost += transition_cost(previous_chord, candidate)
                new_states.append((cost, candidate, previous_path + candidate))
        new_states.sort(key=lambda state: (state[0], state[2]))
        states = new_states[:normalized_beam_width]

    return list(states[0][2]) if states else []


def solve_notes(
    notes: List[NoteEvent],
    beam_width: int = 8,
    max_fret: int = DEFAULT_MAX_FRET,
) -> List[Dict[str, Any]]:
    """Validate and solve notes, dropping only physically conflicting events.

    Results are sorted by start time. Pitches outside the standard guitar's
    configured range and excess simultaneous detections are omitted instead of
    being assigned a fabricated string/fret pair.
    """
    normalized_beam_width = _validate_beam_width(beam_width)
    normalized_max_fret = _validate_max_fret(max_fret)
    playable_notes = _prepare_playable_notes(notes, normalized_max_fret)
    path = find_best_path(playable_notes, normalized_beam_width, normalized_max_fret)
    if len(path) != len(playable_notes):
        return []

    return [
        {
            "start": start,
            "end": end,
            "midi": midi,
            "confidence": confidence,
            "string": string_index + 1,
            "fret": fret,
        }
        for (start, end, midi, confidence), (string_index, fret) in zip(playable_notes, path)
    ]
