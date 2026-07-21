r"""
scripts/run_pipeline.py
Run the audio → tab pipeline locally on a video file.

Usage:
    cd backend
    .venv\Scripts\activate
    python scripts/run_pipeline.py path/to/video.mp4 --title "Song Name" --bpm 72
"""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

# Add parent directory to import app.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.audio_pipeline import AudioPipeline


def main():
    parser = argparse.ArgumentParser(description="Audio to tab pipeline")
    parser.add_argument("video", help="Path to input video")
    parser.add_argument("--title", default="Untitled", help="Song title")
    parser.add_argument("--bpm", type=int, default=72, help="BPM")
    parser.add_argument("--key", default="C", help="Musical key")
    parser.add_argument("--time-signature", default="4/4", help="Time signature, e.g. 4/4")
    parser.add_argument("--output", "-o", default="output_score.json", help="Output JSON path")
    parser.add_argument("--keep-work-dir", action="store_true", help="Keep intermediate audio files")
    args = parser.parse_args()

    video_path = Path(args.video).expanduser().resolve()
    if not video_path.is_file():
        parser.error(f"video does not exist or is not a file: {video_path}")
    if not 1 <= args.bpm <= 400:
        parser.error("--bpm must be between 1 and 400")
    try:
        signature_parts = args.time_signature.split("/")
        if len(signature_parts) != 2:
            raise ValueError
        ts = [int(part) for part in signature_parts]
        if not 1 <= ts[0] <= 32 or ts[1] not in {1, 2, 4, 8, 16}:
            raise ValueError
    except ValueError:
        parser.error("--time-signature must contain two supported positive values, e.g. 4/4")

    output_path = Path(args.output).expanduser().resolve()
    same_as_input = output_path == video_path
    if not same_as_input and output_path.exists():
        try:
            same_as_input = os.path.samefile(video_path, output_path)
        except OSError:
            same_as_input = False
    if same_as_input:
        parser.error("--output must not overwrite the input video")
    if output_path.exists() and output_path.is_dir():
        parser.error("--output must be a file path, not a directory")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    work_dir = None
    if args.keep_work_dir:
        work_dir = tempfile.mkdtemp(prefix="pipeline_work_", dir=output_path.parent)

    pipeline = AudioPipeline()
    score = pipeline.run(
        video_path=str(video_path),
        title=args.title,
        duration=0.0,  # optional
        bpm=args.bpm,
        time_signature=ts,
        key=args.key,
        output_dir=work_dir,
    )

    temp_output = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as output_file:
            temp_output = Path(output_file.name)
            json.dump(score, output_file, ensure_ascii=False, indent=2, allow_nan=False)
            output_file.write("\n")
        os.replace(temp_output, output_path)
    finally:
        if temp_output is not None:
            temp_output.unlink(missing_ok=True)

    total_notes = sum(len(beat["notes"]) for bar in score["bars"] for beat in bar["beats"])
    print(f"Score written to {output_path}")
    print(f"Bars: {len(score['bars'])}, Total notes: {total_notes}")
    if work_dir:
        print(f"Intermediate files kept in {work_dir}")


if __name__ == "__main__":
    main()
