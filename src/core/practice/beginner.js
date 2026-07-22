export const BEGINNER_STEP_COUNT = 6;

export function normalizeBeginnerStep(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(BEGINNER_STEP_COUNT - 1, parsed));
}

export function moveBeginnerStep(current, delta) {
  return normalizeBeginnerStep(normalizeBeginnerStep(current) + Number(delta || 0));
}

export function beginnerProgress(step) {
  const index = normalizeBeginnerStep(step);
  return {
    current: index + 1,
    total: BEGINNER_STEP_COUNT,
    percent: Math.round(((index + 1) / BEGINNER_STEP_COUNT) * 100),
    isFirst: index === 0,
    isLast: index === BEGINNER_STEP_COUNT - 1,
  };
}
