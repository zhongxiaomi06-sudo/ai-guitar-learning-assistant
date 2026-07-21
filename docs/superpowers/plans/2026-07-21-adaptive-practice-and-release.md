# Adaptive Practice, Release Hardening, and Mobile Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn scored errors into teacher-action review, slow looping, repeat comparison, progressive speed recovery, durable mastery, and a release-qualified Web MVP.

**Architecture:** A pure state machine chooses one next action from aggregated issues and pass criteria. React renders the state and controls the shared player; persistence stores attempts and mastery. Release tooling validates demo determinism, ordinary-video degradation, privacy, performance and browser compatibility before mobile work starts.

**Tech Stack:** TypeScript, React, XState-style pure reducer, FastAPI, PostgreSQL, Playwright, Vitest, pytest, GitHub Actions.

## Global Constraints

- Default speed ladder is 60% → 75% → 90% → 100%; 50% is available after repeated failure.
- A practice prompt presents one principal corrective action at a time.
- Passing requires key-note accuracy ≥90%, chord completeness ≥85%, at most two obvious timing errors, and two consecutive correct target attempts.
- Two failures retain or shorten the current drill; four failures lower speed and replay teacher motion.
- Web release gates mobile development.

---

### Task 1: Implement the adaptive-practice state machine

**Files:**
- Create: `packages/practice-engine/package.json`
- Create: `packages/practice-engine/src/state.ts`
- Create: `packages/practice-engine/src/reducer.ts`
- Create: `packages/practice-engine/src/criteria.ts`
- Create: `packages/practice-engine/src/segment.ts`
- Test: `packages/practice-engine/test/reducer.test.ts`

**Interfaces:**
- Consumes: aggregated teaching issue, attempt summary, course measures.
- Produces: `PracticeState`, loop range, speed and one `RecommendedAction`.

- [ ] **Step 1: Write state-transition tests**

```ts
it("advances through the default speed ladder after consecutive passes", () => {
  let state = createPractice(issue(), measures());
  state = reduce(state, { type: "TEACHER_WATCHED" });
  state = reduce(state, { type: "ATTEMPT_FINISHED", summary: passing(1) });
  state = reduce(state, { type: "ATTEMPT_FINISHED", summary: passing(2) });
  expect(state.speed).toBe(0.75);
});

it("drops to 50 percent after four failures", () => {
  const state = repeatFailure(createPractice(issue(), measures()), 4);
  expect(state.speed).toBe(0.5);
  expect(state.phase).toBe("watch_teacher");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @guitar/practice-engine test`  
Expected: FAIL because package does not exist.

- [ ] **Step 3: Implement pure state and pass criteria**

```ts
export type PracticePhase =
  | "watch_teacher" | "count_in" | "listening" | "analyzing"
  | "retry_same_speed" | "speed_up" | "passed";

export const SPEED_LADDER = [0.6, 0.75, 0.9, 1] as const;
```

Segment selection defaults to the previous/current/next measure, clamped to course bounds; a single shift issue uses its 2–4 second motion window.

- [ ] **Step 4: Pass state-machine tests**

Run: `pnpm --filter @guitar/practice-engine test`  
Expected: speed ladder, failure, segment clamp, pass threshold and single-action tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/practice-engine
git commit -m "feat: add adaptive guitar practice engine"
```

### Task 2: Build error heatmap and focused teacher review

**Files:**
- Create: `apps/web/src/features/practice/ErrorHeatmap.tsx`
- Create: `apps/web/src/features/practice/IssueSummary.tsx`
- Create: `apps/web/src/features/practice/TeacherReview.tsx`
- Create: `apps/web/src/features/practice/PracticeWorkspace.tsx`
- Test: `apps/web/src/features/practice/PracticeWorkspace.test.tsx`

**Interfaces:**
- Consumes: evaluations, motion events and practice-engine state.
- Produces: clickable error locations and teacher-action review controls.

- [ ] **Step 1: Write focused-review test**

```tsx
it("opens the teacher one second before the selected error", async () => {
  const controller = fakeController();
  render(<PracticeWorkspace issue={issueAt(18.42)} controller={controller} />);
  await userEvent.click(screen.getByText("第 6 小节第 2 拍"));
  expect(controller.setLoop).toHaveBeenCalledWith({ start: 17.42, end: 18.92 });
  expect(controller.seek).toHaveBeenCalledWith(17.42);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test -- PracticeWorkspace.test.tsx`  
Expected: FAIL because workspace does not exist.

- [ ] **Step 3: Implement heatmap and teacher controls**

Map evaluation types to green/yellow/orange/red/gray states. Teacher review supports frame stepping, hand enlargement, mirror, overlay toggle, teacher/user audio selection, and explicit low-confidence copy.

- [ ] **Step 4: Pass UI tests**

Run: `pnpm --filter web test -- PracticeWorkspace.test.tsx`  
Expected: heatmap selection, loop bounds, motion overlay and missing-motion degradation tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/practice
git commit -m "feat: guide users through focused error review"
```

### Task 3: Connect listening, comparison, and speed recovery

**Files:**
- Create: `apps/web/src/features/practice/PracticeSession.tsx`
- Create: `apps/web/src/features/practice/AttemptComparison.tsx`
- Create: `apps/web/src/features/practice/SpeedLadder.tsx`
- Test: `apps/web/src/features/practice/PracticeSession.test.tsx`
- Test: `apps/web/e2e/practice-loop.spec.ts`

**Interfaces:**
- Consumes: microphone observations, scoring results and practice-engine transitions.
- Produces: complete watch → play → analyze → compare → speed-up loop.

- [ ] **Step 1: Write E2E practice-loop scenario**

```ts
test("a corrected missing note advances the speed ladder", async ({ page }) => {
  await page.goto("/courses/demo-course/practice?fixture=missing-then-correct");
  await page.getByRole("button", { name: "开始专项练习" }).click();
  await page.getByRole("button", { name: "我来试试" }).click();
  await expect(page.getByText("上次：1 弦漏音")).toBeVisible();
  await expect(page.getByText("本次：正确")).toBeVisible();
  await expect(page.getByText("当前速度：75%")).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test:e2e --grep "speed ladder"`  
Expected: FAIL because integrated session does not exist.

- [ ] **Step 3: Implement the integrated session**

Bind player loop/speed to practice state, capture only during `listening`, submit observations during `analyzing`, compare the previous attempt by target event ID, and announce one next action through an accessible live region.

- [ ] **Step 4: Pass unit and E2E tests**

Run: `pnpm --filter web test -- PracticeSession.test.tsx && pnpm --filter web test:e2e --grep "speed ladder"`  
Expected: state transitions, comparison and speed progression PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/practice apps/web/e2e/practice-loop.spec.ts
git commit -m "feat: complete adaptive practice loop"
```

### Task 4: Persist progress and render completion

**Files:**
- Create: `services/api/app/progress/router.py`
- Create: `services/api/app/progress/service.py`
- Create: `apps/web/src/features/results/CompletionSummary.tsx`
- Modify: `apps/web/src/app/courses/[courseId]/page.tsx`
- Test: `services/api/tests/progress/test_mastery.py`
- Test: `apps/web/src/features/results/CompletionSummary.test.tsx`

**Interfaces:**
- Consumes: finished practice sessions and segment pass results.
- Produces: course mastery map, weak measures, best score and last position.

- [ ] **Step 1: Write mastery aggregation test**

```python
def test_mastery_prefers_recent_success_without_erasing_history() -> None:
    result = aggregate_mastery([failed_attempt(), passed_attempt()])
    assert result.status == "mastered"
    assert result.attempt_count == 2
    assert result.improvement.note_accuracy > 0
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/api/tests/progress/test_mastery.py -q`  
Expected: FAIL because progress service is absent.

- [ ] **Step 3: Implement progress aggregation and completion UI**

Persist attempts; derive, rather than overwrite, mastery. Completion summary shows overall score, note/chord/rhythm metrics, mastered/weak measures, duration, improvement, and actions to retry, continue or review weak measures.

- [ ] **Step 4: Pass progress tests**

Run: `pytest services/api/tests/progress -q && pnpm --filter web test -- CompletionSummary.test.tsx`  
Expected: mastery, history and completion presentation tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/progress services/api/tests/progress apps/web/src/features/results apps/web/src/app/courses
git commit -m "feat: persist course mastery and results"
```

### Task 5: Add release security, privacy, observability, and CI gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `services/api/app/telemetry.py`
- Create: `services/api/app/security.py`
- Create: `docs/privacy/microphone-data.md`
- Create: `scripts/demo-smoke.mjs`
- Create: `scripts/check-licenses.mjs`
- Modify: `package.json`
- Test: `services/api/tests/test_security.py`

**Interfaces:**
- Consumes: all Web/API/worker packages.
- Produces: `pnpm verify`, `pnpm demo:smoke`, dependency license report and structured job/practice telemetry.

- [ ] **Step 1: Write security tests**

```python
def test_course_artifact_keys_are_not_accepted_from_client(client) -> None:
    response = client.post("/courses", json={"uploadId": "u1", "sourceObjectKey": "../../other"})
    assert response.status_code == 422


def test_raw_microphone_audio_retention_defaults_off(settings) -> None:
    assert settings.retain_microphone_audio is False
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/api/tests/test_security.py -q`  
Expected: FAIL until server-owned object keys and privacy default exist.

- [ ] **Step 3: Implement release checks**

CI runs contract generation diff, TS/Python unit tests, lint, migrations, worker fixture tests and Playwright. `check-licenses.mjs` fails production dependency graphs containing AGPL packages unless the package name appears with an approved decision in `docs/licenses/approved.json`.

- [ ] **Step 4: Run the release gate**

Run: `pnpm verify && pnpm demo:smoke`  
Expected: all checks PASS; demo fixture reaches completion; repository remains clean.

- [ ] **Step 5: Commit**

```bash
git add .github services/api/app services/api/tests docs/privacy scripts package.json
git commit -m "chore: enforce Web MVP release gates"
```

### Task 6: Record the mobile readiness decision

**Files:**
- Create: `docs/mobile/readiness-checklist.md`
- Create: `docs/mobile/shared-contracts.md`
- Create: `scripts/mobile-readiness.mjs`
- Test: `scripts/mobile-readiness.test.mjs`

**Interfaces:**
- Consumes: Web release reports and canonical contracts.
- Produces: a machine-readable pass/fail decision permitting mobile development.

- [ ] **Step 1: Write readiness test**

```js
test("mobile is blocked when Web learning-loop evidence is missing", () => {
  const result = evaluateReadiness({ contractVersion: "1.0.0", webReleasePassed: false, deviceMatrixPassed: true });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers, ["web_release"]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/mobile-readiness.test.mjs`  
Expected: FAIL because readiness evaluator does not exist.

- [ ] **Step 3: Implement explicit mobile gate**

Require Web release gate, Chrome/Safari/Edge microphone matrix, stable contract version, API backward-compatibility test and documented Bluetooth-latency behavior. The mobile plan may reuse services and schemas but must not fork domain rules.

- [ ] **Step 4: Verify the gate**

Run: `node --test scripts/mobile-readiness.test.mjs && node scripts/mobile-readiness.mjs`  
Expected: tests PASS; command reports blockers until real Web release evidence is supplied.

- [ ] **Step 5: Commit**

```bash
git add docs/mobile scripts/mobile-readiness.mjs scripts/mobile-readiness.test.mjs
git commit -m "docs: define mobile development gate"
```

