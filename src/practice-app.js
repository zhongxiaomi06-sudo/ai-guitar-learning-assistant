/**
 * practice-app.js
 * 弦间单一弹唱界面：上传 → 原地解析 → 原地跟练 → 页面内纠错与结果。
 * 无路由、无多视图；实时判定接入 core/audio、core/matching、core/practice 引擎。
 */

import { GuitarDetector } from './core/audio/detector.js';
import { ScoreModel } from './core/score/model.js';
import { MatchingEngine } from './core/matching/engine.js';
import { ScoringSystem } from './core/matching/scoring.js';
import { PracticeSession } from './core/practice/session.js';
import { midiToNoteName } from './shared/utils/index.js';
import { THRESHOLD_GOOD_TIME } from './shared/constants/index.js';
import { ApiError, courses } from './shared/utils/api.js';

const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const DEMO_DURATION = 48;
const STORAGE_KEY = 'xianjian-practice-state';
const MIC_SAMPLE_INTERVAL = 120;
const FEEDBACK_HOLD_MS = 1500;
const FOCUS_SPEEDS = [0.6, 0.75, 0.9, 1];
const SAME_ERROR_TRIGGER = 2;

const ANALYSIS_RESULTS = [
  { title: '已安全读取视频', detail: '媒体文件已准备进入音频分析', step: '视频读取完成' },
  { title: '已提取分析音轨', detail: '音轨已转换为单声道分析格式', step: '音轨提取完成' },
  { title: '正在识别吉他音高', detail: '忽略了超出标准吉他音域的检测', step: '音高识别完成' },
  { title: '正在合并碎音符', detail: '相邻的同音高事件已整理', step: '音符时值已整理' },
  { title: '正在求解可演奏弦位', detail: '每个音符正在映射到六根琴弦', step: '弦与品位已求解' },
  { title: '六线谱正在成形', detail: '音符正在按时间轴排入谱面', step: '六线谱已生成' },
  { title: '正在校验谱面数据', detail: '时间、弦位与媒体时长正在对齐', step: '谱面数据已校验' },
  { title: '课程已准备就绪', detail: '视频与六线谱已可进入跟练', step: '课程已准备' },
];

/** 内置示例课程（无后端时的兜底谱面）：startTime, string, fret */
const DEMO_NOTES = [
  [4, 3, 2], [8, 2, 1], [12, 1, 0], [17.62, 4, 2], [23, 2, 1],
  [28, 5, 3], [33, 1, 0], [38, 3, 0], [43, 2, 0],
];
const DEMO_BAR_SECONDS = 6;
const DEMO_CHORDS = ['Am', 'Am', 'C', 'C', 'G', 'G', 'Em', 'Em'];

const uploadJobs = new WeakMap();

const state = {
  stage: 'upload', // upload | analyzing | practice
  file: null,
  videoValidationId: 0,
  videoValidationPending: false,
  videoValidated: false,
  videoUrl: null,
  remoteVideoUrl: null,
  remoteCourse: null,
  score: null,
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
  micRequestId: 0,
  playing: false,
  playerTime: 0,
  playerSpeed: 1,
  loopEnabled: false,
  loopStart: 0,
  loopEnd: 0,
  animationFrame: null,
  lastFrameAt: 0,
  toastTimer: null,
  lastFocused: null,
  // 实时判定与练习引擎
  scoreModel: null,
  matchingEngine: null,
  scoring: new ScoringSystem(),
  session: null,
  noteElements: [], // [{ element, note }]
  lastMatchedNoteId: null,
  lastFeedbackAt: 0,
  errorStreak: { noteId: null, count: 0 },
  toleranceScale: 1,
  autoSlowDown: true,
  // 专项纠错
  focus: null, // { note, loopStart, loopEnd, ladderIndex, round, attempts, reviewing }
  focusAttempt: null, // { results: [] }
  reviewPlaying: false,
  // 结果
  lastResults: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* ---------------------------------------------------------------- 本地偏好 */

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.theme === 'dark') document.documentElement.dataset.theme = 'dark';
    if (saved.courseTitle) state.courseTitle = saved.courseTitle;
  } catch {
    // 不可用的本地状态不应阻断页面。
  }
}

function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: document.documentElement.dataset.theme || 'light',
      courseTitle: state.courseTitle,
      firstScores: state.firstScores || undefined,
    }));
  } catch {
    // 隐私模式可能禁用 localStorage，界面仍可正常使用。
  }
}

function loadFirstScores() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.firstScores = saved.firstScores || {};
  } catch {
    state.firstScores = {};
  }
}

/* ---------------------------------------------------------------- 通用 UI */

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
  }
  layer.hidden = true;
  if (allLayers().every((item) => !item || item.hidden)) {
    document.body.style.overflow = '';
  }
  if (restoreFocus && state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
}

function allLayers() {
  return [$('[data-mic-modal]'), $('[data-settings-layer]'), $('[data-focus-layer]'), $('[data-results-layer]')];
}

function activeLayer() {
  return allLayers().find((layer) => layer && !layer.hidden) || null;
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
  return on;
}

function chooseTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  $$('[data-theme-choice]').forEach((button) => button.classList.toggle('is-active', button.dataset.themeChoice === theme));
  savePreferences();
}

/* ---------------------------------------------------------------- 阶段切换 */

function setStage(stage) {
  state.stage = stage;
  $('[data-stage]').hidden = stage === 'practice';
  $('[data-workspace]').hidden = stage !== 'practice';
  $('[data-upload-area]').hidden = stage === 'analyzing';
  $('[data-analysis-panel]').hidden = stage !== 'analyzing';
  $('[data-stage-intro]').hidden = stage === 'analyzing';
  $('[data-topbar-course]').hidden = stage === 'upload';
  const titles = { upload: '上传视频', analyzing: 'AI 解析', practice: '弹唱跟练' };
  document.title = `${titles[stage]} · 弦间`;
}

/* ---------------------------------------------------------------- 上传与校验 */

function validateVideo(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const supportedTypes = ['video/mp4', 'video/quicktime'];
  if (!['mp4', 'mov'].includes(extension) || (file.type && !supportedTypes.includes(file.type))) {
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
  state.loopStart = 0;
  state.loopEnd = 0;
  state.lastMatchedNoteId = null;
  state.lastFeedbackAt = 0;
  state.errorStreak = { noteId: null, count: 0 };
  state.focus = null;
  state.focusAttempt = null;
  state.scoring = new ScoringSystem();
  state.session = null;
  $('[data-seek-track]')?.classList.remove('is-looping');
  $('[data-issue-button]').hidden = true;
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
  state.bpm = null;
  state.timeSignature = '--';
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
  const url = new URL(window.location.href);
  url.searchParams.delete('course');
  window.history.replaceState({}, '', url);
  const dropzone = $('[data-dropzone]');
  if (dropzone) dropzone.hidden = false;
  $('[data-selected-file]').hidden = true;
  const input = $('#videoInput');
  if (input) input.value = '';
  updateStartAnalysisButton();
  setVideoSources();
  updateCourseCopy();
  setStage('upload');
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
    element.textContent = Number.isFinite(state.bpm) && state.bpm > 0 ? String(state.bpm) : '--';
  });
  $$('[data-time-signature]').forEach((element) => {
    element.textContent = state.timeSignature || '4/4';
  });
  const analysisBpm = $('[data-analysis-bpm]');
  if (analysisBpm) {
    analysisBpm.textContent = Number.isFinite(state.bpm) && state.bpm > 0
      ? `${state.bpm} BPM`
      : '节拍待定';
  }
  const analysisSignature = $('[data-analysis-signature]');
  if (analysisSignature) analysisSignature.textContent = state.timeSignature || '--';
  const analysisMode = $('[data-analysis-mode]');
  if (analysisMode) {
    analysisMode.textContent = state.remoteCourse
      ? (state.remoteCourse.status === 'ready' ? '六线谱已生成' : '后台转谱')
      : (state.file ? '等待转谱' : '示例课程');
  }
  const seekTrack = $('[data-seek-track]');
  seekTrack?.setAttribute('aria-valuemax', String(Math.max(1, state.duration)));
  savePreferences();
}

function setVideoSources() {
  const mediaSource = state.videoUrl || state.remoteVideoUrl;
  const mappings = [
    ['analysisVideo', '.media-stage'],
    ['playerVideo', '.teacher-video'],
    ['reviewVideo', '.review-video'],
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

/* ---------------------------------------------------------------- 谱面模型 */

function normalizeTimeSignature(value) {
  if (Array.isArray(value) && value.length === 2) return `${value[0]}/${value[1]}`;
  return typeof value === 'string' && /^\d+\/\d+$/.test(value) ? value : '4/4';
}

/** 从后端谱面打平演奏事件 */
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

/** 提取每小节和弦（后端格式宽容处理） */
function scoreBarChords(score) {
  if (!Array.isArray(score?.bars)) return [];
  return score.bars.map((bar) => {
    if (typeof bar?.chord === 'string') return bar.chord;
    if (Array.isArray(bar?.chords) && bar.chords.length) return String(bar.chords[0]);
    return null;
  });
}

/**
 * 把后端谱面或内置示例转换为 ScoreModel 可用的 project，
 * 让实时判定与纠错闭环有统一的数据来源。
 */
function buildProject() {
  const events = state.score ? scoreEvents(state.score) : [];
  const notes = events.length
    ? events
    : DEMO_NOTES.map(([startTime, stringNumber, fret]) => ({ startTime, stringNumber, fret }));

  const chords = state.score ? scoreBarChords(state.score) : [];
  const scoreBars = Array.isArray(state.score?.bars) ? state.score.bars : [];
  const barCount = Math.max(
    scoreBars.length || 0,
    Math.ceil(Math.max(state.duration, notes[notes.length - 1]?.startTime || 0) / DEMO_BAR_SECONDS),
    1,
  );

  const bars = [];
  for (let index = 0; index < barCount; index += 1) {
    const raw = scoreBars[index];
    const startTime = Number(raw?.startTime);
    const endTime = Number(raw?.endTime);
    const start = Number.isFinite(startTime) && startTime >= 0 ? startTime : index * DEMO_BAR_SECONDS;
    const end = Number.isFinite(endTime) && endTime > start ? endTime : start + DEMO_BAR_SECONDS;
    bars.push({
      id: `bar_${index + 1}`,
      index: index + 1,
      startTime: start,
      endTime: end,
      chord: chords[index] || null,
      beats: [{ notes: [] }],
    });
  }

  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  sorted.forEach((event, index) => {
    const bar = bars.find((item) => event.startTime >= item.startTime && event.startTime < item.endTime)
      || bars[bars.length - 1];
    const next = sorted[index + 1];
    const endTime = next && next.startTime > event.startTime
      ? Math.min(event.startTime + 0.6, next.startTime)
      : event.startTime + 0.4;
    bar.beats[0].notes.push({
      id: `note_${String(index + 1).padStart(3, '0')}`,
      barId: bar.id,
      type: 'note',
      startTime: event.startTime,
      endTime,
      string: event.stringNumber,
      fret: event.fret,
    });
  });

  return {
    id: state.remoteCourse?.id || 'local',
    title: state.courseTitle,
    duration: state.duration,
    bpm: state.bpm || 92,
    timeSignature: state.timeSignature || '4/4',
    bars,
  };
}

function renderScore() {
  const tablature = $('[data-tablature]');
  const playhead = $('[data-score-playhead]');
  if (!tablature || !playhead || !state.scoreModel) return;
  $$('.tab-event', tablature).forEach((event) => event.remove());
  state.noteElements = [];

  const duration = Math.max(1, state.duration);
  state.scoreModel.notes.slice(0, 96).forEach((note) => {
    const button = document.createElement('button');
    button.className = 'tab-event';
    button.type = 'button';
    button.dataset.seek = String(note.startTime);
    button.dataset.noteId = note.id;
    button.style.setProperty('--x', `${Math.max(3, Math.min(96, note.startTime / duration * 100)).toFixed(2)}%`);
    button.style.setProperty('--y', String(note.string));
    button.textContent = String(note.fret);
    button.setAttribute('aria-label', `${note.string} 弦 ${note.fret} 品，${formatTime(note.startTime, true)}`);
    tablature.insertBefore(button, playhead);
    state.noteElements.push({ element: button, note });
  });
}

function renderMeasureTrack() {
  const container = $('[data-measures]');
  if (!container || !state.scoreModel) return;
  container.replaceChildren();
  state.scoreModel.project.bars.forEach((bar) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.seek = String(bar.startTime);
    button.dataset.barId = bar.id;
    button.textContent = String(bar.index).padStart(2, '0');
    container.appendChild(button);
  });
}

function renderChordTrack() {
  const container = $('[data-chords]');
  if (!container || !state.scoreModel) return;
  container.replaceChildren();
  const bars = state.scoreModel.project.bars;
  let lastChord = null;
  bars.forEach((bar, index) => {
    const chord = bar.chord || DEMO_CHORDS[index % DEMO_CHORDS.length];
    if (chord === lastChord) return;
    lastChord = chord;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.seek = String(bar.startTime);
    button.dataset.barId = bar.id;
    button.textContent = chord;
    container.appendChild(button);
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
  updateCourseCopy();
}

/* ---------------------------------------------------------------- 后端课程 */

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
  state.bpm = Number.isFinite(courseBpm) && courseBpm > 0 ? Math.min(400, Math.round(courseBpm)) : null;
  state.timeSignature = normalizeTimeSignature(course.time_signature);
  state.score = null;
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

async function refreshBackendCourses() {
  try {
    const result = await courses.list();
    state.backendAvailable = true;
    state.backendCourses = Array.isArray(result) ? result : [];
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
    if (course.status === 'ready') {
      if (await activation) enterPractice();
    } else {
      setStage('analyzing');
      await activation;
      renderRemoteAnalysisStatus(state.remoteCourse);
      scheduleCoursePolling();
    }
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
      let activeCourse = course;
      if (state.file === selectedFile) {
        state.remoteCourse = activeCourse;
        state.remoteVideoUrl = course.video_path ? courses.getVideoUrl(course.id) : null;
        renderRemoteAnalysisStatus(activeCourse);
        showToast('课程已保存，正在启动后台音频转谱。');
      }
      try {
        activeCourse = await courses.parse(course.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // 另一个标签页可能已启动同一课程的转谱，以权威状态为准。
          try {
            activeCourse = await courses.get(course.id);
          } catch {
            activeCourse = { ...course, status: 'error', progress: 0 };
          }
        } else {
          activeCourse = { ...course, status: 'error', progress: 0 };
          if (state.file === selectedFile) {
            showToast('视频已保存，但转谱任务未能启动，可稍后重试。', 'error');
          }
        }
      }
      if (state.file === selectedFile) {
        state.remoteCourse = activeCourse;
        const url = new URL(window.location.href);
        url.searchParams.set('course', course.id);
        window.history.replaceState({}, '', url);
        if (state.stage === 'analyzing') {
          renderRemoteAnalysisStatus(activeCourse);
          scheduleCoursePolling();
        }
      }
      await refreshBackendCourses();
      return activeCourse;
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
  setStage('analyzing');
  if (state.file) void persistSelectedCourse();
  window.setTimeout(beginAnalysis, 120);
}

async function prepareDemo() {
  const backendDemo = state.backendCourses.find((course) => course.status === 'ready' && course.video_path)
    || state.backendCourses.find((course) => course.video_path);
  if (backendDemo) {
    try {
      const activation = activateRemoteCourse(backendDemo);
      if (backendDemo.status === 'ready') {
        if (await activation) {
          enterPractice();
          showToast('已载入后端课程与可用谱面。');
        }
        return;
      }
      setStage('analyzing');
      await activation;
      renderRemoteAnalysisStatus(state.remoteCourse);
      scheduleCoursePolling();
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
  setStage('analyzing');
  window.setTimeout(beginAnalysis, 120);
}

/* ---------------------------------------------------------------- 解析进度 */

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
  const skipButton = $('[data-action="skip-analysis"]');
  if (skipButton) skipButton.hidden = false;
  setAnalysisAction('hidden');
  $$('.analysis-wave .wave-bar').forEach((bar) => bar.classList.remove('is-visible', 'is-active'));
}

function setAnalysisAction(mode) {
  const button = $('[data-analysis-action]');
  if (!button) return;
  if (mode === 'hidden') {
    button.hidden = true;
    return;
  }
  const retry = mode === 'retry';
  button.hidden = false;
  button.dataset.action = retry ? 'retry-analysis' : 'enter-practice';
  button.replaceChildren(
    document.createTextNode(retry ? '重新启动解析 ' : '进入弹唱跟练 '),
    Object.assign(document.createElement('span'), { textContent: '→' }),
  );
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
  const skipButton = $('[data-action="skip-analysis"]');
  if (skipButton) skipButton.hidden = true;

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
    : (failed ? '可直接重新启动解析，无需再次上传视频' : `后端进度 ${progress}% · 音频转谱正在后台运行`);
  setAnalysisAction(ready ? 'complete' : (failed ? 'retry' : 'hidden'));
  state.analysisComplete = ready;
  updateCourseCopy();

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
  if (state.stage !== 'analyzing' || !course?.id || ['ready', 'error'].includes(course.status)) return;
  const loadId = state.courseLoadId;
  state.coursePollTimer = window.setTimeout(async () => {
    try {
      const freshCourse = await courses.get(course.id);
      if (loadId !== state.courseLoadId || state.remoteCourse?.id !== course.id) return;
      state.remoteCourse = freshCourse;
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

async function retryRemoteAnalysis() {
  const course = state.remoteCourse;
  if (!course?.id || course.status !== 'error') return;
  const button = $('[data-analysis-action]');
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    let freshCourse;
    try {
      freshCourse = await courses.parse(course.id);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      freshCourse = await courses.get(course.id);
    }
    if (state.remoteCourse?.id !== course.id) return;
    state.remoteCourse = freshCourse;
    renderRemoteAnalysisStatus(freshCourse);
    scheduleCoursePolling();
    showToast('已重新启动后台音频转谱。');
  } catch {
    if (state.remoteCourse?.id === course.id) {
      renderRemoteAnalysisStatus(course);
      showToast('暂时无法重新启动解析，请稍后再试。', 'error');
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

function beginAnalysis() {
  if (state.analysisTimer || state.analysisComplete || state.stage !== 'analyzing') return;
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
  $('[data-detected-chord]').textContent = [
    '读取', '音轨', '音高', '整理', '弦位', '谱面', '校验', '完成',
  ][state.analysisIndex];

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
  const noteCount = state.score ? scoreEvents(state.score).length : DEMO_NOTES.length;
  $('[data-analysis-detail]').textContent = `${noteCount} 个音符 · 谱面已可与视频同步`;
  setAnalysisAction('complete');
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

/* ---------------------------------------------------------------- 麦克风 */

function openMicModal() {
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
    showToast('麦克风已连接 · 实时音高检测已开始');
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
  void stopMicrophone(false);
  state.micResolved = true;
  state.micAllowed = false;
  updateMicrophoneUI();
  closeLayer($('[data-mic-modal]'));
  showToast('已进入仅观看模式，可随时在顶部开启麦克风。');
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

/* ---------------------------------------------------------------- 进入跟练 */

function enterPractice() {
  const project = buildProject();
  state.scoreModel = new ScoreModel(project);
  state.matchingEngine = new MatchingEngine(state.scoreModel);
  state.scoring = new ScoringSystem();
  state.session = new PracticeSession(project.id);
  state.session.isAutoSlowDown = state.autoSlowDown;
  state.errorStreak = { noteId: null, count: 0 };
  state.lastMatchedNoteId = null;

  setStage('practice');
  renderScore();
  renderMeasureTrack();
  renderChordTrack();
  setVideoSources();
  updateCourseCopy();
  updatePlayerUI();
  if (!state.micResolved) openMicModal();
}

/* ---------------------------------------------------------------- 播放控制 */

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
  if (state.micContext?.state === 'suspended') void state.micContext.resume();
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

  if (state.micAllowed && state.micDetector && timestamp - state.micLastSampleAt >= MIC_SAMPLE_INTERVAL) {
    state.micLastSampleAt = timestamp;
    try {
      sampleDetection();
    } catch {
      void stopMicrophone();
      showToast('麦克风连接已中断，请重新开启。', 'error');
    }
  }

  // 专项尝试到达循环末尾：结算本轮
  if (state.focusAttempt && state.playerTime >= state.focusAttempt.endTime) {
    finishFocusAttempt();
  }

  if (state.loopEnabled && state.loopEnd > state.loopStart && state.playerTime >= state.loopEnd) {
    seekPlayer(state.loopStart);
    if (!state.focusAttempt) {
      const v = $('#playerVideo');
      if (v && (state.videoUrl || state.remoteVideoUrl)) v.play().catch(() => pausePlayer());
    }
  }
  if (state.playerTime >= state.duration) {
    state.playerTime = state.duration;
    pausePlayer();
    finishPractice();
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

function setPlayerSpeed(speed, { silent = false } = {}) {
  state.playerSpeed = Number(speed) || 1;
  const video = $('#playerVideo');
  if (video) video.playbackRate = state.playerSpeed;
  $$('[data-speed]').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.speed) === state.playerSpeed));
  if (!silent) showToast(`播放速度已调整为 ${Math.round(state.playerSpeed * 100)}%`);
}

function frameStep(direction) {
  seekPlayer(state.playerTime + direction / 30);
}

function toggleLoop() {
  if (state.loopEnabled) {
    state.loopEnabled = false;
    $('[data-seek-track]').classList.remove('is-looping');
    showToast('A/B 循环已关闭');
    return;
  }
  // 未设置过循环区间时，以当前位置为中心取前后各 4 秒。
  if (!(state.loopEnd > state.loopStart)) {
    state.loopStart = Math.max(0, state.playerTime - 4);
    state.loopEnd = Math.min(state.duration, state.playerTime + 4);
  }
  state.loopEnabled = true;
  $('[data-seek-track]').classList.add('is-looping');
  showToast(`A/B 循环已开启：${formatTime(state.loopStart)}–${formatTime(state.loopEnd)}`);
}

function setLoopRange(start, end) {
  state.loopStart = Math.max(0, Math.min(start, state.duration));
  state.loopEnd = Math.max(state.loopStart + 0.5, Math.min(end, state.duration));
  state.loopEnabled = true;
  $('[data-seek-track]')?.classList.add('is-looping');
}

/* ---------------------------------------------------------------- 实时判定 */

/** 教学友好型容错：宽松 1.6×，标准 1×，严格 0.7× */
function toleranceThreshold() {
  return THRESHOLD_GOOD_TIME * state.toleranceScale;
}

function sampleDetection() {
  if (!state.scoreModel || !state.matchingEngine) return;
  const detection = state.micDetector.getDetection();
  const videoTime = state.playerTime;
  const currentTarget = state.scoreModel.getNoteAtTime(videoTime);
  const targetIdentity = currentTarget?.id || null;
  if (!currentTarget) state.lastMatchedNoteId = null;

  if (currentTarget
    && detection.onset
    && detection.pitch.confidence >= 0.65
    && detection.rms >= 0.005
    && targetIdentity !== state.lastMatchedNoteId) {
    const playedNote = {
      pitch: detection.pitch.frequency,
      rms: detection.rms,
      velocity: detection.rms,
      // AudioContext 与视频时间原点不同，统一映射到视频时间轴。
      onsetTime: videoTime,
      duration: 0,
    };
    const result = state.matchingEngine.match(videoTime, playedNote);
    state.lastMatchedNoteId = targetIdentity;
    applyMatchResult(result);
  }
}

function applyMatchResult(result) {
  state.scoring.add(result);
  state.session?.handleResult(result);
  state.lastFeedbackAt = performance.now();

  if (state.focusAttempt) state.focusAttempt.results.push(result);

  // 谱面热力图：对当前目标音符着色
  const entry = state.noteElements.find((item) => item.note.id === result.targetNote?.id);
  if (entry) {
    entry.element.classList.remove('is-correct', 'is-wrong', 'is-missed', 'is-early', 'is-late');
    if (result.type === 'correct') entry.element.classList.add('is-correct');
    else if (result.type === 'wrong-pitch') entry.element.classList.add('is-wrong');
    else if (result.type === 'miss') entry.element.classList.add('is-missed');
    if (Math.abs(result.timingDeviation) > toleranceThreshold()) {
      entry.element.classList.add(result.timingDeviation < 0 ? 'is-early' : 'is-late');
    }
  }

  updateFeedbackCopy(result);
  trackErrorStreak(result);

  if (state.autoSlowDown && state.session) {
    const adapted = state.session.speed;
    if (Math.abs(adapted - state.playerSpeed) > 0.001) setPlayerSpeed(adapted, { silent: true });
  }
}

function updateFeedbackCopy(result) {
  const title = $('[data-feedback-title]');
  const copy = $('[data-feedback-copy]');
  const score = $('[data-live-score]');
  if (!title || !copy || !score) return;

  const target = result.targetNote;
  const targetLabel = target ? `${target.string} 弦 ${target.fret} 品` : '--';
  const heard = result.playedNote?.pitch > 0
    ? midiToNoteName(69 + 12 * Math.log2(result.playedNote.pitch / 440))
    : null;

  if (result.type === 'correct') {
    title.textContent = result.score === 'perfect' ? '完美' : '正确';
    title.dataset.tone = 'good';
    copy.textContent = `目标：${targetLabel}${heard ? ` · 听到 ${heard}` : ''}`;
  } else if (result.type === 'wrong-pitch') {
    title.textContent = '音高偏差';
    title.dataset.tone = 'bad';
    copy.textContent = `目标：${targetLabel} · 听到：${heard || '未知'} · 偏差 ${Math.round(result.pitchDeviation)} 音分`;
  } else if (result.type === 'miss') {
    title.textContent = '漏音 / 节奏偏差';
    title.dataset.tone = 'warn';
    const offset = Math.round(result.timingDeviation);
    copy.textContent = offset
      ? `目标：${targetLabel} · ${offset > 0 ? `慢了 ${offset} ms` : `快了 ${-offset} ms`}`
      : `目标：${targetLabel} · 没有清晰发声`;
  } else {
    title.textContent = '额外音符';
    title.dataset.tone = 'warn';
    copy.textContent = heard ? `听到 ${heard}，此处无目标音符` : '此处无目标音符';
  }

  const accuracy = Math.round(state.scoring.accuracy() * 100);
  score.textContent = state.scoring.results.length ? `${accuracy}%` : '--';
}

/** 连续同一目标出错 → 触发专项练习入口 */
function trackErrorStreak(result) {
  if (result.type === 'correct') {
    if (result.targetNote?.id === state.errorStreak.noteId) {
      state.errorStreak = { noteId: null, count: 0 };
    }
    return;
  }
  const noteId = result.targetNote?.id;
  if (!noteId) return;
  if (state.errorStreak.noteId === noteId) {
    state.errorStreak.count += 1;
  } else {
    state.errorStreak = { noteId, count: 1 };
  }
  if (state.errorStreak.count >= SAME_ERROR_TRIGGER) {
    const barIndex = barIndexOfNote(result.targetNote);
    const issueButton = $('[data-issue-button]');
    $('[data-issue-copy]').textContent = `第 ${barIndex} 小节 ${result.targetNote.string} 弦连续出错`;
    issueButton.hidden = false;
    state.errorStreak = { noteId: null, count: 0 };
  }
}

function barIndexOfNote(note) {
  if (!note || !state.scoreModel) return '?';
  const bar = state.scoreModel.project.bars.find((item) => item.id === note.barId);
  return bar ? bar.index : '?';
}

/* ---------------------------------------------------------------- 播放器 UI */

function updatePlayerUI() {
  if (state.stage !== 'practice') return;
  const duration = Math.max(1, state.duration);
  const progress = Math.max(0, Math.min(1, state.playerTime / duration));
  const playButton = $('[data-action="toggle-play"]');
  $('[data-play-icon]').textContent = state.playing ? 'Ⅱ' : '▶';
  playButton?.setAttribute('aria-label', state.playing ? '暂停' : '播放');
  playButton?.setAttribute('aria-pressed', String(state.playing));
  $('[data-player-time]').textContent = formatTime(state.playerTime);
  $('.frame-counter').textContent = formatTime(state.playerTime, true);
  const seekProgress = $('[data-seek-progress]');
  if (seekProgress) seekProgress.style.width = `${progress * 100}%`;
  const seekTrack = $('[data-seek-track]');
  seekTrack?.setAttribute('aria-valuenow', state.playerTime.toFixed(2));
  const loopRange = $('[data-loop-range]');
  if (loopRange) {
    if (state.loopEnabled && state.loopEnd > state.loopStart) {
      loopRange.style.left = `${(state.loopStart / duration) * 100}%`;
      loopRange.style.width = `${((state.loopEnd - state.loopStart) / duration) * 100}%`;
      loopRange.hidden = false;
    } else {
      loopRange.hidden = true;
    }
  }

  const timeline = $('.timeline-pane');
  const timelinePlayhead = $('[data-timeline-playhead]');
  if (timeline && timelinePlayhead) {
    const labelWidth = 58;
    const left = labelWidth + Math.max(0, timeline.clientWidth - labelWidth) * progress;
    timelinePlayhead.style.left = `${left}px`;
  }
  const scorePlayhead = $('[data-score-playhead]');
  if (scorePlayhead) scorePlayhead.style.left = `${progress * 100}%`;

  // 谱面指针与当前音符
  let nearest = null;
  let nearestDistance = Infinity;
  state.noteElements.forEach(({ element, note }) => {
    const distance = Math.abs(note.startTime - state.playerTime);
    if (distance < nearestDistance) {
      nearest = element;
      nearestDistance = distance;
    }
    if (!element.classList.contains('is-correct')
      && !element.classList.contains('is-wrong')
      && !element.classList.contains('is-missed')) {
      element.classList.toggle('is-done', note.startTime < state.playerTime - 1.5);
    }
    element.classList.remove('is-current');
  });
  if (nearest) nearest.classList.add('is-current');

  // 小节与和弦轨高亮
  const currentBar = state.scoreModel?.getBarAtTime(state.playerTime);
  $$('#mainContent [data-bar-id]').forEach((button) => {
    button.classList.toggle('is-current', button.dataset.barId === currentBar?.id);
    button.classList.toggle('is-past', Number(button.dataset.seek) < state.playerTime - 0.5);
  });
  $('[data-current-chord]').textContent = currentBar?.chord
    || DEMO_CHORDS[(currentBar?.index ?? 1) - 1] || '--';

  updateHandPanes(currentBar);
  updateListeningState();
}

function updateHandPanes(currentBar) {
  if (!state.scoreModel) return;
  const current = state.scoreModel.getNoteAtTime(state.playerTime);
  const upcoming = state.scoreModel.getUpcomingNotes(state.playerTime, 3);
  const next = upcoming.find((note) => note.id !== current?.id);

  const leftDetail = $('[data-left-hand-detail]');
  if (leftDetail) {
    leftDetail.replaceChildren(...(current
      ? [Object.assign(document.createElement('span'), { textContent: `${current.string} 弦 ${current.fret} 品` })]
      : [Object.assign(document.createElement('span'), { textContent: currentBar ? '保持当前把位' : '等待演奏' })]));
  }
  const nextMotion = $('[data-next-motion] small');
  if (nextMotion) {
    nextMotion.textContent = next ? `下一动作：${next.string} 弦 ${next.fret} 品` : '等待演奏';
  }
  const pickFinger = $('[data-pick-finger]');
  const pickDetail = $('[data-pick-detail]');
  const pickDirection = $('[data-pick-direction]');
  if (current && pickFinger && pickDetail && pickDirection) {
    const finger = current.string >= 4 ? 'P · 拇指' : ['i · 食指', 'm · 中指', 'a · 无名指'][3 - current.string] || 'i · 食指';
    pickFinger.textContent = finger;
    pickDetail.textContent = `拨 ${current.string} 弦`;
    pickDirection.textContent = current.string >= 4 ? '↓' : '↑';
  }
  const rightDetail = $('[data-right-hand-detail]');
  if (rightDetail && next) rightDetail.textContent = `下一次：拨 ${next.string} 弦`;
}

function updateListeningState() {
  const title = $('[data-feedback-title]');
  const copy = $('[data-feedback-copy]');
  const score = $('[data-live-score]');
  if (!title || !copy || !score) return;

  // 最近一次判定结果保留片刻，避免闪烁
  if (performance.now() - state.lastFeedbackAt < FEEDBACK_HOLD_MS) return;

  if (!state.playing) {
    title.textContent = state.playerTime > 0 ? '已暂停' : '准备就绪';
    title.dataset.tone = '';
    copy.textContent = state.playerTime > 0 ? '可点击谱面音符精确定位。' : '点击播放，跟随老师开始演奏。';
    return;
  }
  if (state.micAllowed) {
    title.textContent = '正在聆听';
    title.dataset.tone = '';
    copy.textContent = '跟随谱面演奏，系统会实时判定每一个音。';
  } else {
    title.textContent = '跟随播放';
    title.dataset.tone = '';
    copy.textContent = '仅观看模式不会生成演奏判定；开启麦克风可查看实时反馈。';
  }
}

/* ---------------------------------------------------------------- 专项纠错 */

function findWeakestNote() {
  const wrong = [...state.scoring.results].reverse()
    .find((result) => result.type !== 'correct' && result.targetNote);
  if (wrong) return wrong.targetNote;
  // 无错误记录时，回到当前播放位置附近的音符
  return state.scoreModel?.getNoteAtTime(state.playerTime)
    || state.scoreModel?.notes[0]
    || null;
}

function openFocus(note = null) {
  if (!state.scoreModel) return;
  const target = note || findWeakestNote();
  if (!target) {
    showToast('还没有可针对练习的难点，先完整跟练一遍。');
    return;
  }
  pausePlayer();
  const bar = state.scoreModel.project.bars.find((item) => item.id === target.barId);
  const prevBar = state.scoreModel.project.bars[(bar?.index ?? 1) - 2];
  const nextBar = state.scoreModel.project.bars[bar?.index ?? 1];
  const loopStart = Math.max(0, prevBar ? prevBar.startTime : target.startTime - 2);
  const loopEnd = Math.min(state.duration, nextBar ? nextBar.endTime : target.endTime + 2);

  state.focus = {
    note: target,
    loopStart,
    loopEnd,
    ladderIndex: 0,
    round: 0,
    attempts: [],
    targetResolved: false,
  };

  const barIndex = bar?.index ?? '?';
  $('[data-focus-subtitle]').textContent = `第 ${barIndex} 小节 · 回看循环 ${formatTime(loopStart, true)}–${formatTime(loopEnd, true)}`;
  $('[data-focus-issue]').textContent = `${target.string} 弦 ${target.fret} 品 · 第 ${barIndex} 小节`;
  $('[data-marker-target]').textContent = `目标：${target.string} 弦 ${target.fret} 品`;

  // 重置提速阶梯与轮次
  $$('[data-speed-ladder] > div').forEach((item, index) => {
    item.classList.toggle('is-current', index === 0);
    $('span', item).textContent = index === 0 ? '练习中' : (index === FOCUS_SPEEDS.length - 1 ? '原速' : '待解锁');
  });
  $('[data-round-info]').textContent = '第 1 轮';
  $('[data-comparison]').hidden = true;
  $('[data-review-caption]').textContent = `老师动作 · ${Math.round(FOCUS_SPEEDS[0] * 100)}% 速度`;

  setLoopRange(loopStart, loopEnd);
  seekPlayer(loopStart);
  state.focusAttempt = null;
  openLayer($('[data-focus-layer]'));
}

function closeFocus() {
  stopReviewVideo();
  state.focusAttempt = null;
  closeLayer($('[data-focus-layer]'));
}

function focusSpeed() {
  return FOCUS_SPEEDS[state.focus?.ladderIndex ?? 0];
}

function stopReviewVideo() {
  state.reviewPlaying = false;
  const video = $('#reviewVideo');
  video?.pause();
  const button = $('[data-action="toggle-review"]');
  if (button) button.textContent = '▶ 观看动作';
}

function toggleReview() {
  const video = $('#reviewVideo');
  if (!state.focus) return;
  if (state.reviewPlaying) {
    stopReviewVideo();
    return;
  }
  if (!(state.videoUrl || state.remoteVideoUrl) || !video) {
    showToast('示例模式暂无老师画面，仅展示 AI 动作标记。');
    return;
  }
  state.reviewPlaying = true;
  video.currentTime = state.focus.loopStart;
  video.playbackRate = focusSpeed();
  video.loop = false;
  video.ontimeupdate = () => {
    if (state.reviewPlaying && video.currentTime >= state.focus.loopEnd) {
      video.currentTime = state.focus.loopStart;
    }
  };
  video.play().catch(() => {
    stopReviewVideo();
    showToast('浏览器阻止了自动播放，请再点一次。', 'error');
  });
  $('[data-action="toggle-review"]').textContent = 'Ⅱ 暂停动作';
}

function reviewFrameStep(direction) {
  const video = $('#reviewVideo');
  if (!video || !(state.videoUrl || state.remoteVideoUrl)) return;
  video.pause();
  state.reviewPlaying = false;
  $('[data-action="toggle-review"]').textContent = '▶ 观看动作';
  video.currentTime = Math.max(state.focus?.loopStart ?? 0,
    Math.min(video.currentTime + direction / 30, state.focus?.loopEnd ?? state.duration));
}

/** 我来试试：倒数 → 在循环区间内以当前阶梯速度真实监听 */
function startFocusAttempt() {
  if (!state.focus) return;
  if (!state.micAllowed) {
    openMicModal();
    showToast('专项练习需要麦克风监听你的演奏。');
    return;
  }
  stopReviewVideo();
  const countdown = $('[data-countdown]');
  const number = $('span', countdown);
  countdown.hidden = false;
  let count = 3;
  number.textContent = String(count);
  $('small', countdown).textContent = '准备演奏';
  const interval = window.setInterval(() => {
    count -= 1;
    if (count > 0) {
      number.textContent = String(count);
      return;
    }
    if (count === 0) {
      number.textContent = '开始';
      $('small', countdown).textContent = `弹奏第 ${barIndexOfNote(state.focus.note)} 小节`;
      return;
    }
    window.clearInterval(interval);
    countdown.hidden = true;
    beginFocusRound();
  }, 680);
}

function beginFocusRound() {
  const focus = state.focus;
  focus.round += 1;
  $('[data-round-info]').textContent = `第 ${focus.round} 轮`;
  state.focusAttempt = {
    startTime: focus.loopStart,
    endTime: focus.loopEnd,
    results: [],
  };
  setPlayerSpeed(focusSpeed(), { silent: true });
  seekPlayer(focus.loopStart);
  playPlayer();
}

function finishFocusAttempt() {
  const focus = state.focus;
  const attempt = state.focusAttempt;
  state.focusAttempt = null;
  pausePlayer();
  if (!focus || !attempt) return;

  const metrics = computeMetrics(attempt.results);
  const targetResult = attempt.results.find((result) => result.targetNote?.id === focus.note.id);
  const resolved = targetResult?.type === 'correct';
  const passed = resolved && metrics.accuracy >= 0.85;

  const previous = focus.attempts[focus.attempts.length - 1] || null;
  focus.attempts.push(metrics);

  showComparison(metrics, previous, passed, resolved);

  if (passed) {
    const ladder = $$('[data-speed-ladder] > div');
    const current = ladder[focus.ladderIndex];
    current?.classList.remove('is-current');
    if (current) $('span', current).textContent = '通过';
    if (focus.ladderIndex < FOCUS_SPEEDS.length - 1) {
      focus.ladderIndex += 1;
      const next = ladder[focus.ladderIndex];
      next?.classList.add('is-current');
      if (next) $('span', next).textContent = '已解锁';
      $('[data-review-caption]').textContent = `老师动作 · ${Math.round(focusSpeed() * 100)}% 速度`;
      showToast(`目标错误已解决，${Math.round(focusSpeed() * 100)}% 速度已解锁。`);
    } else {
      showToast('已在原速通过该难点，可以回到完整跟练。');
    }
  }
}

function showComparison(metrics, previous, passed, resolved) {
  const comparison = $('[data-comparison]');
  comparison.hidden = false;
  const percent = (value) => `${Math.round(value * 100)}%`;
  $('[data-cmp-acc-prev]').textContent = previous ? percent(previous.accuracy) : '--';
  $('[data-cmp-acc-now]').textContent = percent(metrics.accuracy);
  $('[data-cmp-chord-prev]').textContent = previous ? percent(previous.chord) : '--';
  $('[data-cmp-chord-now]').textContent = percent(metrics.chord);
  $('[data-cmp-time-prev]').textContent = previous ? percent(previous.timing) : '--';
  $('[data-cmp-time-now]').textContent = percent(metrics.timing);

  const title = $('[data-comparison-title]');
  const next = $('[data-comparison-next]');
  if (passed) {
    title.textContent = '这个难点已经稳定了。';
    next.textContent = state.focus.ladderIndex < FOCUS_SPEEDS.length - 1
      ? `下一步：提到 ${Math.round(FOCUS_SPEEDS[state.focus.ladderIndex + 1] * 100)}% 速度，保持相同动作。`
      : '下一步：回到完整跟练，恢复原速。';
  } else if (resolved) {
    title.textContent = '目标音已正确，还不够稳定。';
    next.textContent = '下一步：当前速度再练一次，注意落指后听清每根弦。';
  } else if (metrics.timing < 0.6) {
    title.textContent = '节奏还不够稳。';
    next.textContent = '下一步：跟着节拍慢速再看一遍老师动作。';
  } else {
    title.textContent = '动作还没改过来。';
    next.textContent = '下一步：重新观看老师动作，注意保留手指。';
  }
}

/* ---------------------------------------------------------------- 练习结果 */

function computeMetrics(results) {
  const scoped = results.filter((result) => result.targetNote);
  const hits = scoped.filter((result) => result.type === 'correct').length;
  const accuracy = scoped.length ? hits / scoped.length : 0;
  const chordScoped = scoped.filter((result) => result.targetNote.type === 'chord');
  const chord = chordScoped.length
    ? chordScoped.filter((result) => result.type === 'correct').length / chordScoped.length
    : accuracy;
  const timed = scoped.filter((result) => result.type !== 'extra');
  const timing = timed.length
    ? timed.filter((result) => Math.abs(result.timingDeviation) <= toleranceThreshold()).length / timed.length
    : 0;
  return { accuracy, chord, timing };
}

function finishPractice() {
  pausePlayer();
  if (!state.scoring.results.length) {
    showToast('本次没有演奏判定记录，开启麦克风跟练后可生成结果。');
    return;
  }
  const metrics = computeMetrics(state.scoring.results);
  const total = Math.round(100 * (0.5 * metrics.accuracy + 0.25 * metrics.chord + 0.25 * metrics.timing));
  state.lastResults = { ...metrics, total };

  $('[data-results-score]').textContent = String(total);
  $('[data-score-ring]').style.setProperty('--score', String(total));

  const key = state.courseTitle;
  const first = state.firstScores?.[key];
  if (Number.isFinite(first)) {
    const delta = total - first;
    $('[data-results-delta]').textContent = `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}`;
  } else {
    $('[data-results-delta]').textContent = '首次';
    state.firstScores = { ...(state.firstScores || {}), [key]: total };
    savePreferences();
  }

  const percent = (value) => `${Math.round(value * 100)}%`;
  $('[data-metric-accuracy]').textContent = percent(metrics.accuracy);
  $('[data-metric-accuracy-bar]').style.setProperty('--value', percent(metrics.accuracy));
  $('[data-metric-accuracy-note]').textContent = metrics.accuracy >= 0.9 ? '关键音符已达标' : '仍有音符需要巩固';
  $('[data-metric-chord]').textContent = percent(metrics.chord);
  $('[data-metric-chord-bar]').style.setProperty('--value', percent(metrics.chord));
  $('[data-metric-chord-note]').textContent = metrics.chord >= 0.85 ? '和弦完整度达标' : '注意每根弦都要清晰发声';
  $('[data-metric-timing]').textContent = percent(metrics.timing);
  $('[data-metric-timing-bar]').style.setProperty('--value', percent(metrics.timing));
  $('[data-metric-timing-note]').textContent = metrics.timing >= 0.8 ? '节奏稳定' : '建议打开慢速分段练习';

  $('[data-results-subtitle]').textContent = `你已完成《${state.courseTitle}》的本次跟练，共判定 ${state.scoring.results.length} 个目标音符。`;
  renderMasteryMap();
  openLayer($('[data-results-layer]'));
}

function renderMasteryMap() {
  const container = $('[data-mastery-map]');
  if (!container || !state.scoreModel) return;
  container.replaceChildren();
  const bars = state.scoreModel.project.bars;
  const groups = 4;
  const perGroup = Math.max(1, Math.ceil(bars.length / groups));

  for (let group = 0; group < groups; group += 1) {
    const slice = bars.slice(group * perGroup, (group + 1) * perGroup);
    if (!slice.length) break;
    const barIds = new Set(slice.map((bar) => bar.id));
    const results = state.scoring.results.filter((result) => barIds.has(result.targetNote?.barId));
    const label = `${String(slice[0].index).padStart(2, '0')}–${String(slice[slice.length - 1].index).padStart(2, '0')}`;

    const article = document.createElement('article');
    const title = document.createElement('strong');
    if (!results.length) {
      title.textContent = '待练习';
    } else {
      const accuracy = results.filter((result) => result.type === 'correct').length / results.length;
      if (accuracy >= 0.9) {
        article.classList.add('is-mastered');
        title.textContent = '已掌握';
      } else if (accuracy >= 0.6) {
        article.classList.add('is-learning');
        title.textContent = '基本掌握';
      } else {
        title.textContent = '需要复习';
      }
    }
    const range = document.createElement('span');
    range.textContent = label;
    const icon = document.createElement('i');
    article.append(range, title, icon);
    container.appendChild(article);
  }
}

function practiceAgain() {
  closeLayer($('[data-results-layer]'));
  state.scoring = new ScoringSystem();
  state.session?.reset();
  state.lastMatchedNoteId = null;
  state.errorStreak = { noteId: null, count: 0 };
  state.noteElements.forEach(({ element }) => {
    element.classList.remove('is-correct', 'is-wrong', 'is-missed', 'is-early', 'is-late', 'is-done');
  });
  seekPlayer(0);
  playPlayer();
}

function reviewWeakest() {
  closeLayer($('[data-results-layer]'));
  openFocus(findWeakestNote());
}

/* ---------------------------------------------------------------- 事件分发 */

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
    case 'enter-practice':
      enterPractice();
      break;
    case 'retry-analysis':
      void retryRemoteAnalysis();
      break;
    case 'reupload':
      pausePlayer();
      resetVideoSelection();
      break;
    case 'open-focus':
      openFocus();
      break;
    case 'close-focus':
      closeFocus();
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
      state.autoSlowDown = toggleSwitch(element);
      if (state.session) state.session.isAutoSlowDown = state.autoSlowDown;
      break;
    case 'toggle-overlay':
      toggleSwitch(element);
      $$('.hand-pane').forEach((pane) => pane.classList.toggle('hide-overlay', !element.classList.contains('is-on')));
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
      finishPractice();
      break;
    case 'toggle-review':
      toggleReview();
      break;
    case 'review-frame-back':
      reviewFrameStep(-1);
      break;
    case 'review-frame-forward':
      reviewFrameStep(1);
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
    case 'close-results':
      closeLayer($('[data-results-layer]'));
      break;
    case 'practice-again':
      practiceAgain();
      break;
    case 'review-weakest':
      reviewWeakest();
      break;
    default:
      break;
  }
}

const TOLERANCE_SCALES = { gentle: 1.6, normal: 1, strict: 0.7 };

function handleClick(event) {
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
    if (!state.playing) showToast(`已同步定位到 ${formatTime(state.playerTime, true)}`);
    return;
  }

  const toleranceButton = event.target.closest('[data-tolerance]');
  if (toleranceButton) {
    $$('[data-tolerance]').forEach((button) => button.classList.toggle('is-active', button === toleranceButton));
    state.toleranceScale = TOLERANCE_SCALES[toleranceButton.dataset.tolerance] || 1;
    return;
  }

  const themeButton = event.target.closest('[data-theme-choice]');
  if (themeButton) chooseTheme(themeButton.dataset.themeChoice);
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
    if (state.focusAttempt) {
      finishFocusAttempt();
      return;
    }
    if (state.loopEnabled && state.loopEnd > state.loopStart) {
      seekPlayer(state.loopStart);
      playerVideo.play().catch(() => pausePlayer());
      return;
    }
    state.playerTime = state.duration;
    finishPractice();
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
    if (event.key === ' ' && state.stage === 'practice' && !activeLayer()
      && !['BUTTON', 'INPUT'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      togglePlayer();
    }
  });
  window.addEventListener('beforeunload', () => {
    savePreferences();
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.micDetector?.stop();
    state.micStream?.getTracks().forEach((track) => track.stop());
    if (state.micContext?.state !== 'closed') void state.micContext?.close();
  });
  window.addEventListener('resize', () => updatePlayerUI());
}

/* ---------------------------------------------------------------- 启动 */

function bootstrap() {
  loadPreferences();
  loadFirstScores();
  buildWaveforms();
  initUpload();
  initEvents();
  updateCourseCopy();
  updateMicrophoneUI();
  setVideoSources();
  chooseTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  setStage('upload');

  const bootstrapLoadId = state.courseLoadId;
  void refreshBackendCourses().then(async (availableCourses) => {
    if (bootstrapLoadId !== state.courseLoadId) return;
    const requestedCourseId = new URLSearchParams(window.location.search).get('course');
    if (!requestedCourseId) return;
    const requestedCourse = availableCourses.find((course) => course.id === requestedCourseId);
    if (requestedCourse) {
      const loadId = ++state.courseLoadId;
      const activation = activateRemoteCourse(requestedCourse, loadId);
      if (requestedCourse.status === 'ready') {
        if (await activation) enterPractice();
      } else {
        setStage('analyzing');
        await activation;
        renderRemoteAnalysisStatus(state.remoteCourse);
        scheduleCoursePolling();
      }
    } else if (state.backendAvailable) {
      await openRemoteCourse(requestedCourseId);
    }
  });
}

bootstrap();
