"""
app/main.py
FastAPI entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import courses, score
from app.config import get_settings
from app.database import Base, engine

settings = get_settings()
cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
cors_allow_credentials = settings.cors_allow_credentials and "*" not in cors_origins

# Create database tables on startup (for MVP only; use Alembic in production)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.app_name,
    description="MVP backend for the AI Guitar Learning Assistant.",
    version="1.0.0",
)

# Allow frontend served from Vite dev server or static files
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(courses.router)
app.include_router(score.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {
        "message": "AI Guitar Learning Assistant API",
        "docs": "/docs",
    }
