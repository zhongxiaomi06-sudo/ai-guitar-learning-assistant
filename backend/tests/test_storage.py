from io import BytesIO

import pytest

from app.config import Settings
from app.database import ensure_sqlite_parent
from app.services.minio_storage import MinioStorageService
from app.services.storage import FileTooLargeError, InvalidStorageKeyError, LocalStorageService


def test_sqlite_parent_is_created(tmp_path):
    database_path = tmp_path / "nested" / "database" / "app.db"
    ensure_sqlite_parent(f"sqlite:///{database_path}")
    assert database_path.parent.is_dir()


def test_release_debug_environment_value_is_safe():
    assert Settings(debug="release").debug is False


def test_local_storage_rejects_traversal(tmp_path):
    storage = LocalStorageService(str(tmp_path / "storage"))
    with pytest.raises(InvalidStorageKeyError):
        storage.save("../escape.mp4", BytesIO(b"data"))
    assert storage.get_path("../../escape.mp4") is None
    assert storage.delete("../../escape.mp4") is False


def test_local_storage_removes_partial_oversized_upload(tmp_path):
    storage = LocalStorageService(str(tmp_path / "storage"))
    with pytest.raises(FileTooLargeError):
        storage.save("large.mp4", BytesIO(b"1234"), max_bytes=3)
    assert storage.get_path("videos/large.mp4") is None


class FakeMinioClient:
    def __init__(self):
        self.put_call = None
        self.response_headers = None

    def put_object(self, bucket, key, file, length, **kwargs):
        self.put_call = (bucket, key, length, kwargs)

    def presigned_get_object(self, bucket, key, response_headers=None):
        self.response_headers = response_headers
        return "https://objects.example.test/presigned"


def test_minio_uses_lengths_and_media_types_without_buffering():
    storage = MinioStorageService.__new__(MinioStorageService)
    storage.bucket = "guitar"
    storage.client = FakeMinioClient()

    assert storage.save("lesson.mp4", BytesIO(b"1234"), max_bytes=4) == "lesson.mp4"
    assert storage.client.put_call == (
        "guitar",
        "lesson.mp4",
        4,
        {"content_type": "video/mp4"},
    )
    assert storage.get_path("score.json") == "https://objects.example.test/presigned"
    assert storage.client.response_headers == {"response-content-type": "application/json"}
