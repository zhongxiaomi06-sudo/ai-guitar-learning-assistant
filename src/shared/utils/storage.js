/**
 * shared/utils/storage.js
 * 本地存储封装（基于现有 assets/js/utils/storage.js 的轻量版本）
 */

function safeJSON(value, defaultValue = null) {
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

const storage = {
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[storage] set failed', err);
    }
  },

  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item === null ? defaultValue : safeJSON(item, defaultValue);
    } catch (err) {
      console.warn('[storage] get failed', err);
      return defaultValue;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn('[storage] remove failed', err);
    }
  },
};

export const local = storage;

export default { local };
