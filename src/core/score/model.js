/**
 * core/score/model.js
 * 谱面数据模型：创建、查询、操作谱面
 */

import { uid } from '../../shared/utils/index.js';

/**
 * 谱面模型
 */
export class ScoreModel {
  /**
   * @param {import('../../shared/types/index.js').Project} project
   */
  constructor(project) {
    this.project = project;
    this.notes = this.flattenNotes();
  }

  /**
   * 将所有音符打平成数组
   * @returns {import('../../shared/types/index.js').Note[]}
   */
  flattenNotes() {
    const notes = [];
    for (const bar of this.project.bars) {
      for (const note of bar.beats.flatMap((b) => b.notes || [])) {
        notes.push(note);
      }
    }
    return notes.sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * 根据视频时间获取当前小节
   * @param {number} videoTime
   * @returns {import('../../shared/types/index.js').Bar | null}
   */
  getBarAtTime(videoTime) {
    return this.project.bars.find((bar) => videoTime >= bar.startTime && videoTime < bar.endTime) || null;
  }

  /**
   * 根据视频时间获取当前音符
   * @param {number} videoTime
   * @returns {import('../../shared/types/index.js').Note | null}
   */
  getNoteAtTime(videoTime) {
    return this.notes.find((note) => videoTime >= note.startTime && videoTime < note.endTime) || null;
  }

  /**
   * 获取当前及 upcoming 音符
   * @param {number} videoTime
   * @param {number} lookahead 秒
   * @returns {import('../../shared/types/index.js').Note[]}
   */
  getUpcomingNotes(videoTime, lookahead = 2) {
    return this.notes.filter((note) => note.startTime >= videoTime && note.startTime <= videoTime + lookahead);
  }

  /**
   * 从导入数据创建谱面
   * @param {object} raw
   * @returns {import('../../shared/types/index.js').Project}
   */
  static fromImport(raw) {
    // TODO: 支持 MIDI / Guitar Pro / 自定义 JSON 导入
    return {
      id: raw.id || uid('project'),
      title: raw.title || 'Untitled',
      sourceVideoUrl: raw.sourceVideoUrl || '',
      localVideoPath: raw.localVideoPath || '',
      duration: raw.duration || 0,
      bpm: raw.bpm || 120,
      timeSignature: raw.timeSignature || [4, 4],
      key: raw.key || 'C',
      bars: raw.bars || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export default ScoreModel;
