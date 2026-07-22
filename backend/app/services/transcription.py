"""
services/transcription.py
Basic Pitch wrapper for audio → note events.
"""

import json
import logging
import math
from numbers import Integral, Real
import os
from pathlib import Path
import subprocess
import tempfile
from typing import List, Sequence, Tuple

from app.services.tab_solver import MAX_PLAYABLE_MIDI, MIN_PLAYABLE_MIDI

logger = logging.getLogger(__name__)

FFMPEG_TIMEOUT_SECONDS = 600
FFPROBE_TIMEOUT_SECONDS = 30


class MediaToolError(RuntimeError):
    """A sanitized FFmpeg/FFprobe failure safe to emit in application logs."""


def _run_media_command(
    command: Sequence[str],
    *,
    tool_name: str,
    timeout_seconds: int,
    capture_stdout: bool = False,
):
    """Run a media command without exposing its arguments through exceptions.

    Input arguments may include object-storage pre-signed URLs. Native
    ``subprocess`` exceptions retain the complete command, so never propagate
    or chain them into application logs.
    """
    try:
        return subprocess.run(
            list(command),
            check=True,
            stdout=subprocess.PIPE if capture_stdout else subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=capture_stdout,
            timeout=timeout_seconds,
        )
    except FileNotFoundError:
        raise MediaToolError(f"{tool_name} is not installed or unavailable") from None
    except subprocess.TimeoutExpired:
        raise MediaToolError(
            f"{tool_name} timed out after {timeout_seconds} seconds"
        ) from None
    except subprocess.CalledProcessError:
        raise MediaToolError(f"{tool_name} failed while processing media") from None
    except OSError:
        raise MediaToolError(f"{tool_name} could not be started") from None


def _same_local_file(first: str, second: str) -> bool:
    """Return whether two local path strings identify the same file."""
    if "://" in first or "://" in second:
        return False
    first_path = Path(first).expanduser().resolve()
    second_path = Path(second).expanduser().resolve()
    if first_path == second_path:
        return True
    try:
        return first_path.exists() and second_path.exists() and os.path.samefile(
            first_path,
            second_path,
        )
    except OSError:
        return False


def _remove_partial(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        # Never replace the useful, sanitized media error with a cleanup error.
        logger.warning("Could not remove an incomplete media output")


def extract_audio(video_path: str, output_path: str = None, sample_rate: int = 22050) -> str:
    """Extract mono audio from a video file using FFmpeg.

    Args:
        video_path: path to the input video
        output_path: optional output WAV path; defaults to a temp file
        sample_rate: target sample rate

    Returns:
        Path to the extracted WAV file.
    """
    if not isinstance(sample_rate, int) or sample_rate <= 0:
        raise ValueError("sample_rate must be a positive integer")
    video_path = os.fspath(video_path)
    if output_path is None:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_audio:
            output_path = temp_audio.name
        # Reserve a unique destination name without exposing an empty file as a
        # successful extraction if FFmpeg subsequently fails.
        Path(output_path).unlink()
    output_path = os.fspath(output_path)

    if _same_local_file(video_path, output_path):
        raise ValueError("Audio output must not overwrite the input media")

    destination = Path(output_path).expanduser().absolute()
    partial_path = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=".guitar_audio_",
            suffix=".partial.wav",
            delete=False,
        ) as partial_audio:
            partial_path = Path(partial_audio.name)

        command = [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel", "error",
            "-nostats",
            "-y",
            "-i", video_path,
            "-vn",
            "-ac", "1",
            "-ar", str(sample_rate),
            "-acodec", "pcm_s16le",
            "-f", "wav",
            str(partial_path),
        ]
        logger.info("Extracting mono audio with FFmpeg")
        _run_media_command(
            command,
            tool_name="FFmpeg",
            timeout_seconds=FFMPEG_TIMEOUT_SECONDS,
        )
        os.replace(partial_path, destination)
        partial_path = None
        return str(destination)
    finally:
        if partial_path is not None:
            _remove_partial(partial_path)


def get_video_duration(video_path: str) -> float:
    """Return video duration in seconds using FFprobe."""
    command = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        os.fspath(video_path),
    ]
    result = _run_media_command(
        command,
        tool_name="FFprobe",
        timeout_seconds=FFPROBE_TIMEOUT_SECONDS,
        capture_stdout=True,
    )
    try:
        data = json.loads(result.stdout)
        duration = float(data["format"]["duration"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        raise ValueError("FFprobe did not return a valid media duration") from None
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Media duration must be a positive finite number")
    return duration


def get_av_offset(video_path: str) -> float:
    """Return the audio-vs-video start offset in seconds.

    The offset is ``audio_stream.start_time - video_stream.start_time``. A
    non-zero value typically indicates encoder delay or an MP4 edit list that
    shifts audio relative to video. The browser's HTML5 ``currentTime`` is
    0-based on the video stream, so the offset is added to audio-derived note
    times when mapping them onto the video timeline.

    Returns ``0.0`` when ffprobe is unavailable, no audio stream exists, or
    the streams lack ``start_time`` metadata — playback then stays aligned by
    default rather than guessing from ambiguous data.
    """
    command = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "stream=codec_type,start_time",
        "-of", "json",
        os.fspath(video_path),
    ]
    try:
        result = _run_media_command(
            command,
            tool_name="FFprobe",
            timeout_seconds=FFPROBE_TIMEOUT_SECONDS,
            capture_stdout=True,
        )
        data = json.loads(result.stdout)
    except (MediaToolError, json.JSONDecodeError, OSError):
        return 0.0

    video_start = 0.0
    audio_start = 0.0
    found_audio = False
    found_video = False
    for stream in data.get("streams", []):
        if not isinstance(stream, dict):
            continue
        codec_type = stream.get("codec_type")
        raw_start = stream.get("start_time")
        try:
            start = float(raw_start) if raw_start is not None else 0.0
        except (TypeError, ValueError):
            continue
        if not math.isfinite(start):
            start = 0.0
        if codec_type == "video" and not found_video:
            video_start = max(0.0, start)
            found_video = True
        elif codec_type == "audio" and not found_audio:
            audio_start = max(0.0, start)
            found_audio = True

    if not found_audio:
        return 0.0
    return max(0.0, audio_start - video_start)


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
                     frame_threshold: float = 0.3, min_note_length_ms: float = 50.0,
                     min_midi: int = MIN_PLAYABLE_MIDI,
                     max_midi: int = MAX_PLAYABLE_MIDI) -> List[Tuple[float, float, int, float]]:
    """Run Basic Pitch on an audio file and return note events.

    Args:
        audio_path: path to WAV/MP3/etc.
        onset_threshold: Basic Pitch onset confidence threshold
        frame_threshold: Basic Pitch frame confidence threshold
        min_note_length_ms: minimum note length in milliseconds, as expected by Basic Pitch
        min_midi: minimum MIDI pitch to keep (guitar low E = 40)
        max_midi: maximum MIDI pitch to keep (high E string, fret 19 = 83)

    Returns:
        List of (start_time, end_time, midi, confidence) tuples.
    """
    for name, value in (
        ("onset_threshold", onset_threshold),
        ("frame_threshold", frame_threshold),
    ):
        if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value):
            raise ValueError(f"{name} must be a finite number")
        if not 0 <= value <= 1:
            raise ValueError(f"{name} must be between 0 and 1")
    if (
        isinstance(min_note_length_ms, bool)
        or not isinstance(min_note_length_ms, Real)
        or not math.isfinite(min_note_length_ms)
        or min_note_length_ms <= 0
    ):
        raise ValueError("min_note_length_ms must be a positive finite number")
    if (
        isinstance(min_midi, bool)
        or isinstance(max_midi, bool)
        or not isinstance(min_midi, Integral)
        or not isinstance(max_midi, Integral)
        or min_midi > max_midi
    ):
        raise ValueError("min_midi and max_midi must be ordered integers")

    # Basic Pitch imports a TF SavedModel loader by default on import in some versions.
    # Importing inside the function keeps startup fast when transcription is not needed.
    from basic_pitch.inference import predict

    logger.info("Running Basic Pitch transcription")
    _, _, note_events = predict(
        audio_path,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_length_ms,
    )
    logger.info("Basic Pitch returned %d note events", len(note_events))

    # note_events format: (start, end, pitch, confidence, bend_list)
    notes = []
    for event in note_events:
        try:
            if len(event) < 4:
                raise ValueError
            start, end = float(event[0]), float(event[1])
            raw_pitch, confidence = event[2], float(event[3])
        except (IndexError, TypeError, ValueError, OverflowError):
            raise ValueError("Basic Pitch returned a malformed note event")
        if (
            not math.isfinite(start)
            or not math.isfinite(end)
            or not math.isfinite(confidence)
            or start < 0
            or end <= start
            or not 0 <= confidence <= 1
            or isinstance(raw_pitch, bool)
            or not isinstance(raw_pitch, Real)
            or not math.isfinite(raw_pitch)
            or not float(raw_pitch).is_integer()
        ):
            raise ValueError("Basic Pitch returned an invalid note event")
        pitch = int(raw_pitch)
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
