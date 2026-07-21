/**
 * 弦间前端产品原型
 * 串联上传、解析、课程概览、同步跟练、专项纠错与结果页。
 */

import { GuitarDetector } from './core/audio/detector.js';
import { midiToNoteName } from './shared/utils/index.js';
import { courses } from './shared/utils/api.js';

const ROUTES = new Set(['home', 'analysis', 'overview', 'player', 'focus', 'results', 'library']);
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const DEMO_DURATION = 48;
const STORAGE_KEY = 'xianjian-ui-state';

const ANALYSIS_RESULTS = [
  { title: '已提取视频与音频', detail: '检测到立体声音轨 · 48 kHz', step: '音频提取完成' },
  { title: '已分离吉他演奏', detail: '吉他声部清晰，环境噪声较低', step: '吉他声音可识别' },
  { title: '找到 92 BPM 与 4/4 拍', detail: '已定位 16 个小节', step: '92 BPM · 4/4 拍' },
  { title: '正在识别音符与和弦', detail: '已找到 Am、C、G、Em', step: '识别到 4 个主要和弦' },
  { title: '六线谱正在成形', detail: '已定位 64 个演奏事件', step: '64 个谱面事件' },
  { title: '已定位双手动作', detail: '左手可见度 94% · 右手 91%', step: '双手动作轨已生成' },
  { title: '正在对齐所有时间轴', detail: '视频、声音、谱面与动作已同步', step: '时间轴对齐完成' },
  { title: '课程已准备就绪', detail: '已生成 4 个可独立练习的片段', step: '4 个练习片段' },
];

const uploadJobs = new WeakMap();

const state = {
  view: 'home',
  file: null,
  videoValidationId: 0,
  videoValidationPending: false,
  videoValidated: false,
  videoUrl: null,
  remoteVideoUrl: null,
  remoteCourse: null,
  score: null,
  defaultTabEvents: [],
  backendAvailable: null,
  backendCourses: [],
  courseLoadId: 0,
  coursePollTimer: null,
  courseTitle: '清晨指弹练习',
  duration: DEMO_DURATION,
  mediaDuration: null,
  bpm: 92,
  timeSignature: '4/4',
  analysisTimer: null,
  analysisIndex: -1,
  analysisComplete: false,
  micResolved: false,
  micAllowed: false,
  micStream: null,
  micContext: null,
  micDetector: null,
  micLastSampleAt: 0,
  lastDetection: null,
  micRequestId: 0,
  pendingView: null,
  playing: false,
  playerTime: 0,
  playerSpeed: 1,
  loopEnabled: false,
  animationFrame: null,
  lastFrameAt: 0,
  toastTimer: null,
  lastFocused: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.theme === 'dark') document.documentElement.dataset.theme = 'dark';
    if (saved.courseTitle) state.courseTitle = saved.courseTitle;
    if (Number.isFinite(saved.playerTime)) state.playerTime = Math.min(saved.playerTime, DEMO_DURATION);
  } catch {
    // 不可用的本地状态不应阻断产品页面。
  }
}

function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: document.documentElement.dataset.theme || 'light',
      courseTitle: state.courseTitle,
      playerTime: state.playerTime,
    }));
  } catch {
    // 隐私模式可能禁用 localStorage，界面仍可正常使用。
  }
}

function routeFromHash() {
  const route = window.location.hash.replace(/^#\/?/, '') || 'home';
  return ROUTES.has(route) ? route : 'home';
}

function navigate(view) {
  const safeView = ROUTES.has(view) ? view : 'home';
  const nextHash = `#/${safeView}`;
  if (window.location.hash === nextHash) {
    activateView(safeView);
  } else {
    window.location.hash = nextHash;
  }
}

function activateView(view) {
  state.view = view;
  $$('.view').forEach((element) => {
    const active = element.dataset.view === view;
    element.classList.toggle('is-active', active);
    element.setAttribute('aria-hidden', String(!active));
  });

  $$('.nav-link').forEach((button) => {
    const active = button.dataset.route === (view === 'library' ? 'library' : 'home');
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  const titles = {
    home: '创建课程',
    analysis: 'AI 解析',
    overview: '课程概览',
    player: '同步跟练',
    focus: '专项纠错',
    results: '练习结果',
    library: '我的课程',
  };
  document.title = `${titles[view]} · 弦间`;

  $$('video').forEach((video) => video.pause());
  if (view !== 'analysis') {
    window.clearInterval(state.analysisTimer);
    state.analysisTimer = null;
    clearCoursePolling();
  } else if (state.remoteCourse && state.remoteCourse.status !== 'ready') {
    renderRemoteAnalysisStatus(state.remoteCourse);
    scheduleCoursePolling();
  } else if (!state.analysisComplete && !state.analysisTimer) {
    window.setTimeout(beginAnalysis, 120);
  }
  if (view !== 'player') pausePlayer();
  if (view === 'player') updatePlayerUI();

  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('#mainContent')?.focus({ preventScroll: true });
}

function showToast(message, type = 'info') {
  const toast = $('[data-toast]');
  if (!toast) return;
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle('is-error', type === 'error');
  toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function formatTime(seconds, includeMilliseconds = false) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const basic = `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
  if (!includeMilliseconds) return basic;
  return `${basic}.${String(Math.floor((safe % 1) * 1000)).padStart(3, '0')}`;
}

function validateVideo(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['mp4', 'mov'].includes(extension) && !['video/mp4', 'video/quicktime'].includes(file.type)) {
    return '暂不支持这种格式，请选择 MP4 或 MOV 视频。';
  }
  if (file.size > MAX_FILE_SIZE) {
    return '视频超过 1 GB，请压缩或截取后重试。';
  }
  return null;
}

function readVideoDuration(url) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement('video');
    const timeout = window.setTimeout(() => done(null), 10_000);
    const done = (value) => {
      window.clearTimeout(timeout);
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.removeAttribute('src');
      probe.load();
      if (Number.isFinite(value) && value > 0) resolve(value);
      else reject(new Error('Video metadata unavailable'));
    };
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => done(probe.duration);
    probe.onerror = () => done(null);
    probe.src = url;
  });
}

function updateStartAnalysisButton() {
  const button = $('[data-action="start-analysis"]');
  if (!button) return;
  const disabled = state.videoValidationPending || (Boolean(state.file) && !state.videoValidated);
  button.disabled = disabled;
  button.setAttribute('aria-busy', String(state.videoValidationPending));
}

function resetPlaybackState() {
  state.playerTime = 0;
  state.loopEnabled = false;
  state.lastDetection = null;
  $('[data-seek-track]')?.classList.remove('is-looping');
  pausePlayer();
}

async function selectVideo(file) {
  const error = validateVideo(file);
  if (error) {
    showToast(error, 'error');
    return;
  }

  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = file;
  state.videoUrl = URL.createObjectURL(file);
  state.remoteVideoUrl = null;
  state.remoteCourse = null;
  state.score = null;
  state.courseLoadId += 1;
  clearCoursePolling();
  const validationId = ++state.videoValidationId;
  state.videoValidationPending = true;
  state.videoValidated = false;
  updateStartAnalysisButton();
  resetPlaybackState();
  state.courseTitle = file.name.replace(/\.[^.]+$/, '') || '未命名吉他课程';
  state.duration = DEMO_DURATION;
  state.mediaDuration = null;
  state.bpm = 92;
  state.timeSignature = '4/4';
  restoreDefaultScoreEvents();
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.delete('course');
  window.history.replaceState({}, '', pageUrl);

  $('[data-dropzone]').hidden = true;
  $('[data-selected-file]').hidden = false;
  $('[data-file-name]').textContent = file.name;
  $('[data-file-meta]').textContent = `正在读取时长 · ${formatBytes(file.size)} · 本地视频`;
  updateCourseCopy();
  setVideoSources();

  try {
    const duration = await readVideoDuration(state.videoUrl);
    if (state.file !== file || validationId !== state.videoValidationId) return;
    if (duration > 600) {
      showToast('视频超过 10 分钟，请截取需要练习的片段后重试。', 'error');
      resetVideoSelection();
      return;
    }
    state.duration = duration;
    state.mediaDuration = duration;
    state.videoValidated = true;
    $('[data-file-meta]').textContent = `${formatTime(duration)} · ${formatBytes(file.size)} · 质量检查通过`;
    updateCourseCopy();
    showToast(duration < 30
      ? '视频少于 30 秒，仍可解析，建议使用更完整的练习片段。'
      : '视频质量检查完成，可以开始解析。');
  } catch {
    if (state.file !== file || validationId !== state.videoValidationId) return;
    $('[data-file-meta]').textContent = `${formatBytes(file.size)} · 无法读取视频时长`;
    showToast('无法读取这段视频的时长，请重新导出 MP4 或 MOV 后再试。', 'error');
  } finally {
    if (state.file === file && validationId === state.videoValidationId) {
      state.videoValidationPending = false;
      updateStartAnalysisButton();
    }
  }
}

function resetVideoSelection() {
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = null;
  state.videoValidationId += 1;
  state.videoValidationPending = false;
  state.videoValidated = false;
  state.videoUrl = null;
  state.remoteVideoUrl = null;
  state.remoteCourse = null;
  state.score = null;
  state.courseLoadId += 1;
  clearCoursePolling();
  state.courseTitle = '清晨指弹练习';
  state.duration = DEMO_DURATION;
  state.mediaDuration = null;
  resetPlaybackState();
  state.bpm = 92;
  state.timeSignature = '4/4';
  restoreDefaultScoreEvents();
  const url = new URL(window.location.href);
  url.searchParams.delete('course');
  window.history.replaceState({}, '', url);
  $('[data-dropzone]').hidden = false;
  $('[data-selected-file]').hidden = true;
  const input = $('#videoInput');
  if (input) input.value = '';
  updateStartAnalysisButton();
  setVideoSources();
  updateCourseCopy();
}

function updateCourseCopy() {
  $$('[data-course-title]').forEach((element) => {
    element.textContent = state.courseTitle;
  });
  $$('[data-course-duration]').forEach((element) => {
    element.textContent = formatTime(state.duration);
  });
  $$('[data-player-duration]').forEach((element) => {
    element.textContent = formatTime(state.duration);
  });
  $$('[data-course-bpm]').forEach((element) => {
    element.textContent = String(state.bpm || 92);
  });
  $$('[data-time-signature]').forEach((element) => {
    element.textContent = state.timeSignature || '4/4';
  });
  const seekTrack = $('[data-seek-track]');
  seekTrack?.setAttribute('aria-valuemax', String(Math.max(1, state.duration)));
  savePreferences();
}

function setVideoSources() {
  const mediaSource = state.videoUrl || state.remoteVideoUrl;
  const mappings = [
    ['analysisVideo', '.media-stage'],
    ['overviewVideo', '.overview-art'],
    ['playerVideo', '.teacher-video'],
  ];

  mappings.forEach(([id, parentSelector]) => {
    const video = document.getElementById(id);
    const parent = $(parentSelector);
    const fallback = parent?.querySelector('[data-video-fallback]');
    if (!video) return;
    if (mediaSource) {
      video.src = mediaSource;
      video.hidden = false;
      video.load();
      if (fallback) fallback.hidden = true;
    } else {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  });
}

function normalizeTimeSignature(value) {
  if (Array.isArray(value) && value.length === 2) return `${value[0]}/${value[1]}`;
  return typeof value === 'string' && /^\d+\/\d+$/.test(value) ? value : '4/4';
}

function scoreEvents(score) {
  const events = [];
  const addNotes = (notes, fallbackTime = 0) => {
    if (!Array.isArray(notes)) return;
    notes.forEach((note) => {
      const compound = Array.isArray(note?.notes) && note.notes.length ? note.notes : [note];
      compound.forEach((position) => {
        const startTime = Number(note?.startTime ?? note?.audioStartTime ?? position?.startTime ?? fallbackTime);
        const stringNumber = Number(position?.string ?? note?.string);
        const fret = Number(position?.fret ?? note?.fret);
        if (!Number.isFinite(startTime) || startTime < 0 || !Number.isInteger(stringNumber) || stringNumber < 1 || stringNumber > 6) return;
        if (!Number.isInteger(fret) || fret < 0 || fret > 36) return;
        events.push({ startTime, stringNumber, fret });
      });
    });
  };

  (Array.isArray(score?.bars) ? score.bars : []).forEach((bar) => {
    addNotes(bar?.notes, Number(bar?.startTime) || 0);
    (Array.isArray(bar?.beats) ? bar.beats : []).forEach((beat) => {
      addNotes(beat?.notes, Number(beat?.startTime ?? bar?.startTime) || 0);
    });
  });
  addNotes(score?.notes, 0);
  return events.sort((left, right) => left.startTime - right.startTime);
}

function restoreDefaultScoreEvents() {
  const tablature = $('[data-tablature]');
  const playhead = $('[data-score-playhead]');
  if (!tablature || !state.defaultTabEvents.length) return;
  $$('.tab-event', tablature).forEach((event) => event.remove());
  state.defaultTabEvents.forEach((event) => tablature.insertBefore(event.cloneNode(true), playhead));
}

function renderScore(score) {
  const events = scoreEvents(score).slice(0, 48);
  if (!events.length) return;
  const tablature = $('[data-tablature]');
  const playhead = $('[data-score-playhead]');
  if (!tablature || !playhead) return;
  $$('.tab-event', tablature).forEach((event) => event.remove());
  const lastEvent = events[events.length - 1];
  const duration = Math.max(1, state.duration, lastEvent?.startTime || 0);
  events.forEach((event) => {
    const button = document.createElement('button');
    button.className = 'tab-event';
    button.type = 'button';
    button.dataset.seek = String(event.startTime);
    button.style.setProperty('--x', `${Math.max(3, Math.min(96, event.startTime / duration * 100)).toFixed(2)}%`);
    button.style.setProperty('--y', String(event.stringNumber));
    button.textContent = String(event.fret);
    button.setAttribute('aria-label', `${event.stringNumber} 弦 ${event.fret} 品，${formatTime(event.startTime, true)}`);
    tablature.insertBefore(button, playhead);
  });
}

function applyScore(score) {
  if (!score || typeof score !== 'object') return;
  state.score = score;
  if (typeof score.title === 'string' && score.title.trim()) state.courseTitle = score.title.trim().slice(0, 255);
  const scoreBpm = Number(score.bpm);
  if (Number.isFinite(scoreBpm) && scoreBpm > 0 && scoreBpm <= 400) state.bpm = Math.round(scoreBpm);
  state.timeSignature = normalizeTimeSignature(score.timeSignature ?? score.time_signature);
  const bars = Array.isArray(score.bars) ? score.bars : [];
  const declaredDuration = Number(score.duration);
  const barDuration = Math.max(0, ...bars.map((bar) => {
    const endTime = Number(bar?.endTime);
    return Number.isFinite(endTime) && endTime >= 0 ? endTime : 0;
  }));
  const scoreDuration = Number.isFinite(declaredDuration) && declaredDuration > 0
    ? declaredDuration
    : barDuration;
  if (Number.isFinite(state.mediaDuration) && state.mediaDuration > 0) {
    state.duration = state.mediaDuration;
  } else if (Number.isFinite(scoreDuration) && scoreDuration > 0 && scoreDuration <= 86_400) {
    state.duration = scoreDuration;
  }
  renderScore(score);
  updateCourseCopy();
}

async function activateRemoteCourse(course, loadId = ++state.courseLoadId) {
  if (!course?.id) throw new Error('Invalid course');
  if (loadId !== state.courseLoadId) return false;
  clearCoursePolling();
  resetAnalysis();
  state.file = null;
  state.videoValidationId += 1;
  state.videoValidationPending = false;
  state.videoValidated = true;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = null;
  state.remoteCourse = course;
  state.remoteVideoUrl = course.video_path ? courses.getVideoUrl(course.id) : null;
  resetPlaybackState();
  state.courseTitle = String(course.title || '未命名吉他课程').slice(0, 255);
  const courseDuration = Number(course.duration);
  state.duration = Number.isFinite(courseDuration) && courseDuration > 0 ? courseDuration : DEMO_DURATION;
  state.mediaDuration = null;
  const courseBpm = Number(course.bpm);
  state.bpm = Number.isFinite(courseBpm) && courseBpm > 0 ? Math.min(400, Math.round(courseBpm)) : 92;
  state.timeSignature = normalizeTimeSignature(course.time_signature);
  state.score = null;
  restoreDefaultScoreEvents();
  $('[data-dropzone]').hidden = false;
  $('[data-selected-file]').hidden = true;
  const input = $('#videoInput');
  if (input) input.value = '';
  const url = new URL(window.location.href);
  url.searchParams.set('course', course.id);
  window.history.replaceState({}, '', url);
  updateCourseCopy();
  updateStartAnalysisButton();
  setVideoSources();
  if (course.score_path) {
    try {
      const score = await courses.getScore(course.id);
      if (loadId !== state.courseLoadId || state.remoteCourse?.id !== course.id) return false;
      applyScore(score);
    } catch {
      if (loadId === state.courseLoadId && state.remoteCourse?.id === course.id) {
        showToast('课程视频已载入，但谱面暂时不可用。', 'error');
      }
    }
  }
  return loadId === state.courseLoadId;
}

function courseStatus(course) {
  if (course.status === 'ready') return { filter: 'ready', label: '可以开始', className: 'state-ready' };
  if (course.status === 'error') return { filter: 'learning', label: '需要处理', className: 'state-learning' };
  return { filter: 'learning', label: '解析准备中', className: 'state-learning' };
}

function createCourseCard(course, index) {
  const status = courseStatus(course);
  const article = document.createElement('article');
  article.className = 'library-card';
  article.dataset.status = status.filter;

  const art = document.createElement('div');
  art.className = `library-art ${['art-umber', 'art-sage', 'art-ink'][index % 3]}`;
  const lesson = document.createElement('span');
  lesson.textContent = `LESSON ${String(index + 1).padStart(2, '0')}`;
  const initial = document.createElement('strong');
  initial.textContent = String(course.key || course.title || 'C').trim().slice(0, 2).toUpperCase();
  const strings = document.createElement('i');
  const duration = document.createElement('small');
  duration.textContent = formatTime(course.duration || DEMO_DURATION);
  art.append(lesson, initial, strings, duration);

  const body = document.createElement('div');
  body.className = 'library-body';
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const badge = document.createElement('span');
  badge.className = status.className;
  badge.textContent = status.label;
  const time = document.createElement('time');
  const createdAt = course.created_at ? new Date(course.created_at) : null;
  time.textContent = createdAt && !Number.isNaN(createdAt.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(createdAt)
    : '最近创建';
  meta.append(badge, time);
  const title = document.createElement('h2');
  title.textContent = course.title || '未命名吉他课程';
  const details = document.createElement('p');
  details.textContent = `${course.bpm || '--'} BPM · ${normalizeTimeSignature(course.time_signature)} · ${course.video_path ? '视频已就绪' : '等待视频'}`;
  const progressCopy = document.createElement('div');
  progressCopy.className = 'progress-copy';
  const progressLabel = document.createElement('span');
  progressLabel.textContent = course.status === 'ready' ? '课程已准备' : '后端处理进度';
  const progressValue = document.createElement('strong');
  const progress = Math.max(0, Math.min(100, Number(course.progress) || 0));
  progressValue.textContent = `${progress}%`;
  progressCopy.append(progressLabel, progressValue);
  const progressBar = document.createElement('div');
  progressBar.className = 'linear-progress';
  const progressFill = document.createElement('i');
  progressFill.style.setProperty('--value', `${progress}%`);
  progressBar.append(progressFill);
  const button = document.createElement('button');
  button.className = 'secondary-button full-width';
  button.type = 'button';
  button.dataset.action = 'open-course';
  button.dataset.courseId = course.id;
  button.textContent = course.status === 'ready' ? '查看课程 →' : '查看解析状态 →';
  body.append(meta, title, details, progressCopy, progressBar, button);
  article.append(art, body);
  return article;
}

function updateLibraryCounts() {
  const counts = { all: state.backendCourses.length, learning: 0, ready: 0, complete: 0 };
  state.backendCourses.forEach((course) => {
    counts[courseStatus(course).filter] += 1;
  });
  $$('[data-filter]').forEach((button) => {
    const count = $('span', button);
    if (count) count.textContent = String(counts[button.dataset.filter] || 0);
  });
}

function renderBackendCourses() {
  const grid = $('[data-library-grid]');
  if (!grid) return;
  if (!state.backendCourses.length) {
    const empty = document.createElement('div');
    empty.className = 'library-empty card-surface';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'EMPTY LIBRARY';
    const title = document.createElement('strong');
    title.textContent = '还没有保存到后端的课程。';
    const copy = document.createElement('p');
    copy.textContent = '上传一段 MP4 或 MOV，完成质量检查后即可创建第一门课程。';
    empty.append(eyebrow, title, copy);
    grid.replaceChildren(empty);
    updateLibraryCounts();
    return;
  }
  const fragment = document.createDocumentFragment();
  state.backendCourses.forEach((course, index) => fragment.append(createCourseCard(course, index)));
  grid.replaceChildren(fragment);
  updateLibraryCounts();
}

async function refreshBackendCourses() {
  try {
    const result = await courses.list();
    state.backendAvailable = true;
    state.backendCourses = Array.isArray(result) ? result : [];
    renderBackendCourses();
    return state.backendCourses;
  } catch {
    state.backendAvailable = false;
    return [];
  }
}

async function openRemoteCourse(courseId) {
  const loadId = ++state.courseLoadId;
  try {
    const cached = state.backendCourses.find((course) => course.id === courseId);
    const course = cached || await courses.get(courseId);
    if (loadId !== state.courseLoadId) return;
    const activation = activateRemoteCourse(course, loadId);
    navigate(course.status === 'ready' ? 'overview' : 'analysis');
    await activation;
  } catch {
    if (loadId === state.courseLoadId) showToast('课程暂时无法载入，请确认后端服务正在运行。', 'error');
  }
}

async function persistSelectedCourse() {
  if (!state.file) return null;
  const selectedFile = state.file;
  const activeJob = uploadJobs.get(selectedFile);
  if (activeJob) return activeJob;
  const selectedTitle = state.courseTitle;
  const job = courses.upload(selectedFile, selectedTitle)
    .then(async (course) => {
      state.backendAvailable = true;
      if (state.file === selectedFile) {
        state.remoteCourse = course;
        state.remoteVideoUrl = course.video_path ? courses.getVideoUrl(course.id) : null;
        if (state.view === 'analysis' && course.status !== 'ready') {
          renderRemoteAnalysisStatus(course);
          scheduleCoursePolling();
        }
        showToast('课程已保存；当前版本需单独启动自动转谱服务。');
      }
      await refreshBackendCourses();
      return course;
    })
    .catch(() => {
      if (state.file === selectedFile) {
        state.backendAvailable = false;
        showToast('后端暂时不可用，已继续使用本地预览，不会丢失当前视频。', 'error');
      }
      return null;
    })
    .finally(() => {
      uploadJobs.delete(selectedFile);
    });
  uploadJobs.set(selectedFile, job);
  return job;
}

function startSelectedAnalysis() {
  if (state.file && (!state.videoValidated || state.videoValidationPending)) {
    showToast('请等待视频质量检查完成后再开始解析。', 'error');
    return;
  }
  resetAnalysis();
  navigate('analysis');
  if (state.file) void persistSelectedCourse();
}

async function prepareDemo() {
  const backendDemo = state.backendCourses.find((course) => course.status === 'ready' && course.video_path)
    || state.backendCourses.find((course) => course.video_path);
  if (backendDemo) {
    try {
      const activation = activateRemoteCourse(backendDemo);
      navigate(backendDemo.status === 'ready' ? 'overview' : 'analysis');
      if (await activation) showToast('已载入后端课程与可用谱面。');
      return;
    } catch {
      showToast('后端示例暂时不可用，已切换为内置课程。', 'error');
    }
  }
  resetVideoSelection();
  state.courseTitle = '清晨指弹练习';
  state.duration = DEMO_DURATION;
  updateCourseCopy();
  resetAnalysis();
  navigate('analysis');
}

function resetAnalysis() {
  window.clearInterval(state.analysisTimer);
  state.analysisTimer = null;
  state.analysisIndex = -1;
  state.analysisComplete = false;
  $$('[data-analysis-step]').forEach((item) => {
    item.classList.remove('is-current', 'is-done');
    $('span', item).textContent = '等待开始';
  });
  $('[data-analysis-percent]').textContent = '0%';
  $('.analysis-total')?.setAttribute('aria-valuenow', '0');
  $('[data-analysis-message]').textContent = '正在准备解析…';
  $('[data-analysis-detail]').textContent = '结果会在这里实时出现';
  $('[data-action="analysis-complete"]').hidden = true;
  $$('.analysis-wave .wave-bar').forEach((bar) => bar.classList.remove('is-visible', 'is-active'));
}

function clearCoursePolling() {
  window.clearTimeout(state.coursePollTimer);
  state.coursePollTimer = null;
}

function renderRemoteAnalysisStatus(course) {
  window.clearInterval(state.analysisTimer);
  state.analysisTimer = null;
  const progress = Math.max(0, Math.min(100, Number(course?.progress) || 0));
  const ready = course?.status === 'ready';
  const failed = course?.status === 'error';
  const completedSteps = ready ? ANALYSIS_RESULTS.length : Math.max(1, Math.floor(progress / 12.5));

  $$('[data-analysis-step]').forEach((item, index) => {
    const done = index < completedSteps;
    const current = !ready && !failed && index === Math.min(completedSteps, ANALYSIS_RESULTS.length - 1);
    item.classList.toggle('is-done', done);
    item.classList.toggle('is-current', current);
    const label = $('span', item);
    if (done) label.textContent = index === 0 ? '视频已安全保存' : ANALYSIS_RESULTS[index].step;
    else if (current) label.textContent = '等待处理服务…';
    else label.textContent = '等待开始';
  });

  const shownProgress = ready ? 100 : progress;
  $('[data-analysis-percent]').textContent = `${shownProgress}%`;
  $('.analysis-total')?.setAttribute('aria-valuenow', String(shownProgress));
  $('[data-analysis-message]').textContent = ready
    ? '课程已准备就绪'
    : (failed ? '解析未能完成' : '视频已保存，等待自动转谱服务');
  $('[data-analysis-detail]').textContent = ready
    ? '谱面与视频已可以进入同步跟练'
    : (failed ? '请返回并重新上传，或稍后查看课程状态' : `后端进度 ${progress}% · 当前版本尚未内置 AI 转谱工作进程`);
  $('[data-action="analysis-complete"]').hidden = !ready;
  state.analysisComplete = ready;

  const bars = $$('.analysis-wave .wave-bar');
  const visibleCount = Math.round(shownProgress / 100 * bars.length);
  bars.forEach((bar, index) => {
    bar.classList.toggle('is-visible', index < visibleCount);
    bar.classList.toggle('is-active', !ready && !failed && index >= Math.max(0, visibleCount - 7) && index < visibleCount);
  });
}

function scheduleCoursePolling() {
  clearCoursePolling();
  const course = state.remoteCourse;
  if (state.view !== 'analysis' || !course?.id || ['ready', 'error'].includes(course.status)) return;
  const loadId = state.courseLoadId;
  state.coursePollTimer = window.setTimeout(async () => {
    try {
      const freshCourse = await courses.get(course.id);
      if (loadId !== state.courseLoadId || state.remoteCourse?.id !== course.id) return;
      state.remoteCourse = freshCourse;
      const index = state.backendCourses.findIndex((item) => item.id === freshCourse.id);
      if (index >= 0) state.backendCourses[index] = freshCourse;
      renderBackendCourses();
      if (freshCourse.status === 'ready') {
        await activateRemoteCourse(freshCourse, loadId);
        if (loadId === state.courseLoadId) {
          renderRemoteAnalysisStatus(freshCourse);
          showToast('后端课程已准备完成，可以进入跟练。');
        }
        return;
      }
      renderRemoteAnalysisStatus(freshCourse);
    } catch {
      // 短暂断网不改变当前进度，下一轮继续尝试。
    }
    if (loadId === state.courseLoadId) scheduleCoursePolling();
  }, 3000);
}

function beginAnalysis() {
  if (state.analysisTimer || state.analysisComplete || state.view !== 'analysis') return;
  if (state.remoteCourse && state.remoteCourse.status !== 'ready') {
    renderRemoteAnalysisStatus(state.remoteCourse);
    scheduleCoursePolling();
    return;
  }
  advanceAnalysis();
  state.analysisTimer = window.setInterval(advanceAnalysis, 720);
}

function advanceAnalysis() {
  if (state.remoteCourse && state.remoteCourse.status !== 'ready') {
    renderRemoteAnalysisStatus(state.remoteCourse);
    scheduleCoursePolling();
    return;
  }
  state.analysisIndex += 1;
  if (state.analysisIndex >= ANALYSIS_RESULTS.length) {
    finishAnalysis();
    return;
  }

  const current = ANALYSIS_RESULTS[state.analysisIndex];
  $$('[data-analysis-step]').forEach((item, index) => {
    item.classList.toggle('is-done', index < state.analysisIndex);
    item.classList.toggle('is-current', index === state.analysisIndex);
    const label = $('span', item);
    if (index < state.analysisIndex) label.textContent = ANALYSIS_RESULTS[index].step;
    else if (index === state.analysisIndex) label.textContent = '正在处理…';
    else label.textContent = '等待开始';
  });

  const percent = Math.min(96, Math.round(((state.analysisIndex + 0.72) / ANALYSIS_RESULTS.length) * 100));
  $('[data-analysis-percent]').textContent = `${percent}%`;
  $('.analysis-total')?.setAttribute('aria-valuenow', String(percent));
  $('[data-analysis-message]').textContent = current.title;
  $('[data-analysis-detail]').textContent = current.detail;
  $('[data-detected-chord]').textContent = ['Am', 'Am', 'C', 'C', 'G', 'G', 'Em', 'Em'][state.analysisIndex];

  const bars = $$('.analysis-wave .wave-bar');
  const visibleCount = Math.round(((state.analysisIndex + 1) / ANALYSIS_RESULTS.length) * bars.length);
  bars.forEach((bar, index) => {
    bar.classList.toggle('is-visible', index < visibleCount);
    bar.classList.toggle('is-active', index >= Math.max(0, visibleCount - 7) && index < visibleCount);
  });
}

function finishAnalysis() {
  if (state.remoteCourse && state.remoteCourse.status !== 'ready') {
    renderRemoteAnalysisStatus(state.remoteCourse);
    return;
  }
  window.clearInterval(state.analysisTimer);
  state.analysisTimer = null;
  state.analysisIndex = ANALYSIS_RESULTS.length;
  state.analysisComplete = true;
  $$('[data-analysis-step]').forEach((item, index) => {
    item.classList.remove('is-current');
    item.classList.add('is-done');
    $('span', item).textContent = ANALYSIS_RESULTS[index].step;
  });
  $$('.analysis-wave .wave-bar').forEach((bar) => {
    bar.classList.add('is-visible');
    bar.classList.remove('is-active');
  });
  $('[data-analysis-percent]').textContent = '100%';
  $('.analysis-total')?.setAttribute('aria-valuenow', '100');
  $('[data-analysis-message]').textContent = '课程已生成';
  $('[data-analysis-detail]').textContent = '16 小节 · 64 个音符 · 4 个练习片段';
  $('[data-action="analysis-complete"]').hidden = false;
}

function buildWaveforms() {
  $$('[data-waveform]').forEach((waveform, waveformIndex) => {
    if (waveform.children.length) return;
    const count = waveformIndex === 0 ? 72 : 104;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const bar = document.createElement('i');
      const harmonic = Math.abs(Math.sin(index * 0.63) * 0.58 + Math.sin(index * 0.17) * 0.28);
      const height = 15 + harmonic * 78;
      bar.className = 'wave-bar';
      if (!waveform.classList.contains('analysis-wave')) bar.classList.add('is-visible');
      bar.style.setProperty('--height', `${height.toFixed(1)}%`);
      fragment.appendChild(bar);
    }
    waveform.appendChild(fragment);
  });
}

function openMicModal(pendingView = null) {
  state.pendingView = pendingView;
  closeLayer($('[data-settings-layer]'), false);
  openLayer($('[data-mic-modal]'));
}

async function allowMicrophone() {
  const button = $('[data-action="allow-mic"]');
  const original = button.textContent;
  let stream = null;
  let audioContext = null;
  let adopted = false;
  button.disabled = true;
  button.textContent = '正在检查环境…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('MediaDevices unavailable');
    const requestId = ++state.micRequestId;
    await stopMicrophone(false, false);
    if (requestId !== state.micRequestId) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio unavailable');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    if (requestId !== state.micRequestId) return;
    audioContext = new AudioContextClass();
    await audioContext.resume();
    if (requestId !== state.micRequestId) return;
    const detector = new GuitarDetector(audioContext);
    await detector.start(stream);
    if (requestId !== state.micRequestId) {
      detector.stop();
      return;
    }
    state.micStream = stream;
    state.micContext = audioContext;
    state.micDetector = detector;
    adopted = true;
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (state.micStream !== stream) return;
        void stopMicrophone().then(() => {
          showToast('麦克风连接已结束，可从顶部重新开启。', 'error');
        });
      }, { once: true });
    });
    state.micResolved = true;
    state.micAllowed = true;
    updateMicrophoneUI();
    closeLayer($('[data-mic-modal]'));
    showToast('麦克风已连接 · 环境噪声较低 · 预计延迟 42 ms');
    if (state.pendingView) navigate(state.pendingView);
    state.pendingView = null;
  } catch {
    if (!adopted) {
      state.micAllowed = false;
      updateMicrophoneUI();
      showToast('未能获取麦克风权限，可以选择“仅观看课程”继续。', 'error');
    }
  } finally {
    if (!adopted) {
      stream?.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== 'closed') {
        try {
          await audioContext.close();
        } catch {
          // 获取权限后的初始化失败也必须尽力释放浏览器音频资源。
        }
      }
    }
    button.disabled = false;
    button.textContent = original;
  }
}

async function stopMicrophone(updateUI = true, invalidateRequest = true) {
  if (invalidateRequest) state.micRequestId += 1;
  const detector = state.micDetector;
  const stream = state.micStream;
  const context = state.micContext;
  state.micDetector = null;
  state.micStream = null;
  state.micContext = null;
  state.lastDetection = null;
  state.micAllowed = false;
  detector?.stop();
  stream?.getTracks().forEach((track) => track.stop());
  if (context && context.state !== 'closed') {
    try {
      await context.close();
    } catch {
      // 某些浏览器会在页面卸载期间提前关闭 AudioContext。
    }
  }
  if (updateUI) updateMicrophoneUI();
}

function skipMicrophone() {
  const pendingView = state.pendingView;
  state.pendingView = null;
  void stopMicrophone(false);
  state.micResolved = true;
  state.micAllowed = false;
  updateMicrophoneUI();
  closeLayer($('[data-mic-modal]'));
  showToast('已进入仅观看模式，可随时在顶部开启麦克风。');
  if (pendingView) navigate(pendingView);
}

function updateMicrophoneUI() {
  const label = state.micAllowed ? '麦克风已连接' : (state.micResolved ? '仅观看模式' : '麦克风未开启');
  $$('[data-mic-label]').forEach((element) => {
    element.textContent = label;
  });
  $('#productShell').classList.toggle('mic-active', state.micAllowed);
  $$('.live-mic').forEach((element) => element.classList.toggle('is-active', state.micAllowed));
  $('.settings-foot')?.classList.toggle('is-active', state.micAllowed);
}

function requestPractice() {
  if (state.micResolved) navigate('player');
  else openMicModal('player');
}

function togglePlayer() {
  if (state.playing) pausePlayer();
  else playPlayer();
}

function playPlayer() {
  const video = $('#playerVideo');
  state.playing = true;
  state.lastFrameAt = performance.now();
  if ((state.videoUrl || state.remoteVideoUrl) && video) {
    video.currentTime = Math.min(state.playerTime, video.duration || state.duration);
    video.playbackRate = state.playerSpeed;
    video.play().catch(() => {
      state.playing = false;
      showToast('浏览器阻止了自动播放，请再点一次播放。', 'error');
      updatePlayerUI();
    });
  }
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = requestAnimationFrame(playerFrame);
  updatePlayerUI();
}

function pausePlayer() {
  state.playing = false;
  $('#playerVideo')?.pause();
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  updatePlayerUI();
}

function playerFrame(timestamp) {
  if (!state.playing) return;
  const video = $('#playerVideo');
  if ((state.videoUrl || state.remoteVideoUrl) && video && Number.isFinite(video.currentTime)) {
    state.playerTime = video.currentTime;
  } else {
    const elapsed = Math.min(0.1, Math.max(0, (timestamp - state.lastFrameAt) / 1000));
    state.playerTime += elapsed * state.playerSpeed;
  }
  state.lastFrameAt = timestamp;

  if (state.micAllowed && state.micDetector && timestamp - state.micLastSampleAt >= 120) {
    state.micLastSampleAt = timestamp;
    try {
      state.lastDetection = state.micDetector.getDetection();
    } catch {
      void stopMicrophone();
      showToast('麦克风连接已中断，请重新开启。', 'error');
    }
  }

  if (state.loopEnabled && state.playerTime >= Math.min(28, state.duration)) {
    seekPlayer(Math.min(17.42, state.duration - 1));
  }
  if (state.playerTime >= state.duration) {
    state.playerTime = state.duration;
    pausePlayer();
    navigate('results');
    return;
  }
  updatePlayerUI();
  state.animationFrame = requestAnimationFrame(playerFrame);
}

function seekPlayer(seconds) {
  state.playerTime = Math.max(0, Math.min(Number(seconds) || 0, state.duration));
  const video = $('#playerVideo');
  if ((state.videoUrl || state.remoteVideoUrl) && video && Number.isFinite(video.duration)) {
    video.currentTime = Math.min(state.playerTime, video.duration);
  }
  updatePlayerUI();
  savePreferences();
}

function setPlayerSpeed(speed) {
  state.playerSpeed = Number(speed) || 1;
  const video = $('#playerVideo');
  if (video) video.playbackRate = state.playerSpeed;
  $$('[data-speed]').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.speed) === state.playerSpeed));
  showToast(`播放速度已调整为 ${Math.round(state.playerSpeed * 100)}%`);
}

function updatePlayerUI() {
  const duration = Math.max(1, state.duration);
  const progress = Math.max(0, Math.min(1, state.playerTime / duration));
  const playButton = $('[data-action="toggle-play"]');
  $('[data-play-icon]').textContent = state.playing ? 'Ⅱ' : '▶';
  playButton?.setAttribute('aria-label', state.playing ? '暂停' : '播放');
  playButton?.setAttribute('aria-pressed', String(state.playing));
  $('.player-view')?.classList.toggle('is-playing', state.playing);
  $('[data-player-time]').textContent = formatTime(state.playerTime);
  $('.frame-counter').textContent = formatTime(state.playerTime, true);
  const seekProgress = $('[data-seek-progress]');
  if (seekProgress) seekProgress.style.width = `${progress * 100}%`;
  const seekTrack = $('[data-seek-track]');
  seekTrack?.setAttribute('aria-valuenow', state.playerTime.toFixed(2));

  const timeline = $('.timeline-pane');
  const timelinePlayhead = $('[data-timeline-playhead]');
  if (timeline && timelinePlayhead) {
    const left = 58 + Math.max(0, timeline.clientWidth - 58) * progress;
    timelinePlayhead.style.left = `${left}px`;
  }
  const scorePlayhead = $('[data-score-playhead]');
  if (scorePlayhead) scorePlayhead.style.left = `${progress * 100}%`;

  const notes = $$('.tab-event[data-seek]');
  let nearest = null;
  let nearestDistance = Infinity;
  notes.forEach((note) => {
    const noteTime = Number(note.dataset.seek);
    const distance = Math.abs(noteTime - state.playerTime);
    if (distance < nearestDistance) {
      nearest = note;
      nearestDistance = distance;
    }
    note.classList.toggle('is-done', noteTime < state.playerTime - 1.5);
    note.classList.remove('is-current');
  });
  if (nearest) nearest.classList.add('is-current');

  const title = $('[data-feedback-title]');
  const copy = $('[data-feedback-copy]');
  const score = $('[data-live-score]');
  const detection = state.lastDetection;
  const hasPitch = state.micAllowed
    && detection?.rms >= 0.005
    && detection.pitch?.confidence >= 0.65
    && detection.pitch.frequency > 0;
  if (!state.playing) {
    title.textContent = state.playerTime > 0 ? '已暂停' : '准备就绪';
    copy.textContent = state.playerTime > 0 ? '可点击谱面音符精确定位。' : '点击播放，跟随老师开始演奏。';
    score.textContent = '--';
  } else if (hasPitch) {
    const noteName = midiToNoteName(detection.pitch.midi);
    title.textContent = `识别到 ${noteName}`;
    copy.textContent = `${Math.round(detection.pitch.frequency)} Hz · ${detection.onset ? '起音清晰' : '持续聆听中'}`;
    score.textContent = noteName;
  } else if (state.micAllowed) {
    title.textContent = '正在聆听';
    copy.textContent = '请弹响一个清晰的单音，系统会显示实时音高。';
    score.textContent = '--';
  } else {
    title.textContent = '跟随播放';
    copy.textContent = '仅观看模式不会生成演奏判定；开启麦克风可查看实时音高。';
    score.textContent = '--';
  }
}

function toggleLoop() {
  state.loopEnabled = !state.loopEnabled;
  $('[data-seek-track]').classList.toggle('is-looping', state.loopEnabled);
  showToast(state.loopEnabled ? 'A/B 循环已开启：17.42–28.00 秒' : 'A/B 循环已关闭');
}

function frameStep(direction) {
  seekPlayer(state.playerTime + direction / 30);
}

function startFocusAttempt() {
  const countdown = $('[data-countdown]');
  const number = $('span', countdown);
  countdown.hidden = false;
  let count = 3;
  number.textContent = String(count);
  const interval = window.setInterval(() => {
    count -= 1;
    if (count > 0) {
      number.textContent = String(count);
      return;
    }
    if (count === 0) {
      number.textContent = '开始';
      $('small', countdown).textContent = '弹奏第 6 小节';
      return;
    }
    window.clearInterval(interval);
    countdown.hidden = true;
    $('small', countdown).textContent = '准备演奏';
    const comparison = $('[data-comparison]');
    comparison.hidden = false;
    const ladder = $$('.speed-ladder > div');
    ladder[0].classList.remove('is-current');
    $('span', ladder[0]).textContent = '通过';
    ladder[1].classList.add('is-current');
    $('span', ladder[1]).textContent = '已解锁';
    comparison.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    showToast('目标错误已解决，75% 速度已解锁。');
  }, 680);
}

function openLayer(layer) {
  if (!layer) return;
  state.lastFocused = document.activeElement;
  layer.hidden = false;
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => {
    const first = $('button:not([disabled]), [href], input:not([disabled])', layer);
    first?.focus();
  }, 30);
}

function closeLayer(layer, restoreFocus = true) {
  if (!layer || layer.hidden) return;
  if (layer.matches('[data-mic-modal]') && !state.micAllowed) {
    state.micRequestId += 1;
    state.pendingView = null;
  }
  layer.hidden = true;
  if ($('[data-mic-modal]').hidden && $('[data-settings-layer]').hidden) {
    document.body.style.overflow = '';
  }
  if (restoreFocus && state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
}

function activeLayer() {
  return [$('[data-mic-modal]'), $('[data-settings-layer]')].find((layer) => layer && !layer.hidden) || null;
}

function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const layer = activeLayer();
  if (!layer) return;
  const focusable = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', layer)
    .filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function toggleSwitch(button) {
  const on = !button.classList.contains('is-on');
  button.classList.toggle('is-on', on);
  button.setAttribute('aria-checked', String(on));
}

function chooseTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  $$('[data-theme-choice]').forEach((button) => button.classList.toggle('is-active', button.dataset.themeChoice === theme));
  savePreferences();
}

function filterLibrary(filter) {
  $$('[data-filter]').forEach((button) => button.classList.toggle('is-active', button.dataset.filter === filter));
  $$('.library-card').forEach((card) => {
    card.hidden = filter !== 'all' && card.dataset.status !== filter;
  });
}

function handleAction(action, element) {
  switch (action) {
    case 'start-analysis':
      startSelectedAnalysis();
      break;
    case 'reset-file':
      resetVideoSelection();
      break;
    case 'use-demo':
      prepareDemo();
      break;
    case 'skip-analysis':
      if (state.remoteCourse && state.remoteCourse.status !== 'ready') {
        showToast('后端课程仍在等待转谱，不能跳过真实处理状态。', 'error');
      } else {
        finishAnalysis();
      }
      break;
    case 'analysis-complete':
      navigate('overview');
      break;
    case 'preview-course': {
      const video = $('#overviewVideo');
      if ((state.videoUrl || state.remoteVideoUrl) && video) {
        if (video.paused) video.play().catch(() => showToast('请再点一次播放预览。', 'error'));
        else video.pause();
      } else {
        showToast('示例课程预览：92 BPM · 4/4 拍 · 4 个主要和弦');
      }
      break;
    }
    case 'start-practice':
      requestPractice();
      break;
    case 'open-focus':
      seekPlayer(17.42);
      state.loopEnabled = true;
      $('[data-seek-track]')?.classList.add('is-looping');
      navigate('focus');
      break;
    case 'open-mic':
      if (state.micAllowed) {
        void stopMicrophone();
        showToast('麦克风已关闭，原始音频不会被保存。');
      } else {
        openMicModal();
      }
      break;
    case 'close-mic':
      closeLayer($('[data-mic-modal]'));
      state.pendingView = null;
      break;
    case 'allow-mic':
      allowMicrophone();
      break;
    case 'skip-mic':
      skipMicrophone();
      break;
    case 'open-settings':
      openLayer($('[data-settings-layer]'));
      break;
    case 'close-settings':
      closeLayer($('[data-settings-layer]'));
      break;
    case 'toggle-auto-slow':
    case 'toggle-overlay':
      toggleSwitch(element);
      break;
    case 'toggle-play':
      togglePlayer();
      break;
    case 'toggle-loop':
      toggleLoop();
      break;
    case 'fullscreen': {
      const pane = $('.teacher-pane');
      if (!document.fullscreenElement && pane?.requestFullscreen) {
        pane.requestFullscreen().catch(() => showToast('当前浏览器未允许全屏播放。', 'error'));
      } else if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
      } else {
        showToast('当前浏览器不支持全屏播放。', 'error');
      }
      break;
    }
    case 'frame-back':
      frameStep(-1);
      break;
    case 'frame-forward':
      frameStep(1);
      break;
    case 'finish-practice':
      pausePlayer();
      navigate('results');
      break;
    case 'toggle-review':
      element.textContent = element.textContent.includes('观看') ? 'Ⅱ 暂停动作' : '▶ 观看动作';
      showToast('老师动作正以 60% 速度循环播放。');
      break;
    case 'toggle-mirror':
      $('[data-review-video]').classList.toggle('is-mirrored');
      element.classList.toggle('is-active');
      break;
    case 'toggle-markers':
      $('[data-review-video]').classList.toggle('hide-markers');
      element.classList.toggle('is-active');
      break;
    case 'try-focus':
      startFocusAttempt();
      break;
    case 'open-course':
      void openRemoteCourse(element.dataset.courseId);
      break;
    default:
      break;
  }
}

function handleClick(event) {
  const routeButton = event.target.closest('[data-route]');
  if (routeButton) {
    const route = routeButton.dataset.route;
    if (route === 'player' && !state.micResolved) openMicModal('player');
    else navigate(route);
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    handleAction(actionButton.dataset.action, actionButton);
    return;
  }

  const speedButton = event.target.closest('[data-speed]');
  if (speedButton) {
    setPlayerSpeed(speedButton.dataset.speed);
    return;
  }

  const seekButton = event.target.closest('[data-seek]');
  if (seekButton) {
    seekPlayer(Number(seekButton.dataset.seek));
    showToast(`已同步定位到 ${formatTime(state.playerTime, true)}`);
    return;
  }

  const toleranceButton = event.target.closest('[data-tolerance]');
  if (toleranceButton) {
    $$('[data-tolerance]').forEach((button) => button.classList.toggle('is-active', button === toleranceButton));
    return;
  }

  const themeButton = event.target.closest('[data-theme-choice]');
  if (themeButton) {
    chooseTheme(themeButton.dataset.themeChoice);
    return;
  }

  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) filterLibrary(filterButton.dataset.filter);
}

function handleSeekPointer(event) {
  const track = event.target.closest('[data-seek-track]');
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  seekPlayer(ratio * state.duration);
}

function initUpload() {
  const dropzone = $('[data-dropzone]');
  const input = $('#videoInput');
  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    if (input.files?.[0]) selectVideo(input.files[0]);
  });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
  }));
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) selectVideo(file);
  });
}

function initEvents() {
  document.addEventListener('click', handleClick);
  const playerVideo = $('#playerVideo');
  playerVideo?.addEventListener('loadedmetadata', () => {
    const actualDuration = Number(playerVideo.duration);
    if (!Number.isFinite(actualDuration) || actualDuration <= 0) return;
    state.mediaDuration = actualDuration;
    state.duration = actualDuration;
    state.playerTime = Math.min(state.playerTime, actualDuration);
    updateCourseCopy();
    updatePlayerUI();
  });
  playerVideo?.addEventListener('ended', () => {
    if (state.loopEnabled && state.duration > 18) {
      seekPlayer(Math.min(17.42, state.duration - 0.25));
      playerVideo.play().catch(() => pausePlayer());
      return;
    }
    state.playerTime = state.duration;
    pausePlayer();
    navigate('results');
  });
  playerVideo?.addEventListener('error', () => {
    if (!playerVideo.currentSrc) return;
    pausePlayer();
    showToast('课程视频无法播放，请检查文件或后端媒体地址。', 'error');
  });
  $('[data-seek-track]').addEventListener('click', handleSeekPointer);
  $('[data-seek-track]').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      seekPlayer(state.playerTime + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const layer = activeLayer();
      if (layer) closeLayer(layer);
    }
    trapFocus(event);
  });
  window.addEventListener('hashchange', () => activateView(routeFromHash()));
  window.addEventListener('beforeunload', () => {
    savePreferences();
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.micDetector?.stop();
    state.micStream?.getTracks().forEach((track) => track.stop());
    if (state.micContext?.state !== 'closed') void state.micContext?.close();
  });
  window.addEventListener('resize', () => {
    if (state.view === 'player') updatePlayerUI();
  });
}

function bootstrap() {
  loadPreferences();
  state.defaultTabEvents = $$('.tab-event').map((event) => event.cloneNode(true));
  buildWaveforms();
  initUpload();
  initEvents();
  updateCourseCopy();
  updateMicrophoneUI();
  setVideoSources();
  chooseTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  activateView(routeFromHash());
  const bootstrapLoadId = state.courseLoadId;
  void refreshBackendCourses().then(async (availableCourses) => {
    if (bootstrapLoadId !== state.courseLoadId) return;
    const requestedCourseId = new URLSearchParams(window.location.search).get('course');
    if (!requestedCourseId) return;
    const requestedCourse = availableCourses.find((course) => course.id === requestedCourseId);
    if (requestedCourse) {
      const loadId = ++state.courseLoadId;
      const activation = activateRemoteCourse(requestedCourse, loadId);
      if (routeFromHash() === 'home') navigate(requestedCourse.status === 'ready' ? 'overview' : 'analysis');
      await activation;
    } else if (state.backendAvailable) {
      await openRemoteCourse(requestedCourseId);
    }
  });
}

bootstrap();
