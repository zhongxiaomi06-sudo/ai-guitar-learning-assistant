# Vision and Guitar Motion Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce stable left/right hand crops, fretboard coordinates, confidence-aware finger hints, and motion events synchronized to source video time.

**Architecture:** A vision worker samples the analysis proxy using frame timestamps, detects hands and guitar regions, maintains stable tracks, estimates a fretboard homography, then fuses visual hints with audio performance events. Exact finger/string claims are emitted only above confidence thresholds.

**Tech Stack:** Python, OpenCV, MediaPipe Tasks, NumPy, optional Apache-licensed detector, pytest.

## Global Constraints

- Frame timestamps come from the media manifest, never `frameIndex / nominalFps` for variable-frame-rate media.
- Handedness labels do not determine playing-hand roles because uploaded video may be mirrored.
- Crop tracks may continue briefly through detection loss, but inferred finger positions must become unknown.
- Production runtime may not add AGPL detection dependencies without approval.

---

### Task 1: Extract timestamped frames and hand landmarks

**Files:**
- Create: `services/vision-worker/pyproject.toml`
- Create: `services/vision-worker/vision/frames.py`
- Create: `services/vision-worker/vision/hands.py`
- Create: `services/vision-worker/vision/models.py`
- Test: `services/vision-worker/tests/test_hands.py`

**Interfaces:**
- Consumes: `vision.mp4` and media frame-time manifest.
- Produces: ordered `HandObservation[]` with 21 normalized landmarks and `sourceTimeSeconds`.

- [ ] **Step 1: Write failing timestamp tests**

```python
def test_observations_preserve_manifest_timestamps(fake_landmarker) -> None:
    frames = [Frame(0.000, image()), Frame(0.041, image()), Frame(0.089, image())]
    result = detect_hands(frames, fake_landmarker)
    assert [o.source_time for o in result] == [0.000, 0.041, 0.089]
    assert all(len(hand.landmarks) == 21 for o in result for hand in o.hands)
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/vision-worker/tests/test_hands.py -q`  
Expected: FAIL because frame and hand modules do not exist.

- [ ] **Step 3: Implement timestamp-preserving extraction and MediaPipe adapter**

```python
@dataclass(frozen=True)
class HandObservation:
    source_time: float
    track_candidates: tuple[DetectedHand, ...]
```

Convert timestamps to MediaPipe milliseconds only at the adapter boundary; retain source seconds in all product data.

- [ ] **Step 4: Pass tests**

Run: `pytest services/vision-worker/tests/test_hands.py -q`  
Expected: timestamp, zero-hand, one-hand and two-hand cases PASS.

- [ ] **Step 5: Commit**

```bash
git add services/vision-worker
git commit -m "feat: extract timestamped hand landmarks"
```

### Task 2: Assign fretting/picking roles and stable tracks

**Files:**
- Create: `services/vision-worker/vision/tracking/assign.py`
- Create: `services/vision-worker/vision/tracking/filter.py`
- Create: `services/vision-worker/vision/tracking/roles.py`
- Test: `services/vision-worker/tests/tracking/test_roles.py`

**Interfaces:**
- Consumes: hand observations and detected neck/sound-hole regions.
- Produces: stable `fretting` and `picking` track IDs with confidence.

- [ ] **Step 1: Write mirrored-video role test**

```python
def test_roles_use_guitar_geometry_not_handedness() -> None:
    tracks = assign_roles(mirrored_guitar_fixture())
    assert tracks.fretting.mean_position.is_inside(NECK_REGION)
    assert tracks.picking.mean_position.is_inside(SOUND_HOLE_REGION)
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/vision-worker/tests/tracking/test_roles.py -q`  
Expected: FAIL because role assignment is undefined.

- [ ] **Step 3: Implement geometry/trajectory scoring and smoothing**

Role score combines neck overlap, sound-hole overlap, movement direction and temporal persistence. Smooth crop centers with a Kalman filter; permit a maximum configured crop velocity and a short lost-track grace interval.

- [ ] **Step 4: Pass tracking tests**

Run: `pytest services/vision-worker/tests/tracking -q`  
Expected: mirrored, temporary occlusion, role persistence and no-guitar degradation tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/vision-worker/vision/tracking services/vision-worker/tests/tracking
git commit -m "feat: track fretting and picking hands"
```

### Task 3: Establish fretboard coordinates

**Files:**
- Create: `services/vision-worker/vision/fretboard/detect.py`
- Create: `services/vision-worker/vision/fretboard/homography.py`
- Create: `services/vision-worker/vision/fretboard/grid.py`
- Test: `services/vision-worker/tests/fretboard/test_grid.py`

**Interfaces:**
- Consumes: frame, neck/fretboard region and optional curated four-corner annotation.
- Produces: `FretboardTransform`, fret boundaries and six normalized string lines.

- [ ] **Step 1: Write synthetic homography tests**

```python
def test_corner_mapping_recovers_normalized_board() -> None:
    transform = fit_fretboard_transform(SKEWED_CORNERS)
    assert transform.to_board(SKEWED_CORNERS[0]) == pytest.approx((0.0, 0.0), abs=1e-3)
    assert transform.to_board(SKEWED_CORNERS[2]) == pytest.approx((1.0, 1.0), abs=1e-3)
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/vision-worker/tests/fretboard/test_grid.py -q`  
Expected: FAIL because transform is undefined.

- [ ] **Step 3: Implement transform and confidence-aware grid**

Fit homography from curated or detector corners. Generate fret positions with the twelve-tone equal-temperament distance relation and string lines as six normalized cross-neck coordinates; attach confidence from corner reprojection error.

- [ ] **Step 4: Pass geometry tests**

Run: `pytest services/vision-worker/tests/fretboard -q`  
Expected: synthetic perspective, low-confidence corners and coordinate round-trip tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/vision-worker/vision/fretboard services/vision-worker/tests/fretboard
git commit -m "feat: map video hands to fretboard coordinates"
```

### Task 4: Compose crop and motion events with audio hints

**Files:**
- Create: `services/vision-worker/vision/crops.py`
- Create: `services/vision-worker/vision/motion.py`
- Create: `services/vision-worker/vision/fusion.py`
- Create: `services/vision-worker/vision/compose.py`
- Test: `services/vision-worker/tests/test_compose.py`

**Interfaces:**
- Consumes: hand tracks, fretboard transform and audio `PerformanceEvent[]`.
- Produces: canonical `CropTrack[]`, `MotionEvent[]`, visual string/fret hints.

- [ ] **Step 1: Write confidence degradation tests**

```python
def test_occluded_finger_keeps_crop_but_omits_fret_claim() -> None:
    result = compose_motion(occluded_fixture(), performance_events())
    assert result.crop_tracks
    event = result.motion_events[0]
    assert event.finger_positions == []
    assert event.confidence < 0.5
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/vision-worker/tests/test_compose.py -q`  
Expected: FAIL because composer is undefined.

- [ ] **Step 3: Implement crops, motion detection and audio fusion**

Detect `position_shift` from sustained wrist movement along the fretboard axis. Associate picking-direction extrema with nearby note onsets. Emit finger positions only when hand, board and audio candidate agree above threshold.

- [ ] **Step 4: Validate canonical output**

Run: `pytest services/vision-worker/tests -q && pnpm --filter @guitar/contracts check`  
Expected: canonical motion fixture validates; crop coordinates remain inside `[0,1]`.

- [ ] **Step 5: Commit**

```bash
git add services/vision-worker
git commit -m "feat: compose synchronized hand motion tracks"
```

