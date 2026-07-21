/**
 * core/matching/feedback.js
 * 反馈生成：将匹配结果转化为用户可理解的建议
 */

/**
 * 反馈生成器
 */
export class FeedbackGenerator {
  /**
   * @param {import('../../shared/types/index.js').MatchResult} result
   * @returns {string}
   */
  static generate(result) {
    if (!result.targetNote) {
      return '此段没有目标音符，保持准备。';
    }

    const { string, fret, chordName } = result.targetNote;
    const targetName = chordName || `第 ${string} 弦 ${fret} 品`;

    switch (result.type) {
      case 'correct':
        return result.score === 'perfect' ? '完美！' : '不错，继续保持。';
      case 'wrong-pitch':
        return `${targetName} 音高不准，检查品位。`;
      case 'wrong-string':
        return `弹错弦了，目标为 ${targetName}。`;
      case 'miss':
        return `漏了 ${targetName}，注意节奏。`;
      case 'extra':
        return '多弹了音，保持冷静。';
      default:
        return result.suggestion;
    }
  }

  /**
   * 生成下一步提示
   * @param {import('../../shared/types/index.js').Note} nextNote
   * @returns {string}
   */
  static nextHint(nextNote) {
    if (!nextNote) return '练习结束';
    const { chordName, string, fret } = nextNote;
    return chordName
      ? `准备和弦：${chordName}`
      : `准备：第 ${string} 弦 ${fret} 品`;
  }
}

export default FeedbackGenerator;
