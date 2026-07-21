"""
services/storage.py
Storage abstraction. Supports local filesystem out of the box,
and can be swapped to MinIO/S3 by changing settings.
"""

import os
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO, Optional

from app.config import get_settings

settings = get_settings()


class StorageService(ABC):
    """Abstract storage interface for videos and score files."""

    @abstractmethod
    def save(self, key: str, file: BinaryIO) -> str:
        """Save a file and return its storage key/identifier."""
        pass

    @abstractmethod
    def get_path(self, key: str) -> Optional[str]:
        """Return a local file path or None if not found."""
        pass

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete a file by key."""
        pass


class LocalStorageService(StorageService):
    """Local filesystem storage."""

    def __init__(self, base_path: str = settings.storage_local_path):
        self.base_path = Path(base_path).resolve()
        self.videos_path = self.base_path / "videos"
        self.scores_path = self.base_path / "scores"
        self.videos_path.mkdir(parents=True, exist_ok=True)
        self.scores_path.mkdir(parents=True, exist_ok=True)

    def save(self, key: str, file: BinaryIO) -> str:
        subfolder = "videos" if self._is_video(key) else "scores"
        dest = self.base_path / subfolder / key
        with open(dest, "wb") as buffer:
            shutil.copyfileobj(file, buffer)
        return f"{subfolder}/{key}"

    def get_path(self, key: str) -> Optional[str]:
        # key may already contain subfolder, e.g. "videos/abc.mp4"
        path = self.base_path / key
        if path.exists():
            return str(path)
        # fallback: try as bare filename under videos or scores
        for subfolder in ("videos", "scores"):
            candidate = self.base_path / subfolder / key
            if candidate.exists():
                return str(candidate)
        return None

    def delete(self, key: str) -> bool:
        path = self.base_path / key
        if path.exists():
            path.unlink()
            return True
        return False

    @staticmethod
    def _is_video(key: str) -> bool:
        return key.lower().endswith((".mp4", ".mov", ".webm", ".mkv", ".avi"))


def get_storage() -> StorageService:
    """Factory returning the configured storage service."""
    if settings.storage_type == "minio":
        # Lazy import so MinIO is optional unless configured
        from app.services.minio_storage import MinioStorageService
        return MinioStorageService()
    return LocalStorageService()
