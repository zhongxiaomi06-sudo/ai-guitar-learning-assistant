import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDeviceProfile } from '../src/shared/utils/device.js';

test('recognizes common phone user agents', () => {
  const iphone = detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
    maxTouchPoints: 5,
    viewportWidth: 390,
  });
  assert.equal(iphone.type, 'mobile');
  assert.equal(iphone.prefersLandscape, true);

  const android = detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36',
    maxTouchPoints: 5,
    viewportWidth: 412,
  });
  assert.equal(android.type, 'mobile');
});

test('distinguishes tablets including iPad desktop UA mode', () => {
  assert.equal(detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Safari/537.36',
    maxTouchPoints: 5,
    viewportWidth: 1024,
  }).type, 'tablet');

  assert.equal(detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15',
    maxTouchPoints: 5,
    viewportWidth: 1024,
  }).type, 'tablet');
});

test('keeps desktops desktop and uses touch fallback for reduced UAs', () => {
  assert.equal(detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    viewportWidth: 1440,
  }).type, 'desktop');

  assert.equal(detectDeviceProfile({
    userAgent: 'ReducedUA',
    maxTouchPoints: 5,
    coarsePointer: true,
    viewportWidth: 430,
  }).type, 'mobile');
});
