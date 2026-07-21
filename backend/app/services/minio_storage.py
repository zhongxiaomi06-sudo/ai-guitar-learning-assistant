"""
services/minio_storage.py
Optional MinIO/S3-compatible storage backend.
Only loaded when STORAGE_TYPE=minio.
"""

from typing import BinaryIO, Optional

from minio import Minio

from app.config import get_settings
from app.services.storage import StorageService

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

    def save(self, key: str, file: BinaryIO) -> str:
        # reset file pointer
        file.seek(0)
        length = len(file.read())
        file.seek(0)
        self.client.put_object(self.bucket, key, file, length)
        return key

    def get_path(self, key: str) -> Optional[str]:
        # Return pre-signed URL; for streaming we can redirect to this URL
        try:
            return self.client.presigned_get_object(self.bucket, key)
        except Exception:
            return None

    def delete(self, key: str) -> bool:
        try:
            self.client.remove_object(self.bucket, key)
            return True
        except Exception:
            return False
