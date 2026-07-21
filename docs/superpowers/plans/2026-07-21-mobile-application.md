# Mobile Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver iOS and Android applications that reuse Web contracts, courses, progress, scoring rules and practice-state behavior while adapting playback, microphone capture and layout to phones and tablets.

**Architecture:** A React Native application consumes the existing API and shared TypeScript domain packages. Platform adapters own media playback, microphone capture, local files and offline cache; domain logic remains in shared contracts, timeline, scoring and practice packages.

**Tech Stack:** React Native, Expo development builds, TypeScript, React Navigation, platform audio/video modules, SQLite-backed cache, Vitest/Jest, React Native Testing Library, Maestro or Detox.

## Global Constraints

- Begin only when `node scripts/mobile-readiness.mjs` reports `allowed: true`.
- Do not fork canonical schemas, scoring thresholds or practice-state rules.
- Phone portrait uses switchable video/left-hand/right-hand views; landscape uses immersive practice.
- Tablet uses a multi-column layout comparable to Web.
- Bluetooth latency must be detected or explicitly warned about before microphone practice.
- Course media may be cached offline only through versioned, size-bounded manifests.

---

### Task 1: Scaffold the mobile app and shared API client

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/src/App.tsx`
- Create: `apps/mobile/src/navigation/RootNavigator.tsx`
- Create: `apps/mobile/src/api/client.ts`
- Create: `apps/mobile/src/api/client.test.ts`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Consumes: `@guitar/contracts`, course and practice HTTP APIs.
- Produces: authenticated `getCourses()`, `getCourse(id)`, `getTimeline(id)`, and practice-session client methods.

- [ ] **Step 1: Write API contract tests**

```ts
it("validates timeline responses before returning them", async () => {
  const transport = fakeTransport({ schemaVersion: "bad" });
  await expect(createApiClient(transport).getTimeline("c1")).rejects.toThrow("Invalid TimelineBundle");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter mobile test -- client.test.ts`  
Expected: FAIL because the mobile package does not exist.

- [ ] **Step 3: Scaffold navigation and validated client**

Create routes `Library`, `CourseOverview`, `Player`, `Practice`, `Results`, and `Settings`. Parse all API responses with generated contract validators before exposing them to screens.

- [ ] **Step 4: Pass mobile unit tests**

Run: `pnpm --filter mobile test`  
Expected: navigation smoke and invalid/valid API response tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile pnpm-workspace.yaml
git commit -m "feat: scaffold shared-contract mobile app"
```

### Task 2: Implement responsive course and player screens

**Files:**
- Create: `apps/mobile/src/screens/LibraryScreen.tsx`
- Create: `apps/mobile/src/screens/CourseOverviewScreen.tsx`
- Create: `apps/mobile/src/screens/PlayerScreen.tsx`
- Create: `apps/mobile/src/player/MobilePlayerController.ts`
- Create: `apps/mobile/src/player/ViewSwitcher.tsx`
- Test: `apps/mobile/src/screens/PlayerScreen.test.tsx`

**Interfaces:**
- Consumes: canonical timeline and course APIs.
- Produces: phone portrait switcher, phone landscape player and tablet multi-column player.

- [ ] **Step 1: Write layout and seek tests**

```tsx
it("phone portrait switches to the fretting-hand view without changing source time", async () => {
  const controller = fakeMobileController({ sourceTimeSeconds: 12.5 });
  render(<PlayerScreen controller={controller} layout="phone-portrait" />);
  await userEvent.press(screen.getByRole("button", { name: "左手" }));
  expect(screen.getByTestId("fretting-crop")).toBeVisible();
  expect(controller.snapshot().sourceTimeSeconds).toBe(12.5);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter mobile test -- PlayerScreen.test.tsx`  
Expected: FAIL because screens and controller do not exist.

- [ ] **Step 3: Implement responsive player adapters**

Use shared timeline lookup, keep native media position as master, expose the same `seek`, `setSpeed` and `setLoop` semantics as Web, and render a simplified horizontally scrolling tab view on phones.

- [ ] **Step 4: Pass screen tests**

Run: `pnpm --filter mobile test -- PlayerScreen.test.tsx`  
Expected: portrait switching, landscape layout, tablet layout, seek and missing-crop tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens apps/mobile/src/player
git commit -m "feat: add responsive mobile course player"
```

### Task 3: Add gallery upload and resumable analysis

**Files:**
- Create: `apps/mobile/src/upload/VideoPicker.tsx`
- Create: `apps/mobile/src/upload/BackgroundUpload.ts`
- Create: `apps/mobile/src/screens/UploadScreen.tsx`
- Create: `apps/mobile/src/screens/AnalysisProgressScreen.tsx`
- Test: `apps/mobile/src/upload/BackgroundUpload.test.ts`

**Interfaces:**
- Consumes: system photo library file and upload-session API.
- Produces: resumable upload and course analysis navigation.

- [ ] **Step 1: Write resume test**

```ts
it("resumes an interrupted upload from persisted bytes", async () => {
  const upload = createBackgroundUpload(fakeStore({ uploadedBytes: 1024 }), fakeTransport());
  await upload.resume("upload_1");
  expect(upload.transport.lastRangeStart).toBe(1024);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter mobile test -- BackgroundUpload.test.ts`  
Expected: FAIL because uploader does not exist.

- [ ] **Step 3: Implement picker, upload persistence and progress reconnect**

Validate MP4/MOV and 1 GB locally, persist upload metadata without copying the full file into app memory, resume supported transfers, and reconnect to analysis progress when the app returns from background.

- [ ] **Step 4: Pass upload tests**

Run: `pnpm --filter mobile test -- upload`  
Expected: invalid file, interruption, resume, cancellation and progress reconnection tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/upload apps/mobile/src/screens/UploadScreen.tsx apps/mobile/src/screens/AnalysisProgressScreen.tsx
git commit -m "feat: upload guitar videos from mobile"
```

### Task 4: Implement native microphone calibration and practice

**Files:**
- Create: `apps/mobile/src/audio/MobileAudioCapture.ts`
- Create: `apps/mobile/src/audio/DeviceLatency.ts`
- Create: `apps/mobile/src/screens/CalibrationScreen.tsx`
- Create: `apps/mobile/src/screens/PracticeScreen.tsx`
- Test: `apps/mobile/src/audio/DeviceLatency.test.ts`
- Test: `apps/mobile/src/screens/PracticeScreen.test.tsx`

**Interfaces:**
- Consumes: native PCM frames, shared scoring/practice engines.
- Produces: the same `PracticeObservation` and `EvaluationResult` contracts as Web.

- [ ] **Step 1: Write Bluetooth warning and parity tests**

```ts
it("requires acknowledgement for high-latency Bluetooth input", () => {
  const result = assessDeviceLatency({ route: "bluetooth", measuredMs: 186 });
  expect(result).toEqual({ quality: "high", requiresAcknowledgement: true });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter mobile test -- DeviceLatency.test.ts`  
Expected: FAIL because device assessment is undefined.

- [ ] **Step 3: Implement native adapter and reuse domain engines**

Capture mono PCM with stable timestamps, convert only at the adapter boundary, run the same target-constrained observation contract, and pass results through `@guitar/scoring-engine` and `@guitar/practice-engine` without mobile-specific thresholds.

- [ ] **Step 4: Pass parity tests**

Run: `pnpm --filter mobile test -- audio && pnpm --filter mobile test -- PracticeScreen.test.tsx`  
Expected: wired/Bluetooth calibration, fixture scoring parity and speed-ladder UI tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/audio apps/mobile/src/screens/CalibrationScreen.tsx apps/mobile/src/screens/PracticeScreen.tsx
git commit -m "feat: add calibrated mobile guitar practice"
```

### Task 5: Add bounded offline course cache

**Files:**
- Create: `apps/mobile/src/offline/manifest.ts`
- Create: `apps/mobile/src/offline/CourseCache.ts`
- Create: `apps/mobile/src/screens/DownloadsScreen.tsx`
- Test: `apps/mobile/src/offline/CourseCache.test.ts`

**Interfaces:**
- Consumes: versioned course manifest and signed artifact URLs.
- Produces: atomic cached course usable for playback without network.

- [ ] **Step 1: Write atomic-cache test**

```ts
it("does not expose a partially downloaded course", async () => {
  const cache = createCourseCache(failingDownloader("proxy.mp4"));
  await expect(cache.download(manifest())).rejects.toThrow();
  expect(await cache.get("course_1")).toBeNull();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter mobile test -- CourseCache.test.ts`  
Expected: FAIL because cache does not exist.

- [ ] **Step 3: Implement checksummed, size-bounded manifests**

Download to a staging directory, verify size and SHA-256 for timeline, score and media artifacts, atomically promote the directory, and evict least-recently-used courses only when they are not active.

- [ ] **Step 4: Pass offline tests**

Run: `pnpm --filter mobile test -- offline`  
Expected: success, corruption, partial download, version invalidation and eviction tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/offline apps/mobile/src/screens/DownloadsScreen.tsx
git commit -m "feat: cache mobile courses offline"
```

### Task 6: Run iOS/Android release gates

**Files:**
- Create: `apps/mobile/e2e/practice-flow.yaml`
- Create: `apps/mobile/docs/device-matrix.md`
- Create: `.github/workflows/mobile.yml`
- Modify: `scripts/verify.mjs`

**Interfaces:**
- Consumes: mobile build, API staging environment and demo course.
- Produces: signed internal iOS/Android builds and a completed device matrix.

- [ ] **Step 1: Create the mobile E2E flow**

```yaml
appId: com.example.aiguitar
---
- launchApp
- tapOn: "演示课程"
- tapOn: "开始练习"
- assertVisible: "麦克风校准"
- tapOn: "使用测试音频"
- assertVisible: "本次：正确"
- assertVisible: "当前速度：75%"
```

- [ ] **Step 2: Run and verify initial failure**

Run: `pnpm --filter mobile test:e2e`  
Expected: FAIL until test build and fixture injection are wired.

- [ ] **Step 3: Implement CI build and device-matrix checks**

CI builds iOS/Android development clients, runs unit tests and the deterministic E2E fixture. Manual matrix covers current supported iPhone/iPad and representative low/mid/high Android devices, wired input, built-in mic and Bluetooth warning behavior.

- [ ] **Step 4: Run the mobile release gate**

Run: `pnpm --filter mobile test && pnpm --filter mobile test:e2e && pnpm verify`  
Expected: all shared-contract, mobile unit, E2E and repository checks PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/e2e apps/mobile/docs .github/workflows/mobile.yml scripts/verify.mjs
git commit -m "chore: enforce mobile release gates"
```

