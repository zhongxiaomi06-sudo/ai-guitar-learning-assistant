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
   * 检测当前主音高（YIN 算法简化实现）
   * @returns {{ frequency: number, midi: number, confidence: number }}
   */
  detectPitch() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    const rms = this.computeRMS(this.buffer);
    if (rms < 0.005) {
      return { frequency: 0, midi: 0, confidence: 0 };
    }
    const { frequency, confidence } = this.yinPitchDetect(this.buffer, this.sampleRate);
    const midi = frequency > 0 ? freqToMidi(frequency) : 0;
    return { frequency, midi, confidence };
  }

  /**
   * 计算 RMS
   * @param {Float32Array} buffer
   * @returns {number}
   */
  computeRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  /**
   * YIN 音高检测
   * @param {Float32Array} buffer
   * @param {number} sampleRate
   * @returns {{ frequency: number, confidence: number }}
   */
  yinPitchDetect(buffer, sampleRate) {
    const threshold = 0.12;
    const minFreq = 70; // 吉他最低音约 E2 (82.4 Hz)，留一点余量
    const maxFreq = 1000;
    // 确保搜索范围不超出 buffer 长度
    const tauMax = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buffer.length / 2));
    const tauMin = Math.max(Math.floor(sampleRate / maxFreq), 2);

    if (tauMax <= tauMin) return { frequency: 0, confidence: 0 };

    const diff = new Float32Array(tauMax);
    const cmnd = new Float32Array(tauMax);

    // Step 1: 差分函数
    for (let tau = tauMin; tau < tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < tauMax; j++) {
        const d = buffer[j] - buffer[j + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // Step 2: 累积均值归一化差分
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < tauMax; tau++) {
      runningSum += diff[tau];
      cmnd[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1;
    }

    // Step 3: 绝对阈值搜索
    let tau = tauMin;
    let found = false;
    while (tau < tauMax - 1) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) {
          tau++;
        }
        found = true;
        break;
      }
      tau++;
    }

    if (!found) return { frequency: 0, confidence: 0 };

    // Step 4: 抛物线插值
    const x0 = Math.max(tau - 1, 1);
    const x1 = tau;
    const x2 = tau + 1;
    const y0 = cmnd[x0];
    const y1 = cmnd[x1];
    const y2 = cmnd[x2];
    const denominator = 2 * (y2 - 2 * y1 + y0);
    const betterTau = denominator !== 0 ? x1 - (y2 - y0) / denominator : x1;

    const frequency = betterTau > 0 ? sampleRate / betterTau : 0;
    const confidence = Math.max(0, Math.min(1, 1 - cmnd[tau]));
    return { frequency, confidence };
  }

  /**
   * 检测 Onset（能量阈值 + 上升沿）
   * @param {number} threshold
   * @param {number} prevRms
   * @returns {{ onset: boolean, rms: number }}
   */
  detectOnset(threshold = 0.02, prevRms = 0) {
    const rms = this.getRMS();
    const onset = rms > threshold && rms > prevRms * 1.5;
    return { onset, rms };
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
