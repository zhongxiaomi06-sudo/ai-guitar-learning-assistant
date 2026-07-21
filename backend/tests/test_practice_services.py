"""Tests for timeline, segments, practice results, and quality check."""

import json
import wave
from io import BytesIO

import pytest

from app.models.course import Course as CourseModel
from app.models.practice_result import PracticeResult as PracticeResultModel
from app.schemas.score import CanonicalScore
from app.services.quality_check import analyze_audio
from app.services.segments import build_segments
from app.services.timeline import build_timeline


def canonical_score_payload():
    return {
        "id": "score-1",
        "title": "Morning study",
        "sourceVideoUrl": "",
        "localVideoPath": "",
        "duration": 2,
        "bpm": 120,
        "timeSignature": [4, 4],
        "key": "C",
        "bars": [
            {
                "index": 1,
                "startTime": 0,
                "endTime": 0.5,
                "beats": [
                    {
                        "startTime": 0,
                        "endTime": 0.125,
                        "notes": [
                            {
                                "string": 2,
                                "fret": 1,
                                "midi": 60,
                                "startTime": 0.01,
                                "endTime": 0.1,
                            }
                        ],
                    },
                    {"startTime": 0.125, "endTime": 0.25, "notes": []},
                    {"startTime": 0.25, "endTime": 0.375, "notes": []},
                    {"startTime": 0.375, "endTime": 0.5, "notes": []},
                ],
            },
            {
                "index": 2,
                "startTime": 0.5,
                "endTime": 1.0,
                "beats": [
                    {
                        "startTime": 0.5,
                        "endTime": 0.625,
                        "notes": [
                            {
                                "string": 3,
                                "fret": 2,
                                "midi": 57,
                                "startTime": 0.51,
                                "endTime": 0.6,
                            }
                        ],
                    },
                    {"startTime": 0.625, "endTime": 0.75, "notes": []},
                    {"startTime": 0.75, "endTime": 0.875, "notes": []},
                    {"startTime": 0.875, "endTime": 1.0, "notes": []},
                ],
            },
            {
                "index": 3,
                "startTime": 1.0,
                "endTime": 1.5,
                "beats": [
                    {
                        "startTime": 1.0,
                        "endTime": 1.125,
                        "notes": [
                            {
                                "string": 1,
                                "fret": 0,
                                "midi": 64,
                                "startTime": 1.01,
                                "endTime": 1.1,
                            }
                        ],
                    },
                    {"startTime": 1.125, "endTime": 1.25, "notes": []},
                    {"startTime": 1.25, "endTime": 1.375, "notes": []},
                    {"startTime": 1.375, "endTime": 1.5, "notes": []},
                ],
            },
            {
                "index": 4,
                "startTime": 1.5,
                "endTime": 2.0,
                "beats": [
                    {
                        "startTime": 1.5,
                        "endTime": 1.625,
                        "notes": [
                            {
                                "string": 2,
                                "fret": 3,
                                "midi": 62,
                                "startTime": 1.51,
                                "endTime": 1.6,
                            }
                        ],
                    },
                    {"startTime": 1.625, "endTime": 1.75, "notes": []},
                    {"startTime": 1.75, "endTime": 1.875, "notes": []},
                    {"startTime": 1.875, "endTime": 2.0, "notes": []},
                ],
            },
        ],
        "createdAt": 1,
        "updatedAt": 1,
    }


def upload_score(client, course_id, payload):
    encoded = json.dumps(payload).encode("utf-8")
    return client.post(
        f"/api/v1/courses/{course_id}/score",
        files={"score": ("score.json", BytesIO(encoded), "application/json")},
    )


def test_timeline_flattens_score_into_events():
    score = canonical_score_payload()
    events = build_timeline("course-1", score)
    assert len(events) == 4
    first = events[0]
    assert first["id"].startswith("evt_course-1_")
    assert first["courseId"] == "course-1"
    assert first["type"] == "note"
    assert first["string"] == 2
    assert first["fret"] == 1
    assert first["pitch"] == 60
    assert first["measureIndex"] == 1
    assert first["beatIndex"] == 1
    assert "leftHandShape" in first
    assert "rightHandShape" in first


def test_timeline_groups_chords_within_beat():
    score = canonical_score_payload()
    score["bars"][0]["beats"][0]["notes"].append(
        {"string": 3, "fret": 2, "midi": 57, "startTime": 0.01, "endTime": 0.1}
    )
    events = build_timeline("course-2", score)
    chord_events = [e for e in events if e["measureIndex"] == 1 and e["beatIndex"] == 1]
    assert all(e["chord"] == "C" for e in chord_events)


def test_segments_split_score_into_four_bar_chunks():
    score = canonical_score_payload()
    segments = build_segments("course-1", score)
    assert len(segments) == 1
    assert segments[0]["startMeasure"] == 1
    assert segments[0]["endMeasure"] == 4
    assert segments[0]["status"] == "practicing"
    assert "passCriteria" in segments[0]


def test_segments_split_long_scores():
    score = canonical_score_payload()
    # Append 8 more identical bars to get 12 bars total.
    for i in range(5, 13):
        new_bar = json.loads(json.dumps(score["bars"][0]))
        new_bar["index"] = i
        offset = (i - 1) * 0.5
        new_bar["startTime"] = offset
        new_bar["endTime"] = offset + 0.5
        for j, beat in enumerate(new_bar["beats"]):
            beat["startTime"] = offset + j * 0.125
            beat["endTime"] = offset + (j + 1) * 0.125
        score["bars"].append(new_bar)
    score["duration"] = 6.0
    segments = build_segments("course-1", score)
    assert len(segments) == 3
    assert segments[0]["endMeasure"] == 4
    assert segments[1]["startMeasure"] == 5
    assert segments[1]["endMeasure"] == 8
    assert segments[2]["startMeasure"] == 9
    assert segments[2]["endMeasure"] == 12
    # First segment is practicing, subsequent ones are locked.
    assert segments[0]["status"] == "practicing"
    assert segments[1]["status"] == "locked"


def test_practice_result_crud_and_summary(client, db_session):
    # Create a course to satisfy FK-like expectations.
    course = CourseModel(id="prac-course", title="Practice test", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    payload = {
        "course_id": "prac-course",
        "segment_id": "seg-1",
        "target_event_id": "evt-1",
        "result_type": "correct",
        "detected_pitch": 64,
        "detected_time": 1.0,
        "timing_offset": 0.05,
        "confidence": 0.9,
        "session_id": "s1",
    }
    created = client.post("/api/v1/practice/results", json=payload)
    assert created.status_code == 201
    data = created.json()
    assert data["course_id"] == "prac-course"
    assert data["result_type"] == "correct"

    summary = client.get("/api/v1/practice/summary/prac-course?session_id=s1")
    assert summary.status_code == 200
    summary_data = summary.json()
    assert summary_data["total"] == 1
    assert summary_data["correct"] == 1
    assert summary_data["accuracy"] == 1.0


def test_practice_summary_filters_by_course_only(client, db_session):
    course = CourseModel(id="c2", title="Filter test", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    for result_type in ["correct", "miss", "wrong-pitch"]:
        client.post("/api/v1/practice/results", json={
            "course_id": "c2",
            "result_type": result_type,
        })

    summary = client.get("/api/v1/practice/summary/c2")
    assert summary.status_code == 200
    data = summary.json()
    assert data["total"] == 3
    assert data["correct"] == 1
    assert data["miss"] == 1
    assert data["wrong_pitch"] == 1
    assert 0.3 < data["accuracy"] < 0.4


def test_practice_list_filters(client, db_session):
    course = CourseModel(id="c3", title="List test", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    client.post("/api/v1/practice/results", json={
        "course_id": "c3",
        "result_type": "correct",
        "session_id": "s1",
    })
    client.post("/api/v1/practice/results", json={
        "course_id": "c3",
        "result_type": "miss",
        "session_id": "s2",
    })

    all_results = client.get("/api/v1/practice/results?course_id=c3")
    assert all_results.status_code == 200
    assert len(all_results.json()) == 2

    filtered = client.get("/api/v1/practice/results?course_id=c3&session_id=s1")
    assert len(filtered.json()) == 1


def test_timeline_endpoint_returns_events(client, db_session):
    course = CourseModel(id="timeline-course", title="Timeline test", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    score = canonical_score_payload()
    upload_score(client, "timeline-course", score)

    response = client.get("/api/v1/courses/timeline-course/timeline")
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 4
    assert events[0]["pitch"] == 60


def test_segments_endpoint_returns_segments(client, db_session):
    course = CourseModel(id="seg-course", title="Segment test", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    score = canonical_score_payload()
    upload_score(client, "seg-course", score)

    response = client.get("/api/v1/courses/seg-course/segments")
    assert response.status_code == 200
    segments = response.json()
    assert len(segments) == 1
    assert segments[0]["startMeasure"] == 1


def test_quality_check_rejects_silent_audio(tmp_path):
    # Create a 1-second silent WAV file.
    path = tmp_path / "silent.wav"
    with wave.open(str(path), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(b"\x00" * 22050 * 2)

    ok, report = analyze_audio(str(path))
    assert not ok
    assert report["has_audio"] is True
    assert any("音量过低" in msg for msg in report["messages"])
    assert report["duration_seconds"] == 1.0


def test_segment_progress_is_persisted_in_course_metadata(client, db_session):
    course = CourseModel(id="seg-progress-course", title="Segment progress test", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    response = client.post("/api/v1/courses/seg-progress-course/segments/seg_01/progress?status=practicing")
    assert response.status_code == 200
    assert response.json()["status"] == "practicing"

    response = client.get("/api/v1/courses/seg-progress-course/segments/seg_01/progress")
    assert response.status_code == 200
    assert response.json()["status"] == "practicing"

    # Verify it is also in the course metadata.
    course = db_session.query(CourseModel).filter(CourseModel.id == "seg-progress-course").first()
    assert course.metadata_json["segment_progress"]["seg_01"]["status"] == "practicing"


def test_weak_spots_endpoint_aggregates_errors(client, db_session):
    course = CourseModel(id="weak-course", title="Weak spots test", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    for event_id in ["evt_1", "evt_1", "evt_2"]:
        client.post("/api/v1/practice/results", json={
            "course_id": "weak-course",
            "target_event_id": event_id,
            "result_type": "miss" if event_id == "evt_2" else "wrong-pitch",
        })
    client.post("/api/v1/practice/results", json={
        "course_id": "weak-course",
        "target_event_id": "evt_3",
        "result_type": "correct",
    })

    response = client.get("/api/v1/practice/weak-spots/weak-course")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 4
    assert data["accuracy"] == 0.25
    assert len(data["top_error_types"]) >= 1
    assert data["weak_events"][0]["event_id"] == "evt_1"


def test_weak_spots_returns_empty_summary_for_no_results(client, db_session):
    course = CourseModel(id="empty-weak-course", title="Empty weak spots", video_path="videos/x.mp4")
    db_session.add(course)
    db_session.commit()

    response = client.get("/api/v1/practice/weak-spots/empty-weak-course")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert data["weak_events"] == []


def test_quality_check_accepts_normal_audio(tmp_path):
    # Create a 1-second sine-ish loud WAV.
    import math
    import struct

    samples = []
    for i in range(22050):
        value = int(32767 * 0.5 * math.sin(2 * math.pi * 440 * i / 22050))
        samples.append(struct.pack("<h", value))

    path = tmp_path / "tone.wav"
    with wave.open(str(path), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(b"".join(samples))

    ok, report = analyze_audio(str(path))
    assert ok
    assert any("音频质量正常" in msg for msg in report["messages"])
    assert report["snr_db"] > 10


def test_quality_check_handles_missing_file():
    ok, report = analyze_audio("/nonexistent/path.wav")
    assert not ok
    assert report["has_audio"] is False
