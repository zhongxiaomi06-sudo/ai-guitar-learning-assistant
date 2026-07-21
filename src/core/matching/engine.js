/**
 * core/matching/engine.js
 * 匹配引擎：实时比对目标谱面与用户演奏
 */

import { pitchDeviationCents } from '../../shared/utils/index.js';
import {
  THRESHOLD_PERFECT_PITCH,
  THRESHOLD_GOOD_PITCH,
  THRESHOLD_PERFECT_TIME,
  THRESHOLD_GOOD_TIME,
} from '../../shared/constants/index.js';

/**
 * 匹配引擎
 */
export class MatchingEngine {
  /**
   * @param {import('../score/model.js').ScoreModel} scoreModel
   */
  constructor(scoreModel) {
    this.scoreModel = scoreModel;
    this.lastMatchTime = -1;
  }

  /**
   * 匹配当前演奏
   * @param {number} videoTime
   * @param {import('../../shared/types/index.js').PlayedNote} playedNote
   * @returns {import('../../shared/types/index.js').MatchResult}
   */
  match(videoTime, playedNote) {
    const targetNote = this.scoreModel.getNoteAtTime(videoTime);

    if (!targetNote) {
      return this.createResult(videoTime, null, playedNote, 'extra', '此段无目标音符');
    }

    const energy = Number(playedNote?.rms ?? playedNote?.velocity ?? 0);
    if (!playedNote || energy < 0.01 || !Number.isFinite(playedNote.pitch) || playedNote.pitch <= 0) {
      return this.createResult(videoTime, targetNote, null, 'miss', '未检测到声音');
    }

    // 判定阈值以毫秒定义；调用方必须把 onsetTime 映射到视频时间轴。
    const timingDeviation = (playedNote.onsetTime - targetNote.startTime) * 1000;
    const pitchDeviation = this.computePitchDeviation(playedNote, targetNote);

    if (Math.abs(timingDeviation) > THRESHOLD_GOOD_TIME && Math.abs(pitchDeviation) > THRESHOLD_GOOD_PITCH) {
      return this.createResult(videoTime, targetNote, playedNote, 'wrong-pitch', '音高和节奏均不匹配', 'miss', pitchDeviation, timingDeviation);
    }

    if (Math.abs(pitchDeviation) > THRESHOLD_GOOD_PITCH) {
      return this.createResult(videoTime, targetNote, playedNote, 'wrong-pitch', '音高偏差较大', 'miss', pitchDeviation, timingDeviation);
    }

    if (Math.abs(timingDeviation) > THRESHOLD_GOOD_TIME) {
      return this.createResult(videoTime, targetNote, playedNote, 'miss', '节奏偏差较大', 'miss', pitchDeviation, timingDeviation);
    }

    const score = Math.abs(pitchDeviation) <= THRESHOLD_PERFECT_PITCH &&
      Math.abs(timingDeviation) <= THRESHOLD_PERFECT_TIME ? 'perfect' : 'good';

    return this.createResult(videoTime, targetNote, playedNote, 'correct', score === 'perfect' ? '完美！' : '不错', score, pitchDeviation, timingDeviation);
  }

  /**
   * 计算音高偏差
   * @param {import('../../shared/types/index.js').PlayedNote} playedNote
   * @param {import('../../shared/types/index.js').Note} targetNote
   * @returns {number}
   */
  computePitchDeviation(playedNote, targetNote) {
    if (targetNote.type === 'chord') {
      // 和弦：找到最匹配的音
      const deviations = targetNote.notes.map((n) => {
        const targetFreq = midiToFreq(this.noteToMidi(n));
        return pitchDeviationCents(playedNote.pitch, targetFreq);
      });
      return Math.min(...deviations.map(Math.abs));
    }
    const targetFreq = midiToFreq(this.noteToMidi(targetNote));
    return pitchDeviationCents(playedNote.pitch, targetFreq);
  }

  /**
   * 音符转 MIDI
   * @param {{ string: number, fret: number }} note
   * @returns {number}
   */
  noteToMidi(note) {
    // 标准调音 E2=40, A2=45, D3=50, G3=55, B3=59, E4=64
    const baseMidi = [64, 59, 55, 50, 45, 40];
    return baseMidi[note.string - 1] + note.fret;
  }

  /**
   * 创建匹配结果
   * @param {number} currentTime
   * @param {import('../../shared/types/index.js').Note | null} targetNote
   * @param {import('../../shared/types/index.js').PlayedNote | null} playedNote
   * @param {string} type
   * @param {string} suggestion
   * @param {string} score
   * @param {number} pitchDeviation
   * @param {number} timingDeviation
   * @returns {import('../../shared/types/index.js').MatchResult}
   */
  createResult(
    currentTime,
    targetNote,
    playedNote,
    type,
    suggestion,
    score = 'miss',
    pitchDeviation = 0,
    timingDeviation = 0,
  ) {
    return {
      currentTime,
      targetNote,
      playedNote,
      score,
      pitchDeviation,
      timingDeviation,
      type,
      suggestion,
    };
  }
}

// 辅助函数：MIDI 转频率
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export default MatchingEngine;
