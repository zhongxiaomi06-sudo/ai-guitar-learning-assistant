/**
 * core/audio/player.js
 * 音频播放器：控制视频/音频播放速度、循环、跳转
 */

/**
 * 媒体播放器
 */
export class AudioPlayer {
  /**
   * @param {HTMLMediaElement} mediaElement
   */
  constructor(mediaElement) {
    this.media = mediaElement;
    this.targetSpeed = 1.0;
  }

  /**
   * 播放
   */
  play() {
    this.media.play();
  }

  /**
   * 暂停
   */
  pause() {
    this.media.pause();
  }

  /**
   * 设置播放速度
   * @param {number} speed
   */
  setSpeed(speed) {
    this.targetSpeed = speed;
    this.media.playbackRate = speed;
  }

  /**
   * 获取当前速度
   * @returns {number}
   */
  getSpeed() {
    return this.media.playbackRate;
  }

  /**
   * 跳转到指定时间
   * @param {number} time
   */
  seek(time) {
    this.media.currentTime = time;
  }

  /**
   * 获取当前时间
   * @returns {number}
   */
  getCurrentTime() {
    return this.media.currentTime;
  }

  /**
   * 设置循环区间
   * @param {number} start
   * @param {number} end
   */
  setLoop(start, end) {
    this.loopStart = start;
    this.loopEnd = end;
    this.onTimeUpdate = () => {
      if (this.loopEnd && this.media.currentTime >= this.loopEnd) {
        this.media.currentTime = this.loopStart || 0;
      }
    };
    this.media.addEventListener('timeupdate', this.onTimeUpdate);
  }

  /**
   * 清除循环
   */
  clearLoop() {
    this.loopStart = null;
    this.loopEnd = null;
    if (this.onTimeUpdate) {
      this.media.removeEventListener('timeupdate', this.onTimeUpdate);
      this.onTimeUpdate = null;
    }
  }

  /**
   * 绑定时间更新回调
   * @param {Function} callback
   */
  onTimeUpdate(callback) {
    this.media.addEventListener('timeupdate', () => callback(this.media.currentTime));
  }
}

export default AudioPlayer;
