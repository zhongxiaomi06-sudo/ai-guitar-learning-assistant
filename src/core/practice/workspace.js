export const PANEL_IDS = ['video', 'hands', 'left', 'right', 'timeline', 'feedback'];

export const DEFAULT_HAND_CROPS = Object.freeze({
  left: Object.freeze({ x: 0.705, y: 0.45, width: 0.24, height: 0.36 }),
  right: Object.freeze({ x: 0.14, y: 0.45, width: 0.28, height: 0.34 }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function normalizePanelStates(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(PANEL_IDS.map((id) => [id, source[id] === true]));
}

export function normalizeHandCropOffsets(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    left: normalizeHandCropOffset('left', source.left),
    right: normalizeHandCropOffset('right', source.right),
  };
}

export function normalizeHandCropOffset(hand, value) {
  const crop = DEFAULT_HAND_CROPS[hand] || DEFAULT_HAND_CROPS.left;
  const source = value && typeof value === 'object' ? value : {};
  return {
    x: clamp(source.x, -crop.x, 1 - crop.width - crop.x),
    y: clamp(source.y, -crop.y, 1 - crop.height - crop.y),
  };
}

export function cropForHand(hand, offset) {
  const crop = DEFAULT_HAND_CROPS[hand] || DEFAULT_HAND_CROPS.left;
  const safeOffset = normalizeHandCropOffset(hand, offset);
  return {
    ...crop,
    x: crop.x + safeOffset.x,
    y: crop.y + safeOffset.y,
  };
}

export function dragHandCrop(hand, startOffset, deltaXRatio, deltaYRatio) {
  const crop = DEFAULT_HAND_CROPS[hand] || DEFAULT_HAND_CROPS.left;
  return normalizeHandCropOffset(hand, {
    x: (Number(startOffset?.x) || 0) - (Number(deltaXRatio) || 0) * crop.width,
    y: (Number(startOffset?.y) || 0) - (Number(deltaYRatio) || 0) * crop.height,
  });
}

export function overwriteLatestResult(collection, record) {
  const results = Array.isArray(collection) ? collection : [];
  const existingIndex = results.findIndex((result) => result.targetId === record?.targetId);
  if (existingIndex >= 0) results.splice(existingIndex, 1);
  results.push(record);
  return results;
}
