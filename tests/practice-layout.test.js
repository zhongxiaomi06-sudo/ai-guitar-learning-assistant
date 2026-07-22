import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readProjectFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = readProjectFile('index.html');
const css = readProjectFile('src/assets/css/product.css');
const app = readProjectFile('src/practice-app.js');
const mobilePrototype = readProjectFile('mobile-prototype.html');

test('practice workspace keeps the score and live feedback in one learning board', () => {
  assert.match(html, /class="practice-board"/);
  assert.match(html, /class="lesson-column"/);
  assert.match(html, /class="feedback-panel feedback-bar"/);
  assert.match(html, /data-feedback-bar/);
  assert.match(html, /data-feedback-target/);
  assert.match(css, /height:\s*calc\(100dvh - var\(--header-height\)\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) clamp\(/);
  assert.match(app, /classList\.toggle\('is-practice-stage', stage === 'practice'\)/);
  assert.match(css, /\.product-shell\.is-practice-stage \.topbar\s*{\s*display:\s*none/);
});

test('mobile practice view exposes teacher, left-hand, and right-hand modes', () => {
  for (const view of ['teacher', 'left', 'right']) {
    assert.match(html, new RegExp(`data-mobile-view="${view}"`));
    assert.match(css, new RegExp(`data-mobile-view="${view}"`));
  }
  assert.match(app, /case 'switch-mobile-view'/);
  assert.match(app, /setAttribute\('aria-pressed', String\(selected\)\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /orientation:\s*landscape/);
});

test('standalone mobile prototype includes every clickable practice stage', () => {
  for (const screen of ['upload', 'analysis', 'practice', 'focus', 'results']) {
    assert.match(mobilePrototype, new RegExp(`data-screen="${screen}"`));
  }
  for (const view of ['teacher', 'left', 'right']) {
    assert.match(mobilePrototype, new RegExp(`data-view="${view}"`));
  }
  assert.match(mobilePrototype, /data-settings-layer/);
  assert.match(mobilePrototype, /data-mic-layer/);
  assert.match(mobilePrototype, /function showScreen\(name\)/);
  assert.match(mobilePrototype, /async function openPractice\(\)/);
  assert.match(mobilePrototype, /screen\.orientation\.lock\('landscape'\)/);
  assert.match(mobilePrototype, /@media \(orientation: landscape\)/);
});
