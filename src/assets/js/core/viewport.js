/**
 * core/viewport.js - 视口适配与缩放控制
 * 移动端使用 rem + 1px 边框处理，电脑端保持 px 原生
 */

import { isMobile } from './device.js';
import { debounce } from '../utils/tools.js';

const BASE_WIDTH = 375; // 设计稿基准宽度（iPhone 标准）
const MAX_FONT_SIZE = 24; // 防止平板字号过大

/**
 * 设置移动端 rem 根字号
 */
function setMobileRem() {
  const width = Math.min(window.innerWidth, window.screen.width);
  let fontSize = (width / BASE_WIDTH) * 16;
  fontSize = Math.min(fontSize, MAX_FONT_SIZE);
  document.documentElement.style.fontSize = `${fontSize}px`;
}

/**
 * 重置 rem（用于电脑端）
 */
function resetRem() {
  document.documentElement.style.fontSize = '';
}

/**
 * 初始化视口适配
 */
export function initViewport() {
  if (isMobile()) {
    setMobileRem();
    const onResize = debounce(setMobileRem, 150);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
  } else {
    resetRem();
  }
}

/**
 * 获取当前缩放比例（rem / 16）
 * @returns {number}
 */
export function getScale() {
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return fs / 16 || 1;
}

/**
 * 将 rem 转为 px（仅移动端有效）
 * @param {number} rem
 * @returns {number}
 */
export function rem2px(rem) {
  return rem * getScale() * 16;
}

/**
 * 1px 边框处理：根据 dpr 缩放
 * @returns {number}
 */
export function onePx() {
  const dpr = window.devicePixelRatio || 1;
  return dpr >= 2 ? 1 / dpr : 1;
}

export default {
  initViewport,
  getScale,
  rem2px,
  onePx,
};
