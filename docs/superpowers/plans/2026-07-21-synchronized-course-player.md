# Synchronized Course Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present generated courses and keep original video, waveform, tablature, chord track and hand crops synchronized through seeking, looping and speed changes.

**Architecture:** A pure timeline package performs indexed event lookup, while one player controller owns media state. React views subscribe to controller snapshots; score, waveform and crop components never control one another directly.

**Tech Stack:** Next.js, React, TypeScript, alphaTab, wavesurfer.js, HTMLVideoElement, Vitest, Playwright.

## Global Constraints

- HTML video media time is the Web playback master clock.
- All views seek through one `PlayerController.seek(sourceSeconds)` interface.
- Speed changes never rewrite canonical event times.
- If crops or motion are unavailable, original video and score remain fully usable.

---

### Task 1: Build indexed timeline lookup

**Files:**
- Create: `packages/timeline/package.json`
- Create: `packages/timeline/src/index.ts`
- Create: `packages/timeline/src/lookup.ts`
- Create: `packages/timeline/src/loop.ts`
- Test: `packages/timeline/test/lookup.test.ts`

**Interfaces:**
- Consumes: `TimelineBundle`.
- Produces: `createTimelineIndex(bundle)`, `activeAt(seconds)`, `eventById(id)`, and `normalizeLoop(range,duration)`.

- [ ] **Step 1: Write boundary tests**

```ts
it("uses half-open event intervals", () => {
  const index = createTimelineIndex(bundleWithEvents([[1, 2], [2, 3]]));
  expect(index.activeAt(2).performanceEventIds).toEqual(["event_2"]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @guitar/timeline test`  
Expected: FAIL because package does not exist.

- [ ] **Step 3: Implement binary-search indexes and loop clamping**

Use sorted immutable arrays; reject NaN and negative seeks; define intervals as `[start,end)` except the final event may include exact media duration.

- [ ] **Step 4: Pass timeline tests**

Run: `pnpm --filter @guitar/timeline test`  
Expected: boundary, empty bundle, invalid seek and loop tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/timeline
git commit -m "feat: index canonical course timelines"
```

### Task 2: Implement one playback controller

**Files:**
- Create: `apps/web/src/features/player/PlayerController.ts`
- Create: `apps/web/src/features/player/usePlayer.ts`
- Create: `apps/web/src/features/player/VideoPane.tsx`
- Test: `apps/web/src/features/player/PlayerController.test.ts`

**Interfaces:**
- Consumes: `HTMLVideoElement`, timeline index.
- Produces: `play()`, `pause()`, `seek(seconds)`, `setSpeed(rate)`, `setLoop(range|null)`, and snapshots.

- [ ] **Step 1: Write controller tests**

```ts
it("seeks all subscribers through media currentTime", () => {
  const media = fakeVideo({ duration: 20 });
  const controller = new PlayerController(media, index);
  controller.seek(8.5);
  expect(media.currentTime).toBe(8.5);
  expect(controller.snapshot().sourceTimeSeconds).toBe(8.5);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test -- PlayerController.test.ts`  
Expected: FAIL because controller does not exist.

- [ ] **Step 3: Implement controller and loop enforcement**

Listen to media `timeupdate`, `seeking`, `play`, `pause`, `ratechange`, and `ended`. Use `requestVideoFrameCallback` when available and fall back to `requestAnimationFrame`. At loop end, seek exactly to loop start and preserve play state.

- [ ] **Step 4: Pass controller tests**

Run: `pnpm --filter web test -- PlayerController.test.ts`  
Expected: seek, speed, loop and cleanup tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/player
git commit -m "feat: add synchronized media controller"
```

### Task 3: Render score, waveform, chord and hand views

**Files:**
- Create: `apps/web/src/features/player/ScorePane.tsx`
- Create: `apps/web/src/features/player/WaveformPane.tsx`
- Create: `apps/web/src/features/player/ChordTrack.tsx`
- Create: `apps/web/src/features/player/HandCropPane.tsx`
- Create: `apps/web/src/features/player/CoursePlayer.tsx`
- Test: `apps/web/src/features/player/CoursePlayer.test.tsx`

**Interfaces:**
- Consumes: controller snapshot, score adapter and crop tracks.
- Produces: the desktop player layout defined in `CLAUDE.md`.

- [ ] **Step 1: Write synchronized selection test**

```tsx
it("clicking a score event seeks the shared controller", async () => {
  const controller = fakeController();
  render(<CoursePlayer course={course} timeline={bundle} controller={controller} />);
  await userEvent.click(screen.getByTestId("score-event-note_024"));
  expect(controller.seek).toHaveBeenCalledWith(17.62);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test -- CoursePlayer.test.tsx`  
Expected: FAIL because views do not exist.

- [ ] **Step 3: Implement views and graceful degradation**

Map alphaTab beat IDs back to canonical event IDs, render active chord and confidence, apply crop rectangles to the original video source, and show “画面中手部不可见” instead of an empty crop pane.

- [ ] **Step 4: Pass component tests**

Run: `pnpm --filter web test -- CoursePlayer.test.tsx`  
Expected: selection, active event, missing crop and low-confidence label tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/player
git commit -m "feat: render synchronized course views"
```

### Task 4: Add course overview, library, and browser drift tests

**Files:**
- Create: `apps/web/src/app/courses/page.tsx`
- Create: `apps/web/src/app/courses/[courseId]/page.tsx`
- Create: `apps/web/src/features/course/CourseOverview.tsx`
- Create: `apps/web/e2e/synchronized-course.spec.ts`
- Test: `apps/web/src/features/course/CourseOverview.test.tsx`

**Interfaces:**
- Consumes: course, segments, timeline and saved progress APIs.
- Produces: “我的课程”, course overview and deep-linkable player.

- [ ] **Step 1: Write the E2E synchronization scenario**

```ts
test("score seek and 90-second playback remain synchronized", async ({ page }) => {
  await page.goto("/courses/demo-course");
  await page.getByTestId("score-event-note_024").click();
  await expect(page.getByTestId("video-time")).toHaveText("00:17.620");
  await page.getByRole("button", { name: "播放" }).click();
  await expect.poll(async () => Number(await page.getByTestId("sync-drift-ms").textContent())).toBeLessThan(50);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter web test:e2e --grep "synchronized"`  
Expected: FAIL because routes and fixtures do not exist.

- [ ] **Step 3: Implement pages and deterministic demo fixture route**

Course overview shows metadata, confidence, segments and difficulty tags. Course cards preserve status and last position. Test-only fixture injection must be gated by the test environment and use the same API contract as production.

- [ ] **Step 4: Pass unit and E2E tests**

Run: `pnpm --filter web test && pnpm --filter web test:e2e --grep "synchronized"`  
Expected: course navigation and drift scenario PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/courses apps/web/src/features/course apps/web/e2e/synchronized-course.spec.ts
git commit -m "feat: deliver synchronized course experience"
```

