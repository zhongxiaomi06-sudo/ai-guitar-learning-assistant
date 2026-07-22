/**
 * core/practice/stateMachine.js
 * 专项纠错状态机：驱动「观看老师 → 倒数 → 聆听 → 分析 → 重试/降速/提速/通过」的流转。
 *
 * 该模块为纯逻辑，不触碰 DOM 或定时器，便于在 node:test 中验证迁移合法性。
 * 调用方（product-app.js）负责把 stage 映射到 UI 显隐、倒计时与播放循环。
 */

export const FocusStage = Object.freeze({
  IDLE: 'idle',
  WATCH_TEACHER: 'watch',
  COUNT_IN: 'count-in',
  LISTENING: 'listening',
  ANALYZING: 'analyzing',
  PASSED: 'passed',
});

export const SpeedAction = Object.freeze({
  RETRY: 'retry',
  SLOW_DOWN: 'slow-down',
  SPEED_UP: 'speed-up',
  PASSED: 'passed',
});

export const DEFAULT_FOCUS_SPEEDS = Object.freeze([0.6, 0.75, 0.9, 1.0]);
export const DEFAULT_REQUIRED_CORRECT = 2;
export const DEFAULT_SLOW_DOWN_AFTER_ATTEMPTS = 2;

/**
 * 把一轮练习结果聚合为可比较的指标。
 * @param {Array<{ resultType?: string, timingOffsetMs?: number }>} results
 * @returns {{ correct: number, errors: number, total: number, accuracy: number, timingErrors: number }}
 */
export function summarizeAttempt(results) {
  const list = Array.isArray(results) ? results : [];
  const total = list.length;
  const correct = list.filter((r) => r.resultType === 'correct').length;
  const errors = list.filter((r) => r.resultType && r.resultType !== 'correct').length;
  const timingErrors = list.filter(
    (r) => Math.abs(Number(r.timingOffsetMs) || 0) > 100 && r.resultType !== 'correct',
  ).length;
  const accuracy = total > 0 ? correct / total : 0;
  return { correct, errors, total, accuracy, timingErrors };
}

export class FocusStateMachine {
  /**
   * @param {{ speeds?: number[], requiredCorrect?: number, slowDownAfter?: number }} [options]
   */
  constructor(options = {}) {
    this.speeds = Array.isArray(options.speeds) && options.speeds.length
      ? [...options.speeds]
      : [...DEFAULT_FOCUS_SPEEDS];
    this.requiredCorrect = Number.isFinite(options.requiredCorrect) && options.requiredCorrect > 0
      ? Math.round(options.requiredCorrect)
      : DEFAULT_REQUIRED_CORRECT;
    this.slowDownAfter = Number.isFinite(options.slowDownAfter) && options.slowDownAfter > 0
      ? Math.round(options.slowDownAfter)
      : DEFAULT_SLOW_DOWN_AFTER_ATTEMPTS;
    this.reset();
  }

  /** 重置到 IDLE，保留配置。 */
  reset() {
    this.stage = FocusStage.IDLE;
    this.speedIndex = 0;
    this.attempts = 0;
    this.consecutiveCorrect = 0;
    this.lastAction = null;
    this.beforeStats = null;
    this.afterStats = null;
    return this;
  }

  /** 进入纠错：记录「前」指标，进入 WATCH_TEACHER。 */
  enter(beforeStats = null) {
    this.reset();
    this.stage = FocusStage.WATCH_TEACHER;
    this.beforeStats = beforeStats;
    return this.stage;
  }

  /** 退出纠错。 */
  exit() {
    this.reset();
    return this.stage;
  }

  /** 开始一次尝试：WATCH_TEACHER/ANALYZING → COUNT_IN。 */
  startAttempt() {
    if (this.stage !== FocusStage.WATCH_TEACHER && this.stage !== FocusStage.ANALYZING) {
      return this.stage;
    }
    this.stage = FocusStage.COUNT_IN;
    this.consecutiveCorrect = 0;
    return this.stage;
  }

  /** 倒数结束：COUNT_IN → LISTENING。 */
  finishCountIn() {
    if (this.stage !== FocusStage.COUNT_IN) return this.stage;
    this.stage = FocusStage.LISTENING;
    return this.stage;
  }

  /**
   * 一轮循环结束：LISTENING → ANALYZING，再根据结果决定下一步。
   * @param {Array<{ resultType?: string, timingOffsetMs?: number }>} results
   * @returns {string} 迁移后的 stage
   */
  finishLoop(results) {
    if (this.stage !== FocusStage.LISTENING) return this.stage;
    this.stage = FocusStage.ANALYZING;
    this.attempts += 1;
    const stats = summarizeAttempt(results);
    this.afterStats = stats;

    const passed = stats.correct >= this.requiredCorrect && stats.errors === 0;
    if (passed) {
      this.consecutiveCorrect += 1;
      if (this.speedIndex + 1 >= this.speeds.length) {
        this.lastAction = SpeedAction.PASSED;
        this.stage = FocusStage.PASSED;
      } else {
        this.speedIndex += 1;
        this.lastAction = SpeedAction.SPEED_UP;
        this.stage = FocusStage.WATCH_TEACHER;
      }
      return this.stage;
    }

    // 未达标
    this.consecutiveCorrect = 0;
    if (this.attempts >= this.slowDownAfter && this.speedIndex > 0) {
      this.speedIndex -= 1;
      this.lastAction = SpeedAction.SLOW_DOWN;
    } else {
      this.lastAction = SpeedAction.RETRY;
    }
    this.stage = FocusStage.WATCH_TEACHER;
    return this.stage;
  }

  /** 当前速度倍数。 */
  get currentSpeed() {
    return this.speeds[this.speedIndex];
  }

  /** 当前速度档序号（0-based）。 */
  get speedStep() {
    return this.speedIndex;
  }

  /** 是否处于可再次尝试的状态。 */
  get canRetry() {
    return this.stage === FocusStage.WATCH_TEACHER || this.stage === FocusStage.ANALYZING;
  }

  /** 是否已通过全部速度档。 */
  get isPassed() {
    return this.stage === FocusStage.PASSED;
  }
}

export default FocusStateMachine;
