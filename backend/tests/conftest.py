import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

TEST_ROOT = Path(tempfile.mkdtemp(prefix="guitar-api-tests-"))
atexit.register(shutil.rmtree, TEST_ROOT, True)

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_ROOT / 'database' / 'app.db'}"
os.environ["STORAGE_TYPE"] = "local"
os.environ["STORAGE_LOCAL_PATH"] = str(TEST_ROOT / "storage")
os.environ["CORS_ORIGINS"] = "http://testserver"
os.environ["CORS_ALLOW_CREDENTIALS"] = "false"
os.environ["DEBUG"] = "false"

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    app.dependency_overrides.clear()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
