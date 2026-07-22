import test from 'node:test';
import assert from 'node:assert/strict';

import {
  completenessScoreFor,
  pitchScoreFor,
  scorePracticeResults,
  timingScoreFor,
} from '../src/core/practice/scoring.js';

test('a perfect event receives full marks', () => {
  const result = {
    resultType: 'correct', score: 'perfect', detectedPitch: 64, pitchDeviation: 0, timingOffsetMs: 0,
  };
  assert.equal(pitchScoreFor(result), 100);
  assert.equal(timingScoreFor(result), 100);
  assert.equal(completenessScoreFor(result), 100);
  assert.equal(scorePracticeResults([result]).total, 100);
});

test('a silent missed target contributes zero instead of disappearing', () => {
  const miss = { resultType: 'miss', detectedPitch: null, timingOffsetMs: 0 };
  const score = scorePracticeResults([miss]);
  assert.equal(score.total, 0);
  assert.equal(score.missed, 1);
});

test('mixed results stay bounded and use chord events for completeness', () => {
  const score = scorePracticeResults([
    { resultType: 'correct', score: 'perfect', targetType: 'note', detectedPitch: 64, pitchDeviation: 5, timingOffsetMs: 15 },
    { resultType: 'correct', score: 'good', targetType: 'chord', detectedPitch: 60, pitchDeviation: 35, timingOffsetMs: 70 },
    { resultType: 'wrong-pitch', score: 'miss', targetType: 'chord', detectedPitch: 62, pitchDeviation: 120, timingOffsetMs: 30 },
    { resultType: 'miss', score: 'miss', targetType: 'note', detectedPitch: null, timingOffsetMs: 0 },
  ]);
  assert.equal(score.completeness, 60);
  assert.ok(score.total >= 0 && score.total <= 100);
  assert.equal(score.correct, 2);
  assert.equal(score.missed, 1);
});

test('timing quality falls continuously after the friendly tolerance', () => {
  const base = { resultType: 'correct', detectedPitch: 64 };
  assert.equal(timingScoreFor({ ...base, timingOffsetMs: 50 }), 100);
  assert.equal(timingScoreFor({ ...base, timingOffsetMs: 100 }), 70);
  assert.equal(timingScoreFor({ ...base, timingOffsetMs: 250 }), 0);
});
