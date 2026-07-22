/**
 * core/score/timelineModel.js
 * 将后端统一时间轴（timeline）适配为 MatchingEngine 可用的谱面模型。
 */

const STRING_OPEN_MIDI = [64, 59, 55, 50, 45, 40];

/**
 * @typedef {Object} TimelineEvent
 * @property {string} id
 * @property {string} type
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} measureIndex
 * @property {number} beatPosition
 * @property {number} pitch
 * @property {number} string
 * @property {number} fret
 * @property {string} [chord]
 * @property {object} [leftHandShape]
 * @property {object} [rightHandShape]
 * @property {number} [tolerance]
 */

export class TimelineModel {
  /**
   * @param {TimelineEvent[]} timeline
   */
  constructor(timeline) {
    this.events = Array.isArray(timeline) ? timeline : [];
    this.noteEvents = this.events
      .filter((e) => e.type === 'note' || e.type === 'chord')
      .map((e) => this._normalize(e))
      .filter(Boolean)
      .sort((a, b) => a.startTime - b.startTime);
  }

  _normalize(event) {
    // 优先使用 videoTime（视频时钟），因为播放器 currentTime 与谱面高亮、
    // 匹配判定都在视频时间轴上；audioTime 仅作为音频分析参考。
    const startTime = Number(event.videoTime ?? event.startTime ?? 0);
    const endTime = Number(event.endTime ?? (startTime + 0.3));
    const stringNumber = Number(event.string);
    const fret = Number(event.fret);
    const pitch = Number(event.pitch);

    if (!Number.isFinite(startTime) || startTime < 0) return null;
    if (!Number.isInteger(stringNumber) || stringNumber < 1 || stringNumber > 6) return null;
    if (!Number.isInteger(fret) || fret < 0 || fret > 36) return null;

    const midi = Number.isFinite(pitch) && pitch > 0
      ? pitch
      : STRING_OPEN_MIDI[stringNumber - 1] + fret;

    return {
      id: event.id || `evt-${startTime}-${stringNumber}-${fret}`,
      type: event.type === 'chord' ? 'chord' : 'single',
      startTime,
      endTime,
      string: stringNumber,
      fret,
      midi,
      measureIndex: Number(event.measureIndex ?? 0),
      beatPosition: Number(event.beatPosition ?? 0),
      chord: event.chord,
      leftHandShape: event.leftHandShape,
      rightHandShape: event.rightHandShape,
      tolerance: Number(event.tolerance ?? 0.08),
    };
  }

  /**
   * 根据视频时间获取当前事件。
   * 如果当前时间落在多个同时发声的音符内，返回一个和弦对象。
   * @param {number} videoTime
   * @returns {object | null}
   */
  getNoteAtTime(videoTime) {
    const candidates = this.noteEvents.filter(
      (note) => videoTime >= note.startTime && videoTime < note.endTime,
    );
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    // 同时发声：合并为和弦对象
    return {
      id: `chord-${candidates[0].startTime}`,
      type: 'chord',
      startTime: candidates[0].startTime,
      endTime: Math.max(...candidates.map((n) => n.endTime)),
      notes: candidates.map((n) => ({ string: n.string, fret: n.fret, midi: n.midi })),
      measureIndex: candidates[0].measureIndex,
      beatPosition: candidates[0].beatPosition,
      tolerance: candidates[0].tolerance,
    };
  }

  /**
   * 获取指定小节范围的事件
   * @param {number} startMeasure
   * @param {number} endMeasure
   * @returns {object[]}
   */
  getEventsInMeasures(startMeasure, endMeasure) {
    return this.noteEvents.filter(
      (note) => note.measureIndex >= startMeasure && note.measureIndex <= endMeasure,
    );
  }

  /**
   * 获取当前及 upcoming 事件
   * @param {number} videoTime
   * @param {number} lookahead
   * @returns {object[]}
   */
  getUpcomingNotes(videoTime, lookahead = 2) {
    return this.noteEvents.filter(
      (note) => note.startTime >= videoTime && note.startTime <= videoTime + lookahead,
    );
  }
}

export default TimelineModel;
