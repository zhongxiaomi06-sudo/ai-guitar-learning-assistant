import test from 'node:test';
import assert from 'node:assert/strict';

import { MatchingEngine } from '../src/core/matching/engine.js';
import { VideoFetcher } from '../src/core/video/fetcher.js';
import { API_BASE, courses } from '../src/shared/utils/api.js';

function withNavigator(value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
      else delete globalThis.navigator;
    });
}

test('MatchingEngine uses 1st-string high E and reports real millisecond deviations', () => {
  const target = {
    id: 'note-e4',
    type: 'single',
    string: 1,
    fret: 0,
    startTime: 1,
    endTime: 1.5,
  };
  const engine = new MatchingEngine({ getNoteAtTime: () => target });
  const result = engine.match(1.04, {
    pitch: 329.63,
    velocity: 0.08,
    onsetTime: 1.04,
  });

  assert.equal(result.type, 'correct');
  assert.equal(result.score, 'perfect');
  assert.ok(Math.abs(result.pitchDeviation) < 1);
  assert.ok(Math.abs(result.timingDeviation - 40) < 0.001);
});

test('MatchingEngine accepts rms/velocity energy and rejects late notes', () => {
  const target = {
    id: 'note-e2',
    type: 'single',
    string: 6,
    fret: 0,
    startTime: 2,
    endTime: 2.5,
  };
  const engine = new MatchingEngine({ getNoteAtTime: () => target });

  assert.equal(engine.match(2, {
    pitch: 82.41,
    rms: 0,
    onsetTime: 2,
  }).type, 'miss');

  const late = engine.match(2.2, {
    pitch: 82.41,
    rms: 0.08,
    onsetTime: 2.2,
  });
  assert.equal(late.type, 'miss');
  assert.ok(Math.abs(late.timingDeviation - 200) < 0.001);
});

test('VideoFetcher releases the temporary permission stream after enumeration', async () => {
  let stops = 0;
  const permissionStream = {
    getTracks: () => [{ stop: () => { stops += 1; } }],
  };
  const devices = [
    { kind: 'audioinput', deviceId: 'mic-1' },
    { kind: 'videoinput', deviceId: 'cam-1' },
  ];

  await withNavigator({
    mediaDevices: {
      getUserMedia: async () => permissionStream,
      enumerateDevices: async () => devices,
    },
  }, async () => {
    assert.deepEqual(await VideoFetcher.enumerateAudioDevices(), [devices[0]]);
  });
  assert.equal(stops, 1);
});

test('production API fallback is same-origin and course ids are encoded', async () => {
  assert.equal(API_BASE, '');
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(await courses.delete('course/with space'), null);
    assert.equal(requestUrl, '/api/v1/courses/course%2Fwith%20space');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
