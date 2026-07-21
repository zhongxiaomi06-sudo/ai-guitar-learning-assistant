/**
 * core/device.js - 设备/环境检测
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/**
 * 是否移动设备（粗略判断）
 * @returns {boolean}
 */
export function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(ua);
}

/**
 * 是否桌面设备
 * @returns {boolean}
 */
export function isDesktop() {
  return !isMobile();
}

/**
 * 是否 iOS
 * @returns {boolean}
 */
export function isIOS() {
  return /iPhone|iPad|iPod/i.test(ua);
}

/**
 * 是否 Android
 * @returns {boolean}
 */
export function isAndroid() {
  return /Android/i.test(ua);
}

/**
 * 是否微信
 * @returns {boolean}
 */
export function isWeChat() {
  return /MicroMessenger/i.test(ua);
}

/**
 * 是否刘海屏/安全区设备
 * @returns {boolean}
 */
export function hasSafeArea() {
  return isIOS() && !/iPod/.test(ua);
}

/**
 * 是否支持触摸
 * @returns {boolean}
 */
export function isTouch() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * 是否 Retina/高清屏
 * @returns {boolean}
 */
export function isRetina() {
  return window.devicePixelRatio >= 2;
}

/**
 * 当前屏幕方向
 * @returns {string} 'portrait' | 'landscape'
 */
export function orientation() {
  const angle = window.screen.orientation?.angle ?? 0;
  return angle === 90 || angle === 270 ? 'landscape' : 'portrait';
}

/**
 * 获取设备信息摘要
 * @returns {object}
 */
export function getInfo() {
  return {
    mobile: isMobile(),
    desktop: isDesktop(),
    ios: isIOS(),
    android: isAndroid(),
    wechat: isWeChat(),
    touch: isTouch(),
    retina: isRetina(),
    safeArea: hasSafeArea(),
    orientation: orientation(),
    dpr: window.devicePixelRatio,
    width: window.innerWidth,
    height: window.innerHeight,
    ua,
  };
}

export default {
  isMobile,
  isDesktop,
  isIOS,
  isAndroid,
  isWeChat,
  hasSafeArea,
  isTouch,
  isRetina,
  orientation,
  getInfo,
};
