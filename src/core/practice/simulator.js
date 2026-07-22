/**
 * core/practice/simulator.js
 * MIDI / 程序化用户模拟器：在没有真实吉他和麦克风的情况下，
 * 按时间轴生成虚拟演奏事件，用于前端交互测试与匹配逻辑验证。
 */

import { midiToFreq, freqToMidi } from '../../shared/utils/index.js';

/** 标准调弦 1–6 弦开放音 MIDI（高音 E 到低音 E） */
const STRING_OPEN_MIDI = [64, 59, 55, 50, 45, 40];

/** 错音/漏音判定的匹配窗口（秒），用于 wrong@<time> 等按时间命中的场景 */
const TRIGGER_WINDOW = 0.08;

/** 音符开始后多长时间内仍允许触发（覆盖 120 ms 采样节拍，避免漏触发） */
const FIRE_WINDOW = 0.25;

/** 默认演奏能量 */
const DEFAULT_RMS = 0.08;

/**
 * 将任意时间轴/谱面事件归一化为模拟器可用的音符事件。
 * @param {unknown[]} timeline
 * @returns {Array<{ id: string, type: string, startTime: number, endTime: number, string: number, fret: number, midi: number, measureIndex: number, beatPosition: number, chord?: string }>}
 */
function normalizeEvents(timeline) {
  if (!Array.isArray(timeline)) return [];
  return timeline
    .map((event) => {
      const startTime = Number(event?.startTime ?? event?.videoTime ?? event?.audioTime ?? 0);
      const endTime = Number(event?.endTime ?? startTime + 0.3);
      const stringNumber = Number(event?.string ?? event?.stringNumber);
      const fret = Number(event?.fret);
      const pitch = Number(event?.pitch);

      if (!Number.isFinite(startTime) || startTime < 0) return null;
      if (!Number.isInteger(stringNumber) || stringNumber < 1 || stringNumber > 6) return null;
      if (!Number.isInteger(fret) || fret < 0 || fret > 36) return null;

      const midi = Number.isFinite(pitch) && pitch > 0
        ? pitch
        : STRING_OPEN_MIDI[stringNumber - 1] + fret;

      return {
        id: String(event?.id || `evt-${startTime}-${stringNumber}-${fret}`),
        type: String(event?.type || 'note'),
        startTime,
        endTime,
        string: stringNumber,
        fret,
        midi,
        measureIndex: Number(event?.measureIndex ?? 0),
        beatPosition: Number(event?.beatPosition ?? 0),
        chord: event?.chord,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startTime - right.startTime);
}

/**
 * 解析模拟模式字符串，返回配置对象。
 * 支持：perfect / miss / late50 / late100 / late200 / early50 / early100 / wrong@<time> / wrong@id=<id> / jitter / partial
 *
 * @param {string} mode
 * @returns {{ timingOffset: number, wrongAtTime: number | null, wrongAtId: string | null, jitter: boolean, partial: boolean, missAll: boolean }}
 */
function parseMode(mode) {
  const config = {
    timingOffset: 0,
    wrongAtTime: null,
    wrongAtId: null,
    jitter: false,
    partial: false,
    missAll: false,
  };

  if (!mode || mode === 'perfect') return config;
  if (mode === 'miss') {
    config.missAll = true;
    return config;
  }

  const lower = String(mode).trim().toLowerCase();

  if (lower === 'late50') config.timingOffset = 0.05;
  else if (lower === 'late100') config.timingOffset = 0.10;
  else if (lower === 'late200') config.timingOffset = 0.20;
  else if (lower === 'early50') config.timingOffset = -0.05;
  else if (lower === 'early100') config.timingOffset = -0.10;
  else if (lower === 'jitter') config.jitter = true;
  else if (lower === 'partial') config.partial = true;
  else if (lower.startsWith('wrong@')) {
    const payload = lower.slice('wrong@'.length);
    if (payload.startsWith('id=')) {
      config.wrongAtId = payload.slice(3);
    } else {
      const time = Number(payload);
      config.wrongAtTime = Number.isFinite(time) && time >= 0 ? time : null;
    }
  }

  return config;
}

/**
 * 用户模拟器：根据时间轴生成程序化演奏事件。
 */
export class UserSimulator {
  /**
   * @param {unknown[]} timeline 时间轴事件数组，可以是后端 timeline 或谱面事件
   * @param {string} mode 模拟模式
   */
  constructor(timeline, mode = 'perfect') {
    this.events = normalizeEvents(timeline);
    this.mode = mode;
    this.config = parseMode(mode);
    this.triggered = new Set();
  }

  /**
   * 根据当前播放时间返回下一个虚拟演奏事件（PlayedNote 形状）。
   * 同一目标只会触发一次，避免重复记录。
   *
   * 触发时机：当播放时间进入音符开始后的 FIRE_WINDOW 内时触发。
   * 返回的 onsetTime 为「模拟用户的实际演奏时间」= 目标时间 + 模式偏移，
   * 这样匹配引擎计算出的节奏偏差方向与大小都和模式一致，且不受采样抖动影响。
   *
   * @param {number} videoTime 当前视频时间（秒）
   * @returns {{ pitch: number, rms: number, onsetTime: number, string: number, fret: number, targetId: string } | null}
   */
  nextNote(videoTime) {
    if (this.events.length === 0 || this.config.missAll) return null;

    // 找到当前时间窗口内尚未触发的事件。triggered 集合保证每个事件只触发一次，
    // 因此不需要额外的「同一物理时间」冷却；和弦内的重叠音符会由多次调用依次触发。
    const candidate = this.events.find((event) => {
      if (this.triggered.has(event.id)) return false;
      // partial 模式：按事件 id 确定性地漏掉一部分音符，标记后不再考虑
      if (this.shouldMiss(event)) {
        this.triggered.add(event.id);
        return false;
      }
      return videoTime >= event.startTime && videoTime <= event.startTime + FIRE_WINDOW;
    });

    if (!candidate) return null;

    this.triggered.add(candidate.id);

    // 模拟用户的「实际演奏时间」= 目标时间 + 模式偏移
    const offset = this.effectiveTimingOffset(candidate, videoTime);
    const onsetTime = candidate.startTime + offset;

    let midi = candidate.midi;

    // 错音处理：命中指定时间或指定事件时，音高偏移一个半音
    if (this.shouldPlayWrong(candidate, videoTime)) {
      midi += 1;
    }

    return {
      pitch: midiToFreq(midi),
      rms: DEFAULT_RMS,
      onsetTime,
      string: candidate.string,
      fret: candidate.fret,
      targetId: candidate.id,
    };
  }

  /**
   * 兼容 GuitarDetector.getDetection() 的接口，供前端直接替换麦克风检测。
   * 返回结构在 GuitarDetector 基础上额外携带 onsetTime（模拟用户的实际演奏时间），
   * 让调用方可以用它代替采样时刻来计算节奏偏差。
   *
   * @param {number} videoTime 当前视频时间（秒）
   * @returns {{ time: number, pitch: { frequency: number, midi: number, confidence: number }, onset: boolean, rms: number, onsetTime?: number }}
   */
  getDetection(videoTime) {
    const note = this.nextNote(videoTime);
    if (note) {
      return {
        time: videoTime,
        pitch: { frequency: note.pitch, midi: freqToMidi(note.pitch), confidence: 0.95 },
        onset: true,
        rms: note.rms,
        onsetTime: note.onsetTime,
      };
    }
    return {
      time: videoTime,
      pitch: { frequency: 0, midi: 0, confidence: 0 },
      onset: false,
      rms: 0,
    };
  }

  /**
   * 兼容 GuitarDetector.stop()：模拟器不持有硬件资源，调用为空操作，
   * 使其可以作为 state.micDetector 的直接替换者。
   */
  stop() {
    // 模拟器无需释放硬件资源；保留方法仅为接口兼容。
  }

  /**
   * 兼容 GuitarDetector.isListening：模拟器始终处于「可监听」状态。
   * @returns {boolean}
   */
  get isListening() {
    return true;
  }

  /**
   * 重置触发状态，允许同一事件再次触发（用于循环、回跳或重新练习）。
   */
  reset() {
    this.triggered.clear();
  }

  /**
   * 获取当前有效的时序偏移量。
   * @param {object} _event
   * @param {number} _videoTime
   * @returns {number}
   */
  effectiveTimingOffset(_event, _videoTime) {
    if (this.config.jitter) {
      // 随机 ±30 ms，但保持可重复性（按事件 id 哈希）
      return seededJitter(_event.id);
    }
    return this.config.timingOffset;
  }

  /**
   * 判断当前事件是否应触发错音。
   * @param {object} event
   * @param {number} _videoTime 保留参数以与 nextNote 调用签名一致，当前错音判定不依赖采样时刻。
   * @returns {boolean}
   */
  shouldPlayWrong(event, _videoTime) {
    if (this.config.wrongAtId && event.id === this.config.wrongAtId) return true;
    if (this.config.wrongAtTime !== null && Math.abs(event.startTime - this.config.wrongAtTime) < TRIGGER_WINDOW) {
      return true;
    }
    // partial 模式：随机漏掉一部分，但这里不处理错音，只处理漏音
    return false;
  }

  /**
   * 当前事件是否应被“漏掉”（用于 partial 模式）。
   * @param {object} event
   * @returns {boolean}
   */
  shouldMiss(event) {
    if (!this.config.partial) return false;
    return seededChoice(event.id, 0.3);
  }

  /**
   * 当前模式名称（用于调试 UI）。
   * @returns {string}
   */
  get modeLabel() {
    const map = {
      perfect: '完美演奏',
      miss: '全程漏音',
      late50: '晚 50 ms',
      late100: '晚 100 ms',
      late200: '晚 200 ms',
      early50: '早 50 ms',
      early100: '早 100 ms',
      jitter: '节奏抖动',
      partial: '部分漏音',
    };
    return map[this.mode] || `模拟模式：${this.mode}`;
  }
}

/**
 * 基于字符串种子生成伪随机数，保证同一事件每次运行结果一致。
 * 使用 FNV-1a 32-bit + murmur3 fmix32 终结器：相近的 id（如 note_001 / note_002）
 * 也能均匀分散到 [0,1)，避免 partial/jitter 模式在共享前缀的真实 id 上退化。
 * @param {string} seed
 * @returns {number} 0–1
 */
function seededRandom(seed) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 0x100000000;
}

/**
   * 基于事件 id 生成 ±30 ms 的确定性抖动。
   * @param {string} id
   * @returns {number}
   */
function seededJitter(id) {
  return (seededRandom(id) - 0.5) * 0.06;
}

/**
 * 基于事件 id 做概率选择。
 * @param {string} id
 * @param {number} probability
 * @returns {boolean}
 */
function seededChoice(id, probability) {
  return seededRandom(id) < probability;
}

export default UserSimulator;
