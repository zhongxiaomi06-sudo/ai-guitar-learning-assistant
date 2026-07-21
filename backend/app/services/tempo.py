"""
services/tempo.py
Estimate BPM and time signature from extracted note events or audio.

This is intentionally lightweight: we already run Basic Pitch on the audio, so
we can estimate tempo from note onset intervals without re-running a heavy
beat tracker. For cases where the audio is sparse (few notes), we fall back to
librosa beat tracking on the waveform.
"""

import math
from typing import List, Optional, Tuple

import numpy as np


NoteEvent = Tuple[float, float, int, float]


def _onset_intervals(onsets: List[float]) -> List[float]:
    """Return sorted positive intervals between consecutive note onsets."""
    intervals = []
    for i in range(1, len(onsets)):
        delta = onsets[i] - onsets[i - 1]
        if delta > 0.01:  # ignore duplicate/fractured onsets
            intervals.append(delta)
    return sorted(intervals)


def _bpm_from_note_onsets(onsets: List[float]) -> Optional[float]:
    """Estimate BPM from the median of note onset intervals."""
    if len(onsets) < 3:
        return None

    intervals = _onset_intervals(onsets)
    if not intervals:
        return None

    # Use the median of intervals to reduce the impact of ornamental notes.
    median_interval = float(np.median(intervals))
    if median_interval <= 0:
        return None

    bpm = 60.0 / median_interval
    # Tempos above 250 BPM are likely double-time misestimations.
    while bpm > 250 and median_interval > 0:
        bpm /= 2.0
    # Tempos below 40 BPM are likely half-time misestimations.
    while bpm < 40 and median_interval > 0:
        bpm *= 2.0
    return bpm


def _time_signature_from_onsets(onsets: List[float], bpm: float) -> Tuple[int, int]:
    """Estimate time signature by grouping note onsets into beats and bars.

    Returns:
        (numerator, denominator). Denominator is always 4 for MVP.
    """
    if len(onsets) < 4 or not bpm or bpm <= 0:
        return 4, 4

    beat_interval = 60.0 / bpm
    # Look at the first few seconds of onsets and see how many beats fit
    # between strong accent candidates (the first note in each bar).
    first_10_seconds = [o for o in onsets if o <= 10.0]
    if len(first_10_seconds) < 4:
        return 4, 4

    # Group onsets into beat positions within a hypothetical bar of 2, 3, or 4 beats.
    best_score = -1.0
    best_numerator = 4
    for numerator in [2, 3, 4, 6]:
        bar_duration = beat_interval * numerator
        # Count how many onsets land near beat boundaries within each bar.
        score = 0.0
        for onset in first_10_seconds:
            beat_in_bar = (onset % bar_duration) / beat_interval
            distance = min(beat_in_bar % 1.0, 1.0 - (beat_in_bar % 1.0))
            score += 1.0 - min(1.0, distance * 4.0)
        if score > best_score:
            best_score = score
            best_numerator = numerator

    return best_numerator, 4


def estimate_bpm_from_audio(audio_path: str) -> Optional[float]:
    """Estimate BPM using librosa beat tracking as a fallback."""
    try:
        import librosa
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        if len(y) == 0:
            return None
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        if isinstance(tempo, np.ndarray):
            tempo = float(tempo.item())
        else:
            tempo = float(tempo)
        if tempo > 250:
            tempo /= 2.0
        if tempo < 40:
            tempo *= 2.0
        return tempo
    except Exception:
        return None


def estimate_tempo(
    note_events: Optional[List[NoteEvent]] = None,
    audio_path: Optional[str] = None,
) -> Tuple[int, int]:
    """Estimate (BPM, time_signature) from note events or audio.

    Args:
        note_events: list of (start, end, midi, confidence) from Basic Pitch
        audio_path: path to the extracted analysis WAV (fallback)

    Returns:
        Tuple of (bpm, time_signature). Defaults to (72, [4, 4]) if estimation fails.
    """
    bpm = None

    if note_events:
        onsets = sorted({start for start, _, _, _ in note_events})
        bpm = _bpm_from_note_onsets(onsets)

    if bpm is None and audio_path:
        bpm = estimate_bpm_from_audio(audio_path)

    if bpm is None or not math.isfinite(bpm) or bpm <= 0:
        return 72, (4, 4)

    bpm = int(round(bpm))

    if note_events:
        onsets = sorted({start for start, _, _, _ in note_events})
        numerator, denominator = _time_signature_from_onsets(onsets, bpm)
    else:
        numerator, denominator = 4, 4

    return bpm, (numerator, denominator)
