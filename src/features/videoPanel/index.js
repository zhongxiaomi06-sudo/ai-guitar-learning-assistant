/**
 * features/videoPanel/index.js
 * 视频面板 UI 控制器
 */

import { VideoPlayer } from '../../core/video/player.js';
import { VideoFetcher } from '../../core/video/fetcher.js';

/**
 * 视频面板
 */
export class VideoPanel {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.videoElement = this.container.querySelector('video');
    this.player = new VideoPlayer(this.videoElement);
  }

  /**
   * 加载视频
   * @param {string | File} source
   */
  async load(source) {
    let url = '';
    if (typeof source === 'string') {
      url = await VideoFetcher.fromURL(source);
    } else if (source instanceof File) {
      url = VideoFetcher.fromFile(source);
    }
    this.player.load(url);
  }

  /**
   * 播放
   */
  play() {
    this.player.play();
  }

  /**
   * 暂停
   */
  pause() {
    this.player.pause();
  }

  /**
   * 跳转到指定时间
   * @param {number} time
   */
  seek(time) {
    this.player.seek(time);
  }

  /**
   * 设置速度
   * @param {number} speed
   */
  setSpeed(speed) {
    this.player.setSpeed(speed);
  }

  /**
   * 绑定时间更新
   * @param {Function} callback
   */
  onTimeUpdate(callback) {
    this.player.onTimeUpdate(callback);
  }
}

export default VideoPanel;
