from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend configuration, loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AI Guitar Learning Assistant API"
    debug: bool = False

    # Database: PostgreSQL preferred, SQLite fallback for quick local dev
    database_url: str = "sqlite:///./storage/app.db"

    # Storage: local filesystem by default, MinIO when configured
    storage_type: str = "local"  # "local" or "minio"
    storage_local_path: str = "./storage"
    max_video_upload_bytes: int = Field(default=1024 * 1024 * 1024, gt=0)
    max_score_upload_bytes: int = Field(default=10 * 1024 * 1024, gt=0)

    # Comma-separated so it is convenient to configure from Docker/.env.
    # Defaults include common Vite dev/preview ports to keep local frontend
    # connectivity working out of the box.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
    cors_allow_credentials: bool = False

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "guitar"
    minio_secure: bool = False

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug_value(cls, value):
        # Some deployment environments set DEBUG=release/production globally.
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
            if normalized in {"debug", "dev", "development"}:
                return True
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
