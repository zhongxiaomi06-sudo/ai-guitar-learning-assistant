/**
 * utils/storage.js - 本地存储封装
 * 支持 localStorage / sessionStorage，自动 JSON 序列化，带错误处理
 */

import { safeJSON } from './tools.js';

const StorageType = {
  LOCAL: 'localStorage',
  SESSION: 'sessionStorage',
};

function getStorage(type) {
  return type === StorageType.SESSION ? window.sessionStorage : window.localStorage;
}

function createStorage(type) {
  const storage = getStorage(type);

  return {
    /**
     * 设置值
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch (err) {
        console.warn(`[storage] set failed: ${key}`, err);
      }
    },

    /**
     * 获取值
     * @param {string} key
     * @param {*} defaultValue
     * @returns {*}
     */
    get(key, defaultValue = null) {
      try {
        const item = storage.getItem(key);
        return item === null ? defaultValue : safeJSON(item, defaultValue);
      } catch (err) {
        console.warn(`[storage] get failed: ${key}`, err);
        return defaultValue;
      }
    },

    /**
     * 移除值
     * @param {string} key
     */
    remove(key) {
      try {
        storage.removeItem(key);
      } catch (err) {
        console.warn(`[storage] remove failed: ${key}`, err);
      }
    },

    /**
     * 清空
     */
    clear() {
      try {
        storage.clear();
      } catch (err) {
        console.warn('[storage] clear failed', err);
      }
    },

    /**
     * 是否存在
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
      return storage.getItem(key) !== null;
    },
  };
}

export const local = createStorage(StorageType.LOCAL);
export const session = createStorage(StorageType.SESSION);

export default { local, session };
