from io import BytesIO

import app.api.courses as course_api
from app.main import app
from app.services.storage import StorageService, get_storage


def upload_video(client, content=b"fake-mp4", filename="lesson.mp4", content_type="video/mp4"):
    return client.post(
        "/api/v1/courses/upload",
        data={"title": "Morning study"},
        files={"video": (filename, BytesIO(content), content_type)},
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

    score_payload = b'{"id":"score-1","bars":[]}'
    score = client.post(
        f"/api/v1/courses/{course['id']}/score",
        files={"score": ("score.json", BytesIO(score_payload), "application/json")},
    )
    assert score.status_code == 200
    assert score.json()["status"] == "ready"
    assert score.json()["progress"] == 100

    fetched_score = client.get(f"/api/v1/courses/{course['id']}/score")
    assert fetched_score.status_code == 200
    assert fetched_score.json() == {"id": "score-1", "bars": []}

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


def test_schema_bounds_and_url_validation(client):
    course = upload_video(client).json()
    assert client.patch(
        f"/api/v1/courses/{course['id']}",
        json={"progress": 101},
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
