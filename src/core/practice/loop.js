/**
 * core/practice/loop.js
 * 循环练习控制
 */

/**
 * 循环控制器
 */
export class LoopController {
  /**
   * @param {import('../audio/player.js').AudioPlayer} player
   */
  constructor(player) {
    this.player = player;
    this.start = 0;
    this.end = 0;
    this.enabled = false;
    this.boundCheck = null;
  }

  /**
   * 设置循环区间
   * @param {number} start
   * @param {number} end
   */
  setRange(start, end) {
    this.start = start;
    this.end = end;
    this.enabled = true;
    this.bind();
  }

  /**
   * 清除循环
   */
  clear() {
    this.enabled = false;
    this.start = 0;
    this.end = 0;
    this.unbind();
  }

  /**
   * 绑定时间更新监听
   */
  bind() {
    this.unbind();
    this.boundCheck = () => {
      if (!this.enabled) return;
      const t = this.player.getCurrentTime();
      if (t >= this.end) {
        this.player.seek(this.start);
      }
    };
    this.player.media.addEventListener('timeupdate', this.boundCheck);
  }

  /**
   * 解绑
   */
  unbind() {
    if (this.boundCheck) {
      this.player.media.removeEventListener('timeupdate', this.boundCheck);
      this.boundCheck = null;
    }
  }
}

export default LoopController;
