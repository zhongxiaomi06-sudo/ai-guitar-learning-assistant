# AI Guitar Learning Assistant Master Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete Web-first MVP described in `CLAUDE.md`, then reuse its contracts and services for the mobile application.

**Architecture:** Build a pnpm monorepo containing a Next.js Web app, a FastAPI product API, isolated Python media/audio/vision workers, and shared JSON Schema contracts. Every subsystem exchanges immutable, source-time-based events through PostgreSQL/object storage; Redis only carries job coordination and ephemeral progress.

**Tech Stack:** TypeScript, Next.js, React, alphaTab, wavesurfer.js, Web Audio API, Python 3.11, FastAPI, Pydantic, PyTorch/ONNX Runtime, FFmpeg, Basic Pitch, Beat This!, MediaPipe, OpenCV, PostgreSQL, Redis, S3-compatible storage, Docker Compose, Playwright, Vitest, pytest.

## Global Constraints

- Web desktop ships before the mobile application; mobile starts only after the Web learning loop passes acceptance.
- Inputs are local MP4/MOV files, 30 seconds to 10 minutes, with a recommended maximum size of 1 GB.
- The public product has one upload entry and no tutor role.
- Demo-video fingerprints may resolve to curated analysis, while all other supported videos run the real pipeline.
- `sourceTimeSeconds` is the canonical time unit across video, audio, score, motion, practice, and evaluation data.
- Real-time scoring is score-guided and teaching-friendly; uncertain observations never become red errors.
- Low-confidence visual or audio results degrade explicitly instead of fabricating string, fret, finger, or chord precision.
- AGPL dependencies must not enter production runtime without a recorded licensing decision.
- Every task follows test-first development and ends with a focused commit.

---

## Plan Suite

Execute these plans in order. A later plan may begin only after all listed prerequisites pass.

| Order | Plan | Deliverable | Prerequisites |
|---:|---|---|---|
| 1 | `2026-07-21-foundation-and-contracts.md` | Runnable monorepo, infrastructure, canonical schemas | None |
| 2 | `2026-07-21-media-upload-and-jobs.md` | Upload, storage, media normalization, job progress | Plan 1 |
| 3 | `2026-07-21-transcription-pipeline.md` | Notes, beats, chords, string/fret candidates, score JSON | Plans 1–2 |
| 4 | `2026-07-21-vision-and-motion.md` | Hand crops, fretboard coordinates, motion events | Plans 1–2 |
| 5 | `2026-07-21-synchronized-course-player.md` | Course overview and synchronized video/score/crops | Plans 1–4 |
| 6 | `2026-07-21-realtime-scoring.md` | Microphone calibration and teaching-friendly evaluation | Plans 1, 3, 5 |
| 7 | `2026-07-21-adaptive-practice-and-release.md` | Error loop, speed ladder, results, hardening, mobile gate | Plans 1–6 |
| 8 | `2026-07-21-mobile-application.md` | iOS/Android course, upload and practice experience | Plan 7 mobile gate |

## Locked Repository Structure

```text
apps/
  web/                         Next.js product UI
  mobile/                      React Native iOS/Android application
services/
  api/                         FastAPI product API
  media-worker/                FFmpeg normalization and quality checks
  transcription-worker/        Note, beat, chord, string/fret analysis
  vision-worker/               Hand, fretboard, crop and motion analysis
  realtime-scoring/            Server-side phrase rescoring
packages/
  contracts/                   JSON Schema and generated TS/Python types
  timeline/                    Pure source-time lookup and synchronization logic
  score-model/                 Canonical score and alphaTab adapter
  scoring-engine/              Pure teaching-friendly evaluation rules
  practice-engine/             Pure adaptive-practice state machine
infra/
  docker-compose.yml           Local PostgreSQL, Redis and MinIO
  migrations/                  SQL migrations
fixtures/
  demo/                        Small redistributable development fixtures only
  expected/                    Golden analysis outputs
scripts/                       Developer and CI verification scripts
docs/superpowers/plans/        This plan suite
```

## Cross-Plan Interfaces

The following names are frozen in Plan 1 and must not be redefined locally:

```ts
type SourceSeconds = number;
type Confidence = number;
type AnalysisStatus =
  | "uploaded"
  | "normalizing"
  | "transcribing"
  | "analyzing_vision"
  | "composing"
  | "ready"
  | "degraded"
  | "failed";

interface TimelineBundle {
  schemaVersion: "1.0.0";
  courseId: string;
  durationSeconds: SourceSeconds;
  measures: Measure[];
  performanceEvents: PerformanceEvent[];
  motionEvents: MotionEvent[];
  cropTracks: CropTrack[];
}
```

All services validate inputs and outputs against `packages/contracts/schema/*.json`. Generated TypeScript and Python models are artifacts; developers edit schemas, not generated files.

## Integration Gates

### Gate A: Foundation

Run:

```bash
pnpm lint
pnpm test
pnpm contracts:check
docker compose -f infra/docker-compose.yml config --quiet
```

Expected: every command exits `0` and generated contracts have no diff.

### Gate B: Offline course generation

Run:

```bash
pnpm fixture:analyze fixtures/demo/clean-guitar-20s.mp4
pnpm fixture:verify fixtures/expected/clean-guitar-20s.timeline.json
```

Expected: analysis reaches `ready` or documented `degraded`; schema validation passes; every performance event belongs to a measure and lies inside media duration.

### Gate C: Synchronized player

Run:

```bash
pnpm --filter web test:e2e --grep "synchronized course"
```

Expected: seeking a score event updates video, waveform and both crop views within the UI tolerance; a 90-second playback test shows no accumulating drift.

### Gate D: Real-time learning loop

Run:

```bash
pnpm --filter web test:e2e --grep "practice loop"
pytest services/realtime-scoring/tests -q
```

Expected: calibrated fixture audio produces correct, wrong-note, missing-note and late results at the expected event IDs; uncertain input is not rendered as a red error.

### Gate E: Release candidate

Run:

```bash
pnpm verify
pnpm demo:smoke
```

Expected: unit, integration, contract and browser tests pass; demo upload-to-completion flow finishes without manual database or storage edits.

## Milestones

1. **M0—Engineering baseline:** Plan 1 complete.
2. **M1—Video becomes data:** Plans 2–4 complete; ordinary videos yield a validated timeline bundle.
3. **M2—Video becomes a lesson:** Plan 5 complete; score, waveform and hands are synchronized.
4. **M3—Lesson becomes interactive:** Plan 6 complete; microphone feedback identifies target events.
5. **M4—Learning loop complete:** Plan 7 complete; errors become adaptive practice and completion progress.
6. **M5—Mobile authorized:** Web release metrics and device matrix pass the mobile gate in Plan 7.

## Delivery Rules

- Merge or review each plan task independently; do not combine unrelated worker, UI and infrastructure changes.
- Store model name, model version, code version and configuration with every analysis result.
- Preserve curated demo output as versioned fixture data; never hide demo-only conditionals inside model code.
- Add one golden fixture for every corrected regression.
- Do not collect or retain microphone audio beyond the documented practice path; default local analysis transmits features, not a continuous raw stream.
- Update `CLAUDE.md` only when product scope changes; update `TECHNICAL_RESEARCH.md` when a technology or license decision changes.
