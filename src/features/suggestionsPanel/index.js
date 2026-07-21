/**
 * features/suggestionsPanel/index.js
 * 建议面板：实时反馈、下一步提示、统计
 */

import { FeedbackGenerator } from '../../core/matching/feedback.js';

/**
 * 建议面板
 */
export class SuggestionsPanel {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.feedbackEl = this.container.querySelector('[data-feedback]');
    this.nextHintEl = this.container.querySelector('[data-next-hint]');
    this.statsEl = this.container.querySelector('[data-stats]');
  }

  /**
   * 显示匹配反馈
   * @param {import('../../shared/types/index.js').MatchResult} result
   */
  showFeedback(result) {
    if (!this.feedbackEl) return;
    this.feedbackEl.textContent = FeedbackGenerator.generate(result);
    this.feedbackEl.setAttribute('data-type', result.type);
  }

  /**
   * 显示下一步提示
   * @param {import('../../shared/types/index.js').Note} nextNote
   */
  showNextHint(nextNote) {
    if (!this.nextHintEl) return;
    this.nextHintEl.textContent = FeedbackGenerator.nextHint(nextNote);
  }

  /**
   * 更新统计
   * @param {import('../../core/matching/scoring.js').ScoringSystem} scoring
   */
  updateStats(scoring) {
    if (!this.statsEl) return;
    this.statsEl.innerHTML = `
      <span>准确率: ${(scoring.accuracy() * 100).toFixed(1)}%</span>
      <span>连击: ${scoring.streak()}</span>
    `;
  }
}

export default SuggestionsPanel;
