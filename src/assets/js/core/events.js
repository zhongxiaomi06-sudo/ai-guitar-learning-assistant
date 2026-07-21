/**
 * core/events.js - 全局事件总线（发布订阅）
 */

class EventBus {
  constructor() {
    this.events = new Map();
  }

  /**
   * 订阅事件
   * @param {string} name
   * @param {Function} handler
   */
  on(name, handler) {
    if (!this.events.has(name)) {
      this.events.set(name, new Set());
    }
    this.events.get(name).add(handler);
  }

  /**
   * 取消订阅
   * @param {string} name
   * @param {Function} handler
   */
  off(name, handler) {
    const handlers = this.events.get(name);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this.events.delete(name);
    }
  }

  /**
   * 发布事件
   * @param {string} name
   * @param {...*} args
   */
  emit(name, ...args) {
    const handlers = this.events.get(name);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(...args);
        } catch (err) {
          console.error(`[EventBus] emit error in "${name}":`, err);
        }
      });
    }
  }

  /**
   * 订阅一次性事件
   * @param {string} name
   * @param {Function} handler
   */
  once(name, handler) {
    const wrapper = (...args) => {
      this.off(name, wrapper);
      handler(...args);
    };
    this.on(name, wrapper);
  }
}

export const bus = new EventBus();

export default bus;
