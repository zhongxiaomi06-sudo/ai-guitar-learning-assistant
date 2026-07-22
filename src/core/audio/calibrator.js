/**
 * core/audio/calibrator.js
 * 麦克风校准：环境噪声基线、自适应 onset 阈值、输入延迟估计。
 *
 * 纯函数（percentile / computeThreshold / estimateLatency / classifyEnvironment）
 * 不依赖 DOM，可在 node:test 中验证；MicCalibrator 类负责按帧采样并汇总。
 */

/** 默认 onset 阈值（RMS），用于环境噪声很低时。 */
export const DEFAULT_ONSET_THRESHOLD = 0.02;
/** 避免校准期间的拨弦尖峰把起音门槛抬到普通木吉他无法触发的程度。 */
export const MAX_ONSET_THRESHOLD = 0.05;
/** 校准采样的最小/最大噪声样本数，避免极端环境卡死。 */
const MIN_NOISE_SAMPLES = 8;
const MAX_NOISE_SAMPLES = 240;
/** 判定环境噪声过高的阈值（RMS）。 */
export const NOISE_TOO_HIGH = 0.05;
/** 判定输入延迟过高、疑似蓝牙设备的阈值（秒）。 */
export const LATENCY_TOO_HIGH = 0.1;
/** 判定吉他音量过低的 RMS 阈值。 */
export const GUITAR_TOO_QUIET = 0.02;

/**
 * 计算一组数值的指定分位数（线性插值）。
 * @param {number[]} values
 * @param {number} p 0–1
 * @returns {number}
 */
export function percentile(values, p) {
  const list = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, p * (sorted.length - 1)));
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const frac = rank - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

/**
 * 根据噪声基线计算自适应 onset 阈值。
 * 取噪声基线 95 分位的 2.5 倍与默认阈值中较大者，避免安静环境下过于敏感、
 * 嘈杂环境下频繁误报。
 * @param {number} noiseFloor
 * @param {number} [defaultThreshold=DEFAULT_ONSET_THRESHOLD]
 * @returns {number}
 */
export function computeThreshold(noiseFloor, defaultThreshold = DEFAULT_ONSET_THRESHOLD) {
  const base = Number.isFinite(noiseFloor) && noiseFloor > 0 ? noiseFloor * 2.5 : 0;
  return Math.min(MAX_ONSET_THRESHOLD, Math.max(defaultThreshold, base));
}

/**
 * 从 AudioContext 估计输入延迟（秒）。
 * 浏览器只暴露 baseLatency / outputLatency，作为输入延迟的近似估计已足够
 * 用于补偿与高延迟告警。
 * @param {AudioContext} audioContext
 * @returns {number}
 */
export function estimateLatency(audioContext) {
  if (!audioContext) return 0;
  const base = Number(audioContext.baseLatency) || 0;
  const output = typeof audioContext.outputLatency === 'number' ? Number(audioContext.outputLatency) || 0 : 0;
  return Math.max(0, base + output);
}

/**
 * 根据校准结果给出环境/设备提示。
 * @param {{ noiseFloor: number, guitarRms: number, latencyOffset: number }} env
 * @returns {{ warnings: string[], level: 'ok' | 'warn' }}
 */
export function classifyEnvironment({ noiseFloor = 0, guitarRms = 0, latencyOffset = 0 } = {}) {
  const warnings = [];
  if (noiseFloor >= NOISE_TOO_HIGH) {
    warnings.push('环境噪声较高，已扩大判定容错，建议更换更安静的环境。');
  }
  if (guitarRms > 0 && guitarRms < GUITAR_TOO_QUIET) {
    warnings.push('吉他音量偏低，建议靠近麦克风或调大输入增益。');
  }
  if (latencyOffset >= LATENCY_TOO_HIGH) {
    warnings.push('输入延迟较高，疑似蓝牙音频设备，建议改用有线麦克风。');
  }
  return { warnings, level: warnings.length ? 'warn' : 'ok' };
}

/**
 * 麦克风校准器：按帧采集 RMS，汇总噪声基线与吉他音量。
 */
export class MicCalibrator {
  /**
   * @param {{ getRMS: () => number, analyzeFrame?: () => { rms: number, onset: boolean, pitch: { frequency: number, confidence: number } } }} analyzer
   */
  constructor(analyzer) {
    this.analyzer = analyzer;
    this.noiseFloor = 0;
    this.guitarRms = 0;
    this.latencyOffset = 0;
    this.threshold = DEFAULT_ONSET_THRESHOLD;
  }

  /**
   * 监听 durationMs，采集环境噪声基线与峰值吉他音量。
   * 采用 95 分位 RMS 作为噪声基线，避免短暂尖峰拉高基线。
   * @param {number} durationMs
   * @param {(progress: number) => void} [onProgress] 0–1
   * @returns {Promise<{ noiseFloor: number, guitarRms: number, threshold: number }>}
   */
  async measureEnvironment(durationMs = 3000, onProgress) {
    const samples = [];
    const peaks = [];
    const start = performance.now();
    const interval = Math.max(40, Math.min(120, durationMs / 30));
    const deadline = start + Math.max(500, durationMs);

    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        let frame;
        try {
          frame = this.analyzer?.analyzeFrame?.() ?? { rms: this.analyzer?.getRMS?.() ?? 0, onset: false };
        } catch {
          frame = { rms: 0, onset: false };
        }
        const rms = Number.isFinite(frame.rms) ? frame.rms : 0;
        samples.push(rms);
        if (frame.onset || rms > 0) peaks.push(rms);

        if (typeof onProgress === 'function') {
          onProgress(Math.max(0, Math.min(1, (now - start) / durationMs)));
        }
        if (now < deadline && samples.length < MAX_NOISE_SAMPLES) {
          setTimeout(tick, interval);
        } else {
          resolve();
        }
      };
      setTimeout(tick, interval);
    });

    const usable = samples.length >= MIN_NOISE_SAMPLES ? samples : samples.concat(new Array(MIN_NOISE_SAMPLES - samples.length).fill(0));
    this.noiseFloor = percentile(usable, 0.95);
    this.guitarRms = peaks.length ? percentile(peaks, 0.75) : 0;
    this.threshold = computeThreshold(this.noiseFloor);
    return {
      noiseFloor: this.noiseFloor,
      guitarRms: this.guitarRms,
      threshold: this.threshold,
    };
  }

  /**
   * 设置延迟偏移（来自 estimateLatency），用于后续 onsetTime 补偿。
   * @param {number} offsetSeconds
   */
  setLatency(offsetSeconds) {
    this.latencyOffset = Math.max(0, Number(offsetSeconds) || 0);
  }
}

export default MicCalibrator;
