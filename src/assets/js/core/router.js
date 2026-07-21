/**
 * core/router.js - 基于 hash 的轻量级前端路由
 */

import { bus } from './events.js';

const ROUTE_CHANGE = 'route:change';
const ROUTE_NOT_FOUND = 'route:notFound';

class Router {
  constructor() {
    this.routes = new Map();
    this.beforeHooks = [];
    this.current = null;
  }

  /**
   * 注册路由
   * @param {string} path
   * @param {Function} handler
   * @returns {Router}
   */
  on(path, handler) {
    this.routes.set(this.normalize(path), handler);
    return this;
  }

  /**
   * 注册 404 处理
   * @param {Function} handler
   */
  notFound(handler) {
    this.routes.set('*', handler);
  }

  /**
   * 全局前置钩子
   * @param {Function} hook
   */
  beforeEach(hook) {
    this.beforeHooks.push(hook);
  }

  /**
   * 规范化路径
   * @param {string} path
   * @returns {string}
   */
  normalize(path) {
    return path.replace(/^#/, '').replace(/\/$/, '') || '/';
  }

  /**
   * 获取当前路径
   * @returns {string}
   */
  getPath() {
    return this.normalize(window.location.hash || '#/');
  }

  /**
   * 获取当前查询参数
   * @returns {URLSearchParams}
   */
  getQuery() {
    return new URLSearchParams(window.location.search);
  }

  /**
   * 导航到指定路径
   * @param {string} path
   */
  push(path) {
    window.location.hash = path.startsWith('#') ? path : `#${path}`;
  }

  /**
   * 替换当前路径
   * @param {string} path
   */
  replace(path) {
    window.location.replace(path.startsWith('#') ? path : `#${path}`);
  }

  /**
   * 解析路由
   */
  resolve() {
    const path = this.getPath();
    const handler = this.routes.get(path) || this.routes.get('*');

    const context = {
      path,
      query: this.getQuery(),
      params: {},
      from: this.current,
    };

    this.current = path;

    const run = async () => {
      for (const hook of this.beforeHooks) {
        const result = await hook(context);
        if (result === false) return;
      }
      if (handler) {
        handler(context);
        bus.emit(ROUTE_CHANGE, context);
      } else {
        bus.emit(ROUTE_NOT_FOUND, context);
      }
    };

    run().catch((err) => {
      console.error('[Router] resolve error:', err);
    });
  }

  /**
   * 启动路由监听
   */
  start() {
    window.addEventListener('hashchange', () => this.resolve(), { passive: true });
    window.addEventListener('DOMContentLoaded', () => this.resolve(), { once: true });
  }
}

export const router = new Router();
export { ROUTE_CHANGE, ROUTE_NOT_FOUND };

export default router;
