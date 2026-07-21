"""
services/minio_storage.py
Optional MinIO/S3-compatible storage backend.
Only loaded when STORAGE_TYPE=minio.
"""

import mimetypes
from pathlib import PurePosixPath
from typing import BinaryIO, Optional

from minio import Minio

from app.config import get_settings
from app.services.storage import (
    FileTooLargeError,
    InvalidStorageKeyError,
    StorageError,
    StorageService,
)

settings = get_settings()


class MinioStorageService(StorageService):
    def __init__(self):
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self.bucket = settings.minio_bucket
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)

    def save(self, key: str, file: BinaryIO, max_bytes: Optional[int] = None) -> str:
        if not self._valid_key(key):
            raise InvalidStorageKeyError("Storage keys must be plain filenames")

        # UploadFile uses a seekable spooled file, so determine its length
        # without reading the entire video into process memory.
        try:
            file.seek(0, 2)
            length = file.tell()
            file.seek(0)
        except (AttributeError, OSError) as exc:
            raise StorageError("MinIO uploads require a seekable file") from exc

        if max_bytes is not None and length > max_bytes:
            raise FileTooLargeError(f"Upload exceeds {max_bytes} bytes")
        content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
        self.client.put_object(self.bucket, key, file, length, content_type=content_type)
        return key

    def get_path(self, key: str) -> Optional[str]:
        # Return pre-signed URL; for streaming we can redirect to this URL
        if not self._valid_key(key):
            return None
        try:
            content_type = mimetypes.guess_type(key)[0]
            response_headers = {"response-content-type": content_type} if content_type else None
            return self.client.presigned_get_object(
                self.bucket,
                key,
                response_headers=response_headers,
            )
        except Exception:
            return None

    def delete(self, key: str) -> bool:
        if not self._valid_key(key):
            return False
        try:
            self.client.remove_object(self.bucket, key)
            return True
        except Exception:
            return False

    @staticmethod
    def _valid_key(key: str) -> bool:
        path = PurePosixPath(key)
        return bool(key) and not path.is_absolute() and path.name == key and ".." not in path.parts
