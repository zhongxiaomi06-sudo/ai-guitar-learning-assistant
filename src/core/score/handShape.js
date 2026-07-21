/**
 * core/score/handShape.js
 * 基于谱面生成左手按弦/右手拨弦示意图
 */

/**
 * 手型生成器
 */
export class HandShapeRenderer {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
  }

  /**
   * 渲染左手按弦图
   * @param {import('../../shared/types/index.js').HandShape} shape
   */
  renderLeftHand(shape) {
    // TODO: 用 SVG 绘制吉他指板和手指位置
    this.container.innerHTML = `
      <div class="hand-shape">
        <p>左手按弦：${shape.type}</p>
        <pre>${JSON.stringify(shape.fingerPositions, null, 2)}</pre>
      </div>
    `;
  }

  /**
   * 渲染右手拨弦/扫弦图
   * @param {import('../../shared/types/index.js').PickShape} shape
   */
  renderRightHand(shape) {
    // TODO: 用箭头/图标表示拨弦方向
    this.container.innerHTML = `
      <div class="pick-shape">
        <p>右手拨弦：${shape.direction}</p>
        <p>弦：${shape.strings.join(', ')}</p>
      </div>
    `;
  }

  /**
   * 根据音符生成左手手型
   * @param {import('../../shared/types/index.js').Note} note
   * @returns {import('../../shared/types/index.js').HandShape}
   */
  static generateLeftHandShape(note) {
    if (note.type === 'chord') {
      return {
        type: 'barre',
        fingerPositions: note.notes.map((n) => ({ finger: 1, string: n.string, fret: n.fret })),
      };
    }
    return {
      type: 'single',
      fingerPositions: [{ finger: 1, string: note.string, fret: note.fret }],
    };
  }

  /**
   * 根据音符生成右手拨弦方式
   * @param {import('../../shared/types/index.js').Note} note
   * @returns {import('../../shared/types/index.js').PickShape}
   */
  static generateRightHandShape(note) {
    const strings = note.type === 'chord' ? note.notes.map((n) => n.string) : [note.string];
    return {
      direction: note.type === 'chord' ? 'strum-down' : 'down',
      strings,
    };
  }
}

export default HandShapeRenderer;
