import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FocusStateMachine,
  FocusStage,
  SpeedAction,
  summarizeAttempt,
  DEFAULT_FOCUS_SPEEDS,
} from '../src/core/practice/stateMachine.js';

function makeResults(types) {
  return types.map((resultType) => ({ resultType, timingOffsetMs: 0 }));
}

test('summarizeAttempt counts correct/errors and timing errors', () => {
  const s = summarizeAttempt([
    { resultType: 'correct', timingOffsetMs: 10 },
    { resultType: 'wrong-pitch', timingOffsetMs: 0 },
    { resultType: 'miss', timingOffsetMs: 150 },
  ]);
  assert.equal(s.correct, 1);
  assert.equal(s.errors, 2);
  assert.equal(s.total, 3);
  assert.equal(s.timingErrors, 1);
  assert.ok(Math.abs(s.accuracy - 1 / 3) < 1e-9);
});

test('enter starts in WATCH_TEACHER and stores beforeStats', () => {
  const fsm = new FocusStateMachine();
  assert.equal(fsm.stage, FocusStage.IDLE);
  const stage = fsm.enter({ accuracy: 0.4 });
  assert.equal(stage, FocusStage.WATCH_TEACHER);
  assert.deepEqual(fsm.beforeStats, { accuracy: 0.4 });
  assert.equal(fsm.speedIndex, 0);
  assert.equal(fsm.attempts, 0);
});

test('startAttempt is only valid from WATCH_TEACHER or ANALYZING', () => {
  const fsm = new FocusStateMachine();
  // from IDLE → no transition
  assert.equal(fsm.startAttempt(), FocusStage.IDLE);
  fsm.enter();
  assert.equal(fsm.startAttempt(), FocusStage.COUNT_IN);
  // from COUNT_IN → no transition (must finishCountIn first)
  assert.equal(fsm.startAttempt(), FocusStage.COUNT_IN);
});

test('a full happy path: enter → count-in → listen → speed-up → passed', () => {
  const fsm = new FocusStateMachine({ speeds: [0.6, 0.75] });
  fsm.enter();
  fsm.startAttempt();
  assert.equal(fsm.finishCountIn(), FocusStage.LISTENING);
  // first speed passes
  let stage = fsm.finishLoop(makeResults(['correct', 'correct']));
  assert.equal(fsm.lastAction, SpeedAction.SPEED_UP);
  assert.equal(fsm.speedIndex, 1);
  assert.equal(stage, FocusStage.WATCH_TEACHER);
  // second speed passes → all done
  fsm.startAttempt();
  fsm.finishCountIn();
  stage = fsm.finishLoop(makeResults(['correct', 'correct']));
  assert.equal(fsm.lastAction, SpeedAction.PASSED);
  assert.equal(stage, FocusStage.PASSED);
  assert.equal(fsm.isPassed, true);
});

test('failing the loop with errors stays at same speed then slows down', () => {
  const fsm = new FocusStateMachine({ speeds: [0.6, 0.75, 0.9], slowDownAfter: 2 });
  fsm.enter();
  // attempt 1: fail, slowDownAfter=2 → retry same speed
  fsm.startAttempt();
  fsm.finishCountIn();
  fsm.finishLoop(makeResults(['wrong-pitch', 'miss']));
  assert.equal(fsm.lastAction, SpeedAction.RETRY);
  assert.equal(fsm.speedIndex, 0);
  assert.equal(fsm.attempts, 1);

  // attempt 2: fail again, now >= slowDownAfter but already at floor → retry
  fsm.startAttempt();
  fsm.finishCountIn();
  fsm.finishLoop(makeResults(['miss']));
  assert.equal(fsm.lastAction, SpeedAction.RETRY);
  assert.equal(fsm.speedIndex, 0);

  // climb to a higher speed so we can slow down
  fsm.speedIndex = 2;
  fsm.stage = FocusStage.LISTENING;
  fsm.finishLoop(makeResults(['miss', 'wrong-pitch']));
  assert.equal(fsm.lastAction, SpeedAction.SLOW_DOWN);
  assert.equal(fsm.speedIndex, 1);
  assert.equal(fsm.stage, FocusStage.WATCH_TEACHER);
});

test('passing requires requiredCorrect corrects and zero errors', () => {
  const fsm = new FocusStateMachine({ requiredCorrect: 2 });
  fsm.enter();
  fsm.startAttempt();
  fsm.finishCountIn();
  // 1 correct 1 error → not passed
  fsm.finishLoop(makeResults(['correct', 'wrong-pitch']));
  assert.equal(fsm.lastAction, SpeedAction.RETRY);
  assert.equal(fsm.speedIndex, 0);
  // 2 correct → passed at this speed (still has higher speeds)
  fsm.startAttempt();
  fsm.finishCountIn();
  fsm.finishLoop(makeResults(['correct', 'correct']));
  assert.equal(fsm.lastAction, SpeedAction.SPEED_UP);
});

test('finishLoop ignores calls outside LISTENING', () => {
  const fsm = new FocusStateMachine();
  fsm.enter();
  // not listening yet
  assert.equal(fsm.finishLoop(makeResults(['correct'])), FocusStage.WATCH_TEACHER);
  assert.equal(fsm.attempts, 0);
});

test('exit returns to IDLE and clears state but keeps config', () => {
  const fsm = new FocusStateMachine({ speeds: [0.5, 1] });
  fsm.enter();
  fsm.startAttempt();
  fsm.exit();
  assert.equal(fsm.stage, FocusStage.IDLE);
  assert.equal(fsm.attempts, 0);
  assert.equal(fsm.speeds.length, 2);
});

test('currentSpeed and speedStep track the active ladder rung', () => {
  const fsm = new FocusStateMachine();
  assert.equal(fsm.currentSpeed, DEFAULT_FOCUS_SPEEDS[0]);
  assert.equal(fsm.speedStep, 0);
  fsm.enter();
  fsm.speedIndex = 2;
  assert.equal(fsm.currentSpeed, DEFAULT_FOCUS_SPEEDS[2]);
  assert.equal(fsm.speedStep, 2);
});

test('canRetry is true in WATCH_TEACHER and ANALYZING, false otherwise', () => {
  const fsm = new FocusStateMachine();
  assert.equal(fsm.canRetry, false);
  fsm.enter();
  assert.equal(fsm.canRetry, true);
  fsm.startAttempt();
  assert.equal(fsm.canRetry, false); // COUNT_IN
  fsm.finishCountIn();
  assert.equal(fsm.canRetry, false); // LISTENING
});
