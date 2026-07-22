import subprocess
import sys
import traceback
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from app.services import audio_pipeline, transcription
from app.database import SessionLocal
from app.models.course import Course
from scripts import run_pipeline


def test_local_pipeline_run_does_not_initialize_configured_storage(monkeypatch):
    def unexpected_storage_init():
        raise AssertionError("run-only pipeline must not initialize storage")

    def fake_analyze_audio(audio_path, sample_rate=22050):
        return True, {
            "ok": True,
            "messages": ["音频质量正常。"],
            "has_audio": True,
            "duration_seconds": 1.0,
            "rms_db": -20.0,
            "peak_db": -10.0,
            "noise_floor_db": -80.0,
            "snr_db": 60.0,
        }

    monkeypatch.setattr(audio_pipeline, "get_storage", unexpected_storage_init)
    monkeypatch.setattr(audio_pipeline, "extract_audio", lambda *args, **kwargs: None)
    monkeypatch.setattr(audio_pipeline, "analyze_audio", fake_analyze_audio)
    # Provide note events so the pipeline produces a usable score without
    # falling back to librosa beat tracking on the mocked audio file.
    monkeypatch.setattr(
        audio_pipeline,
        "transcribe_audio",
        lambda *args, **kwargs: [
            (0.0, 0.15, 64, 0.9),
            (0.2, 0.35, 62, 0.9),
            (0.4, 0.55, 60, 0.9),
            (0.6, 0.75, 59, 0.9),
        ],
    )

    score = audio_pipeline.AudioPipeline().run(
        video_path="input.mp4",
        title="Local run",
        duration=1.0,
    )

    assert score["title"] == "Local run"
    assert score["duration"] == 1.0


def test_pipeline_rejects_long_media_before_audio_or_model_work(monkeypatch):
    monkeypatch.setattr(
        audio_pipeline,
        "extract_audio",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("audio extraction must not start")
        ),
    )
    monkeypatch.setattr(
        audio_pipeline,
        "transcribe_audio",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("transcription must not start")
        ),
    )

    with pytest.raises(audio_pipeline.InputQualityError, match="600"):
        audio_pipeline.AudioPipeline().run("long.mp4", duration=600.01)


def test_pipeline_clips_model_tail_to_media_duration(monkeypatch):
    def fake_analyze_audio(audio_path, sample_rate=22050):
        return True, {
            "ok": True,
            "messages": ["音频质量正常。"],
            "has_audio": True,
            "duration_seconds": 1.0,
            "rms_db": -20.0,
            "peak_db": -10.0,
            "noise_floor_db": -80.0,
            "snr_db": 60.0,
        }

    monkeypatch.setattr(audio_pipeline, "analyze_audio", fake_analyze_audio)
    monkeypatch.setattr(audio_pipeline, "extract_audio", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        audio_pipeline,
        "transcribe_audio",
        lambda *args, **kwargs: [
            (0.9, 1.1, 64, 0.9),
            (1.0, 1.2, 65, 0.8),
        ],
    )

    built = audio_pipeline.AudioPipeline().run("tail.mp4", duration=1.0)
    notes = [
        note
        for bar in built["bars"]
        for beat in bar["beats"]
        for note in beat["notes"]
    ]

    assert built["duration"] == 1.0
    assert len(notes) == 1
    assert notes[0]["endTime"] == 1.0


def test_transcription_keeps_the_full_standard_19_fret_range(monkeypatch):
    captured = {}
    inference = ModuleType("basic_pitch.inference")

    def predict(path, **kwargs):
        captured.update(kwargs)
        return None, None, [
            (0.0, 0.2, 83, 0.9, []),
            (0.3, 0.5, 84, 0.9, []),
        ]

    inference.predict = predict
    package = ModuleType("basic_pitch")
    package.__path__ = []
    monkeypatch.setitem(sys.modules, "basic_pitch", package)
    monkeypatch.setitem(sys.modules, "basic_pitch.inference", inference)

    notes = transcription.transcribe_audio("analysis.wav")

    assert [event[2] for event in notes] == [83]
    assert captured["minimum_note_length"] == 50.0


@pytest.mark.parametrize("raw_duration", ["nan", "inf", "0", "-1"])
def test_video_duration_rejects_non_positive_or_non_finite_values(monkeypatch, raw_duration):
    monkeypatch.setattr(
        "subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(
            stdout=f'{{"format": {{"duration": "{raw_duration}"}}}}'
        ),
    )

    with pytest.raises(ValueError, match="positive finite"):
        transcription.get_video_duration("input.mp4")


def test_pipeline_cleans_owned_work_dir_when_duration_probe_fails(monkeypatch, tmp_path):
    work_dir = tmp_path / "pipeline-work"

    def create_work_dir(*args, **kwargs):
        work_dir.mkdir()
        return str(work_dir)

    monkeypatch.setattr(audio_pipeline.tempfile, "mkdtemp", create_work_dir)
    monkeypatch.setattr(
        audio_pipeline,
        "get_video_duration",
        lambda path: (_ for _ in ()).throw(RuntimeError("invalid media")),
    )

    with pytest.raises(RuntimeError, match="invalid media"):
        audio_pipeline.AudioPipeline().run(video_path="broken.mp4")

    assert not work_dir.exists()


@pytest.mark.parametrize("failure", ["process", "timeout"])
def test_extract_audio_cleans_partial_output_and_sanitizes_errors(
    monkeypatch,
    tmp_path,
    failure,
):
    secret = "super-secret-signature"
    video_url = f"https://objects.example.test/video.mp4?X-Amz-Signature={secret}"
    destination = tmp_path / "analysis.wav"
    destination.write_bytes(b"previous-good-output")

    def fail_after_partial_write(command, **kwargs):
        Path(command[-1]).write_bytes(b"partial-output")
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        raise subprocess.CalledProcessError(1, command, stderr=b"decoder failed")

    monkeypatch.setattr(transcription.subprocess, "run", fail_after_partial_write)

    with pytest.raises(transcription.MediaToolError) as error:
        transcription.extract_audio(video_url, str(destination))

    rendered_traceback = "".join(
        traceback.format_exception(
            type(error.value),
            error.value,
            error.value.__traceback__,
        )
    )
    assert secret not in str(error.value)
    assert secret not in rendered_traceback
    assert destination.read_bytes() == b"previous-good-output"
    assert list(tmp_path.iterdir()) == [destination]


def test_ffprobe_failure_does_not_expose_presigned_url(monkeypatch):
    secret = "duration-secret-signature"
    video_url = f"https://objects.example.test/video.mp4?X-Amz-Signature={secret}"

    def fail_probe(command, **kwargs):
        raise subprocess.CalledProcessError(1, command, stderr="probe failed")

    monkeypatch.setattr(transcription.subprocess, "run", fail_probe)

    with pytest.raises(transcription.MediaToolError) as error:
        transcription.get_video_duration(video_url)

    rendered_traceback = "".join(
        traceback.format_exception(
            type(error.value),
            error.value,
            error.value.__traceback__,
        )
    )
    assert secret not in str(error.value)
    assert secret not in rendered_traceback


def _probe_result(streams_json):
    """Build a SimpleNamespace mimicking subprocess.run stdout for ffprobe JSON."""
    return SimpleNamespace(stdout=streams_json)


def test_get_av_offset_returns_audio_minus_video_start_time(monkeypatch):
    payload = '{"streams": [{"codec_type": "video", "start_time": "0.0"}, {"codec_type": "audio", "start_time": "0.04"}]}'
    monkeypatch.setattr(transcription.subprocess, "run", lambda *a, **k: _probe_result(payload))

    offset = transcription.get_av_offset("video.mp4")
    assert abs(offset - 0.04) < 1e-9


def test_get_av_offset_defaults_to_zero_when_audio_has_no_start_time(monkeypatch):
    payload = '{"streams": [{"codec_type": "video", "start_time": "0.0"}, {"codec_type": "audio"}]}'
    monkeypatch.setattr(transcription.subprocess, "run", lambda *a, **k: _probe_result(payload))

    assert transcription.get_av_offset("video.mp4") == 0.0


def test_get_av_offset_defaults_to_zero_when_no_audio_stream(monkeypatch):
    payload = '{"streams": [{"codec_type": "video", "start_time": "0.0"}]}'
    monkeypatch.setattr(transcription.subprocess, "run", lambda *a, **k: _probe_result(payload))

    assert transcription.get_av_offset("video.mp4") == 0.0


def test_get_av_offset_subtracts_video_start_to_normalize_to_browser_clock(monkeypatch):
    # Video stream starts at 0.1, audio at 0.14 → relative offset 0.04
    payload = '{"streams": [{"codec_type": "video", "start_time": "0.1"}, {"codec_type": "audio", "start_time": "0.14"}]}'
    monkeypatch.setattr(transcription.subprocess, "run", lambda *a, **k: _probe_result(payload))

    assert abs(transcription.get_av_offset("video.mp4") - 0.04) < 1e-9


def test_get_av_offset_clamps_negative_offset_to_zero(monkeypatch):
    # Audio starts before video (rare) → clamp to 0 rather than shifting notes earlier
    payload = '{"streams": [{"codec_type": "video", "start_time": "0.1"}, {"codec_type": "audio", "start_time": "0.05"}]}'
    monkeypatch.setattr(transcription.subprocess, "run", lambda *a, **k: _probe_result(payload))

    assert transcription.get_av_offset("video.mp4") == 0.0


def test_get_av_offset_returns_zero_when_ffprobe_fails(monkeypatch):
    def fail(command, **kwargs):
        raise subprocess.CalledProcessError(1, command, stderr="probe failed")

    monkeypatch.setattr(transcription.subprocess, "run", fail)

    assert transcription.get_av_offset("video.mp4") == 0.0


def test_get_av_offset_returns_zero_on_malformed_json(monkeypatch):
    monkeypatch.setattr(transcription.subprocess, "run", lambda *a, **k: _probe_result("not-json"))
    assert transcription.get_av_offset("video.mp4") == 0.0


def test_extract_audio_replaces_destination_only_after_success(monkeypatch, tmp_path):
    destination = tmp_path / "analysis.wav"
    destination.write_bytes(b"old")

    def succeed(command, **kwargs):
        Path(command[-1]).write_bytes(b"complete-wav")
        return SimpleNamespace(stdout=None)

    monkeypatch.setattr(transcription.subprocess, "run", succeed)

    result = transcription.extract_audio("video.mp4", str(destination))

    assert result == str(destination.absolute())
    assert destination.read_bytes() == b"complete-wav"
    assert list(tmp_path.iterdir()) == [destination]


def test_cli_refuses_to_overwrite_input_video(monkeypatch, tmp_path):
    video = tmp_path / "lesson.mp4"
    original = b"original-video"
    video.write_bytes(original)
    monkeypatch.setattr(
        sys,
        "argv",
        ["run_pipeline.py", str(video), "--output", str(video)],
    )

    class UnexpectedPipeline:
        def __init__(self):
            raise AssertionError("pipeline must not start for an unsafe output path")

    monkeypatch.setattr(run_pipeline, "AudioPipeline", UnexpectedPipeline)

    with pytest.raises(SystemExit, match="2"):
        run_pipeline.main()

    assert video.read_bytes() == original


class FakeCourseStorage:
    def __init__(self, *, fail_delete=None):
        self.deleted = []
        self.fail_delete = fail_delete

    def get_path(self, key):
        return "/safe/video.mp4"

    def save(self, key, file, max_bytes=None):
        assert file.read()
        return f"scores/{key}"

    def delete(self, key):
        self.deleted.append(key)
        if key == self.fail_delete:
            raise OSError("storage unavailable")
        return True


class FakeCourseQuery:
    def __init__(self, course):
        self.course = course

    def filter(self, *args):
        return self

    def first(self):
        return self.course


class FakeCourseSession:
    def __init__(self, course, *, rowcount, refresh_error=False):
        self.course = course
        self.rowcount = rowcount
        self.refresh_error = refresh_error
        self.commits = 0
        self.rollbacks = 0

    def query(self, model):
        return FakeCourseQuery(self.course)

    def execute(self, statement, execution_options=None):
        assert execution_options == {"synchronize_session": "fetch"}
        return SimpleNamespace(rowcount=self.rowcount)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def refresh(self, course):
        if self.refresh_error:
            raise RuntimeError("database temporarily unavailable")


def make_processing_course(score_path="scores/old.json"):
    return SimpleNamespace(
        id="course-1",
        title="Lesson",
        source_url=None,
        video_path="videos/lesson.mp4",
        score_path=score_path,
        duration=1.0,
        bpm=72,
        time_signature="4/4",
        key="C",
        status="processing",
        progress=1,
    )


def pipeline_score():
    return {
        "title": "Lesson",
        "duration": 1.0,
        "bpm": 72,
        "timeSignature": [4, 4],
        "bars": [],
    }


def test_process_course_discards_result_when_processing_cas_loses(monkeypatch):
    course = make_processing_course()
    storage = FakeCourseStorage()
    session = FakeCourseSession(course, rowcount=0)
    pipeline = audio_pipeline.AudioPipeline(storage)
    monkeypatch.setattr(pipeline, "run", lambda **kwargs: pipeline_score())

    result = pipeline.process_course(course.id, session)

    assert result is course
    assert session.commits == 0
    assert session.rollbacks == 1
    assert len(storage.deleted) == 1
    assert storage.deleted[0].startswith("scores/course-1_score_")
    assert course.score_path == "scores/old.json"
    assert course.status == "processing"


def test_process_course_skips_job_that_was_superseded_before_start(monkeypatch):
    course = make_processing_course(score_path="scores/manual.json")
    course.status = "ready"
    storage = FakeCourseStorage()
    session = FakeCourseSession(course, rowcount=1)
    pipeline = audio_pipeline.AudioPipeline(storage)
    monkeypatch.setattr(
        pipeline,
        "run",
        lambda **kwargs: (_ for _ in ()).throw(
            AssertionError("superseded job must not run transcription")
        ),
    )

    result = pipeline.process_course(course.id, session)

    assert result is course
    assert session.commits == 0
    assert session.rollbacks == 0
    assert storage.deleted == []


def test_process_course_commits_ready_state_with_real_cas(monkeypatch):
    session = SessionLocal()
    try:
        course = Course(
            id="course-real-cas",
            title="Lesson",
            video_path="videos/lesson.mp4",
            status="processing",
            progress=1,
            duration=1.0,
            bpm=72,
            time_signature="4/4",
            key="C",
        )
        session.add(course)
        session.commit()

        storage = FakeCourseStorage()
        pipeline = audio_pipeline.AudioPipeline(storage)
        monkeypatch.setattr(pipeline, "run", lambda **kwargs: pipeline_score())

        result = pipeline.process_course(course.id, session)

        assert result.status == "ready"
        assert result.progress == 100
        assert result.score_path.startswith("scores/course-real-cas_score_")
        persisted = session.query(Course).filter(Course.id == course.id).one()
        assert persisted.status == "ready"
        assert persisted.progress == 100
        assert persisted.score_path == result.score_path
    finally:
        session.close()


def test_post_commit_cleanup_and_refresh_are_best_effort(monkeypatch):
    old_score = "scores/old.json"
    course = make_processing_course(score_path=old_score)
    storage = FakeCourseStorage(fail_delete=old_score)
    session = FakeCourseSession(course, rowcount=1, refresh_error=True)
    pipeline = audio_pipeline.AudioPipeline(storage)
    monkeypatch.setattr(pipeline, "run", lambda **kwargs: pipeline_score())

    result = pipeline.process_course(course.id, session)

    assert result is course
    assert session.commits == 1
    assert session.rollbacks == 0
    assert storage.deleted == [old_score]
