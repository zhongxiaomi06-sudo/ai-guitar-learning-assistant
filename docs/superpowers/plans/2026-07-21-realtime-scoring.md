# Real-Time Guitar Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calibrate a browser microphone, detect score-guided guitar observations, and produce low-latency teaching-friendly event evaluations with server-side phrase rescoring.

**Architecture:** AudioWorklet performs allocation-safe capture and framing. A Web Worker extracts onset/pitch/chroma features and matches them only against nearby target events; the server accepts compact observations for deterministic second-pass scoring and persistence.

**Tech Stack:** Web Audio API, AudioWorklet, Web Worker/WASM, TypeScript, Python, FastAPI, NumPy, Vitest, pytest, Playwright.

## Global Constraints

- Raw microphone audio is not retained by default.
- Local fast feedback and server second-pass scoring share canonical observation/evaluation contracts.
- Calibration offset is applied once; never double-correct browser and server timestamps.
- Low-confidence input returns `uncertain`, not a red error.
- The first release targets obvious errors in solo acoustic guitar, not studio-grade open transcription.

---

### Task 1: Capture microphone frames safely

**Files:**
- Create: `apps/web/src/features/practice/audio/capture-worklet.ts`
- Create: `apps/web/src/features/practice/audio/AudioCapture.ts`
- Create: `apps/web/src/features/practice/audio/ring-buffer.ts`
- Test: `apps/web/src/features/practice/audio/ring-buffer.test.ts`

**Interfaces:**
- Consumes: `MediaStream`.
- Produces: timestamped mono float frames `{audioContextTime,sampleRate,samples}`.

- [ ] **Step 1: Write ring-buffer tests**

```ts
it("returns overlapping frames without losing samples", () => {
  const buffer = new RingBuffer(8);
  buffer.push(Float32Array.from([1, 2, 3, 4, 5, 6]));
  expect([...buffer.readFrame(4, 2)!]).toEqual([1, 2, 3, 4]);
  expect([...buffer.readFrame(4, 2)!]).toEqual([3, 4, 5, 6]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test -- ring-buffer.test.ts`  
Expected: FAIL because ring buffer does not exist.

- [ ] **Step 3: Implement fixed-capacity capture**

The worklet writes into preallocated buffers and posts fixed-size transferable frames. `AudioCapture.stop()` disconnects nodes and stops owned media tracks.

- [ ] **Step 4: Pass capture tests**

Run: `pnpm --filter web test -- ring-buffer.test.ts`  
Expected: overlap, wraparound, overflow and cleanup tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/practice/audio
git commit -m "feat: capture low-latency microphone frames"
```

### Task 2: Implement environment check and latency calibration

**Files:**
- Create: `apps/web/src/features/practice/calibration/measure.ts`
- Create: `apps/web/src/features/practice/calibration/CalibrationPanel.tsx`
- Create: `apps/web/src/features/practice/calibration/state.ts`
- Test: `apps/web/src/features/practice/calibration/measure.test.ts`

**Interfaces:**
- Consumes: captured frames and prompted open-string onset.
- Produces: `CalibrationResult{inputOffsetMs,noiseFloorDb,inputLevelDb,quality}`.

- [ ] **Step 1: Write calibration tests**

```ts
it("computes input offset from prompted and detected onset", () => {
  expect(computeCalibration({ promptedAtMs: 1000, detectedAtMs: 1068, noiseFloorDb: -52, inputLevelDb: -18 }))
    .toMatchObject({ inputOffsetMs: 68, quality: "good" });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test -- measure.test.ts`  
Expected: FAIL because calibration functions do not exist.

- [ ] **Step 3: Implement explicit calibration states**

States are `requesting_permission`, `measuring_environment`, `waiting_for_note`, `complete`, and `failed`. Reject silent input; warn but permit noisy input; persist calibration only for the current input device and session.

- [ ] **Step 4: Pass tests**

Run: `pnpm --filter web test -- calibration`  
Expected: permission denial, silence, noise warning and successful offset tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/practice/calibration
git commit -m "feat: calibrate practice microphone input"
```

### Task 3: Extract observations with target constraints

**Files:**
- Create: `packages/scoring-engine/src/targets.ts`
- Create: `apps/web/src/features/practice/audio/feature-worker.ts`
- Create: `apps/web/src/features/practice/audio/onset.ts`
- Create: `apps/web/src/features/practice/audio/pitch.ts`
- Create: `apps/web/src/features/practice/audio/chroma.ts`
- Test: `apps/web/src/features/practice/audio/features.test.ts`

**Interfaces:**
- Consumes: audio frames, calibration result and target window.
- Produces: canonical `PracticeObservation` values.

- [ ] **Step 1: Write fixture-based observation tests**

```ts
it("matches a detected E4 to the nearby target only", async () => {
  const result = await analyzeFixture("e4.wav", targetWindow([{ id: "n1", midiPitch: 64, sourceStart: 1.0 }]));
  expect(result.targetEventId).toBe("n1");
  expect(result.detectedPitches[0].midi).toBe(64);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test -- features.test.ts`  
Expected: FAIL because feature worker is absent.

- [ ] **Step 3: Implement onset/pitch/chroma extraction**

The worker searches only target events inside the current tolerance window, separates previous-note sustain from a new onset, and emits `uncertain` evidence when pitch stability or SNR is below threshold.

- [ ] **Step 4: Pass audio fixture tests**

Run: `pnpm --filter web test -- features.test.ts`  
Expected: correct single note, wrong note, sustain, silence and noisy fixture tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scoring-engine apps/web/src/features/practice/audio
git commit -m "feat: extract score-guided guitar observations"
```

### Task 4: Evaluate notes, chords, omissions, and timing

**Files:**
- Create: `packages/scoring-engine/src/evaluate.ts`
- Create: `packages/scoring-engine/src/timing.ts`
- Create: `packages/scoring-engine/src/chords.ts`
- Create: `packages/scoring-engine/src/aggregate.ts`
- Test: `packages/scoring-engine/test/evaluate.test.ts`

**Interfaces:**
- Consumes: target event, observation, BPM, note value and environment quality.
- Produces: canonical `EvaluationResult` and aggregated teaching issue.

- [ ] **Step 1: Write evaluation tests**

```ts
it("does not report uncertain input as wrong", () => {
  const result = evaluate(targetE4(), observation({ confidence: 0.31, detectedPitches: [66] }), context());
  expect(result.resultType).toBe("uncertain");
  expect(result.severity).toBe("neutral");
});

it("marks a stable semitone error as wrong_note", () => {
  const result = evaluate(targetE4(), observation({ confidence: 0.95, detectedPitches: [65] }), context());
  expect(result.resultType).toBe("wrong_note");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @guitar/scoring-engine test`  
Expected: FAIL because evaluator does not exist.

- [ ] **Step 3: Implement pure scoring rules**

Compute timing tolerance from `60000 / BPM`, note value and configurable ratio, clamped to configured minimum/maximum. Chord completeness weights root/third/seventh above repeated fifths. Aggregation merges adjacent event errors into one actionable teaching issue.

- [ ] **Step 4: Pass scoring tests**

Run: `pnpm --filter @guitar/scoring-engine test`  
Expected: correct, wrong, missing, early, late, uncertain and chord-completeness tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scoring-engine
git commit -m "feat: evaluate teaching-friendly guitar performance"
```

### Task 5: Persist observations and rescore phrases

**Files:**
- Create: `services/realtime-scoring/pyproject.toml`
- Create: `services/realtime-scoring/scoring/rescore.py`
- Create: `services/api/app/practice/router.py`
- Create: `services/api/app/practice/repository.py`
- Test: `services/realtime-scoring/tests/test_rescore.py`
- Test: `services/api/tests/practice/test_sessions.py`

**Interfaces:**
- Consumes: batches of canonical observations.
- Produces: practice session API, persisted evaluations and phrase summary.

- [ ] **Step 1: Write idempotency test**

```python
def test_duplicate_observation_id_is_idempotent(client, session_id) -> None:
    payload = observation_payload(id="obs_1")
    assert client.post(f"/practice-sessions/{session_id}/observations", json=payload).status_code == 202
    assert client.post(f"/practice-sessions/{session_id}/observations", json=payload).status_code == 200
    assert count_observations("obs_1") == 1
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/api/tests/practice services/realtime-scoring/tests -q`  
Expected: FAIL because practice routes and rescorer do not exist.

- [ ] **Step 3: Implement session persistence and second-pass alignment**

Accept compact observation batches, enforce course/session ownership, de-duplicate observation IDs, realign within the phrase window, and return event-level results plus one ranked issue list.

- [ ] **Step 4: Pass service tests**

Run: `pytest services/api/tests/practice services/realtime-scoring/tests -q`  
Expected: lifecycle, idempotency, alignment and summary tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/practice services/api/tests/practice services/realtime-scoring
git commit -m "feat: persist and rescore practice sessions"
```

