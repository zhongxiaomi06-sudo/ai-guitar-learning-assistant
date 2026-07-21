import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioAnalyzer } from '../src/core/audio/analyzer.js';
import { GuitarDetector } from '../src/core/audio/detector.js';

function createAudioContext(sampleRate = 48000, state = 'running') {
  const sources = [];
  const analyserNode = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 0,
    getFloatFrequencyData() {},
    getFloatTimeDomainData(target) {
      target.fill(0);
    },
  };

  const context = {
    sampleRate,
    currentTime: 12.5,
    state,
    resumeCalls: 0,
    createAnalyser() {
      return analyserNode;
    },
    createMediaStreamSource(stream) {
      const source = {
        stream,
        connectCalls: 0,
        disconnectCalls: 0,
        connect() {
          this.connectCalls += 1;
        },
        disconnect() {
          this.disconnectCalls += 1;
        },
      };
      sources.push(source);
      return source;
    },
    async resume() {
      this.resumeCalls += 1;
      this.state = 'running';
    },
  };

  return { context, analyserNode, sources };
}

function createStream(name) {
  const track = {
    name,
    stopCalls: 0,
    stop() {
      this.stopCalls += 1;
    },
  };
  return {
    stream: {
      active: true,
      getTracks: () => [track],
    },
    track,
  };
}

function createTone(frequency, sampleRate, length, harmonics = [[1, 1]]) {
  return Float32Array.from({ length }, (_, index) => harmonics.reduce(
    (sample, [multiple, amplitude]) => sample
      + amplitude * Math.sin((2 * Math.PI * frequency * multiple * index) / sampleRate),
    0,
  ));
}

function centsBetween(actual, expected) {
  return Math.abs(1200 * Math.log2(actual / expected));
}

test('AudioAnalyzer chooses a buffer large enough for low E at high sample rates', () => {
  const normal = createAudioContext(48000);
  const highRate = createAudioContext(96000);

  const normalAnalyzer = new AudioAnalyzer(normal.context);
  const highRateAnalyzer = new AudioAnalyzer(highRate.context);

  assert.equal(normalAnalyzer.analyser.fftSize, 2048);
  assert.equal(highRateAnalyzer.analyser.fftSize, 4096);
});

test('YIN detects guitar range boundaries without NaN or half-frequency errors', () => {
  const { context } = createAudioContext(48000);
  const analyzer = new AudioAnalyzer(context);

  for (const expected of [70, 82.41, 110, 146.83, 196, 246.94, 329.63, 1000]) {
    const buffer = createTone(expected, context.sampleRate, analyzer.buffer.length, [[1, 0.2]]);
    const result = analyzer.yinPitchDetect(buffer, context.sampleRate);

    assert.ok(Number.isFinite(result.frequency), `${expected} Hz returned a finite frequency`);
    assert.ok(result.frequency > 0, `${expected} Hz was detected`);
    assert.ok(
      centsBetween(result.frequency, expected) < 5,
      `${expected} Hz was not folded to an octave: received ${result.frequency}`,
    );
    assert.ok(result.confidence > 0.8, `${expected} Hz has useful confidence`);
  }
});

test('YIN detects low E at 96 kHz and a harmonic-rich guitar-like tone', () => {
  const { context } = createAudioContext(96000);
  const analyzer = new AudioAnalyzer(context);
  const lowE = createTone(82.41, context.sampleRate, analyzer.buffer.length, [[1, 0.2]]);
  const harmonicTone = createTone(110, context.sampleRate, analyzer.buffer.length, [
    [1, 0.08],
    [2, 0.2],
    [3, 0.05],
  ]);

  const lowEResult = analyzer.yinPitchDetect(lowE, context.sampleRate);
  const harmonicResult = analyzer.yinPitchDetect(harmonicTone, context.sampleRate);

  assert.ok(centsBetween(lowEResult.frequency, 82.41) < 5);
  assert.ok(centsBetween(harmonicResult.frequency, 110) < 5);
});

test('YIN returns a consistent empty result for a non-periodic degenerate buffer', () => {
  const { context } = createAudioContext(48000);
  const analyzer = new AudioAnalyzer(context);
  const constantSignal = new Float32Array(analyzer.buffer.length).fill(0.2);

  assert.deepEqual(
    analyzer.yinPitchDetect(constantSignal, context.sampleRate),
    { frequency: 0, confidence: 0 },
  );
});

test('GuitarDetector start is idempotent and switching streams releases the old source', async () => {
  const { context, sources } = createAudioContext();
  const detector = new GuitarDetector(context);
  const first = createStream('first');
  const second = createStream('second');

  await detector.start(first.stream);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].connectCalls, 1);
  assert.equal(detector.isListening, true);

  await detector.start(first.stream);
  assert.equal(sources.length, 1, 'same-stream start does not create a duplicate source');
  assert.equal(first.track.stopCalls, 0);

  detector.prevRms = 0.5;
  await detector.start(second.stream);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].disconnectCalls, 1);
  assert.equal(first.track.stopCalls, 1);
  assert.equal(detector.prevRms, 0);

  detector.stop();
  assert.equal(sources[1].disconnectCalls, 1);
  assert.equal(second.track.stopCalls, 1);
  assert.equal(detector.isListening, false);

  detector.stop();
  assert.equal(sources[1].disconnectCalls, 1, 'repeated stop is safe');
  assert.equal(second.track.stopCalls, 1, 'tracks are stopped once');
});

test('GuitarDetector resumes a suspended context and analyzes one coherent frame', async () => {
  const { context } = createAudioContext(48000, 'suspended');
  const detector = new GuitarDetector(context);
  const input = createStream('input');
  const calls = [];
  detector.analyzer = {
    connect(source) {
      source.connect({});
    },
    analyzeFrame(threshold, prevRms) {
      calls.push({ threshold, prevRms });
      return {
        pitch: { frequency: 220, midi: 57, confidence: 0.95 },
        onset: true,
        rms: 0.08,
      };
    },
  };

  await detector.start(input.stream);
  const detection = detector.getDetection();

  assert.equal(context.resumeCalls, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { threshold: 0.02, prevRms: 0 });
  assert.deepEqual(detection, {
    time: 12.5,
    pitch: { frequency: 220, midi: 57, confidence: 0.95 },
    onset: true,
    rms: 0.08,
  });
  assert.equal(detector.prevRms, 0.08);
});

test('GuitarDetector is neutral while stopped and cleans up failed connections', async () => {
  const { context } = createAudioContext();
  const detector = new GuitarDetector(context);
  detector.analyzer = {
    connect() {
      throw new Error('connect failed');
    },
    analyzeFrame() {
      throw new Error('must not analyze while stopped');
    },
  };
  const input = createStream('failed');

  await assert.rejects(detector.start(input.stream), /connect failed/);
  assert.equal(input.track.stopCalls, 1);
  assert.equal(detector.isListening, false);
  assert.deepEqual(detector.getDetection(), {
    time: 12.5,
    pitch: { frequency: 0, midi: 0, confidence: 0 },
    onset: false,
    rms: 0,
  });
});
