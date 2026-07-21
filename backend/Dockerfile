FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for psycopg2 and audio/video processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Basic Pitch declares tensorflow as a requirement for python>=3.11, but the
# ONNX model path works with onnxruntime only. Install it without dependencies.
COPY requirements-pipeline.txt .
RUN pip install --no-cache-dir --no-deps -r requirements-pipeline.txt

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .

# Storage directory for local files
RUN mkdir -p /app/storage/videos /app/storage/scores

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
