/**
 * features/settingsPanel/index.js
 * 设置面板：速度、模式、循环、难度、设备
 */

/**
 * 设置面板
 */
export class SettingsPanel {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.callbacks = {};
  }

  /**
   * 绑定设置变更
   * @param {string} name
   * @param {Function} callback
   */
  onChange(name, callback) {
    this.callbacks[name] = callback;
  }

  /**
   * 初始化设置控件事件
   */
  init() {
    const speedInput = this.container.querySelector('[data-setting="speed"]');
    if (speedInput) {
      speedInput.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        this.callbacks.speed?.(value);
      });
    }

    const modeInput = this.container.querySelector('[data-setting="matchMode"]');
    if (modeInput) {
      modeInput.addEventListener('change', (e) => {
        this.callbacks.matchMode?.(e.target.value);
      });
    }

    const difficultyInput = this.container.querySelector('[data-setting="difficulty"]');
    if (difficultyInput) {
      difficultyInput.addEventListener('change', (e) => {
        this.callbacks.difficulty?.(e.target.value);
      });
    }

    const autoSlowInput = this.container.querySelector('[data-setting="autoSlowDown"]');
    if (autoSlowInput) {
      autoSlowInput.addEventListener('change', (e) => {
        this.callbacks.autoSlowDown?.(e.target.checked);
      });
    }

    const deviceInput = this.container.querySelector('[data-setting="inputDevice"]');
    if (deviceInput) {
      deviceInput.addEventListener('change', (e) => {
        this.callbacks.inputDevice?.(e.target.value);
      });
    }
  }

  /**
   * 渲染音频设备列表
   * @param {MediaDeviceInfo[]} devices
   */
  renderDevices(devices) {
    const deviceInput = this.container.querySelector('[data-setting="inputDevice"]');
    if (!deviceInput) return;

    deviceInput.innerHTML = devices.map((d) => `
      <option value="${d.deviceId}">${d.label || d.deviceId}</option>
    `).join('');
  }
}

export default SettingsPanel;
