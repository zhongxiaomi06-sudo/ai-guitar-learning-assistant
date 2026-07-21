/**
 * core/matching/scoring.js
 * 评分系统：统计准确率、连击、小节通过率
 */

/**
 * 评分系统
 */
export class ScoringSystem {
  constructor() {
    this.results = [];
  }

  /**
   * 添加匹配结果
   * @param {import('../../shared/types/index.js').MatchResult} result
   */
  add(result) {
    this.results.push(result);
  }

  /**
   * 获取准确率
   * @returns {number}
   */
  accuracy() {
    if (this.results.length === 0) return 0;
    const hits = this.results.filter((r) => r.score === 'perfect' || r.score === 'good').length;
    return hits / this.results.length;
  }

  /**
   * 获取当前连击数
   * @returns {number}
   */
  streak() {
    let count = 0;
    for (let i = this.results.length - 1; i >= 0; i--) {
      if (this.results[i].score === 'perfect' || this.results[i].score === 'good') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * 计算小节得分
   * @param {string} barId
   * @returns {number}
   */
  barScore(barId) {
    const barResults = this.results.filter((r) => r.targetNote?.barId === barId);
    if (barResults.length === 0) return 0;
    return barResults.filter((r) => r.score !== 'miss').length / barResults.length;
  }

  /**
   * 重置
   */
  reset() {
    this.results = [];
  }
}

export default ScoringSystem;
