/**
 * core/video/player.js
 * 视频播放器封装，扩展 AudioPlayer
 */

import { AudioPlayer } from '../audio/player.js';

/**
 * 视频播放器
 */
export class VideoPlayer extends AudioPlayer {
  /**
   * @param {HTMLVideoElement} videoElement
   */
  constructor(videoElement) {
    super(videoElement);
    this.video = videoElement;
  }

  /**
   * 加载视频源
   * @param {string} src
   */
  load(src) {
    this.video.src = src;
    this.video.load();
  }

  /**
   * 获取视频当前时间
   * @returns {number}
   */
  getCurrentTime() {
    return this.video.currentTime;
  }

  /**
   * 获取视频时长
   * @returns {number}
   */
  getDuration() {
    return this.video.duration || 0;
  }

  /**
   * 是否暂停
   * @returns {boolean}
   */
  isPaused() {
    return this.video.paused;
  }
}

export default VideoPlayer;
