/**
 * features/scorePanel/index.js
 * 乐谱面板 UI 控制器
 */

import { ScoreRenderer } from '../../core/score/renderer.js';
import { HandShapeRenderer } from '../../core/score/handShape.js';

/**
 * 乐谱面板
 */
export class ScorePanel {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.scoreContainer = this.container.querySelector('[data-score]');
    this.leftHandContainer = this.container.querySelector('[data-left-hand]');
    this.rightHandContainer = this.container.querySelector('[data-right-hand]');

    this.scoreRenderer = new ScoreRenderer(this.scoreContainer);
    this.leftHandRenderer = new HandShapeRenderer(this.leftHandContainer);
    this.rightHandRenderer = new HandShapeRenderer(this.rightHandContainer);
  }

  /**
   * 渲染谱面
   * @param {import('../../shared/types/index.js').Project} project
   * @param {number} currentTime
   */
  render(project, currentTime) {
    this.scoreRenderer.render(project, currentTime);
  }

  /**
   * 渲染手型
   * @param {import('../../shared/types/index.js').Note} note
   */
  renderHandShapes(note) {
    if (!note) return;
    this.leftHandRenderer.renderLeftHand(note.leftHandShape);
    this.rightHandRenderer.renderRightHand(note.rightHandShape);
  }

  /**
   * 清空
   */
  clear() {
    this.scoreRenderer.clear();
  }
}

export default ScorePanel;
