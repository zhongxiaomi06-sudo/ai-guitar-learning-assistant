import copy
import json
from io import BytesIO

import pytest

import app.api.courses as course_api
from app.main import app
from app.services.storage import StorageService, get_storage


def upload_video(client, content=b"fake-mp4", filename="lesson.mp4", content_type="video/mp4"):
    return client.post(
        "/api/v1/courses/upload",
        data={"title": "Morning study"},
        files={"video": (filename, BytesIO(content), content_type)},
    )


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
                "endTime": 2,
                "difficulty": 1,
                "beats": [
                    {
                        "startTime": 0,
                        "endTime": 0.5,
                        "notes": [
                            {
                                "string": 2,
                                "fret": 1,
                                "midi": 60,
                                "startTime": 0.1,
                                "endTime": 0.4,
                            }
                        ],
                    },
                    {"startTime": 0.5, "endTime": 1, "notes": []},
                    {"startTime": 1, "endTime": 1.5, "notes": []},
                    {"startTime": 1.5, "endTime": 2, "notes": []},
                ],
            }
        ],
        "createdAt": 1,
        "updatedAt": 1,
        "generatorVersion": "test-extra-field",
    }


def upload_score(client, course_id, payload):
    encoded = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
    return client.post(
        f"/api/v1/courses/{course_id}/score",
        files={"score": ("score.json", BytesIO(encoded), "application/json")},
    )


def test_course_video_score_and_delete_flow(client):
    created = upload_video(client)
    assert created.status_code == 201
    course = created.json()
    assert course["status"] == "pending"

    video = client.get(f"/api/v1/courses/{course['id']}/video")
    assert video.status_code == 200
    assert video.content == b"fake-mp4"
    assert video.headers["content-type"].startswith("video/mp4")

    score_payload = canonical_score_payload()
    score = upload_score(client, course["id"], score_payload)
    assert score.status_code == 200
    assert score.json()["status"] == "ready"
    assert score.json()["progress"] == 100
    assert score.json()["duration"] == 2
    assert score.json()["bpm"] == 120
    assert score.json()["time_signature"] == "4/4"
    assert "_score_" in score.json()["score_path"]

    fetched_score = client.get(f"/api/v1/courses/{course['id']}/score")
    assert fetched_score.status_code == 200
    assert fetched_score.json() == score_payload

    deleted = client.delete(f"/api/v1/courses/{course['id']}")
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert client.get(f"/api/v1/courses/{course['id']}").status_code == 404


def test_upload_rejects_unsupported_and_oversized_files(client, monkeypatch):
    unsupported = upload_video(client, filename="lesson.txt", content_type="text/plain")
    assert unsupported.status_code == 415

    monkeypatch.setattr(course_api.settings, "max_video_upload_bytes", 3)
    oversized = upload_video(client, content=b"four")
    assert oversized.status_code == 413


def test_score_upload_rejects_invalid_json(client):
    course = upload_video(client).json()
    invalid = client.post(
        f"/api/v1/courses/{course['id']}/score",
        files={"score": ("score.json", BytesIO(b"not-json"), "application/json")},
    )
    assert invalid.status_code == 422
    assert client.get(f"/api/v1/courses/{course['id']}/score").status_code == 404


@pytest.mark.parametrize(
    "mutate",
    [
        lambda score: score.pop("bars"),
        lambda score: score["bars"][0].pop("beats"),
        lambda score: score["bars"][0]["beats"][0].pop("notes"),
        lambda score: score.update({"duration": True}),
        lambda score: score.update({"bpm": True}),
        lambda score: score["bars"][0]["beats"][0]["notes"][0].update({"string": True}),
        lambda score: score["bars"][0]["beats"][0]["notes"][0].update({"string": 7}),
        lambda score: score["bars"][0]["beats"][0]["notes"][0].update({"fret": 20}),
        lambda score: score["bars"][0]["beats"][0]["notes"][0].update({"midi": 84}),
        lambda score: score["bars"][0]["beats"][0]["notes"][0].update({"midi": 61}),
        lambda score: score["bars"][0]["beats"][0]["notes"][0].update(
            {"startTime": 0.4, "endTime": 0.4}
        ),
        lambda score: score["bars"][0]["beats"][0]["notes"][0].update({"endTime": 2.1}),
        lambda score: score.update({"duration": 601}),
        lambda score: score.update({"bpm": 401}),
        lambda score: score.update({"timeSignature": [4, 3]}),
    ],
)
def test_score_upload_rejects_invalid_canonical_fields(client, mutate):
    course = upload_video(client).json()
    payload = copy.deepcopy(canonical_score_payload())
    mutate(payload)

    response = upload_score(client, course["id"], payload)

    assert response.status_code == 422
    assert client.get(f"/api/v1/courses/{course['id']}/score").status_code == 404


@pytest.mark.parametrize("invalid_number", [b"NaN", b"Infinity", b"-Infinity", b"1e999"])
def test_score_upload_rejects_non_finite_numbers(client, invalid_number):
    course = upload_video(client).json()
    raw_score = json.dumps(canonical_score_payload()).replace(
        '"duration": 2',
        f'"duration": {invalid_number.decode()}',
    ).encode()

    response = upload_score(client, course["id"], raw_score)

    assert response.status_code == 422
    assert client.get(f"/api/v1/courses/{course['id']}/score").status_code == 404


def test_score_upload_rejects_timeline_beyond_known_course_duration(client):
    course = upload_video(client).json()
    updated = client.patch(
        f"/api/v1/courses/{course['id']}",
        json={"duration": 1},
    )
    assert updated.status_code == 200

    response = upload_score(client, course["id"], canonical_score_payload())

    assert response.status_code == 422


def test_parse_queues_background_pipeline_once(client, monkeypatch):
    course = upload_video(client).json()
    queued = []
    monkeypatch.setattr(course_api, "transcribe_course_task", lambda course_id: queued.append(course_id))

    response = client.post(f"/api/v1/courses/{course['id']}/parse")
    assert response.status_code == 202
    assert response.json()["status"] == "processing"
    assert response.json()["progress"] == 1
    assert queued == [course["id"]]

    duplicate = client.post(f"/api/v1/courses/{course['id']}/parse")
    assert duplicate.status_code == 409


def test_schema_bounds_and_url_validation(client):
    course = upload_video(client).json()
    assert client.patch(
        f"/api/v1/courses/{course['id']}",
        json={"progress": 101},
    ).status_code == 422
    assert client.patch(
        f"/api/v1/courses/{course['id']}",
        json={"progress": 50},
    ).status_code == 422
    assert client.patch(
        f"/api/v1/courses/{course['id']}",
        json={"status": "ready"},
    ).status_code == 422
    metadata_update = client.patch(
        f"/api/v1/courses/{course['id']}",
        json={"bpm": 96, "time_signature": "6/8", "key": "Am"},
    )
    assert metadata_update.status_code == 200
    assert metadata_update.json()["bpm"] == 96
    assert metadata_update.json()["time_signature"] == "6/8"
    assert metadata_update.json()["key"] == "Am"
    assert client.patch(
        f"/api/v1/courses/{course['id']}",
        json={"time_signature": "4/3"},
    ).status_code == 422
    assert client.get("/api/v1/courses?skip=-1").status_code == 422
    assert client.post(
        "/api/v1/courses/from-url",
        json={"title": "Bad URL", "source_url": "file:///etc/passwd"},
    ).status_code == 422


class PresignedStorage(StorageService):
    def save(self, key, file, max_bytes=None):
        return key

    def get_path(self, key):
        return "https://objects.example.test/presigned-video"

    def delete(self, key):
        return True


def test_object_storage_urls_are_redirected(client):
    course = upload_video(client).json()
    app.dependency_overrides[get_storage] = lambda: PresignedStorage()
    response = client.get(
        f"/api/v1/courses/{course['id']}/video",
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers["location"] == "https://objects.example.test/presigned-video"


def test_cors_allows_configured_frontend(client):
    response = client.options(
        "/api/v1/courses",
        headers={
            "Origin": "http://testserver",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://testserver"
