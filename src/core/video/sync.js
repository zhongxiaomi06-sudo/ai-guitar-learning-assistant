/**
 * core/video/sync.js
 * 视频与谱面对齐：基于音频事件、BPM、时间戳
 */

/**
 * 同步器
 */
export class AVSync {
  constructor() {
    this.offset = 0;
  }

  /**
   * 将谱面时间转换为视频时间
   * @param {number} scoreTime
   * @returns {number}
   */
  scoreToVideo(scoreTime) {
    return scoreTime + this.offset;
  }

  /**
   * 将视频时间转换为谱面时间
   * @param {number} videoTime
   * @returns {number}
   */
  videoToScore(videoTime) {
    return videoTime - this.offset;
  }

  /**
   * 对齐视频与音频（DTW 占位）
   * @param {AudioBuffer} _videoAudio
   * @param {AudioBuffer} _scoreAudio
   * @returns {number} offset in seconds
   */
  align(_videoAudio, _scoreAudio) {
    // TODO: 使用 Onset + DTW 计算最佳 offset
    this.offset = 0;
    return this.offset;
  }

  /**
   * 手动设置 offset
   * @param {number} offset
   */
  setOffset(offset) {
    this.offset = offset;
  }
}

export default AVSync;
