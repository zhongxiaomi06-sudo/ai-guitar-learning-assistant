/**
 * core/practice/session.js
 * 练习会话管理
 */

import { DEFAULT_SETTINGS, MIN_SPEED, MAX_SPEED, SPEED_STEP } from '../../shared/constants/index.js';
import { ScoringSystem } from '../matching/scoring.js';

/**
 * 练习会话
 */
export class PracticeSession {
  /**
   * @param {string} projectId
   */
  constructor(projectId) {
    this.projectId = projectId;
    this.startTime = Date.now();
    this.speed = DEFAULT_SETTINGS.speed;
    this.targetSpeed = DEFAULT_SETTINGS.speed;
    this.loopRange = { start: 0, end: 0 };
    this.currentBarIndex = 0;
    this.scoring = new ScoringSystem();
    this.isAutoSlowDown = DEFAULT_SETTINGS.autoSlowDown;
    this.errors = [];
  }

  /**
   * 设置循环区间
   * @param {number} start
   * @param {number} end
   */
  setLoop(start, end) {
    this.loopRange = { start, end };
  }

  /**
   * 清除循环
   */
  clearLoop() {
    this.loopRange = { start: 0, end: 0 };
  }

  /**
   * 设置速度
   * @param {number} speed
   */
  setSpeed(speed) {
    this.speed = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
  }

  /**
   * 处理匹配结果
   * @param {import('../../shared/types/index.js').MatchResult} result
   */
  handleResult(result) {
    this.scoring.add(result);

    if (result.score === 'miss' || result.score === 'wrong-pitch') {
      this.errors.push(result);
    }

    if (this.isAutoSlowDown) {
      this.adaptSpeed();
    }
  }

  /**
   * 自适应调速
   */
  adaptSpeed() {
    const streak = this.scoring.streak();
    const missCount = this.errors.length;

    if (missCount >= 3) {
      this.setSpeed(this.speed - SPEED_STEP);
      this.errors = [];
    } else if (streak >= 5 && this.speed < this.targetSpeed) {
      this.setSpeed(this.speed + SPEED_STEP);
    }
  }

  /**
   * 重置
   */
  reset() {
    this.scoring.reset();
    this.errors = [];
    this.currentBarIndex = 0;
    this.speed = this.targetSpeed;
  }
}

export default PracticeSession;
