import test from 'node:test';
import assert from 'node:assert/strict';

import { API_BASE, ApiError, courses } from '../src/shared/utils/api.js';

test('production-like API client defaults to same-origin and encodes course ids', () => {
  assert.equal(API_BASE, '');
  assert.equal(courses.getVideoUrl('course/with spaces'), '/api/v1/courses/course%2Fwith%20spaces/video');
});

test('course delete accepts an empty 204 response', async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(await courses.delete('safe/id'), null);
    assert.equal(request.url, '/api/v1/courses/safe%2Fid');
    assert.equal(request.options.method, 'DELETE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('course parse uses an encoded id and POST method', async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: 'course/id', status: 'processing' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const course = await courses.parse('course/id');
    assert.equal(course.status, 'processing');
    assert.equal(request.url, '/api/v1/courses/course%2Fid/parse');
    assert.equal(request.options.method, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API errors preserve backend status and detail', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Invalid course' }), {
    status: 422,
    headers: { 'content-type': 'application/json' },
  });
  try {
    await assert.rejects(courses.get('bad'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.equal(error.detail, 'Invalid course');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
