/**
 * core/score/renderer.js
 * 六线谱渲染器
 */

/**
 * 六线谱渲染器
 */
export class ScoreRenderer {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * 渲染谱面
   * @param {import('../../shared/types/index.js').Project} _project
   * @param {number} _currentTime
   */
  render(_project, _currentTime) {
    // TODO: 使用 Canvas 或 SVG 渲染六线谱
    const width = this.container.clientWidth;
    const height = 300;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.clearRect(0, 0, width, height);

    // 绘制 6 根弦
    const stringCount = 6;
    const spacing = height / (stringCount + 1);
    this.ctx.strokeStyle = '#64748b';
    this.ctx.lineWidth = 1;
    for (let i = 1; i <= stringCount; i++) {
      const y = i * spacing;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }

    // 绘制当前位置指示线
    this.ctx.strokeStyle = '#ef4444';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(width * 0.2, 0);
    this.ctx.lineTo(width * 0.2, height);
    this.ctx.stroke();
  }

  /**
   * 清空画布
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export default ScoreRenderer;
