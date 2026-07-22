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
    this.stream = null;
    this.isListening = false;
    this.prevRms = 0;
    // onset 阈值（RMS），可由麦克风校准器根据环境噪声自适应调整。
    this.onsetThreshold = 0.02;
  }

  /**
   * 开始监听麦克风
   * @param {MediaStream} stream
   * @returns {Promise<void>}
   */
  async start(stream) {
    if (!stream) throw new TypeError('A MediaStream is required');

    // 同一条流重复 start 应该是幂等的，否则会向 AnalyserNode
    // 叠加多个 MediaStreamAudioSourceNode。
    if (this.isListening && this.stream === stream && this.source) return;

    // GuitarDetector 在 start 成功后接管 stream；切换设备时先完整释放旧流。
    this.stop();

    let source = null;
    try {
      source = this.audioContext.createMediaStreamSource(stream);
      this.analyzer.connect(source);
    } catch (error) {
      try {
        source?.disconnect();
      } catch {
        // 部分连接成功时仍要继续回收 stream。
      }
      this.stopStreamTracks(stream);
      throw error;
    }

    this.source = source;
    this.stream = stream;
    this.isListening = true;
    this.prevRms = 0;

    // AudioContext 在移动浏览器上常以 suspended 状态创建。
    // source 先连接，即使并发 start 发生，后一次也能通过 source 引用
    // 安全地取代前一次。
    if (this.audioContext.state === 'suspended' && typeof this.audioContext.resume === 'function') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        if (this.source === source) this.stop();
        throw error;
      }
    }
  }

  /**
   * 停止监听
   * @param {{ stopTracks?: boolean }} options
   */
  stop({ stopTracks = true } = {}) {
    const source = this.source;
    const stream = this.stream;

    // 先清理状态，使 stop 可重入且多次调用安全。
    this.source = null;
    this.stream = null;
    this.isListening = false;
    this.prevRms = 0;

    if (source) {
      try {
        source.disconnect();
      } catch {
        // 已被浏览器断开的 source 不应阻断其余资源回收。
      }
    }

    if (stopTracks) this.stopStreamTracks(stream);
  }

  /**
   * @param {MediaStream | null} stream
   */
  stopStreamTracks(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // 单个 track 的异常不应影响其他 track 的停止。
      }
    }
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
    const time = Number.isFinite(this.audioContext.currentTime)
      ? this.audioContext.currentTime
      : 0;

    if (!this.isListening || !this.source || this.stream?.active === false) {
      if (this.stream?.active === false) this.stop();
      return {
        time,
        pitch: { frequency: 0, midi: 0, confidence: 0 },
        onset: false,
        rms: 0,
      };
    }

    const detection = this.analyzer.analyzeFrame(this.onsetThreshold, this.prevRms);
    const rms = Number.isFinite(detection.rms) ? detection.rms : 0;
    this.prevRms = rms;

    const rawPitch = detection.pitch || {};
    const pitch = {
      frequency: Number.isFinite(rawPitch.frequency) ? rawPitch.frequency : 0,
      midi: Number.isFinite(rawPitch.midi) ? rawPitch.midi : 0,
      confidence: Number.isFinite(rawPitch.confidence) ? rawPitch.confidence : 0,
    };

    return {
      time,
      pitch,
      onset: Boolean(detection.onset),
      rms,
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
