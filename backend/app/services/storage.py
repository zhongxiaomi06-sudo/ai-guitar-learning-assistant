"""
services/storage.py
Storage abstraction. Supports local filesystem out of the box,
and can be swapped to MinIO/S3 by changing settings.
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO, Optional

from app.config import get_settings

settings = get_settings()
COPY_CHUNK_SIZE = 1024 * 1024


class StorageError(Exception):
    """Base class for storage failures that can be shown as API errors."""


class InvalidStorageKeyError(StorageError):
    """Raised when a key could escape its configured storage directory."""


class FileTooLargeError(StorageError):
    """Raised when a streamed upload exceeds its configured byte limit."""


class StorageService(ABC):
    """Abstract storage interface for videos and score files."""

    @abstractmethod
    def save(self, key: str, file: BinaryIO, max_bytes: Optional[int] = None) -> str:
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

    def save(self, key: str, file: BinaryIO, max_bytes: Optional[int] = None) -> str:
        if not key or Path(key).name != key:
            raise InvalidStorageKeyError("Storage keys must be plain filenames")

        subfolder = "videos" if self._is_video(key) else "scores"
        dest = self._safe_path(self.base_path, f"{subfolder}/{key}")
        if dest is None:
            raise InvalidStorageKeyError("Storage key escapes the configured directory")

        written = 0
        try:
            with open(dest, "wb") as buffer:
                while chunk := file.read(COPY_CHUNK_SIZE):
                    written += len(chunk)
                    if max_bytes is not None and written > max_bytes:
                        raise FileTooLargeError(f"Upload exceeds {max_bytes} bytes")
                    buffer.write(chunk)
        except Exception:
            dest.unlink(missing_ok=True)
            raise
        return f"{subfolder}/{key}"

    def get_path(self, key: str) -> Optional[str]:
        # key may already contain subfolder, e.g. "videos/abc.mp4"
        path = self._safe_path(self.base_path, key)
        if path and path.is_file():
            return str(path)
        # fallback: try as bare filename under videos or scores
        if Path(key).name == key:
            for subfolder in ("videos", "scores"):
                candidate = self._safe_path(self.base_path, f"{subfolder}/{key}")
                if candidate and candidate.is_file():
                    return str(candidate)
        return None

    def delete(self, key: str) -> bool:
        path = self._safe_path(self.base_path, key)
        if path and path.is_file():
            path.unlink()
            return True
        return False

    @staticmethod
    def _safe_path(root: Path, key: str) -> Optional[Path]:
        root = root.resolve()
        try:
            candidate = (root / key).resolve()
            candidate.relative_to(root)
        except (OSError, ValueError):
            return None
        return candidate

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
