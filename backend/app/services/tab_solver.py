"""
services/tab_solver.py
Map MIDI pitches to guitar strings and frets using a dynamic-programming path search.
"""

from typing import List, Tuple, Dict, Any

# Standard tuning: E2 A2 D3 G3 B3 E4 (MIDI: 40, 45, 50, 55, 59, 64)
STRING_OPEN_MIDI = [64, 59, 55, 50, 45, 40]  # string 1 (high) to 6 (low)


def midi_to_candidates(midi: int, max_fret: int = 19) -> List[Tuple[int, int]]:
    """Return all possible (string, fret) positions for a MIDI pitch.

    String index 0 = high E, 5 = low E.
    """
    candidates = []
    for string_idx, open_midi in enumerate(STRING_OPEN_MIDI):
        fret = midi - open_midi
        if 0 <= fret <= max_fret:
            candidates.append((string_idx, fret))
    return candidates


def same_time_group(notes: List[Tuple[float, float, int, float]],
                    time_threshold: float = 0.05) -> List[List[int]]:
    """Group note indices that start at roughly the same time into chords."""
    if not notes:
        return []

    groups = []
    current_group = [0]
    for i in range(1, len(notes)):
        if abs(notes[i][0] - notes[current_group[0]][0]) <= time_threshold:
            current_group.append(i)
        else:
            groups.append(current_group)
            current_group = [i]
    groups.append(current_group)
    return groups


def chord_finger_span(positions: List[Tuple[int, int]]) -> int:
    """Compute the fret span of a chord. Lower is better."""
    frets = [fret for _, fret in positions if fret > 0]
    if not frets:
        return 0
    return max(frets) - min(frets)


def chord_cost(positions: List[Tuple[int, int]]) -> float:
    """Cost for a single chord: prefer open strings, small span, low frets, and no duplicate strings."""
    cost = 0.0

    # Penalize large fret span
    span = chord_finger_span(positions)
    if span > 4:
        cost += (span - 4) ** 2 * 1.5

    # Reward open strings
    open_count = sum(1 for _, fret in positions if fret == 0)
    cost -= open_count * 2.0

    # Penalize high frets (prefer lower positions, especially below 5th fret)
    for _, fret in positions:
        if fret > 12:
            cost += (fret - 12) * 1.0
        elif fret > 7:
            cost += (fret - 7) * 0.3
        elif fret > 5:
            cost += (fret - 5) * 0.1

    # Penalize duplicate strings (impossible physically)
    strings = [s for s, _ in positions]
    if len(strings) != len(set(strings)):
        cost += 1000.0

    # Penalize barre-like stretches (large span + no open strings)
    if span >= 4 and open_count == 0:
        cost += span * 0.5

    return cost


def transition_cost(prev: List[Tuple[int, int]], curr: List[Tuple[int, int]]) -> float:
    """Cost of moving from one chord/note to the next."""
    if not prev or not curr:
        return 0.0

    cost = 0.0
    prev_frets = [fret for _, fret in prev]
    curr_frets = [fret for _, fret in curr]

    # Average fret distance
    avg_prev = sum(prev_frets) / len(prev_frets) if prev_frets else 0
    avg_curr = sum(curr_frets) / len(curr_frets) if curr_frets else 0
    cost += abs(avg_curr - avg_prev) * 0.5

    # Big jumps on the same string are harder
    prev_by_string = {s: f for s, f in prev}
    for s, f in curr:
        if s in prev_by_string:
            cost += abs(f - prev_by_string[s]) ** 2 * 0.15

    # Prefer small overall span changes
    prev_span = chord_finger_span(prev)
    curr_span = chord_finger_span(curr)
    cost += abs(curr_span - prev_span) * 0.3

    # Slightly penalize jumping to a very different fret region
    if avg_prev > 0 and abs(avg_curr - avg_prev) > 7:
        cost += 2.0

    return cost


def find_best_path(notes: List[Tuple[float, float, int, float]],
                   beam_width: int = 8) -> List[Tuple[int, int]]:
    """Find the best string/fret sequence for a list of notes.

    Args:
        notes: list of (start, end, midi, confidence)
        beam_width: number of top candidates to keep at each step

    Returns:
        List of (string, fret) positions aligned with the input notes.
    """
    if not notes:
        return []

    # Group notes into chords
    groups = same_time_group(notes)

    # For each group, generate all candidate chord fingerings
    group_candidates = []
    for group in groups:
        note_candidates = [midi_to_candidates(notes[i][2]) for i in group]
        # Cartesian product of candidates for notes in this group
        from itertools import product
        candidates = list(product(*note_candidates))
        # Score each candidate chord
        scored = []
        for candidate in candidates:
            if len(candidate) != len(group):
                continue
            cost = chord_cost(candidate)
            scored.append((cost, candidate))
        scored.sort(key=lambda x: x[0])
        # Keep at least one candidate per group, even if duplicates exist
        group_candidates.append([cand for _, cand in scored[:max(beam_width, 1)]])

    # DP over groups, keeping top beam_width paths.
    # State: (cumulative_cost, previous_chord_positions, flat_path)
    states = [(0.0, None, ())]
    for candidates in group_candidates:
        new_states = []
        for prev_cost, prev_chord, prev_path in states:
            for cand in candidates:
                if prev_chord is None:
                    cost = chord_cost(cand)
                else:
                    cost = prev_cost + chord_cost(cand) + transition_cost(prev_chord, cand)
                # Flatten candidate tuple into the path
                flat_cand = tuple(pos for pos in cand)
                new_states.append((cost, cand, prev_path + flat_cand))
        # Sort by cost and keep top beam_width paths
        new_states.sort(key=lambda x: x[0])
        states = new_states[:beam_width]

    if not states:
        return []

    best_path = states[0][2]
    # best_path is a flat tuple of (string, fret) for each note in order
    return list(best_path)


def solve_notes(notes: List[Tuple[float, float, int, float]]) -> List[Dict[str, Any]]:
    """Solve string/fret positions for all notes and attach them to events.

    Returns a list of dicts with keys: start, end, midi, confidence, string, fret.
    """
    path = find_best_path(notes)
    results = []
    for i, (start, end, midi, confidence) in enumerate(notes):
        if i < len(path):
            string_idx, fret = path[i]
            results.append({
                "start": start,
                "end": end,
                "midi": midi,
                "confidence": confidence,
                "string": string_idx + 1,  # 1-indexed for UI
                "fret": fret,
            })
        else:
            # Fallback: choose highest string candidate (smallest string index)
            candidates = midi_to_candidates(midi)
            if candidates:
                string_idx, fret = candidates[0]
            else:
                # Should not happen after filtering, but keep a safe default
                string_idx, fret = 0, 0
            results.append({
                "start": start,
                "end": end,
                "midi": midi,
                "confidence": confidence,
                "string": string_idx + 1,
                "fret": fret,
            })
    return results
