/**
 * core/audio/detector.js
 * 音高/Onset/和弦检测器
 */

import { AudioAnalyzer } from './analyzer.js';

/**
 * 吉他检测器
 * 封装音频输入与检测结果，供匹配引擎使用。
 */
export class GuitarDetector {
  /**
   * @param {AudioContext} audioContext
   */
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.analyzer = new AudioAnalyzer(audioContext);
    this.source = null;
    this.isListening = false;
  }

  /**
   * 开始监听麦克风
   * @param {MediaStream} stream
   */
  async start(stream) {
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.analyzer.connect(this.source);
    this.isListening = true;
  }

  /**
   * 停止监听
   */
  stop() {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    this.isListening = false;
  }

  /**
   * 获取当前检测结果
   * @returns {{
   *   time: number,
   *   pitch: { frequency: number, midi: number, confidence: number },
   *   onset: boolean,
   *   rms: number
   * }}
   */
  getDetection() {
    return {
      time: this.audioContext.currentTime,
      pitch: this.analyzer.detectPitch(),
      onset: this.analyzer.detectOnset(),
      rms: this.analyzer.getRMS(),
    };
  }

  /**
   * 检测和弦（多音高提取）
   * @returns {number[]}
   */
  detectChord() {
    // TODO: 基于多音高检测和和弦模板识别
    return [];
  }
}

export default GuitarDetector;
