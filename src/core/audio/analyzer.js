/**
 * core/audio/analyzer.js
 * 音频分析：频域、时域、Onset 检测、音高提取
 */

import { freqToMidi } from '../../shared/utils/index.js';

const MIN_GUITAR_FREQUENCY = 70;
const MAX_GUITAR_FREQUENCY = 1000;
const YIN_THRESHOLD = 0.12;
const SILENCE_RMS = 0.005;

/**
 * YIN 需要至少容纳两个最低音周期。AnalyserNode 只接受 2 的幂次 fftSize。
 * @param {number} sampleRate
 * @returns {number}
 */
function chooseFftSize(sampleRate) {
  const minimumSize = Math.ceil((sampleRate / MIN_GUITAR_FREQUENCY) * 2);
  let fftSize = 2048;
  while (fftSize < minimumSize && fftSize < 32768) fftSize *= 2;
  return Math.min(fftSize, 32768);
}

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
    this.analyser.fftSize = chooseFftSize(audioContext.sampleRate);
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
    return this.detectPitchFromBuffer(this.buffer, rms);
  }

  /**
   * 对同一帧时域数据同时计算音高、Onset 和 RMS。
   * 避免一次检测中多次读取 AnalyserNode 导致数据不同步。
   * @param {number} onsetThreshold
   * @param {number} prevRms
   * @returns {{
   *   pitch: { frequency: number, midi: number, confidence: number },
   *   onset: boolean,
   *   rms: number
   * }}
   */
  analyzeFrame(onsetThreshold = 0.02, prevRms = 0) {
    this.analyser.getFloatTimeDomainData(this.buffer);
    const rms = this.computeRMS(this.buffer);
    return {
      pitch: this.detectPitchFromBuffer(this.buffer, rms),
      // 普通麦克风常带有自动增益，吉他起音不一定能在相邻
      // 两帧间跳升 50%。25% 仍能排除稳定背景噪声，同时少漏掉轻拨弦。
      onset: rms > onsetThreshold && rms > prevRms * 1.25,
      rms,
    };
  }

  /**
   * @param {Float32Array} buffer
   * @param {number} rms
   * @returns {{ frequency: number, midi: number, confidence: number }}
   */
  detectPitchFromBuffer(buffer, rms = this.computeRMS(buffer)) {
    if (!Number.isFinite(rms) || rms < SILENCE_RMS) {
      return { frequency: 0, midi: 0, confidence: 0 };
    }

    const { frequency, confidence } = this.yinPitchDetect(buffer, this.sampleRate);
    const validFrequency = Number.isFinite(frequency) ? frequency : 0;
    const midi = validFrequency > 0 ? freqToMidi(validFrequency) : 0;
    return { frequency: validFrequency, midi, confidence };
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
    if (!buffer?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return { frequency: 0, confidence: 0 };
    }

    // 搜索区间覆盖吉他基频，并为差分函数保留等长比较窗。
    const tauMax = Math.min(
      Math.floor(sampleRate / MIN_GUITAR_FREQUENCY),
      Math.floor(buffer.length / 2),
    );
    const tauMin = Math.max(Math.floor(sampleRate / MAX_GUITAR_FREQUENCY), 2);

    if (tauMax <= tauMin) return { frequency: 0, confidence: 0 };

    // tauMax 也是有效候选，因此多保留一个元素防止边界插值越界。
    const diff = new Float64Array(tauMax + 1);
    const cmnd = new Float64Array(tauMax + 1);
    const comparisonLength = tauMax;

    // Step 1: 差分函数
    // 累积均值必须包含 1..tauMax 的全部差分。从 tauMin 才开始
    // 计算会使高频端的 CMND 失真，并将 1000 Hz 误判为 500 Hz。
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < comparisonLength; j++) {
        const d = buffer[j] - buffer[j + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // Step 2: 累积均值归一化差分
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      runningSum += diff[tau];
      cmnd[tau] = runningSum > Number.EPSILON ? (diff[tau] * tau) / runningSum : 1;
    }

    // Step 3: 绝对阈值搜索
    let selectedTau = 0;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < YIN_THRESHOLD) {
        selectedTau = tau;
        while (selectedTau < tauMax && cmnd[selectedTau + 1] < cmnd[selectedTau]) {
          selectedTau++;
        }
        break;
      }
    }

    if (selectedTau === 0) return { frequency: 0, confidence: 0 };

    // Step 4: 抛物线插值
    let betterTau = selectedTau;
    if (selectedTau > 1 && selectedTau < tauMax) {
      const y0 = cmnd[selectedTau - 1];
      const y1 = cmnd[selectedTau];
      const y2 = cmnd[selectedTau + 1];
      const denominator = 2 * (2 * y1 - y2 - y0);
      if (Number.isFinite(denominator) && Math.abs(denominator) > Number.EPSILON) {
        const candidate = selectedTau + (y2 - y0) / denominator;
        if (Number.isFinite(candidate) && Math.abs(candidate - selectedTau) <= 1) {
          betterTau = candidate;
        }
      }
    }

    const frequency = sampleRate / betterTau;
    const inRange = Number.isFinite(frequency)
      && frequency >= MIN_GUITAR_FREQUENCY * 0.98
      && frequency <= MAX_GUITAR_FREQUENCY * 1.02;
    const confidence = Math.max(0, Math.min(1, 1 - cmnd[selectedTau]));
    return { frequency: inRange ? frequency : 0, confidence: inRange ? confidence : 0 };
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
