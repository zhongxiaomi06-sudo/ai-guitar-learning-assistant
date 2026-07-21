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

    ts = [int(x) for x in args.time_signature.split("/")]
    work_dir = os.path.join(os.path.dirname(args.output), "pipeline_work") if args.keep_work_dir else None

    pipeline = AudioPipeline()
    score = pipeline.run(
        video_path=args.video,
        title=args.title,
        duration=0.0,  # optional
        bpm=args.bpm,
        time_signature=ts,
        key=args.key,
        output_dir=work_dir,
    )

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(score, f, ensure_ascii=False, indent=2)

    total_notes = sum(len(beat["notes"]) for bar in score["bars"] for beat in bar["beats"])
    print(f"Score written to {args.output}")
    print(f"Bars: {len(score['bars'])}, Total notes: {total_notes}")


if __name__ == "__main__":
    main()
