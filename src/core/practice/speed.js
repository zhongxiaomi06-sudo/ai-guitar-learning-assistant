/**
 * core/practice/speed.js
 * 速度控制与恢复策略
 */

import { MIN_SPEED, MAX_SPEED, SPEED_STEP } from '../../shared/constants/index.js';

/**
 * 速度控制器
 */
export class SpeedController {
  constructor() {
    this.current = 1.0;
    this.target = 1.0;
    this.min = MIN_SPEED;
    this.max = MAX_SPEED;
  }

  /**
   * 设置目标速度
   * @param {number} speed
   */
  setTarget(speed) {
    this.target = Math.min(Math.max(speed, this.min), this.max);
  }

  /**
   * 设置当前速度
   * @param {number} speed
   */
  setCurrent(speed) {
    this.current = Math.min(Math.max(speed, this.min), this.max);
  }

  /**
   * 降速一步
   */
  slowDown() {
    this.current = Math.max(this.current - SPEED_STEP, this.min);
  }

  /**
   * 提速一步
   */
  speedUp() {
    this.current = Math.min(this.current + SPEED_STEP, this.target);
  }

  /**
   * 恢复目标速度
   */
  reset() {
    this.current = this.target;
  }
}

export default SpeedController;
