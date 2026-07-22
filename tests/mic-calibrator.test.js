import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MicCalibrator,
  percentile,
  computeThreshold,
  estimateLatency,
  classifyEnvironment,
  DEFAULT_ONSET_THRESHOLD,
  NOISE_TOO_HIGH,
  LATENCY_TOO_HIGH,
} from '../src/core/audio/calibrator.js';

test('percentile returns 0 for empty input and handles single values', () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([42], 0.5), 42);
});

test('percentile interpolates linearly between samples', () => {
  // 0..10, median (p=0.5) at index 5 → 5
  const vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(vals, 0.5), 5);
  // p=0.25 at index 2.5 → 2.5
  assert.ok(Math.abs(percentile(vals, 0.25) - 2.5) < 1e-9);
  // p=0 → min, p=1 → max
  assert.equal(percentile(vals, 0), 0);
  assert.equal(percentile(vals, 1), 10);
});

test('percentile ignores non-finite values', () => {
  assert.equal(percentile([1, NaN, 3, undefined, 5], 0.5), 3);
});

test('computeThreshold falls back to default when noise is low/zero', () => {
  assert.equal(computeThreshold(0), DEFAULT_ONSET_THRESHOLD);
  assert.equal(computeThreshold(0.001), DEFAULT_ONSET_THRESHOLD);
});

test('computeThreshold scales noise floor by 2.5x when noisy', () => {
  // 0.03 * 2.5 = 0.075 > default 0.02
  assert.ok(Math.abs(computeThreshold(0.03) - 0.075) < 1e-9);
  assert.ok(computeThreshold(0.03) > DEFAULT_ONSET_THRESHOLD);
});

test('estimateLatency reads baseLatency + outputLatency from the context', () => {
  assert.equal(estimateLatency(null), 0);
  assert.equal(estimateLatency({ baseLatency: 0.01 }), 0.01);
  assert.equal(estimateLatency({ baseLatency: 0.01, outputLatency: 0.02 }), 0.03);
  // outputLatency missing (older browsers) → only base
  assert.equal(estimateLatency({ baseLatency: 0.02 }), 0.02);
});

test('classifyEnvironment reports ok when everything is clean', () => {
  const r = classifyEnvironment({ noiseFloor: 0.005, guitarRms: 0.05, latencyOffset: 0.02 });
  assert.equal(r.level, 'ok');
  assert.equal(r.warnings.length, 0);
});

test('classifyEnvironment warns on noise, quiet guitar, and high latency', () => {
  const r = classifyEnvironment({ noiseFloor: NOISE_TOO_HIGH + 0.001, guitarRms: 0.005, latencyOffset: LATENCY_TOO_HIGH + 0.001 });
  assert.equal(r.level, 'warn');
  assert.ok(r.warnings.length >= 3, `expected >=3 warnings, got ${r.warnings.length}`);
});

test('classifyEnvironment does not warn when guitar is silent (0) because no guitar detected yet', () => {
  const r = classifyEnvironment({ noiseFloor: 0.005, guitarRms: 0, latencyOffset: 0.02 });
  assert.equal(r.level, 'ok');
});

test('MicCalibrator.measureEnvironment uses a stub analyzer and computes noise floor', async () => {
  // Stub analyzer returning a deterministic RMS sequence.
  let calls = 0;
  const stub = {
    analyzeFrame() {
      calls += 1;
      // cycle through a few values to simulate noise + one spike
      const seq = [0.01, 0.012, 0.011, 0.05, 0.013, 0.01, 0.012, 0.011, 0.01, 0.012];
      const rms = seq[(calls - 1) % seq.length];
      return { rms, onset: rms > 0.04 };
    },
  };
  const calibrator = new MicCalibrator(stub);
  // durationMs below the 500ms floor still runs ~500ms with 40ms ticks (~12 frames).
  // This keeps the test under a second while exercising the real polling path.
  const result = await calibrator.measureEnvironment(1);
  assert.ok(Number.isFinite(result.noiseFloor));
  assert.ok(Number.isFinite(result.threshold));
  assert.ok(result.threshold >= DEFAULT_ONSET_THRESHOLD);
  assert.ok(calls > 0);
});

test('MicCalibrator.setLatency clamps to non-negative numbers', () => {
  const c = new MicCalibrator({ analyzeFrame: () => ({ rms: 0, onset: false }) });
  c.setLatency(-0.05);
  assert.equal(c.latencyOffset, 0);
  c.setLatency('0.03');
  assert.ok(Math.abs(c.latencyOffset - 0.03) < 1e-9);
});
