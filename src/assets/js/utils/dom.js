/**
 * utils/dom.js - DOM 操作工具
 */

/**
 * 选择单个元素
 * @param {string} selector
 * @param {Element|Document} context
 * @returns {Element|null}
 */
export function $(selector, context = document) {
  return context.querySelector(selector);
}

/**
 * 选择全部元素
 * @param {string} selector
 * @param {Element|Document} context
 * @returns {Element[]}
 */
export function $$(selector, context = document) {
  return Array.from(context.querySelectorAll(selector));
}

/**
 * 绑定事件
 * @param {Element} el
 * @param {string} type
 * @param {Function} handler
 * @param {object|boolean} options
 */
export function on(el, type, handler, options = {}) {
  el.addEventListener(type, handler, options);
}

/**
 * 解绑事件
 * @param {Element} el
 * @param {string} type
 * @param {Function} handler
 * @param {object|boolean} options
 */
export function off(el, type, handler, options = {}) {
  el.removeEventListener(type, handler, options);
}

/**
 * 一次性事件
 * @param {Element} el
 * @param {string} type
 * @param {Function} handler
 */
export function once(el, type, handler) {
  const wrapped = (event) => {
    handler(event);
    off(el, type, wrapped);
  };
  on(el, type, wrapped);
}

/**
 * 添加 CSS 类
 * @param {Element} el
 * @param {string} className
 */
export function addClass(el, className) {
  el.classList.add(className);
}

/**
 * 移除 CSS 类
 * @param {Element} el
 * @param {string} className
 */
export function removeClass(el, className) {
  el.classList.remove(className);
}

/**
 * 切换 CSS 类
 * @param {Element} el
 * @param {string} className
 * @param {boolean} force
 */
export function toggleClass(el, className, force) {
  el.classList.toggle(className, force);
}

/**
 * 是否有 CSS 类
 * @param {Element} el
 * @param {string} className
 * @returns {boolean}
 */
export function hasClass(el, className) {
  return el.classList.contains(className);
}

/**
 * 设置/获取 data 属性
 * @param {Element} el
 * @param {string} key
 * @param {string} [value]
 */
export function data(el, key, value) {
  if (value === undefined) {
    return el.dataset[key];
  }
  el.dataset[key] = value;
}

/**
 * 创建元素
 * @param {string} tag
 * @param {object} attrs
 * @param {string|Element[]} children
 * @returns {Element}
 */
export function createElement(tag, attrs = {}, children = '') {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else {
      el.setAttribute(key, value);
    }
  }
  if (Array.isArray(children)) {
    children.forEach((child) => el.appendChild(child));
  } else if (children) {
    el.innerHTML = children;
  }
  return el;
}

/**
 * 将 HTML 字符串插入到容器
 * @param {Element} container
 * @param {string} html
 */
export function setHTML(container, html) {
  container.innerHTML = html;
}

/**
 * 清空容器
 * @param {Element} container
 */
export function empty(container) {
  container.innerHTML = '';
}

/**
 * 安全的模板转义
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 获取元素相对视口的位置信息
 * @param {Element} el
 * @returns {DOMRect}
 */
export function rect(el) {
  return el.getBoundingClientRect();
}

export default {
  $,
  $$,
  on,
  off,
  once,
  addClass,
  removeClass,
  toggleClass,
  hasClass,
  data,
  createElement,
  setHTML,
  empty,
  escapeHTML,
  rect,
};
