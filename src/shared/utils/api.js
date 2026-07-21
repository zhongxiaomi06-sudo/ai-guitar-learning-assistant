/**
 * shared/utils/api.js
 * 后端 API 客户端（最小版本）
 */

const API_BASE = import.meta.env?.VITE_API_BASE || 'http://127.0.0.1:8000';

/**
 * 通用 GET
 * @param {string} path
 * @returns {Promise<any>}
 */
export async function get(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
  return resp.json();
}

/**
 * 通用 POST（JSON）
 * @param {string} path
 * @param {object} body
 * @returns {Promise<any>}
 */
export async function postJSON(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
  return resp.json();
}

/**
 * 通用 POST（multipart/form-data）
 * @param {string} path
 * @param {FormData} formData
 * @returns {Promise<any>}
 */
export async function postForm(path, formData) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
  return resp.json();
}

/**
 * 课程 API
 */
export const courses = {
  list: () => get('/api/v1/courses'),
  get: (id) => get(`/api/v1/courses/${id}`),
  upload: (file, title) => {
    const form = new FormData();
    form.append('video', file);
    if (title) form.append('title', title);
    return postForm('/api/v1/courses/upload', form);
  },
  fromUrl: (url, title) =>
    postJSON('/api/v1/courses/from-url', { source_url: url, title }),
  delete: (id) => fetch(`${API_BASE}/api/v1/courses/${id}`, { method: 'DELETE' }),
  getVideoUrl: (id) => `${API_BASE}/api/v1/courses/${id}/video`,
  getScore: (id) => get(`/api/v1/courses/${id}/score`),
};
