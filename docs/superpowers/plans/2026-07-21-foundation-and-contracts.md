# Foundation and Shared Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a runnable, testable monorepo and the canonical contracts every later service and UI consumes.

**Architecture:** pnpm owns JavaScript workspaces, Python services use isolated `pyproject.toml` files, and Docker Compose provides local PostgreSQL, Redis and MinIO. JSON Schema is the source of truth; TypeScript and Pydantic models are generated and checked in CI.

**Tech Stack:** pnpm workspaces, Turborepo, Next.js, FastAPI, Pydantic, JSON Schema 2020-12, datamodel-code-generator, json-schema-to-typescript, Vitest, pytest, Docker Compose.

## Global Constraints

- Use the repository structure and frozen interface names from `2026-07-21-master-roadmap.md`.
- `sourceTimeSeconds` is a non-negative finite number.
- Confidence values are finite numbers from `0` through `1`.
- Generated files are never hand-edited.
- Local infrastructure must start without cloud credentials.

---

### Task 1: Bootstrap the monorepo and verification commands

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `scripts/verify.mjs`
- Test: `scripts/verify.test.mjs`

**Interfaces:**
- Consumes: none.
- Produces: root commands `pnpm lint`, `pnpm test`, `pnpm contracts:check`, and `pnpm verify`.

- [ ] **Step 1: Write the failing root verification test**

```js
// scripts/verify.test.mjs
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("root package exposes required verification commands", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  for (const name of ["lint", "test", "contracts:check", "verify"]) {
    assert.equal(typeof pkg.scripts[name], "string", `missing script ${name}`);
  }
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test scripts/verify.test.mjs`  
Expected: FAIL because `package.json` does not exist.

- [ ] **Step 3: Create the minimal workspace files**

```json
{
  "name": "ai-guitar-learning-assistant",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "lint": "turbo run lint",
    "test": "turbo run test",
    "contracts:check": "pnpm --filter @guitar/contracts check",
    "verify": "node scripts/verify.mjs"
  },
  "devDependencies": { "turbo": "^2" }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

```js
// scripts/verify.mjs
import { spawnSync } from "node:child_process";

for (const args of [["lint"], ["test"], ["contracts:check"]]) {
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

- [ ] **Step 4: Install and run the test**

Run: `pnpm install && node --test scripts/verify.test.mjs`  
Expected: PASS with one successful test.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .editorconfig .gitignore scripts
git commit -m "build: bootstrap monorepo verification"
```

### Task 2: Define canonical timeline schemas

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/schema/common.json`
- Create: `packages/contracts/schema/timeline-bundle.json`
- Create: `packages/contracts/schema/practice.json`
- Create: `packages/contracts/scripts/generate.mjs`
- Create: `packages/contracts/src/generated.ts`
- Test: `packages/contracts/test/schema.test.ts`

**Interfaces:**
- Consumes: root pnpm workspace.
- Produces: `TimelineBundle`, `PerformanceEvent`, `MotionEvent`, `CropTrack`, `PracticeObservation`, and `EvaluationResult` types.

- [ ] **Step 1: Write schema validation tests**

```ts
import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2020.js";
import timeline from "../schema/timeline-bundle.json";

describe("TimelineBundle schema", () => {
  const validate = new Ajv({ strict: true }).compile(timeline);

  it("accepts an empty valid bundle", () => {
    expect(validate({
      schemaVersion: "1.0.0",
      courseId: "course_1",
      durationSeconds: 20,
      measures: [], performanceEvents: [], motionEvents: [], cropTracks: []
    })).toBe(true);
  });

  it("rejects negative source time", () => {
    expect(validate({
      schemaVersion: "1.0.0", courseId: "course_1", durationSeconds: -1,
      measures: [], performanceEvents: [], motionEvents: [], cropTracks: []
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter @guitar/contracts test`  
Expected: FAIL because the package and schemas do not exist.

- [ ] **Step 3: Implement the schema source**

Define `timeline-bundle.json` with `$schema: "https://json-schema.org/draft/2020-12/schema"`, `additionalProperties: false`, non-negative duration/time fields, confidence bounds `[0,1]`, and discriminated event types. Define each property named in the master roadmap instead of accepting arbitrary objects.

Core fragment:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://guitar.local/schema/timeline-bundle.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "courseId", "durationSeconds", "measures", "performanceEvents", "motionEvents", "cropTracks"],
  "properties": {
    "schemaVersion": { "const": "1.0.0" },
    "courseId": { "type": "string", "minLength": 1 },
    "durationSeconds": { "type": "number", "minimum": 0 },
    "measures": { "type": "array", "items": { "$ref": "#/$defs/measure" } },
    "performanceEvents": { "type": "array", "items": { "$ref": "#/$defs/performanceEvent" } },
    "motionEvents": { "type": "array", "items": { "$ref": "#/$defs/motionEvent" } },
    "cropTracks": { "type": "array", "items": { "$ref": "#/$defs/cropTrack" } }
  }
}
```

- [ ] **Step 4: Generate types and pass tests**

Run: `pnpm --filter @guitar/contracts generate && pnpm --filter @guitar/contracts test`  
Expected: generated TypeScript compiles and both schema tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: define canonical timeline contracts"
```

### Task 3: Generate matching Python contracts

**Files:**
- Create: `packages/contracts/python/pyproject.toml`
- Create: `packages/contracts/python/guitar_contracts/__init__.py`
- Create: `packages/contracts/python/guitar_contracts/generated.py`
- Create: `packages/contracts/python/tests/test_contracts.py`
- Modify: `packages/contracts/scripts/generate.mjs`

**Interfaces:**
- Consumes: JSON schemas from Task 2.
- Produces: importable `guitar_contracts.TimelineBundle` Pydantic model.

- [ ] **Step 1: Write the Python parity test**

```python
from pydantic import ValidationError
from guitar_contracts import TimelineBundle


def test_timeline_bundle_rejects_negative_duration() -> None:
    try:
        TimelineBundle.model_validate({
            "schemaVersion": "1.0.0", "courseId": "c1", "durationSeconds": -1,
            "measures": [], "performanceEvents": [], "motionEvents": [], "cropTracks": []
        })
    except ValidationError:
        return
    raise AssertionError("negative duration was accepted")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest packages/contracts/python/tests -q`  
Expected: FAIL with `ModuleNotFoundError: guitar_contracts`.

- [ ] **Step 3: Add deterministic generation**

Extend `generate.mjs` to run `datamodel-codegen --input schema/timeline-bundle.json --input-file-type jsonschema --output python/guitar_contracts/generated.py --output-model-type pydantic_v2.BaseModel`, then export generated models from `__init__.py`.

- [ ] **Step 4: Verify TypeScript/Python parity**

Run: `pnpm --filter @guitar/contracts generate && python -m pytest packages/contracts/python/tests -q && git diff --exit-code`  
Expected: tests PASS and a second generation produces no diff.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: generate Python timeline contracts"
```

### Task 4: Create local infrastructure and migrations

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/migrations/001_core.sql`
- Create: `infra/migrations/002_analysis.sql`
- Create: `infra/migrations/003_practice.sql`
- Create: `scripts/wait-for-services.sh`
- Test: `services/api/tests/test_database_health.py`

**Interfaces:**
- Consumes: canonical course, analysis and practice identifiers.
- Produces: PostgreSQL on `localhost:5432`, Redis on `localhost:6379`, MinIO API on `localhost:9000`.

- [ ] **Step 1: Write the infrastructure health test**

```python
import os
import psycopg


def test_database_has_core_tables() -> None:
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute(
            "select tablename from pg_tables where schemaname = 'public'"
        ).fetchall()
    names = {row[0] for row in rows}
    assert {"courses", "analysis_jobs", "practice_sessions"} <= names
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/api/tests/test_database_health.py -q`  
Expected: FAIL because infrastructure and tables do not exist.

- [ ] **Step 3: Implement Compose and SQL migrations**

Create health-checked PostgreSQL, Redis and MinIO services with named volumes. Define `courses`, `analysis_jobs`, `analysis_artifacts`, `practice_sessions`, `practice_observations`, and `evaluation_results`; use UUID primary keys, UTC timestamps, foreign keys, and unique artifact `(course_id, kind, version)`.

Representative migration:

```sql
create table courses (
  id uuid primary key,
  title text not null,
  source_object_key text not null unique,
  duration_seconds double precision,
  analysis_status text not null check (analysis_status in
    ('uploaded','normalizing','transcribing','analyzing_vision','composing','ready','degraded','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 4: Start services, apply migrations, and pass health test**

Run: `docker compose -f infra/docker-compose.yml up -d && ./scripts/wait-for-services.sh && pytest services/api/tests/test_database_health.py -q`  
Expected: PASS with all required tables present.

- [ ] **Step 5: Commit**

```bash
git add infra scripts/wait-for-services.sh services/api/tests/test_database_health.py
git commit -m "feat: add local data infrastructure"
```

### Task 5: Scaffold the Web and API health surfaces

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/api/health/route.ts`
- Create: `apps/web/src/app/page.test.tsx`
- Create: `services/api/pyproject.toml`
- Create: `services/api/app/main.py`
- Create: `services/api/app/settings.py`
- Create: `services/api/tests/test_health.py`

**Interfaces:**
- Consumes: local infrastructure environment variables.
- Produces: Web `GET /api/health` and API `GET /healthz` returning versioned health JSON.

- [ ] **Step 1: Write failing health tests**

```python
from fastapi.testclient import TestClient
from app.main import app


def test_healthz() -> None:
    response = TestClient(app).get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "api", "version": "0.1.0"}
```

```tsx
import { render, screen } from "@testing-library/react";
import Home from "./page";

it("shows the single upload call to action", () => {
  render(<Home />);
  expect(screen.getByRole("button", { name: "选择视频" })).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/api/tests/test_health.py -q && pnpm --filter web test`  
Expected: FAIL because the applications do not exist.

- [ ] **Step 3: Implement minimal health surfaces**

```python
from fastapi import FastAPI

app = FastAPI(title="AI Guitar API", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "api", "version": "0.1.0"}
```

```tsx
export default function Home() {
  return <main><h1>上传吉他视频，生成可交互跟练课程</h1><button>选择视频</button></main>;
}
```

- [ ] **Step 4: Run all foundation checks**

Run: `pytest services/api/tests -q && pnpm --filter web test && pnpm contracts:check`  
Expected: every test passes and generated contracts have no diff.

- [ ] **Step 5: Commit**

```bash
git add apps/web services/api
git commit -m "feat: scaffold Web and API applications"
```

