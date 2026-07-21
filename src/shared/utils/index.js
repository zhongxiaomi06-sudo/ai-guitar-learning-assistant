/**
 * shared/utils/index.js
 * 通用工具函数
 */

/**
 * 安全的 JSON 解析
 * @param {string} value
 * @param {*} defaultValue
 * @returns {*}
 */
export function safeJSON(value, defaultValue = null) {
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

/**
 * 防抖
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 节流
 * @param {Function} fn
 * @param {number} interval
 * @returns {Function}
 */
export function throttle(fn, interval = 100) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= interval) {
      last = now;
      fn.apply(this, args);
    }
  };
}

/**
 * 频率转 MIDI 音高
 * @param {number} frequency
 * @returns {number}
 */
export function freqToMidi(frequency) {
  if (frequency <= 0) return 0;
  return 69 + 12 * Math.log2(frequency / 440);
}

/**
 * MIDI 音高转频率
 * @param {number} midi
 * @returns {number}
 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * MIDI 音高转音符名称
 * @param {number} midi
 * @returns {string}
 */
export function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = Math.round(midi) % 12;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${noteNames[noteIndex]}${octave}`;
}

/**
 * 音高偏差（音分）
 * @param {number} detectedFreq
 * @param {number} targetFreq
 * @returns {number}
 */
export function pitchDeviationCents(detectedFreq, targetFreq) {
  if (detectedFreq <= 0 || targetFreq <= 0) return Infinity;
  return 1200 * Math.log2(detectedFreq / targetFreq);
}

/**
 * 限制数值范围
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 格式化时间 mm:ss
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 生成唯一 ID
 * @param {string} prefix
 * @returns {string}
 */
export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

/**
 * 吉他 MIDI 音高映射到琴弦（lane 0-5，0 为 1 弦/高音 E）
 * @param {number} midi
 * @returns {number} lane 0-5，或 -1 表示无法识别
 */
export function midiToStringLane(midi) {
  if (midi <= 0) return -1;
  // 标准调弦开放弦 MIDI：E2=40 A2=45 D3=50 G3=55 B3=59 E4=64
  // 按频段边界映射到 lane（0=1弦 到 5=6弦）
  if (midi >= 62.5) return 0; // 1 弦 E4
  if (midi >= 57.5) return 1; // 2 弦 B3
  if (midi >= 52.5) return 2; // 3 弦 G3
  if (midi >= 47.5) return 3; // 4 弦 D3
  if (midi >= 42.5) return 4; // 5 弦 A2
  return 5;                   // 6 弦 E2
}

export const utils = {
  safeJSON,
  debounce,
  throttle,
  freqToMidi,
  midiToFreq,
  midiToNoteName,
  pitchDeviationCents,
  clamp,
  formatTime,
  uid,
  midiToStringLane,
};

export default utils;
