/**
 * core/audio/analyzer.js
 * 音频分析：频域、时域、Onset 检测、音高提取
 */

import { freqToMidi } from '../../shared/utils/index.js';

/**
 * 音频分析器
 */
export class AudioAnalyzer {
  /**
   * @param {AudioContext} audioContext
   */
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.sampleRate = audioContext.sampleRate;
  }

  /**
   * 连接音频源
   * @param {AudioNode} source
   */
  connect(source) {
    source.connect(this.analyser);
  }

  /**
   * 获取当前频域数据
   * @returns {Float32Array}
   */
  getFrequencyData() {
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  /**
   * 获取当前时域数据
   * @returns {Float32Array}
   */
  getTimeData() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    return new Float32Array(this.buffer);
  }

  /**
   * 检测当前主音高（YIN 简化版占位）
   * @returns {{ frequency: number, midi: number, confidence: number }}
   */
  detectPitch() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    // TODO: 接入 YIN / autocorrelation / CREPE 算法
    const frequency = this.placeholderPitchDetect();
    const midi = freqToMidi(frequency);
    return { frequency, midi, confidence: 0 };
  }

  /**
   * 占位音高检测
   * @returns {number}
   */
  placeholderPitchDetect() {
    // 简单能量重心，后续替换为真实算法
    let sum = 0;
    let count = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      sum += Math.abs(this.buffer[i]);
      count++;
    }
    const energy = sum / count;
    if (energy < 0.01) return 0;
    return 220 + energy * 100;
  }

  /**
   * 检测 Onset（能量差分法）
   * @param {number} threshold
   * @returns {boolean}
   */
  detectOnset(threshold = 0.1) {
    const data = this.getTimeData();
    let energy = 0;
    for (let i = 0; i < data.length; i++) {
      energy += data[i] * data[i];
    }
    const rms = Math.sqrt(energy / data.length);
    // TODO: 使用更鲁棒的 Onset 检测算法
    return rms > threshold;
  }

  /**
   * 获取 RMS 能量
   * @returns {number}
   */
  getRMS() {
    const data = this.getTimeData();
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }
}

export default AudioAnalyzer;
