import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BEGINNER_STEP_COUNT,
  beginnerProgress,
  moveBeginnerStep,
  normalizeBeginnerStep,
} from '../src/core/practice/beginner.js';

test('beginner tutorial clamps invalid and out-of-range steps', () => {
  assert.equal(normalizeBeginnerStep('not-a-step'), 0);
  assert.equal(normalizeBeginnerStep(-5), 0);
  assert.equal(normalizeBeginnerStep(99), BEGINNER_STEP_COUNT - 1);
});

test('beginner tutorial navigation never leaves its six required lessons', () => {
  assert.equal(moveBeginnerStep(0, -1), 0);
  assert.equal(moveBeginnerStep(2, 1), 3);
  assert.equal(moveBeginnerStep(BEGINNER_STEP_COUNT - 1, 1), BEGINNER_STEP_COUNT - 1);
});

test('beginner tutorial progress exposes first and final states', () => {
  assert.deepEqual(beginnerProgress(0), {
    current: 1,
    total: 6,
    percent: 17,
    isFirst: true,
    isLast: false,
  });
  assert.deepEqual(beginnerProgress(5), {
    current: 6,
    total: 6,
    percent: 100,
    isFirst: false,
    isLast: true,
  });
});
