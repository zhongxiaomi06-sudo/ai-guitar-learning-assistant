import test from 'node:test';
import assert from 'node:assert/strict';

import { UserSimulator } from '../src/core/practice/simulator.js';
import { MatchingEngine } from '../src/core/matching/engine.js';
import { TimelineModel } from '../src/core/score/timelineModel.js';
import { midiToFreq } from '../src/shared/utils/index.js';

/**
 * 固定测试时间轴：每个音符都带 string/fret/pitch，
 * 同时被 UserSimulator.normalizeEvents 和 TimelineModel 接受。
 */
const TIMELINE = [
  { id: 'n1', type: 'note', startTime: 1.0, endTime: 1.4, string: 1, fret: 0, pitch: 64 }, // E4 329.63 Hz
  { id: 'n2', type: 'note', startTime: 2.0, endTime: 2.4, string: 2, fret: 1, pitch: 60 }, // C4 261.63 Hz
  { id: 'n3', type: 'note', startTime: 3.0, endTime: 3.4, string: 3, fret: 0, pitch: 55 }, // G3 196.00 Hz
  { id: 'n4', type: 'note', startTime: 4.0, endTime: 4.4, string: 4, fret: 2, pitch: 52 }, // E3 164.81 Hz
  { id: 'n5', type: 'note', startTime: 6.2, endTime: 6.6, string: 5, fret: 3, pitch: 48 }, // C3 130.81 Hz
];

function makeEngine() {
  return new MatchingEngine(new TimelineModel(TIMELINE));
}

test('TimelineModel exposes the same notes collection used by player scoring', () => {
  const model = new TimelineModel(TIMELINE);

  assert.equal(model.notes, model.noteEvents);
  assert.equal(model.notes.length, TIMELINE.length);
  assert.ok(model.notes.every((note) => Number.isFinite(note.endTime)));
});

test('TimelineModel keeps display metadata when simultaneous notes form a chord', () => {
  const model = new TimelineModel([
    { ...TIMELINE[0], id: 'am-1', chord: 'Am', leftHandShape: { type: 'chord' }, rightHandShape: { direction: 'down' } },
    { ...TIMELINE[0], id: 'am-2', string: 2, fret: 1, pitch: 60, chord: 'Am' },
  ]);

  const chord = model.getNoteAtTime(1.05);
  assert.equal(chord.type, 'chord');
  assert.equal(chord.chord, 'Am');
  assert.equal(chord.notes.length, 2);
  assert.deepEqual(chord.leftHandShape, { type: 'chord' });
  assert.deepEqual(chord.rightHandShape, { direction: 'down' });
});

/**
 * 用一个全新模拟器在指定视频时间产生一次检测，并交给匹配引擎判定。
 * 模拟 product-app.playerFrame 的调用方式：getDetection(playerTime) → match(playerTime, playedNote)。
 * 每次调用都创建全新实例，避免 triggered 集合跨用例污染。
 */
function judgeOnce(mode, videoTime) {
  const sim = new UserSimulator(TIMELINE, mode);
  const engine = makeEngine();
  const detection = sim.getDetection(videoTime);
  if (!detection.onset) return { detection, result: null };
  const result = engine.match(videoTime, {
    pitch: detection.pitch.frequency,
    rms: detection.rms,
    onsetTime: detection.onsetTime,
  });
  return { detection, result };
}

test('UserSimulator fires nothing before a note starts or after the fire window', () => {
  const sim = new UserSimulator(TIMELINE, 'perfect');
  assert.equal(sim.nextNote(0.5), null, 'before n1 starts → null');
  assert.equal(sim.nextNote(0.99), null, 'just before n1 start → null');
  assert.ok(sim.nextNote(1.0), 'at n1 start → fires');
  assert.equal(sim.nextNote(1.05), null, 'n1 already triggered → null');
  // n2 的触发窗口是 [2.0, 2.25]，2.30 已过
  assert.equal(sim.nextNote(2.3), null, 'past n2 fire window → null');
});

test('perfect mode produces correct/perfect results with zero timing deviation', () => {
  // 用同一模拟器连续触发两个音符，验证多音符场景
  const sim = new UserSimulator(TIMELINE, 'perfect');
  const engine = makeEngine();

  const d1 = sim.getDetection(1.0);
  assert.equal(d1.onset, true);
  assert.ok(Math.abs(d1.pitch.frequency - midiToFreq(64)) < 1e-6);
  assert.equal(d1.onsetTime, 1.0);
  const r1 = engine.match(1.0, { pitch: d1.pitch.frequency, rms: d1.rms, onsetTime: d1.onsetTime });
  assert.equal(r1.type, 'correct');
  assert.equal(r1.score, 'perfect');
  assert.ok(Math.abs(r1.timingDeviation) < 1e-6);
  assert.ok(Math.abs(r1.pitchDeviation) < 1e-6);

  const d2 = sim.getDetection(2.0);
  const r2 = engine.match(2.0, { pitch: d2.pitch.frequency, rms: d2.rms, onsetTime: d2.onsetTime });
  assert.equal(r2.type, 'correct');
  assert.equal(r2.score, 'perfect');
});

test('miss mode never fires a note and reports a silent detection', () => {
  const sim = new UserSimulator(TIMELINE, 'miss');
  for (const t of [1.0, 2.0, 3.0, 4.0, 6.2]) {
    assert.equal(sim.nextNote(t), null, `miss at ${t} → null`);
  }
  const detection = sim.getDetection(1.0);
  assert.equal(detection.onset, false);
  assert.equal(detection.rms, 0);
  assert.equal(detection.pitch.frequency, 0);
  assert.equal(sim.modeLabel, '全程漏音');
});

test('late50 shifts onset forward by 50 ms and stays correct', () => {
  const { detection, result } = judgeOnce('late50', 1.0);
  assert.equal(detection.onset, true);
  assert.ok(Math.abs(detection.onsetTime - 1.05) < 1e-9, `got ${detection.onsetTime}`);
  // 50 ms 落在 PERFECT_TIME 边界，浮点误差使其略大于 50 → good 而非 perfect，但仍为 correct
  assert.equal(result.type, 'correct');
  assert.ok(Math.abs(result.timingDeviation - 50) < 1e-3, `got ${result.timingDeviation}`);
});

test('late100 sits at the GOOD_TIME boundary and is treated as a rhythm miss', () => {
  const { result } = judgeOnce('late100', 1.0);
  // 0.10 s → 100.00000000000009 ms，因浮点误差超过 GOOD_TIME(100) 阈值
  assert.equal(result.type, 'miss');
  assert.ok(Math.abs(result.timingDeviation - 100) < 1e-3, `got ${result.timingDeviation}`);
});

test('late200 is clearly flagged as a rhythm miss', () => {
  const { result } = judgeOnce('late200', 1.0);
  assert.equal(result.type, 'miss');
  assert.ok(Math.abs(result.timingDeviation - 200) < 1e-3, `got ${result.timingDeviation}`);
});

test('early50 shifts onset backward by 50 ms and stays correct', () => {
  const { detection, result } = judgeOnce('early50', 1.0);
  assert.ok(Math.abs(detection.onsetTime - 0.95) < 1e-9, `got ${detection.onsetTime}`);
  assert.equal(result.type, 'correct');
  assert.ok(Math.abs(result.timingDeviation + 50) < 1e-3, `got ${result.timingDeviation}`);
});

test('wrong@<time> pitches the matching note one semitone up and is flagged wrong-pitch', () => {
  const { detection, result } = judgeOnce('wrong@6.2', 6.2);
  assert.ok(detection.onset, 'n5 fires at 6.2');
  assert.ok(Math.abs(detection.pitch.frequency - midiToFreq(49)) < 1e-6, 'pitch shifted +1 semitone');
  assert.equal(result.type, 'wrong-pitch');
  assert.ok(result.pitchDeviation > 50, `got ${result.pitchDeviation}`);

  // 其他音符不受影响
  const other = judgeOnce('wrong@6.2', 1.0);
  assert.equal(other.result.type, 'correct');
  assert.ok(Math.abs(other.detection.pitch.frequency - midiToFreq(64)) < 1e-6);
});

test('wrong@id=<id> only wrongs the named event', () => {
  const { detection, result } = judgeOnce('wrong@id=n3', 3.0);
  assert.equal(result.type, 'wrong-pitch');
  assert.ok(Math.abs(detection.pitch.frequency - midiToFreq(56)) < 1e-6, 'n3 shifted +1 semitone');

  const untouched = judgeOnce('wrong@id=n3', 1.0);
  assert.equal(untouched.result.type, 'correct');
});

test('jitter mode keeps deviations within the deterministic ±30 ms band', () => {
  for (const event of TIMELINE) {
    const { result } = judgeOnce('jitter', event.startTime);
    assert.equal(result.type, 'correct', `${event.id} should stay correct under jitter`);
    assert.ok(Math.abs(result.timingDeviation) <= 30, `${event.id} dev ${result.timingDeviation} out of band`);
  }
  // 同一事件两次运行的抖动必须一致（确定性）
  const a = new UserSimulator(TIMELINE, 'jitter').getDetection(1.0).onsetTime;
  const b = new UserSimulator(TIMELINE, 'jitter').getDetection(1.0).onsetTime;
  assert.equal(a, b);
});

test('partial mode deterministically skips a subset of notes', () => {
  const ids = TIMELINE.map((e) => e.id);

  function firedIds() {
    const sim = new UserSimulator(TIMELINE, 'partial');
    const fired = [];
    for (const event of TIMELINE) {
      const note = sim.nextNote(event.startTime);
      if (note) fired.push(note.targetId);
    }
    return fired;
  }

  const first = firedIds();
  const second = firedIds();
  // 确定性：两次运行结果完全一致
  assert.deepEqual(first, second);
  // 漏掉一部分，但不是全部
  assert.ok(first.length > 0, 'partial should still fire some notes');
  assert.ok(first.length < ids.length, 'partial should skip at least one note');
  // 触发的都是合法音符 id
  for (const id of first) assert.ok(ids.includes(id));
});

test('reset allows already-triggered events to fire again', () => {
  const sim = new UserSimulator(TIMELINE, 'perfect');
  assert.ok(sim.nextNote(1.0));
  assert.equal(sim.nextNote(1.0), null, 'cannot retrigger before reset');
  sim.reset();
  const again = sim.nextNote(1.0);
  assert.ok(again, 'after reset the note fires again');
  assert.equal(again.onsetTime, 1.0);
});

test('getDetection carries onsetTime and stays GuitarDetector-compatible when idle', () => {
  const sim = new UserSimulator(TIMELINE, 'perfect');
  const fired = sim.getDetection(1.0);
  assert.equal(fired.onset, true);
  assert.equal(fired.rms, 0.08);
  assert.equal(fired.onsetTime, 1.0);
  assert.ok(fired.pitch.confidence >= 0.65);

  const idle = sim.getDetection(0.5);
  assert.equal(idle.onset, false);
  assert.equal(idle.rms, 0);
  assert.equal(idle.pitch.frequency, 0);
  assert.equal('onsetTime' in idle, false, 'idle detection has no onsetTime');
});

test('UserSimulator is a drop-in GuitarDetector substitute (stop / isListening)', () => {
  const sim = new UserSimulator(TIMELINE, 'perfect');
  assert.equal(sim.isListening, true);
  assert.doesNotThrow(() => sim.stop());
  // stop 不影响后续检测能力
  assert.ok(sim.getDetection(1.0).onset, 'still functional after stop()');
});

test('normalizeEvents tolerates missing pitch and filters invalid entries', () => {
  const mixed = [
    { id: 'ok1', type: 'note', startTime: 1.0, endTime: 1.3, string: 1, fret: 0 }, // 无 pitch → 由弦品推算
    { id: 'bad-string', type: 'note', startTime: 2.0, string: 9, fret: 0 }, // 弦号非法
    { id: 'bad-fret', type: 'note', startTime: 3.0, string: 2, fret: -1 }, // 品位非法
    { id: 'ok2', type: 'note', startTime: 4.0, string: 6, fret: 0, pitch: 40 }, // 低音 E
  ];
  const sim = new UserSimulator(mixed, 'perfect');
  const n1 = sim.nextNote(1.0);
  assert.ok(n1, 'ok1 fires');
  assert.ok(Math.abs(n1.pitch - midiToFreq(64)) < 1e-6, 'pitch derived from string+fret');
  assert.equal(sim.nextNote(2.0), null, 'bad-string skipped');
  assert.equal(sim.nextNote(3.0), null, 'bad-fret skipped');
  const n2 = sim.nextNote(4.0);
  assert.ok(n2, 'ok2 fires');
  assert.ok(Math.abs(n2.pitch - midiToFreq(40)) < 1e-6);
});

test('modeLabel returns a human-readable label for known modes', () => {
  assert.equal(new UserSimulator(TIMELINE, 'perfect').modeLabel, '完美演奏');
  assert.equal(new UserSimulator(TIMELINE, 'late200').modeLabel, '晚 200 ms');
  assert.match(new UserSimulator(TIMELINE, 'wrong@6.2').modeLabel, /模拟模式/);
});
