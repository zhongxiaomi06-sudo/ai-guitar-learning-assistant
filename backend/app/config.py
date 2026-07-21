from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Backend configuration, loaded from environment variables."""

    app_name: str = "AI Guitar Learning Assistant API"
    debug: bool = False

    # Database: PostgreSQL preferred, SQLite fallback for quick local dev
    database_url: str = "sqlite:///./storage/app.db"

    # Storage: local filesystem by default, MinIO when configured
    storage_type: str = "local"  # "local" or "minio"
    storage_local_path: str = "./storage"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "guitar"
    minio_secure: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
