/**
 * features/matchingPanel/index.js
 * 匹配 UI 面板：音游式 / KTV 式
 */

/**
 * 匹配面板
 */
export class MatchingPanel {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.mode = 'game';
  }

  /**
   * 设置显示模式
   * @param {'game' | 'ktv'} mode
   */
  setMode(mode) {
    this.mode = mode;
    this.container.setAttribute('data-mode', mode);
  }

  /**
   * 渲染音游式下落轨道
   * @param {import('../../shared/types/index.js').Note[]} upcomingNotes
   * @param {number} _currentTime
   */
  renderGame(upcomingNotes, _currentTime) {
    // TODO: Canvas 渲染下落音符
    this.container.innerHTML = `<p>音游模式 -  upcoming notes: ${upcomingNotes.length}</p>`;
  }

  /**
   * 渲染 KTV 音高条
   * @param {number} targetPitch
   * @param {number} userPitch
   */
  renderKTV(targetPitch, userPitch) {
    // TODO: SVG/Canvas 绘制音高曲线
    this.container.innerHTML = `<p>KTV 模式 - target: ${targetPitch.toFixed(1)}, user: ${userPitch.toFixed(1)}</p>`;
  }

  /**
   * 更新匹配结果
   * @param {import('../../shared/types/index.js').MatchResult} result
   */
  updateResult(result) {
    this.container.setAttribute('data-result', result.score);
  }
}

export default MatchingPanel;
