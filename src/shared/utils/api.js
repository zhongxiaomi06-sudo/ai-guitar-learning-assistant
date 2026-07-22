/**
 * shared/utils/api.js
 * Small, defensive client for the course backend.
 */

// Production defaults to same-origin /api. The localhost fallback is dev-only,
// so a deployed static page never probes services on the visitor's computer.
export const API_BASE = (import.meta.env?.VITE_API_BASE
  || (import.meta.env?.DEV ? 'http://127.0.0.1:8000' : ''))
  .replace(/\/+$/, '');

const DEFAULT_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export class ApiError extends Error {
  constructor(message, { status = 0, detail = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function buildUrl(path) {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readError(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    if (typeof payload.detail === 'string') return payload.detail;
    return payload.detail || payload;
  } catch {
    return text;
  }
}

/**
 * Run an API request with consistent timeout, error, 204, and JSON handling.
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number }} options
 * @returns {Promise<any>}
 */
export async function request(path, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    headers = {},
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(buildUrl(path), {
      ...fetchOptions,
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await readError(response);
      const message = typeof detail === 'string'
        ? detail
        : `${fetchOptions.method || 'GET'} ${path} 请求失败（${response.status}）`;
      throw new ApiError(message, { status: response.status, detail });
    }
    if (response.status === 204) return null;

    const text = await response.text();
    if (!text) return null;
    const contentType = response.headers.get('content-type') || '';
    const trimmedText = text.trimStart();
    const looksLikeJson = trimmedText.startsWith('{') || trimmedText.startsWith('[');
    if (contentType.includes('json') || looksLikeJson) {
      try {
        return JSON.parse(text);
      } catch (cause) {
        throw new ApiError('服务端返回了无效的 JSON', {
          status: response.status,
          detail: text,
          cause,
        });
      }
    }
    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new ApiError(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`, { cause: error });
    }
    if (externalSignal?.aborted) {
      throw new ApiError('请求已取消', { cause: error });
    }
    throw new ApiError('无法连接课程服务，请确认后端已启动', { cause: error });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export function get(path, options) {
  return request(path, options);
}

export function postJSON(path, body, options = {}) {
  return request(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
}

export function patchJSON(path, body, options = {}) {
  return request(path, {
    ...options,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
}

export function postForm(path, formData, options = {}) {
  return request(path, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    ...options,
    method: 'POST',
    body: formData,
  });
}

function coursePath(id, suffix = '') {
  return `/api/v1/courses/${encodeURIComponent(id)}${suffix}`;
}

export const courses = {
  list: ({ skip = 0, limit = 100 } = {}) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    return get(`/api/v1/courses?${params}`);
  },
  get: (id) => get(coursePath(id)),
  upload: (file, title) => {
    const form = new FormData();
    form.append('video', file);
    if (title) form.append('title', title);
    return postForm('/api/v1/courses/upload', form);
  },
  fromUrl: (url, title = '链接课程') =>
    postJSON('/api/v1/courses/from-url', { source_url: url, title }),
  update: (id, values) => patchJSON(coursePath(id), values),
  delete: (id) => request(coursePath(id), { method: 'DELETE' }),
  getVideoUrl: (id) => buildUrl(coursePath(id, '/video')),
  getScore: (id) => get(coursePath(id, '/score')),
  getTimeline: (id) => get(coursePath(id, '/timeline')),
  getSegments: (id) => get(coursePath(id, '/segments')),
  updateSegmentProgress: (courseId, segmentId, progress) =>
    postJSON(coursePath(courseId, `/segments/${encodeURIComponent(segmentId)}/progress`), progress),
  parse: (id) => request(coursePath(id, '/parse'), { method: 'POST' }),
  uploadScore: (id, file) => {
    const form = new FormData();
    form.append('score', file);
    return postForm(coursePath(id, '/score'), form);
  },
};

export const practice = {
  createResult: (payload) => postJSON('/api/v1/practice/results', payload),
  createResults: (payloads) => Promise.all(payloads.map((payload) => postJSON('/api/v1/practice/results', payload))),
  list: ({ course_id, segment_id, session_id, limit = 100, skip = 0 } = {}) => {
    const params = new URLSearchParams();
    if (course_id) params.set('course_id', course_id);
    if (segment_id) params.set('segment_id', segment_id);
    if (session_id) params.set('session_id', session_id);
    params.set('limit', String(limit));
    params.set('skip', String(skip));
    return get(`/api/v1/practice/results?${params}`);
  },
  summary: (courseId) => get(`/api/v1/practice/summary/${encodeURIComponent(courseId)}`),
  weakSpots: (courseId) => get(`/api/v1/practice/weak-spots/${encodeURIComponent(courseId)}`),
};
