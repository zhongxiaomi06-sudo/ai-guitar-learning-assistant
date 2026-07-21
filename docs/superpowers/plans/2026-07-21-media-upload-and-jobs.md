# Media Upload and Analysis Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept MP4/MOV uploads, normalize them into analysis artifacts, detect curated demo videos, and expose recoverable analysis progress.

**Architecture:** The API creates presigned object-store uploads and durable job records. A Celery media worker validates media with ffprobe, creates proxy/audio/vision artifacts with FFmpeg, and publishes stage events that the Web consumes through SSE.

**Tech Stack:** Next.js, FastAPI, boto3, PostgreSQL, Redis, Celery, FFmpeg/ffprobe, pytest, Vitest, Playwright.

## Global Constraints

- Accept only MP4/MOV, 30 seconds through 10 minutes, maximum 1 GB.
- The browser uploads directly to S3-compatible storage.
- Demo fingerprints resolve to versioned curated artifacts without branching inside downstream model code.
- Refresh and short network interruption must not lose job state.

---

### Task 1: Create upload sessions and validate files

**Files:**
- Create: `services/api/app/uploads/router.py`
- Create: `services/api/app/uploads/service.py`
- Create: `services/api/app/uploads/models.py`
- Modify: `services/api/app/main.py`
- Test: `services/api/tests/uploads/test_create_upload.py`

**Interfaces:**
- Consumes: `CreateUploadRequest{name,sizeBytes,mimeType}`.
- Produces: `POST /uploads` → `{uploadId, objectKey, uploadUrl, expiresAt}`.

- [ ] **Step 1: Write failing API tests**

```python
def test_rejects_unsupported_extension(client) -> None:
    response = client.post("/uploads", json={
        "name": "lesson.avi", "sizeBytes": 1000, "mimeType": "video/x-msvideo"
    })
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == "Value error, only MP4 and MOV are supported"


def test_creates_presigned_upload(client, fake_storage) -> None:
    response = client.post("/uploads", json={
        "name": "lesson.mp4", "sizeBytes": 1024, "mimeType": "video/mp4"
    })
    assert response.status_code == 201
    assert response.json()["objectKey"].endswith("/source.mp4")
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/api/tests/uploads/test_create_upload.py -q`  
Expected: FAIL with route not found.

- [ ] **Step 3: Implement request validation and presigning**

```python
class CreateUploadRequest(BaseModel):
    name: str
    sizeBytes: int = Field(gt=0, le=1_073_741_824)
    mimeType: Literal["video/mp4", "video/quicktime"]

    @field_validator("name")
    @classmethod
    def validate_extension(cls, value: str) -> str:
        if Path(value).suffix.lower() not in {".mp4", ".mov"}:
            raise ValueError("only MP4 and MOV are supported")
        return value
```

- [ ] **Step 4: Pass API tests**

Run: `pytest services/api/tests/uploads -q`  
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/uploads services/api/app/main.py services/api/tests/uploads
git commit -m "feat: create direct video uploads"
```

### Task 2: Build the upload UI and quality-check transition

**Files:**
- Create: `apps/web/src/features/upload/UploadDropzone.tsx`
- Create: `apps/web/src/features/upload/upload-client.ts`
- Create: `apps/web/src/features/upload/UploadSummary.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Test: `apps/web/src/features/upload/UploadDropzone.test.tsx`

**Interfaces:**
- Consumes: `POST /uploads` response from Task 1.
- Produces: completed upload ID and object key for course creation.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("rejects an AVI before requesting an upload", async () => {
  render(<UploadDropzone onUploaded={vi.fn()} />);
  const input = screen.getByLabelText("选择视频");
  await userEvent.upload(input, new File(["x"], "bad.avi", { type: "video/x-msvideo" }));
  expect(await screen.findByText("仅支持 MP4 或 MOV 视频")).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test -- UploadDropzone.test.tsx`  
Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement accessible selection and progress**

Create an input accepting `.mp4,.mov,video/mp4,video/quicktime`, validate size locally, request a presigned URL, upload with progress, and replace the dropzone with `UploadSummary` containing thumbnail, name, size, duration placeholder, “开始 AI 解析”, and “重新选择”.

- [ ] **Step 4: Pass component tests**

Run: `pnpm --filter web test -- UploadDropzone.test.tsx`  
Expected: invalid file, oversize file, upload progress and completion tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/upload apps/web/src/app/page.tsx
git commit -m "feat: add video upload experience"
```

### Task 3: Normalize media and publish quality results

**Files:**
- Create: `services/media-worker/pyproject.toml`
- Create: `services/media-worker/media_worker/probe.py`
- Create: `services/media-worker/media_worker/normalize.py`
- Create: `services/media-worker/media_worker/quality.py`
- Create: `services/media-worker/media_worker/tasks.py`
- Test: `services/media-worker/tests/test_normalize.py`

**Interfaces:**
- Consumes: `{courseId, sourceObjectKey}` job.
- Produces: `proxy.mp4`, `analysis.wav`, `vision.mp4`, `thumbnail.webp`, and `MediaQualityReport`.

- [ ] **Step 1: Write a failing command-construction test**

```python
def test_normalize_uses_explicit_audio_and_video_outputs(tmp_path) -> None:
    command = build_normalize_command(Path("source.mov"), tmp_path)
    joined = " ".join(command)
    assert "analysis.wav" in joined
    assert "proxy.mp4" in joined
    assert "-map_metadata" in command
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/media-worker/tests/test_normalize.py -q`  
Expected: FAIL because `build_normalize_command` is undefined.

- [ ] **Step 3: Implement deterministic ffprobe/FFmpeg wrappers**

```python
def build_normalize_command(source: Path, output: Path) -> list[str]:
    return [
        "ffmpeg", "-nostdin", "-y", "-i", str(source), "-map_metadata", "0",
        "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-c:a", "aac",
        str(output / "proxy.mp4"),
    ]
```

Use separate explicit commands for WAV, vision proxy and thumbnail; validate duration and audio presence before producing success.

- [ ] **Step 4: Run worker tests on fixture media**

Run: `pytest services/media-worker/tests -q`  
Expected: command, no-audio, duration-boundary and output-manifest tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/media-worker
git commit -m "feat: normalize uploaded guitar videos"
```

### Task 4: Persist job stages, SSE progress, and demo fingerprints

**Files:**
- Create: `services/api/app/analysis/router.py`
- Create: `services/api/app/analysis/repository.py`
- Create: `services/api/app/analysis/events.py`
- Create: `services/api/app/analysis/demo_registry.py`
- Create: `fixtures/demo/registry.json`
- Create: `apps/web/src/features/analysis/AnalysisProgress.tsx`
- Test: `services/api/tests/analysis/test_progress.py`
- Test: `apps/web/src/features/analysis/AnalysisProgress.test.tsx`

**Interfaces:**
- Consumes: normalized artifact manifest and SHA-256 fingerprint.
- Produces: `POST /courses/{id}/analyze`, `GET /analysis-jobs/{id}`, and SSE `/analysis-jobs/{id}/events`.

- [ ] **Step 1: Write failing state-transition tests**

```python
def test_job_cannot_move_backwards(repository, job) -> None:
    repository.transition(job.id, "transcribing", 45)
    with pytest.raises(InvalidTransition):
        repository.transition(job.id, "normalizing", 20)
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/api/tests/analysis/test_progress.py -q`  
Expected: FAIL because transition rules do not exist.

- [ ] **Step 3: Implement durable state transitions and demo lookup**

```python
ALLOWED_NEXT = {
    "uploaded": {"normalizing", "failed"},
    "normalizing": {"transcribing", "failed"},
    "transcribing": {"analyzing_vision", "failed"},
    "analyzing_vision": {"composing", "failed"},
    "composing": {"ready", "degraded", "failed"},
}
```

The demo registry maps fingerprint to a versioned timeline artifact; it does not mark the course as ready until required artifacts pass schema validation.

- [ ] **Step 4: Pass API and UI progress tests**

Run: `pytest services/api/tests/analysis -q && pnpm --filter web test -- AnalysisProgress.test.tsx`  
Expected: transitions, reconnection, failure copy and eight visual stages PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/analysis services/api/tests/analysis fixtures/demo/registry.json apps/web/src/features/analysis
git commit -m "feat: expose recoverable analysis progress"
```

