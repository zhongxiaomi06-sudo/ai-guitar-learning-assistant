"""
services/transcription.py
Basic Pitch wrapper for audio → note events.
"""

import logging
import os
import tempfile
from pathlib import Path
from typing import List, Tuple

logger = logging.getLogger(__name__)


def extract_audio(video_path: str, output_path: str = None, sample_rate: int = 22050) -> str:
    """Extract mono audio from a video file using FFmpeg.

    Args:
        video_path: path to the input video
        output_path: optional output WAV path; defaults to a temp file
        sample_rate: target sample rate

    Returns:
        Path to the extracted WAV file.
    """
    import subprocess

    if output_path is None:
        output_path = tempfile.mktemp(suffix=".wav")

    cmd = [
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vn",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-acodec", "pcm_s16le",
        output_path,
    ]
    logger.info("Extracting audio with FFmpeg: %s", " ".join(cmd))
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return output_path


def get_video_duration(video_path: str) -> float:
    """Return video duration in seconds using FFprobe."""
    import subprocess
    import json

    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        video_path,
    ]
    result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def _merge_same_pitch(notes: List[Tuple[float, float, int, float]],
                        gap_threshold: float = 0.05,
                        min_duration: float = 0.08) -> List[Tuple[float, float, int, float]]:
    """Merge consecutive notes of the same pitch with small gaps.

    Basic Pitch can emit fragmented detections for a single sustained note.
    This merges them into one longer note and drops very short artifacts.
    """
    if not notes:
        return []

    # Sort by pitch then start time
    notes = sorted(notes, key=lambda x: (x[2], x[0]))
    merged = []
    cur_start, cur_end, cur_pitch, cur_conf = notes[0]

    for start, end, pitch, conf in notes[1:]:
        if pitch == cur_pitch and (start - cur_end) <= gap_threshold:
            # Extend current note and keep highest confidence
            cur_end = max(cur_end, end)
            cur_conf = max(cur_conf, conf)
        else:
            duration = cur_end - cur_start
            if duration >= min_duration:
                merged.append((cur_start, cur_end, cur_pitch, cur_conf))
            cur_start, cur_end, cur_pitch, cur_conf = start, end, pitch, conf

    duration = cur_end - cur_start
    if duration >= min_duration:
        merged.append((cur_start, cur_end, cur_pitch, cur_conf))

    return merged


def transcribe_audio(audio_path: str, onset_threshold: float = 0.5,
                     frame_threshold: float = 0.3, min_note_length: float = 0.05,
                     min_midi: int = 40, max_midi: int = 76) -> List[Tuple[float, float, int, float]]:
    """Run Basic Pitch on an audio file and return note events.

    Args:
        audio_path: path to WAV/MP3/etc.
        onset_threshold: Basic Pitch onset confidence threshold
        frame_threshold: Basic Pitch frame confidence threshold
        min_note_length: minimum note length in seconds passed to Basic Pitch
        min_midi: minimum MIDI pitch to keep (guitar low E = 40)
        max_midi: maximum MIDI pitch to keep (guitar high E = 76)

    Returns:
        List of (start_time, end_time, midi, confidence) tuples.
    """
    # Basic Pitch imports a TF SavedModel loader by default on import in some versions.
    # Importing inside the function keeps startup fast when transcription is not needed.
    from basic_pitch.inference import predict

    logger.info("Running Basic Pitch on %s", audio_path)
    model_output, midi_data, note_events = predict(
        audio_path,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_length,
    )
    logger.info("Basic Pitch returned %d note events", len(note_events))

    # note_events format: (start, end, pitch, confidence, bend_list)
    notes = []
    for event in note_events:
        start, end, pitch, confidence = event[0], event[1], int(event[2]), float(event[3])
        if min_midi <= pitch <= max_midi:
            notes.append((start, end, pitch, confidence))

    # Merge fragmented detections of the same pitch and drop short artifacts
    merged = _merge_same_pitch(notes, gap_threshold=0.05, min_duration=0.08)

    # Final deduplication: drop exact duplicate start times within a small window
    deduped = []
    merged.sort(key=lambda x: (x[2], x[0]))
    last_pitch = -1
    last_start = -1.0
    time_window = 0.05
    for start, end, pitch, confidence in merged:
        if pitch == last_pitch and abs(start - last_start) < time_window:
            continue
        deduped.append((start, end, pitch, confidence))
        last_pitch = pitch
        last_start = start

    # Sort by start time
    deduped.sort(key=lambda x: x[0])
    logger.info("Kept %d notes in guitar range [%d, %d]", len(deduped), min_midi, max_midi)
    return deduped
