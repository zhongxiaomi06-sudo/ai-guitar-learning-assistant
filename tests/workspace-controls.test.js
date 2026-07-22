import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cropForHand,
  dragHandCrop,
  normalizeHandCropOffsets,
  normalizePanelStates,
  overwriteLatestResult,
} from '../src/core/practice/workspace.js';

test('workspace panel preferences only accept known boolean flags', () => {
  const panels = normalizePanelStates({ video: true, hands: 1, timeline: false, unknown: true });

  assert.equal(panels.video, true);
  assert.equal(panels.hands, false);
  assert.equal(panels.timeline, false);
  assert.equal('unknown' in panels, false);
});

test('hand crop offsets are clamped inside the source video', () => {
  const offsets = normalizeHandCropOffsets({
    left: { x: 99, y: -99 },
    right: { x: -99, y: 99 },
  });
  const left = cropForHand('left', offsets.left);
  const right = cropForHand('right', offsets.right);

  assert.equal(left.x + left.width, 1);
  assert.equal(left.y, 0);
  assert.equal(right.x, 0);
  assert.equal(right.y + right.height, 1);
});

test('dragging a zoomed hand image moves its crop in the opposite direction', () => {
  const offset = dragHandCrop('left', { x: 0, y: 0 }, 0.25, -0.5);

  assert.ok(offset.x < 0);
  assert.ok(offset.y > 0);
});

test('the latest judgement overwrites the previous score for the same note', () => {
  const results = [{ targetId: 'note-1', resultType: 'wrong', eventScore: 20 }];

  overwriteLatestResult(results, { targetId: 'note-1', resultType: 'correct', eventScore: 100 });

  assert.deepEqual(results, [{ targetId: 'note-1', resultType: 'correct', eventScore: 100 }]);
});
