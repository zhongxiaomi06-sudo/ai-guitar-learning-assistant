# Guitar Transcription Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert normalized solo-guitar audio into validated beats, measures, notes, chords, playable string/fret assignments, and canonical score data.

**Architecture:** Independent adapters run Basic Pitch and Beat This!, normalize their results, then pure deterministic composers quantize events, infer chords and select playable string/fret paths. Model adapters can change without changing the canonical contracts.

**Tech Stack:** Python, Basic Pitch, Beat This!, librosa, NumPy, Pydantic, pytest, ONNX Runtime/PyTorch.

## Global Constraints

- Model adapters return raw candidates; pure composer code owns product decisions.
- Store model name, version, configuration and confidence with each artifact.
- Keep at least three string/fret path candidates until timeline composition.
- Uncertain chord or string/fret values remain nullable and lower course confidence.

---

### Task 1: Wrap note and beat models behind stable adapters

**Files:**
- Create: `services/transcription-worker/pyproject.toml`
- Create: `services/transcription-worker/transcription/adapters/basic_pitch.py`
- Create: `services/transcription-worker/transcription/adapters/beat_this.py`
- Create: `services/transcription-worker/transcription/models.py`
- Test: `services/transcription-worker/tests/adapters/test_models.py`

**Interfaces:**
- Consumes: local `analysis.wav`.
- Produces: `list[NoteCandidate]` and `BeatGrid`.

- [ ] **Step 1: Write adapter contract tests**

```python
def test_note_candidates_are_sorted_and_bounded(fake_basic_pitch) -> None:
    notes = BasicPitchAdapter(fake_basic_pitch).transcribe(Path("fixture.wav"), duration=2.0)
    assert [n.source_start for n in notes] == sorted(n.source_start for n in notes)
    assert all(0 <= n.source_start < n.source_end <= 2.0 for n in notes)
    assert all(0 <= n.confidence <= 1 for n in notes)
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/transcription-worker/tests/adapters/test_models.py -q`  
Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement adapters and normalization**

```python
@dataclass(frozen=True)
class NoteCandidate:
    source_start: float
    source_end: float
    midi_pitch: int
    velocity: float
    confidence: float
```

Clamp only floating noise outside `[0,duration]`; reject invalid MIDI pitch and non-positive duration rather than silently fixing corrupt model output.

- [ ] **Step 4: Pass adapter tests**

Run: `pytest services/transcription-worker/tests/adapters -q`  
Expected: ordering, bounds, empty-audio and metadata tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/transcription-worker
git commit -m "feat: add note and beat model adapters"
```

### Task 2: Quantize notes into beats and measures

**Files:**
- Create: `services/transcription-worker/transcription/quantize.py`
- Create: `services/transcription-worker/transcription/measures.py`
- Test: `services/transcription-worker/tests/test_quantize.py`

**Interfaces:**
- Consumes: `NoteCandidate[]`, `BeatGrid`.
- Produces: canonical `Measure[]` and timed note drafts with `beatPosition`.

- [ ] **Step 1: Write the quantization test**

```python
def test_quantizes_note_to_nearest_sixteenth() -> None:
    grid = BeatGrid(beats=[0.0, 0.5, 1.0, 1.5], downbeats=[0.0])
    note = NoteCandidate(0.26, 0.49, 64, 0.8, 0.9)
    result = quantize_notes([note], grid, subdivisions=4)
    assert result[0].beat_position == 0.5
    assert result[0].source_start == 0.26
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/transcription-worker/tests/test_quantize.py -q`  
Expected: FAIL because `quantize_notes` is undefined.

- [ ] **Step 3: Implement non-destructive quantization**

Preserve raw `source_start/source_end`; store quantized musical position separately. Infer measure boundaries from downbeats and flag irregular grids rather than fabricating 4/4.

- [ ] **Step 4: Pass quantization tests**

Run: `pytest services/transcription-worker/tests/test_quantize.py -q`  
Expected: regular, pickup, missing-downbeat and tempo-change fixtures PASS.

- [ ] **Step 5: Commit**

```bash
git add services/transcription-worker/transcription/quantize.py services/transcription-worker/transcription/measures.py services/transcription-worker/tests/test_quantize.py
git commit -m "feat: compose beat and measure grid"
```

### Task 3: Infer and smooth chord labels

**Files:**
- Create: `services/transcription-worker/transcription/chords/templates.py`
- Create: `services/transcription-worker/transcription/chords/infer.py`
- Create: `services/transcription-worker/transcription/chords/smooth.py`
- Test: `services/transcription-worker/tests/chords/test_chords.py`

**Interfaces:**
- Consumes: beat-grouped notes and optional chroma frames.
- Produces: `ChordEvent[]` with label, pitch classes, source bounds and confidence.

- [ ] **Step 1: Write chord tests**

```python
def test_c_major_from_pitch_classes() -> None:
    result = infer_chord({0: 1.0, 4: 0.9, 7: 0.8})
    assert result.label == "C"
    assert result.confidence > 0.8


def test_low_margin_returns_unknown() -> None:
    assert infer_chord({0: 0.4, 1: 0.4, 6: 0.4}).label == "N"
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/transcription-worker/tests/chords -q`  
Expected: FAIL because chord inference does not exist.

- [ ] **Step 3: Implement weighted templates and temporal smoothing**

Use root/third/seventh weights, lower repeated-fifth influence, permit labels only above a configurable winner margin, and change labels preferentially at beat boundaries.

- [ ] **Step 4: Pass chord tests**

Run: `pytest services/transcription-worker/tests/chords -q`  
Expected: major, minor, seventh, unknown and anti-flicker tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/transcription-worker/transcription/chords services/transcription-worker/tests/chords
git commit -m "feat: infer stable guitar chord track"
```

### Task 4: Select playable string/fret paths

**Files:**
- Create: `services/transcription-worker/transcription/fingering/tuning.py`
- Create: `services/transcription-worker/transcription/fingering/candidates.py`
- Create: `services/transcription-worker/transcription/fingering/beam_search.py`
- Create: `services/transcription-worker/transcription/fingering/costs.py`
- Test: `services/transcription-worker/tests/fingering/test_beam_search.py`

**Interfaces:**
- Consumes: timed notes, chord events, optional visual fret-position hints.
- Produces: ranked `FingeringPath[]`; each event has nullable string, fret and confidence.

- [ ] **Step 1: Write candidate and path tests**

```python
def test_e4_has_all_standard_tuning_positions() -> None:
    assert positions_for_pitch(64, STANDARD_TUNING, max_fret=20) == [(1, 0), (2, 5), (3, 9), (4, 14), (5, 19)]


def test_beam_prefers_small_position_change() -> None:
    paths = solve_fingering(two_phrase_fixture(), beam_width=8, keep=3)
    assert paths[0].total_shift_cost < paths[1].total_shift_cost
    assert len(paths) == 3
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/transcription-worker/tests/fingering -q`  
Expected: FAIL because tuning and beam search are undefined.

- [ ] **Step 3: Implement hard constraints and weighted costs**

```python
@dataclass(frozen=True)
class FingeringWeights:
    visual_position: float = 5.0
    chord_shape: float = 4.0
    position_shift: float = 3.0
    hand_span: float = 3.0
    common_finger: float = 2.0
    string_crossing: float = 1.5
    open_string: float = 1.0
```

Reject simultaneous conflicting frets on one string and unreachable pitch. Keep three ranked paths and normalize confidence from the score margin.

- [ ] **Step 4: Pass fingering tests**

Run: `pytest services/transcription-worker/tests/fingering -q`  
Expected: standard tuning, chord voicing, shift cost, visual hint and impossible-event tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/transcription-worker/transcription/fingering services/transcription-worker/tests/fingering
git commit -m "feat: solve playable guitar fingerings"
```

### Task 5: Compose and validate canonical score artifacts

**Files:**
- Create: `packages/score-model/src/compose.ts`
- Create: `packages/score-model/src/alphatab-adapter.ts`
- Create: `packages/score-model/test/compose.test.ts`
- Create: `services/transcription-worker/transcription/compose.py`
- Test: `services/transcription-worker/tests/test_compose.py`

**Interfaces:**
- Consumes: measures, note events, chords, ranked fingering paths.
- Produces: `score.json`, `timeline.audio.json`, and alphaTex render input.

- [ ] **Step 1: Write validation tests**

```python
def test_composed_events_are_inside_measure_and_duration() -> None:
    bundle = compose_audio_timeline(fixture_result(), course_id="c1", duration=20.0)
    assert all(0 <= e.sourceStart < e.sourceEnd <= 20 for e in bundle.performanceEvents)
    assert all(any(m.sourceStart <= e.sourceStart < m.sourceEnd for m in bundle.measures) for e in bundle.performanceEvents)
```

- [ ] **Step 2: Run and verify failure**

Run: `pytest services/transcription-worker/tests/test_compose.py -q`  
Expected: FAIL because composer does not exist.

- [ ] **Step 3: Implement artifact composition and alphaTab adapter**

The Python composer emits canonical JSON validated by generated Pydantic models. The TypeScript adapter accepts canonical score only and returns alphaTab input plus a map from canonical event ID to alphaTab beat ID.

- [ ] **Step 4: Run cross-language fixture verification**

Run: `pytest services/transcription-worker/tests/test_compose.py -q && pnpm --filter @guitar/score-model test`  
Expected: canonical fixture validates in both languages and event-ID mapping is complete.

- [ ] **Step 5: Commit**

```bash
git add packages/score-model services/transcription-worker
git commit -m "feat: compose canonical guitar score"
```

