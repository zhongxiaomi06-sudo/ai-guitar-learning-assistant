"""
services/quality_check.py
Lightweight media quality inspection for uploaded guitar lesson videos.

This module reads the extracted analysis WAV and returns structured feedback
about audio presence, loudness, noise level, and duration. It does not perform
visual analysis (that is out of MVP scope) but it does report when a file has
no audio track or is suspiciously short.
"""

import math
from typing import Any, Dict, Tuple

import numpy as np


def analyze_audio(
    audio_path: str,
    sample_rate: int = 22050,
) -> Tuple[bool, Dict[str, Any]]:
    """Inspect an audio file and return (ok, report).

    Args:
        audio_path: path to a mono WAV file
        sample_rate: expected sample rate of the file

    Returns:
        Tuple of (overall_ok, report_dict). The report contains human-readable
        messages and machine-usable flags.
    """
    try:
        import soundfile as sf
        data, sr = sf.read(audio_path, dtype="float32")
    except Exception as exc:
        return False, {
            "ok": False,
            "messages": [f"无法读取音频：{exc}"],
            "has_audio": False,
            "duration_seconds": 0.0,
            "rms_db": None,
            "peak_db": None,
            "noise_floor_db": None,
            "snr_db": None,
        }

    if data is None or data.size == 0:
        return False, {
            "ok": False,
            "messages": ["音频文件为空，未检测到音轨。"],
            "has_audio": False,
            "duration_seconds": 0.0,
            "rms_db": None,
            "peak_db": None,
            "noise_floor_db": None,
            "snr_db": None,
        }

    if data.ndim > 1:
        data = data.mean(axis=1)

    duration = len(data) / sr
    peak = np.max(np.abs(data))
    rms = np.sqrt(np.mean(data**2))

    def to_db(value: float) -> float:
        if value <= 0:
            return -120.0
        return 20.0 * math.log10(value)

    peak_db = to_db(float(peak))
    rms_db = to_db(float(rms))

    # Estimate noise floor from the quietest non-zero 50 ms windows.
    window_size = int(0.05 * sr)
    if window_size > 0 and len(data) >= window_size:
        step = max(1, window_size // 2)
        window_rms = []
        for start in range(0, len(data) - window_size + 1, step):
            w = data[start : start + window_size]
            rms_value = float(np.sqrt(np.mean(w**2)))
            if rms_value > 1e-9:
                window_rms.append(rms_value)
        if window_rms:
            # Use the minimum non-zero window as a conservative noise floor,
            # but never exceed 1% of the overall RMS to avoid misclassifying
            # sustained tones as noisy.
            noise_floor = min(min(window_rms), rms * 0.01)
        else:
            noise_floor = rms * 0.1
    else:
        noise_floor = rms * 0.1

    noise_floor_db = to_db(noise_floor)
    snr_db = rms_db - noise_floor_db

    messages = []
    ok = True

    if duration < 1.0:
        messages.append("音频时长不足 1 秒，请检查视频是否包含有效内容。")
        ok = False

    if peak_db < -50:
        messages.append("音量过低，识别准确度可能降低。")
        ok = False

    if snr_db < 10:
        messages.append("环境噪声较高，建议在更安静的环境练习或靠近麦克风。")
        ok = False

    if not messages:
        messages.append("音频质量正常。")

    return ok, {
        "ok": ok,
        "messages": messages,
        "has_audio": True,
        "duration_seconds": round(duration, 2),
        "rms_db": round(rms_db, 2),
        "peak_db": round(peak_db, 2),
        "noise_floor_db": round(noise_floor_db, 2),
        "snr_db": round(snr_db, 2),
    }
