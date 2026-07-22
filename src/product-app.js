/**
 * 弦间前端产品原型
 * 串联上传、解析、课程概览、同步跟练、专项纠错与结果页。
 */

import { GuitarDetector } from './core/audio/detector.js';
import { MicCalibrator, estimateLatency, classifyEnvironment } from './core/audio/calibrator.js';
import { MatchingEngine } from './core/matching/engine.js';
import { FocusStateMachine, SpeedAction, summarizeAttempt } from './core/practice/stateMachine.js';
import { UserSimulator } from './core/practice/simulator.js';
import { scorePracticeResults } from './core/practice/scoring.js';
import { beginnerProgress, moveBeginnerStep, normalizeBeginnerStep } from './core/practice/beginner.js';
import {
  cropForHand,
  dragHandCrop,
  normalizeHandCropOffsets,
  normalizePanelStates,
  overwriteLatestResult,
} from './core/practice/workspace.js';
import { ScoreModel } from './core/score/model.js';
import { TimelineModel } from './core/score/timelineModel.js';
import { VoiceController } from './core/voice/controller.js';
import { VOICE_HELP_TEXT } from './core/voice/commands.js';
import { midiToNoteName, freqToMidi } from './shared/utils/index.js';
import { ApiError, courses, practice } from './shared/utils/api.js';

const ROUTES = new Set(['home', 'analysis', 'overview', 'player', 'focus', 'results', 'library']);
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const DEMO_DURATION = 48;
const STORAGE_KEY = 'xianjian-ui-state';

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
  timeline: [],
  segments: [],
  currentSegment: null,
  scoreModel: null,
  matchingEngine: null,
  practiceResults: [],
  practiceSummaries: {},
  lastResult: null,
  currentNote: null,
  sessionId: null,
  focusMode: false,
  focusEvent: null,
  focusErrorType: 'default',
  focusFsm: null,
  focusLoopStart: 0,
  focusLoopEnd: 0,
  focusSpeedIndex: 0,
  focusConsecutiveCorrect: 0,
  focusStage: 'idle',
  focusAttempts: 0,
  focusResults: [],
  focusLoopCount: 0,
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
  micCalibrator: null,
  calibrationOffset: 0,
  micLastSampleAt: 0,
  lastDetection: null,
  micRequestId: 0,
  pendingView: null,
  simMode: null,
  simulator: null,
  playing: false,
  playerTime: 0,
  playerSpeed: 1,
  loopEnabled: false,
  loopStart: null,
  loopEnd: null,
  animationFrame: null,
  lastFrameAt: 0,
  toastTimer: null,
  lastFocused: null,
  voiceEnabled: false,
  voiceRecording: false,
  voiceProcessing: false,
  voiceWakeWord: false,
  timelineZoomIndex: 2,
  timelineWindowStart: -1,
  timelineWindowEnd: -1,
  layoutVideoShare: 72,
  layoutTimelineScale: 100,
  layoutLeftHandShare: 50,
  handViewMode: 'guide',
  handCropOffsets: normalizeHandCropOffsets(),
  minimizedPanels: normalizePanelStates(),
  scoringEnabled: true,
  scoringPass: 0,
  lastScoringTime: 0,
  scoreHistory: {},
  beginnerStep: 0,
  beginnerComplete: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.theme === 'dark') document.documentElement.dataset.theme = 'dark';
    if (saved.courseTitle) state.courseTitle = saved.courseTitle;
    if (Number.isFinite(saved.playerTime)) state.playerTime = Math.min(saved.playerTime, DEMO_DURATION);
    if (typeof saved.voiceEnabled === 'boolean') state.voiceEnabled = saved.voiceEnabled;
    if (typeof saved.voiceWakeWord === 'boolean') state.voiceWakeWord = saved.voiceWakeWord;
    if (Number.isFinite(saved.layoutVideoShare)) state.layoutVideoShare = Math.max(55, Math.min(82, saved.layoutVideoShare));
    if (Number.isFinite(saved.layoutTimelineScale)) state.layoutTimelineScale = Math.max(75, Math.min(130, saved.layoutTimelineScale));
    if (Number.isFinite(saved.layoutLeftHandShare)) state.layoutLeftHandShare = Math.max(30, Math.min(70, saved.layoutLeftHandShare));
    if (saved.handViewMode === 'guide' || saved.handViewMode === 'zoom') state.handViewMode = saved.handViewMode;
    state.handCropOffsets = normalizeHandCropOffsets(saved.handCropOffsets);
    state.minimizedPanels = normalizePanelStates(saved.minimizedPanels);
    if (typeof saved.scoringEnabled === 'boolean') state.scoringEnabled = saved.scoringEnabled;
    if (saved.scoreHistory && typeof saved.scoreHistory === 'object') state.scoreHistory = saved.scoreHistory;
    if (typeof saved.beginnerComplete === 'boolean') state.beginnerComplete = saved.beginnerComplete;
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
      voiceEnabled: state.voiceEnabled,
      voiceWakeWord: state.voiceWakeWord,
      layoutVideoShare: state.layoutVideoShare,
      layoutTimelineScale: state.layoutTimelineScale,
      layoutLeftHandShare: state.layoutLeftHandShare,
      handViewMode: state.handViewMode,
      handCropOffsets: state.handCropOffsets,
      minimizedPanels: state.minimizedPanels,
      scoringEnabled: state.scoringEnabled,
      scoreHistory: state.scoreHistory,
      beginnerComplete: state.beginnerComplete,
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
  document.body.classList.toggle('is-player-view', view === 'player');
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
  setVideoSources();
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
  if (view === 'player') {
    if (state.focusMode) exitFocusMode();
    updatePlayerUI();
  }
  if (view === 'results') {
    if (state.remoteCourse?.id) loadPracticeSummary(state.remoteCourse.id);
    else if (state.practiceResults.length > 0) loadPracticeSummary('');
  }

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
  state.timelineWindowStart = -1;
  state.timelineWindowEnd = -1;
  state.loopEnabled = false;
  state.loopStart = null;
  state.loopEnd = null;
  state.lastDetection = null;
  state.scoringPass = 0;
  state.lastScoringTime = 0;
  $('[data-seek-track]')?.classList.remove('is-looping');
  updateLoopUI();
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
  updateLoopUI();
  savePreferences();
}

function setVideoSources() {
  const mediaSource = state.videoUrl || state.remoteVideoUrl;
  const mappings = [
    ['analysisVideo', '.media-stage', ['analysis'], 'metadata'],
    ['overviewVideo', '.overview-art', ['overview'], 'none'],
    // 专项练习仍复用主播放器。不要在 player/focus 之间卸载 src，
    // 否则返回完整跟练时会重新请求视频并丢失可播放状态。
    ['playerVideo', '.teacher-video', ['player', 'focus'], 'auto'],
  ];

  mappings.forEach(([id, parentSelector, ownerViews, preload]) => {
    const video = document.getElementById(id);
    const parent = $(parentSelector);
    const fallback = parent?.querySelector('[data-video-fallback]');
    if (!video) return;
    const shouldLoad = Boolean(mediaSource) && ownerViews.includes(state.view);
    if (shouldLoad) {
      video.preload = preload;
      if (id === 'playerVideo') {
        video.muted = false;
        video.volume = 1;
      }
      if (video.getAttribute('src') !== mediaSource) {
        video.src = mediaSource;
        video.load();
      }
      const deferPreview = id === 'overviewVideo' && video.readyState < 2;
      video.hidden = deferPreview;
      if (fallback) fallback.hidden = !deferPreview;
    } else {
      video.pause();
      if (video.hasAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
      video.hidden = true;
      if (fallback) fallback.hidden = false;
      if (id === 'playerVideo') {
        $$('[data-hand-canvas]').forEach((canvas) => {
          canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
          canvas.parentElement?.classList.remove('has-frame');
        });
      }
    }
  });
}

function applyLayoutPreferences({ persist = false } = {}) {
  const playerView = $('.player-view');
  if (!playerView) return;
  const videoShare = Math.max(55, Math.min(82, Number(state.layoutVideoShare) || 72));
  const timelineScale = Math.max(75, Math.min(130, Number(state.layoutTimelineScale) || 100));
  const leftHandShare = Math.max(30, Math.min(70, Number(state.layoutLeftHandShare) || 50));
  state.layoutVideoShare = videoShare;
  state.layoutTimelineScale = timelineScale;
  state.layoutLeftHandShare = leftHandShare;
  playerView.style.setProperty('--video-panel-size', `${videoShare}fr`);
  playerView.style.setProperty('--hand-panel-size', `${100 - videoShare}fr`);
  playerView.style.setProperty('--timeline-scale', String(timelineScale / 100));
  playerView.style.setProperty('--left-hand-size', `${leftHandShare}fr`);
  playerView.style.setProperty('--right-hand-size', `${100 - leftHandShare}fr`);
  const compactHeight = window.innerHeight <= 850 && window.innerWidth > 720;
  const scale = timelineScale / 100;
  const timelineBases = compactHeight
    ? { wave: 36, measure: 24, chord: 32, tab: 112 }
    : { wave: 52, measure: 28, chord: 42, tab: 142 };
  playerView.style.setProperty('--timeline-wave-height', `${Math.round(timelineBases.wave * scale)}px`);
  playerView.style.setProperty('--timeline-measure-height', `${Math.round(timelineBases.measure * scale)}px`);
  playerView.style.setProperty('--timeline-chord-height', `${Math.round(timelineBases.chord * scale)}px`);
  playerView.style.setProperty('--timeline-tab-height', `${Math.round(timelineBases.tab * scale)}px`);

  const values = { video: videoShare, timeline: timelineScale, hands: leftHandShare };
  Object.entries(values).forEach(([name, value]) => {
    const input = $(`[data-layout-control="${name}"]`);
    const output = $(`[data-layout-output="${name}"]`);
    if (input) input.value = String(value);
    if (output) output.textContent = `${value}%`;
  });
  if (state.view === 'player') {
    renderTimeline(true);
    updatePlayerUI();
  }
  if (persist) savePreferences();
}

function updateLayoutPreference(name, value, { persist = true } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  if (name === 'video') state.layoutVideoShare = numeric;
  else if (name === 'timeline') state.layoutTimelineScale = numeric;
  else if (name === 'hands') state.layoutLeftHandShare = numeric;
  else return;
  applyLayoutPreferences({ persist });
}

const PANEL_SELECTORS = {
  video: '.teacher-pane',
  hands: '.hand-stack',
  left: '.left-hand-pane',
  right: '.right-hand-pane',
  timeline: '.timeline-pane',
  feedback: '.feedback-bar',
};

const PANEL_NAMES = {
  video: '原始教学视频',
  hands: '双手动作面板',
  left: '左手面板',
  right: '右手面板',
  timeline: '谱面与时间轴',
  feedback: '评分反馈',
};

function applyPanelStates({ persist = false } = {}) {
  const playerView = $('.player-view');
  Object.entries(PANEL_SELECTORS).forEach(([id, selector]) => {
    const minimized = state.minimizedPanels[id] === true;
    $(selector)?.classList.toggle('is-minimized', minimized);
    playerView?.classList.toggle(`is-panel-${id}-minimized`, minimized);
    $$(`[data-panel-toggle="${id}"]`).forEach((button) => {
      button.setAttribute('aria-expanded', String(!minimized));
      button.setAttribute('aria-label', `${minimized ? '恢复' : '最小化'}${PANEL_NAMES[id]}`);
      const icon = $('span', button);
      if (icon) icon.textContent = minimized ? '+' : '−';
    });
  });
  if (state.view === 'player') {
    renderTimeline(true);
    updatePlayerUI();
  }
  if (persist) savePreferences();
}

function togglePanel(id) {
  if (!(id in PANEL_SELECTORS)) return;
  state.minimizedPanels[id] = !state.minimizedPanels[id];
  applyPanelStates({ persist: true });
}

function applyScoringMode({ persist = false } = {}) {
  const enabled = state.scoringEnabled !== false;
  $('.player-view')?.classList.toggle('is-scoring-disabled', !enabled);
  $$('[data-scoring-toggle]').forEach((button) => {
    button.classList.toggle('is-on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    if (button.getAttribute('role') === 'switch') button.setAttribute('aria-checked', String(enabled));
  });
  $$('[data-scoring-label]').forEach((label) => {
    label.textContent = enabled ? '评分开启' : '评分关闭';
  });
  if (state.view === 'player') updatePlayerUI();
  if (persist) savePreferences();
}

function setScoringMode(enabled) {
  state.scoringEnabled = Boolean(enabled);
  if (!state.scoringEnabled) {
    resetPracticeResults();
    state.scoringPass += 1;
    state.lastScoringTime = state.playerTime;
  }
  applyScoringMode({ persist: true });
  showToast(state.scoringEnabled
    ? '评分模式已开启，将继续记录音准、节奏与完整度。'
    : '评分模式已关闭，视频、谱面和动作仍会保持同步。');
}

function resetHandCrop(hand, { persist = true } = {}) {
  if (!state.handCropOffsets[hand]) return;
  state.handCropOffsets[hand] = { x: 0, y: 0 };
  drawHandCloseups();
  if (persist) savePreferences();
}

function initHandCropDragging() {
  $$('[data-hand-canvas]').forEach((canvas) => {
    const hand = canvas.dataset.handCanvas;
    canvas.addEventListener('pointerdown', (event) => {
      if (state.handViewMode !== 'zoom') return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startOffset = { ...state.handCropOffsets[hand] };
      canvas.classList.add('is-dragging');
      canvas.setPointerCapture?.(event.pointerId);

      const move = (moveEvent) => {
        const bounds = canvas.getBoundingClientRect();
        state.handCropOffsets[hand] = dragHandCrop(
          hand,
          startOffset,
          (moveEvent.clientX - startX) / Math.max(1, bounds.width),
          (moveEvent.clientY - startY) / Math.max(1, bounds.height),
        );
        drawHandCloseups();
      };
      const end = () => {
        canvas.classList.remove('is-dragging');
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', end);
        savePreferences();
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    });

    canvas.addEventListener('dblclick', () => {
      if (state.handViewMode !== 'zoom') return;
      resetHandCrop(hand);
      showToast(`${hand === 'left' ? '左手' : '右手'}取景已恢复默认。`);
    });

    canvas.addEventListener('keydown', (event) => {
      if (state.handViewMode !== 'zoom') return;
      if (event.key === 'Home') {
        event.preventDefault();
        resetHandCrop(hand);
        return;
      }
      const directions = {
        ArrowLeft: [-0.02, 0],
        ArrowRight: [0.02, 0],
        ArrowUp: [0, -0.02],
        ArrowDown: [0, 0.02],
      };
      const delta = directions[event.key];
      if (!delta) return;
      event.preventDefault();
      const current = state.handCropOffsets[hand];
      state.handCropOffsets[hand] = dragHandCrop(hand, current, delta[0], delta[1]);
      drawHandCloseups();
      savePreferences();
    });
  });
}

function initPanelResizers() {
  $$('[data-layout-resizer]').forEach((handle) => {
    const kind = handle.dataset.layoutResizer;
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const grid = $('.player-grid');
      if (!grid) return;
      const startY = event.clientY;
      const startTimeline = state.layoutTimelineScale;
      let pendingFrame = null;
      let latestEvent = event;
      handle.classList.add('is-dragging');
      handle.setPointerCapture?.(event.pointerId);

      const applyMove = () => {
        pendingFrame = null;
        if (kind === 'video') {
          const rect = grid.getBoundingClientRect();
          const share = (latestEvent.clientX - rect.left) / Math.max(1, rect.width) * 100;
          updateLayoutPreference('video', Math.round(share * 10) / 10, { persist: false });
        } else {
          const scale = startTimeline - (latestEvent.clientY - startY) * 0.28;
          updateLayoutPreference('timeline', Math.round(scale * 10) / 10, { persist: false });
        }
      };
      const move = (moveEvent) => {
        latestEvent = moveEvent;
        if (pendingFrame === null) pendingFrame = requestAnimationFrame(applyMove);
      };
      const end = () => {
        if (pendingFrame !== null) {
          cancelAnimationFrame(pendingFrame);
          applyMove();
        }
        handle.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        savePreferences();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });

    handle.addEventListener('dblclick', () => {
      updateLayoutPreference(kind === 'video' ? 'video' : 'timeline', kind === 'video' ? 72 : 100);
      showToast(kind === 'video' ? '主视频宽度已恢复默认。' : '谱面高度已恢复默认。');
    });

    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') {
        updateLayoutPreference(kind === 'video' ? 'video' : 'timeline', kind === 'video' ? 72 : 100);
        return;
      }
      if (kind === 'video') {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 2 : -2;
        updateLayoutPreference('video', state.layoutVideoShare + delta);
      } else {
        const delta = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 5 : -5;
        updateLayoutPreference('timeline', state.layoutTimelineScale + delta);
      }
    });
  });
}

function normalizeTimeSignature(value) {
  if (Array.isArray(value) && value.length === 2) return `${value[0]}/${value[1]}`;
  return typeof value === 'string' && /^\d+\/\d+$/.test(value) ? value : '4/4';
}

function timelineEvents(timeline) {
  if (!Array.isArray(timeline)) return [];
  return timeline
    .filter((event) => event.type === 'note' || event.type === 'chord')
    .map((event) => ({
      id: event.id,
      // 谱面音符的点击跳转与高亮都基于视频时间轴，优先使用 videoTime。
      startTime: Number(event.videoTime ?? event.startTime ?? 0),
      stringNumber: Number(event.string),
      fret: Number(event.fret),
      pitch: Number(event.pitch),
      measureIndex: Number(event.measureIndex ?? 0),
      beatPosition: Number(event.beatPosition ?? 0),
      chord: event.chord,
      leftHandShape: event.leftHandShape,
      rightHandShape: event.rightHandShape,
      tolerance: Number(event.tolerance ?? 0.08),
    }))
    .filter((event) => Number.isFinite(event.startTime) && event.startTime >= 0 && Number.isInteger(event.stringNumber) && event.stringNumber >= 1 && event.stringNumber <= 6 && Number.isInteger(event.fret) && event.fret >= 0 && event.fret <= 36);
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
        events.push({ id: note?.id || `note-${startTime}-${stringNumber}-${fret}`, startTime, stringNumber, fret });
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

const TIMELINE_BAR_COUNTS = [16, 10, 6, 4];

function getTimelineBarDuration() {
  const bars = Array.isArray(state.score?.bars) ? state.score.bars : [];
  const durations = bars
    .map((bar) => Number(bar?.endTime) - Number(bar?.startTime))
    .filter((duration) => Number.isFinite(duration) && duration > 0.2 && duration < 30)
    .sort((left, right) => left - right);
  if (durations.length) return durations[Math.floor(durations.length / 2)];
  const numerator = Number(String(state.timeSignature || '4/4').split('/')[0]) || 4;
  return Math.max(0.8, Math.min(12, numerator * 60 / Math.max(30, Number(state.bpm) || 92)));
}

function getTimelineWindow() {
  const barDuration = getTimelineBarDuration();
  const barCount = TIMELINE_BAR_COUNTS[state.timelineZoomIndex] || 6;
  const windowDuration = Math.min(Math.max(barDuration * barCount, 4), Math.max(4, state.duration));
  const maximumStart = Math.max(0, state.duration - windowDuration);
  const desiredStart = Math.max(0, state.playerTime - windowDuration * 0.22);
  const start = Math.min(maximumStart, Math.floor(desiredStart / barDuration) * barDuration);
  return { start, end: Math.min(state.duration, start + windowDuration), barDuration, barCount };
}

function timelinePosition(time, windowStart, windowEnd) {
  const span = Math.max(0.001, windowEnd - windowStart);
  return Math.max(0, Math.min(100, (Number(time) - windowStart) / span * 100));
}

function renderTimelineTracks(windowStart, windowEnd, visibleEvents) {
  const measureTrack = $('[data-measure-track]');
  const chordTrack = $('[data-chord-track]');
  const bars = Array.isArray(state.score?.bars) ? state.score.bars : [];
  if (measureTrack) {
    measureTrack.replaceChildren();
    bars.forEach((bar, index) => {
      const startTime = Number(bar?.startTime);
      const endTime = Number(bar?.endTime);
      if (!Number.isFinite(startTime) || startTime >= windowEnd || endTime <= windowStart) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.seek = String(startTime);
      button.textContent = String(Number(bar?.index ?? (index + 1))).padStart(2, '0');
      button.style.left = `${timelinePosition(startTime, windowStart, windowEnd)}%`;
      button.style.width = `${Math.max(4, timelinePosition(endTime, windowStart, windowEnd) - timelinePosition(startTime, windowStart, windowEnd))}%`;
      measureTrack.appendChild(button);
    });
  }

  if (chordTrack) {
    chordTrack.replaceChildren();
    let previousChord = '';
    visibleEvents.forEach((event) => {
      const chord = typeof event.chord === 'string' ? event.chord.trim() : '';
      if (!chord || chord === previousChord) return;
      previousChord = chord;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.seek = String(event.startTime);
      button.textContent = chord;
      button.style.left = `${timelinePosition(event.startTime, windowStart, windowEnd)}%`;
      chordTrack.appendChild(button);
    });
  }

  const range = $('[data-timeline-range]');
  if (range) range.textContent = `${formatTime(windowStart, true)} – ${formatTime(windowEnd, true)}`;
  const zoom = $('[data-timeline-zoom]');
  if (zoom) zoom.textContent = `${TIMELINE_BAR_COUNTS[state.timelineZoomIndex]} 小节`;

  const waveform = $('[data-waveform].workspace-wave');
  if (waveform) {
    const barsInWave = $$('.wave-bar', waveform);
    barsInWave.forEach((bar, index) => {
      const sampleTime = windowStart + (index / Math.max(1, barsInWave.length - 1)) * (windowEnd - windowStart);
      const harmonic = Math.abs(Math.sin(sampleTime * 1.73) * 0.58 + Math.sin(sampleTime * 0.41) * 0.28);
      bar.style.setProperty('--height', `${15 + harmonic * 78}%`);
    });
  }
}

function renderTimeline(force = false) {
  const source = state.timeline.length > 0 ? timelineEvents(state.timeline) : scoreEvents(state.score);
  const windowState = getTimelineWindow();
  if (!force && Math.abs(windowState.start - state.timelineWindowStart) < 0.001
    && Math.abs(windowState.end - state.timelineWindowEnd) < 0.001) return;
  state.timelineWindowStart = windowState.start;
  state.timelineWindowEnd = windowState.end;
  const visibleEvents = source.filter((event) => event.startTime >= windowState.start && event.startTime < windowState.end);
  renderTabEvents(visibleEvents, windowState.start, windowState.end);
  renderTimelineTracks(windowState.start, windowState.end, visibleEvents);
}

function renderScore(score) {
  if (state.timeline.length > 0) {
    renderTimeline(true);
    return;
  }
  state.score = score;
  renderTimeline(true);
}

function renderTabEvents(events, windowStart = 0, windowEnd = state.duration) {
  const tablature = $('[data-tablature]');
  const playhead = $('[data-score-playhead]');
  if (!tablature || !playhead) return;
  $$('.tab-event', tablature).forEach((event) => event.remove());
  if (!events.length) return;
  events.forEach((event) => {
    const button = document.createElement('button');
    button.className = 'tab-event';
    button.type = 'button';
    button.dataset.seek = String(event.startTime);
    if (event.id) button.dataset.eventId = String(event.id);
    button.style.setProperty('--x', `${Math.max(1, Math.min(99, timelinePosition(event.startTime, windowStart, windowEnd))).toFixed(2)}%`);
    button.style.setProperty('--y', String(event.stringNumber));
    button.textContent = String(event.fret);
    button.setAttribute('aria-label', `${event.stringNumber} 弦 ${event.fret} 品，${formatTime(event.startTime, true)}`);
    tablature.insertBefore(button, playhead);
  });
}

function restoreDefaultScoreEvents() {
  const tablature = $('[data-tablature]');
  const playhead = $('[data-score-playhead]');
  if (!tablature || !state.defaultTabEvents.length) return;
  $$('.tab-event', tablature).forEach((event) => event.remove());
  state.defaultTabEvents.forEach((event) => tablature.insertBefore(event.cloneNode(true), playhead));
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
  rebuildMatchingEngine();
  updateCourseCopy();
}

function rebuildMatchingEngine() {
  let model = null;
  if (state.timeline.length > 0) {
    model = new TimelineModel(state.timeline);
  } else if (state.score && Array.isArray(state.score.bars)) {
    model = new ScoreModel(state.score);
  }
  if (model) {
    state.scoreModel = model;
    state.matchingEngine = new MatchingEngine(model);
  } else {
    state.scoreModel = null;
    state.matchingEngine = null;
  }
  buildSimulator();
}

/**
 * 在 ?sim=<mode> 模式下，用当前谱面/时间轴构建一个 UserSimulator，
 * 直接替换 state.micDetector，跳过真实麦克风流程。
 * 谱面未就绪时不报错，等 applyScore / 时间轴加载后再次调用即可。
 */
function buildSimulator() {
  if (!state.simMode) return;
  const events = state.scoreModel?.notes?.length
    ? state.scoreModel.notes
    : state.timeline;
  const simulator = new UserSimulator(events, state.simMode);
  state.simulator = simulator;
  state.micDetector = simulator;
  state.micResolved = true;
  state.micAllowed = true;
  updateMicrophoneUI();
}

async function activateRemoteCourse(course, loadId = ++state.courseLoadId) {
  if (!course?.id) throw new Error('Invalid course');
  if (loadId !== state.courseLoadId) return false;
  clearCoursePolling();
  resetAnalysis();
  resetPracticeResults();
  state.timeline = [];
  state.segments = [];
  state.currentSegment = null;
  state.scoreModel = null;
  state.matchingEngine = null;
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

  // 获取统一时间轴和练习片段；失败时不阻断，仍可继续用 score 兜底。
  if (course.score_path) {
    try {
      const [timeline, segments] = await Promise.all([
        courses.getTimeline(course.id),
        courses.getSegments(course.id),
      ]);
      if (loadId !== state.courseLoadId || state.remoteCourse?.id !== course.id) return false;
      if (Array.isArray(timeline) && timeline.length > 0) {
        state.timeline = timeline;
        renderTimeline();
      }
      if (Array.isArray(segments) && segments.length > 0) {
        state.segments = segments;
        state.currentSegment = segments[0] || null;
      }
      rebuildMatchingEngine();
    } catch {
      // 后端时间轴不可用，继续用 score 渲染
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
  const progressValue = document.createElement('strong');
  const button = document.createElement('button');
  button.className = 'secondary-button full-width';
  button.type = 'button';
  button.dataset.action = 'open-course';
  button.dataset.courseId = course.id;
  // 已解析完成的课程优先展示真实练习进度（正确率），否则回退到解析进度
  const summary = state.practiceSummaries?.[course.id];
  let progress;
  if (course.status === 'ready' && summary && Number(summary.total) > 0) {
    const accuracy = Math.max(0, Math.min(1, Number(summary.accuracy) || 0));
    progress = Math.round(accuracy * 100);
    progressLabel.textContent = `已练习 ${summary.total} 次 · 正确率`;
    button.textContent = '继续练习 →';
  } else if (course.status === 'ready') {
    progress = 100;
    progressLabel.textContent = summary && Number(summary.total) === 0 ? '尚未开始练习' : '课程已准备';
    button.textContent = '查看课程 →';
  } else {
    progress = Math.max(0, Math.min(100, Number(course.progress) || 0));
    progressLabel.textContent = '后端处理进度';
    button.textContent = '查看解析状态 →';
  }
  progressValue.textContent = `${progress}%`;
  progressCopy.append(progressLabel, progressValue);
  const progressBar = document.createElement('div');
  progressBar.className = 'linear-progress';
  const progressFill = document.createElement('i');
  progressFill.style.setProperty('--value', `${progress}%`);
  progressBar.append(progressFill);
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
    // 已解析完成的课程后台拉取练习 summary，用于驱动卡片真实进度
    void loadPracticeSummaries();
    return state.backendCourses;
  } catch {
    state.backendAvailable = false;
    return [];
  }
}

async function loadPracticeSummaries() {
  const readyCourses = state.backendCourses.filter((course) => course.status === 'ready' && course.id);
  if (!readyCourses.length) return;
  const entries = await Promise.all(
    readyCourses.map(async (course) => {
      try {
        const summary = await practice.summary(course.id);
        return [course.id, summary];
      } catch {
        // 后端不可用或无练习记录时静默回退到解析进度
        return [course.id, null];
      }
    }),
  );
  const summaries = {};
  for (const [id, summary] of entries) {
    if (id && summary) summaries[id] = summary;
  }
  state.practiceSummaries = summaries;
  // 仅在用户仍停留在课程库时刷新，避免覆盖其他视图
  if (state.view === 'library') renderBackendCourses();
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
          // Another tab/request may have claimed the same course first. Read
          // the authoritative state instead of misreporting a running task.
          try {
            activeCourse = await courses.get(course.id);
          } catch {
            activeCourse = { ...course, status: 'error', progress: 0 };
          }
        } else {
          activeCourse = { ...course, status: 'error', progress: 0 };
          if (state.file === selectedFile) {
            showToast('视频已保存，但转谱任务未能启动，可稍后从课程库重试。', 'error');
          }
        }
      }
      if (state.file === selectedFile) {
        state.remoteCourse = activeCourse;
        const url = new URL(window.location.href);
        url.searchParams.set('course', course.id);
        window.history.replaceState({}, '', url);
        if (state.view === 'analysis') {
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
  button.dataset.action = retry ? 'retry-analysis' : 'analysis-complete';
  button.replaceChildren(
    document.createTextNode(retry ? '重新启动解析 ' : '查看课程概览 '),
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
    : (failed ? '可直接重新启动解析，无需再次上传视频' : `后端进度 ${progress}% · 音频转谱正在后台运行，可稍后返回查看`);
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
  $('[data-analysis-detail]').textContent = '16 小节 · 64 个音符 · 4 个练习片段';
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

    // 麦克风校准：监听约 3 秒环境噪声，自适应 onset 阈值并估计输入延迟。
    // 校准失败不应阻断麦克风使用，沿用默认阈值与零延迟补偿。
    const calibrator = new MicCalibrator(detector.analyzer);
    try {
      const env = await calibrator.measureEnvironment(3000, (p) => {
        button.textContent = `正在检测环境噪声… ${Math.round(p * 100)}%`;
      });
      detector.onsetThreshold = env.threshold;
      calibrator.setLatency(estimateLatency(audioContext));
      state.micCalibrator = calibrator;
      state.calibrationOffset = calibrator.latencyOffset;
      const assessment = classifyEnvironment({
        noiseFloor: env.noiseFloor,
        guitarRms: env.guitarRms,
        latencyOffset: calibrator.latencyOffset,
      });
      if (assessment.level === 'ok') {
        showToast(`麦克风已校准 · 预计延迟 ${Math.round(calibrator.latencyOffset * 1000)} ms`);
      } else {
        assessment.warnings.forEach((w) => showToast(w, 'error'));
      }
    } catch {
      state.micCalibrator = null;
      state.calibrationOffset = 0;
    }

    state.micResolved = true;
    state.micAllowed = true;
    updateMicrophoneUI();
    closeLayer($('[data-mic-modal]'));
    showToast('麦克风已连接 · 实时音高检测已开始');
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
  // 模拟模式不持有硬件资源，只切换状态；保留 simMode/simulator 以便重新开启。
  if (state.simMode) {
    state.micDetector = null;
    state.lastDetection = null;
    state.micAllowed = false;
    if (updateUI) updateMicrophoneUI();
    return;
  }
  const detector = state.micDetector;
  const stream = state.micStream;
  const context = state.micContext;
  state.micDetector = null;
  state.micStream = null;
  state.micContext = null;
  state.micCalibrator = null;
  state.calibrationOffset = 0;
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
  let label;
  if (state.simMode && state.micAllowed) {
    label = `模拟 · ${state.simulator?.modeLabel || state.simMode}`;
  } else if (state.micAllowed) {
    label = '麦克风已连接';
  } else if (state.micResolved) {
    label = state.simMode ? '模拟已暂停' : '仅观看模式';
  } else {
    label = '麦克风未开启';
  }
  $$('[data-mic-label]').forEach((element) => {
    element.textContent = label;
  });
  $('#productShell').classList.toggle('mic-active', state.micAllowed);
  $('#productShell').classList.toggle('sim-active', Boolean(state.simMode));
  $$('.live-mic').forEach((element) => element.classList.toggle('is-active', state.micAllowed));
  $('.settings-foot')?.classList.toggle('is-active', state.micAllowed);
}

function requestPractice() {
  if (state.simMode) {
    if (!state.simulator) buildSimulator();
    if (!state.matchingEngine) {
      showToast('模拟模式需要已加载的谱面课程，请先选择或上传视频。', 'error');
      return;
    }
    navigate('player');
    return;
  }
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
  state.lastScoringTime = state.playerTime;
  startPracticeSession();
  if ((state.videoUrl || state.remoteVideoUrl) && video) {
    if (video.volume === 0) video.volume = 1;
    updateMuteButton();
    video.playbackRate = state.playerSpeed;
    const restorePosition = () => {
      if (!['player', 'focus'].includes(state.view)) return;
      const mediaDuration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : state.duration;
      const target = Math.max(0, Math.min(state.playerTime, mediaDuration));
      if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
    };
    if (video.readyState >= 1) restorePosition();
    else video.addEventListener('loadedmetadata', restorePosition, { once: true });
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

function updateMuteButton() {
  const video = $('#playerVideo');
  const button = $('[data-mute-button]');
  if (!video || !button) return;
  const muted = video.muted || video.volume === 0;
  button.textContent = muted ? '🔇' : '🔊';
  button.setAttribute('aria-label', muted ? '恢复视频声音' : '静音视频');
  button.setAttribute('aria-pressed', String(muted));
}

function togglePlayerMute() {
  const video = $('#playerVideo');
  if (!video) return;
  video.muted = !(video.muted || video.volume === 0);
  if (!video.muted && video.volume === 0) video.volume = 1;
  updateMuteButton();
  showToast(video.muted ? '视频已静音。' : '视频声音已开启。');
}

function startPracticeSession() {
  if (state.sessionId && state.practiceResults.length > 0) return;
  state.sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  state.practiceResults = [];
  state.lastResult = null;
  // 模拟模式：每段新练习重新触发所有音符
  state.simulator?.reset();
}

function resetPracticeResults() {
  state.sessionId = null;
  state.practiceResults = [];
  state.focusResults = [];
  state.lastResult = null;
  state.scoringPass = 0;
  state.lastScoringTime = state.playerTime;
}

function buildPracticePayloads() {
  const courseId = state.remoteCourse?.id;
  if (!courseId || !state.sessionId || state.practiceResults.length === 0) return [];

  const segmentId = state.currentSegment?.id;
  return state.practiceResults.map((result) => ({
    course_id: courseId,
    segment_id: segmentId || undefined,
    session_id: state.sessionId,
    target_event_id: result.targetId || undefined,
    detected_pitch: Number.isFinite(result.detectedPitch) ? result.detectedPitch : null,
    detected_time: Number.isFinite(result.videoTime) ? result.videoTime : null,
    result_type: result.resultType || 'miss',
    timing_offset: Number.isFinite(result.timingOffsetMs) ? result.timingOffsetMs / 1000 : 0,
    confidence: result.pitchDeviation !== undefined ? Math.max(0, 1 - Math.abs(result.pitchDeviation) / 100) : 0,
    error_type: result.type === 'wrong-pitch' ? 'pitch' : result.type === 'miss' ? 'miss' : undefined,
    metadata_json: {
      event_score: Number(result.eventScore) || 0,
      target_type: result.targetType || 'note',
      measure_index: Number(result.measureIndex) || null,
      scoring_pass: Number(result.passId) || 0,
    },
  }));
}

async function submitPracticeResults() {
  const payloads = buildPracticePayloads();
  if (!payloads.length) return;
  try {
    await practice.createResults(payloads);
    showToast(`已保存 ${payloads.length} 条练习记录`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      showToast('后端未连接，练习记录暂存本地。', 'error');
    } else {
      showToast('练习记录保存失败。', 'error');
    }
  }
}

async function loadPracticeSummary(courseId) {
  let summary = null;
  let weakSpots = null;

  if (courseId) {
    try {
      [, weakSpots] = await Promise.all([
        practice.summary(courseId),
        practice.weakSpots(courseId),
      ]);
    } catch {
      // 后端不可用，使用本地结果计算
    }
  }

  const localResults = state.practiceResults;
  const total = localResults.filter((result) => result.resultType !== 'extra').length;
  const practiceScore = scorePracticeResults(localResults);
  const accuracy = practiceScore.noteAccuracy;
  const chordCompleteness = practiceScore.completeness;
  const timingScore = practiceScore.timing;
  const totalScore = practiceScore.total;

  const accuracyEl = $('[data-accuracy]');
  const accuracyBarEl = $('[data-accuracy-bar]');
  const accuracyLabelEl = $('[data-accuracy-label]');
  const chordEl = $('[data-chord-completeness]');
  const chordBarEl = $('[data-chord-bar]');
  const chordLabelEl = $('[data-chord-label]');
  const timingEl = $('[data-timing]');
  const timingBarEl = $('[data-timing-bar]');
  const timingLabelEl = $('[data-timing-label]');
  const totalScoreEl = $('[data-total-score]');
  const scoreRingEl = $('[data-score-ring]');
  const scoreDeltaEl = $('[data-score-delta]');
  const subtitleEl = $('[data-results-subtitle]');

  if (accuracyEl) accuracyEl.textContent = `${accuracy}%`;
  if (accuracyBarEl) accuracyBarEl.style.setProperty('--value', `${accuracy}%`);
  if (accuracyLabelEl) accuracyLabelEl.textContent = accuracy >= 90 ? '关键音符已达标' : accuracy >= 70 ? '大部分音符正确' : '需要继续练习';

  if (chordEl) chordEl.textContent = `${chordCompleteness}%`;
  if (chordBarEl) chordBarEl.style.setProperty('--value', `${chordCompleteness}%`);
  if (chordLabelEl) chordLabelEl.textContent = chordCompleteness >= 85 ? '和弦完整度良好' : '注意保持和弦音';

  if (timingEl) timingEl.textContent = `${timingScore}%`;
  if (timingBarEl) timingBarEl.style.setProperty('--value', `${timingScore}%`);
  if (timingLabelEl) timingLabelEl.textContent = timingScore >= 90 ? '节奏稳定' : timingScore >= 70 ? '少量节奏偏差' : '建议先降速练习';

  if (totalScoreEl) totalScoreEl.textContent = String(totalScore);
  if (scoreRingEl) scoreRingEl.style.setProperty('--score', String(totalScore));
  const historyKey = state.remoteCourse?.id || 'local-course';
  const history = state.scoreHistory[historyKey] || {};
  const firstScore = Number.isFinite(history.first) ? history.first : totalScore;
  const delta = totalScore - firstScore;
  if (scoreDeltaEl) scoreDeltaEl.textContent = total > 0
    ? (history.first === undefined ? '首次' : `${delta >= 0 ? '+' : ''}${delta}`)
    : '--';
  if (subtitleEl) subtitleEl.textContent = total > 0
    ? `本次完成 ${total} 个目标事件，综合 ${totalScore} 分 · ${practiceScore.grade} 级。`
    : '本次没有收到有效演奏判定，请开启麦克风后再试。';
  if (total > 0 && history.lastSession !== state.sessionId) {
    state.scoreHistory[historyKey] = {
      first: firstScore,
      best: Math.max(Number(history.best) || 0, totalScore),
      last: totalScore,
      lastSession: state.sessionId,
    };
    savePreferences();
  }

  renderMasteryMap(weakSpots, summary);
}

function renderMasteryMap(weakSpots, _summary) {
  const container = $('[data-mastery-map]');
  if (!container) return;
  if (!Array.isArray(weakSpots) || weakSpots.length === 0) {
    container.innerHTML = '<article><span>--</span><strong>暂无数据</strong><i></i></article>';
    return;
  }
  container.innerHTML = weakSpots.map((spot) => {
    const status = spot.severity >= 0.7 ? '' : (spot.severity >= 0.3 ? 'is-learning' : 'is-mastered');
    return `<article class="${status}"><span>${spot.measureRange || '?'}</span><strong>${status === 'is-mastered' ? '已掌握' : status === 'is-learning' ? '基本掌握' : '需练习'}</strong><i></i></article>`;
  }).join('');
}

function appendPracticeRecord(record) {
  record.eventScore = scorePracticeResults([record]).total;
  overwriteLatestResult(state.practiceResults, record);
  if (state.focusMode) overwriteLatestResult(state.focusResults, record);
}

function recordExpiredTargets(fromTime, toTime) {
  if (!state.scoringEnabled || !state.micAllowed || !state.scoreModel || toTime <= fromTime) return;
  for (const note of state.scoreModel.notes) {
    if (note.endTime <= fromTime) continue;
    if (note.endTime > toTime) break;
    const alreadyJudged = state.practiceResults.some(
      (result) => result.passId === state.scoringPass && result.targetId === note.id,
    );
    if (alreadyJudged) continue;
    const record = {
      targetId: note.id,
      targetType: note.type || 'note',
      targetChord: note.chord || null,
      measureIndex: note.measureIndex || null,
      detectedPitch: null,
      detectedFreq: null,
      timingOffsetMs: 0,
      pitchDeviation: null,
      resultType: 'miss',
      score: 'miss',
      videoTime: note.endTime,
      targetTime: note.startTime,
      passId: state.scoringPass,
    };
    appendPracticeRecord(record);
    state.lastResult = {
      currentTime: note.endTime,
      targetNote: note,
      playedNote: null,
      score: 'miss',
      pitchDeviation: 0,
      timingDeviation: 0,
      type: 'miss',
      suggestion: '未检测到目标音符',
    };
  }
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

  state.currentNote = state.scoreModel ? state.scoreModel.getNoteAtTime(state.playerTime) : null;
  recordExpiredTargets(state.lastScoringTime, state.playerTime);
  state.lastScoringTime = state.playerTime;

  if (state.micAllowed && state.micDetector && timestamp - state.micLastSampleAt >= 60) {
    state.micLastSampleAt = timestamp;
    try {
      // 模拟模式传入视频时间，让 UserSimulator 按谱面触发；
      // 真实 GuitarDetector.getDetection 忽略该参数。
      state.lastDetection = state.micDetector.getDetection(state.playerTime);
    } catch {
      void stopMicrophone();
      showToast('麦克风连接已中断，请重新开启。', 'error');
    }
  }

  // 实时匹配：起音可用时用它做节奏判定；普通麦克风漏掉起音时，
  // 首个稳定音高仍可完成该目标的一次判定，避免全程无记录而得 0 分。
  if (state.scoringEnabled && state.playing && state.micAllowed && state.matchingEngine && state.currentNote) {
    const detection = state.lastDetection;
    const hasPitch = detection?.rms >= 0.004
      && detection?.pitch?.confidence >= 0.45
      && detection.pitch.frequency > 0;
    const alreadyJudged = state.practiceResults.some(
      (result) => result.passId === state.scoringPass && result.targetId === state.currentNote.id,
    );

    if (hasPitch && (detection.onset || !alreadyJudged)) {
      const playedNote = {
        pitch: detection.pitch.frequency,
        rms: detection.rms,
        // 模拟器返回的是「用户实际演奏时间」，比采样时刻更准确；
        // 真实麦克风检测不携带 onsetTime，回退到当前播放时间。
        // 校准偏移补偿输入延迟：检测到的起音比实际弹奏晚 latencyOffset 秒。
        // 没有捕获到瞬态时只能确认音高，不能反推真实起音时刻。
        // 此时以目标起点作为中性时间，避免把“起音未捕获”误判为节奏错误。
        onsetTime: detection.onset
          ? (Number.isFinite(detection.onsetTime) ? detection.onsetTime : state.playerTime) - state.calibrationOffset
          : state.currentNote.startTime,
      };
      const result = state.matchingEngine.match(state.playerTime, playedNote);
      state.lastResult = result;

      // 避免同一音符被重复记录多次
      const isSameNote = state.practiceResults.some(
        (record) => record.targetId === state.currentNote.id && record.passId === state.scoringPass,
      );

      if (!isSameNote) {
        const record = {
          targetId: state.currentNote.id,
          targetType: state.currentNote.type || 'note',
          targetChord: state.currentNote.chord || null,
          measureIndex: state.currentNote.measureIndex || null,
          detectedPitch: freqToMidi(detection.pitch.frequency),
          detectedFreq: detection.pitch.frequency,
          timingOffsetMs: result.timingDeviation,
          pitchDeviation: result.pitchDeviation,
          resultType: result.type,
          score: result.score,
          videoTime: state.playerTime,
          targetTime: state.currentNote.startTime,
          passId: state.scoringPass,
        };
        appendPracticeRecord(record);

        // 自动进入专项纠错：连续 3 次同音符错误
        if (!state.focusMode && state.autoSlowDown !== false) {
          const recent = state.practiceResults.slice(-3);
          const sameTarget = recent.every((r) => r.targetId === state.currentNote.id);
          const allErrors = recent.every((r) => r.resultType !== 'correct');
          if (recent.length >= 3 && sameTarget && allErrors) {
            enterFocusMode(state.currentNote, recent[recent.length - 1].resultType);
          }
        }
      }
    }
  }

  // 纠错模式：在循环范围内自动回跳
  if (state.focusMode && state.loopEnabled && state.playerTime >= state.focusLoopEnd) {
    state.focusLoopCount += 1;
    if (state.focusLoopCount >= 2) {
      if (state.scoringEnabled) {
        pausePlayer();
        evaluateFocusAttempt();
      } else {
        seekPlayer(state.focusLoopStart);
      }
      state.focusLoopCount = 0;
    } else {
      seekPlayer(state.focusLoopStart);
    }
  }

  // 非纠错循环：在当前练习片段范围内回跳，不再使用写死的演示区间
  if (state.loopEnabled && !state.focusMode) {
    const range = getLoopRange();
    if (state.playerTime >= range.end && range.end > range.start) {
      seekPlayer(range.start);
    }
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
  const target = Math.max(0, Math.min(Number(seconds) || 0, state.duration));
  // 回跳时重置模拟器，让循环范围内的音符可以重新触发
  if (state.simulator && target < state.playerTime - 0.1) {
    state.simulator.reset();
  }
  if (target < state.playerTime - 0.1) state.scoringPass += 1;
  state.playerTime = target;
  state.lastScoringTime = target;
  state.currentNote = state.scoreModel ? state.scoreModel.getNoteAtTime(state.playerTime) : null;
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

function getCurrentSegmentStart() {
  if (state.currentSegment && Number.isFinite(state.currentSegment.startTime)) {
    return state.currentSegment.startTime;
  }
  return 0;
}

const FINGER_NAMES = { 0: '空弦', 1: '食指', 2: '中指', 3: '无名指', 4: '小指' };
const PICK_NAMES = { P: '拇指', i: '食指', m: '中指', a: '无名指' };

function drawHandCloseups() {
  if (state.handViewMode !== 'zoom') return;
  const video = $('#playerVideo');
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  $$('[data-hand-canvas]').forEach((canvas) => {
    const hand = canvas.dataset.handCanvas;
    const crop = cropForHand(hand, state.handCropOffsets[hand]);
    const bounds = canvas.getBoundingClientRect();
    if (!crop || bounds.width < 2 || bounds.height < 2) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const targetWidth = Math.max(1, Math.round(bounds.width * ratio));
    const targetHeight = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const sourceX = video.videoWidth * crop.x;
    const sourceY = video.videoHeight * crop.y;
    const sourceWidth = video.videoWidth * crop.width;
    const sourceHeight = video.videoHeight * crop.height;
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = targetWidth / targetHeight;
    let drawX = sourceX;
    let drawY = sourceY;
    let drawWidth = sourceWidth;
    let drawHeight = sourceHeight;
    if (sourceRatio > targetRatio) {
      drawWidth = sourceHeight * targetRatio;
      drawX += (sourceWidth - drawWidth) / 2;
    } else {
      drawHeight = sourceWidth / targetRatio;
      drawY += (sourceHeight - drawHeight) / 2;
    }
    try {
      context.drawImage(video, drawX, drawY, drawWidth, drawHeight, 0, 0, targetWidth, targetHeight);
      canvas.parentElement?.classList.add('has-frame');
    } catch {
      canvas.parentElement?.classList.remove('has-frame');
    }
  });
}

function renderHandGuides(note, left, right) {
  const dots = $('[data-left-guide-dots]');
  const leftTitle = $('[data-left-guide-title]');
  const leftCopy = $('[data-left-guide-copy]');
  const positions = Array.isArray(left?.fingerPositions) && left.fingerPositions.length
    ? left.fingerPositions
    : (note && Number.isFinite(note.string) ? [{ string: note.string, fret: note.fret || 0, finger: 0 }] : []);

  if (dots) {
    dots.replaceChildren();
    const maxFret = Math.max(5, Math.min(12, ...positions.map((position) => Number(position.fret) || 0)));
    positions.forEach((position) => {
      const string = Math.max(1, Math.min(6, Number(position.string) || 1));
      const fret = Math.max(0, Number(position.fret) || 0);
      const dot = document.createElement('i');
      dot.className = 'guide-finger-dot';
      dot.style.left = fret === 0 ? '2%' : `${((fret - 0.5) / maxFret) * 100}%`;
      dot.style.top = `${((string - 0.5) / 6) * 100}%`;
      dot.textContent = fret === 0 ? '○' : String(position.finger || fret);
      dot.title = `${string} 弦 ${fret === 0 ? '空弦' : `${fret} 品`}`;
      dots.append(dot);
    });
  }

  const targetName = note?.chord || (Number.isFinite(note?.midi) ? midiToNoteName(note.midi) : '等待当前音符');
  if (leftTitle) leftTitle.textContent = targetName;
  if (leftCopy) {
    leftCopy.textContent = positions.length
      ? positions.map((position) => `${position.string}弦${position.fret || 0}品`).join(' · ')
      : '将在指板上标出琴弦、品位和手指';
  }

  const stringGuide = $('[data-right-guide-strings]');
  const rightTitle = $('[data-right-guide-title]');
  const rightCopy = $('[data-right-guide-copy]');
  const targetStrings = Array.isArray(right?.strings) && right.strings.length
    ? right.strings.map(Number)
    : (Number.isFinite(note?.string) ? [Number(note.string)] : []);
  if (stringGuide) {
    [...stringGuide.querySelectorAll('i')].forEach((line, index) => {
      line.classList.toggle('is-active', targetStrings.includes(index + 1));
    });
  }
  const isDown = String(right?.direction || 'down').includes('down');
  const arrow = $('[data-right-guide-arrow]');
  if (arrow) arrow.textContent = isDown ? '↓' : '↑';
  const finger = right?.finger || 'i';
  if (rightTitle) rightTitle.textContent = `${isDown ? '下拨' : '上拨'} · ${finger}`;
  if (rightCopy) rightCopy.textContent = targetStrings.length
    ? `目标 ${targetStrings.join('/')} 弦 · ${PICK_NAMES[finger] || finger}`
    : '将在琴弦上标出拨弦方向和手指';
}

function applyHandViewMode(mode = state.handViewMode, { persist = false } = {}) {
  state.handViewMode = mode === 'zoom' ? 'zoom' : 'guide';
  const stack = $('.hand-stack');
  stack?.classList.toggle('is-video-zoom', state.handViewMode === 'zoom');
  $$('[data-hand-view]').forEach((button) => {
    const active = button.dataset.handView === state.handViewMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderHandStack();
  if (persist) savePreferences();
}

/**
 * 画面来自原视频同步裁切；文字只呈现谱面推导，不伪装成视觉识别结果。
 */
function renderHandStack() {
  const note = state.currentNote;
  const left = note?.leftHandShape;
  const right = note?.rightHandShape;

  const leftConf = $('[data-left-confidence]');
  const leftFingers = $('[data-left-fingers]');
  const leftNext = $('[data-left-next]');

  if (left && Array.isArray(left.fingerPositions) && left.fingerPositions.length) {
    if (leftConf) leftConf.textContent = '视频同步裁切';
    if (leftFingers) {
      const fretted = left.fingerPositions.filter((p) => p.finger > 0);
      const labels = (fretted.length ? fretted : left.fingerPositions).map(
        (p) => `${FINGER_NAMES[p.finger] || `${p.finger} 指`} · ${p.string} 弦 ${p.fret} 品`,
      );
      leftFingers.replaceChildren(...labels.map((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        return span;
      }));
    }
    if (leftNext) {
      const shift = left.nextShift;
      let text = '保持当前手型';
      if (shift) {
        if (shift.direction === 'up') text = `下一动作：向第 ${shift.targetFret} 品换把`;
        else if (shift.direction === 'down') text = `下一动作：回第 ${shift.targetFret} 品`;
        else if (shift.direction === 'stay') text = '下一动作：保持把位';
      }
      const barre = left.barreRange;
      if (barre) text = `横按 ${barre.stringStart}–${barre.stringEnd} 弦 ${barre.fret} 品 · ${text}`;
      leftNext.textContent = `谱面提示：${text}`;
    }
  } else {
    if (leftFingers) leftFingers.innerHTML = '<span>指法信息由谱面推导，仅作辅助</span>';
    if (leftNext) leftNext.textContent = '谱面提示：等待当前音符';
  }

  const rightConf = $('[data-right-confidence]');
  const rightDir = $('[data-right-direction]');
  const rightFinger = $('[data-right-finger]');
  const rightDetail = $('[data-right-detail]');
  const rightNext = $('[data-right-next]');

  if (right) {
    if (rightConf) rightConf.textContent = '视频同步裁切';
    const isDown = String(right.direction || '').includes('down');
    const arrow = isDown ? '↓' : '↑';
    if (rightDir) rightDir.textContent = arrow;
    const fingerKey = right.finger || 'i';
    if (rightFinger) rightFinger.textContent = `谱面建议 ${fingerKey} · ${PICK_NAMES[fingerKey] || fingerKey}`;
    const strings = Array.isArray(right.strings) ? right.strings : [];
    if (rightDetail) rightDetail.textContent = `${isDown ? '下拨' : '上拨'} ${strings.length ? strings.join('/') : ''} 弦`;
    if (rightNext) rightNext.textContent = '拨弦信息由谱面推导，仅作辅助';
  } else {
    if (rightDir) rightDir.textContent = '·';
    if (rightFinger) rightFinger.textContent = '等待当前音符';
    if (rightDetail) rightDetail.textContent = '谱面推导提示';
  }
  if (leftConf) leftConf.textContent = state.handViewMode === 'guide' ? '谱面动作示意' : '视频同步裁切';
  if (rightConf) rightConf.textContent = state.handViewMode === 'guide' ? '谱面动作示意' : '视频同步裁切';
  renderHandGuides(note, left, right);
  drawHandCloseups();
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

  renderTimeline();
  const timeline = $('.timeline-pane');
  const timelinePlayhead = $('[data-timeline-playhead]');
  const timelineProgress = timelinePosition(state.playerTime, state.timelineWindowStart, state.timelineWindowEnd) / 100;
  if (timeline && timelinePlayhead) {
    const left = 58 + Math.max(0, timeline.clientWidth - 58) * timelineProgress;
    timelinePlayhead.style.left = `${left}px`;
  }
  const scorePlayhead = $('[data-score-playhead]');
  if (scorePlayhead) scorePlayhead.style.left = `${timelineProgress * 100}%`;

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
    note.classList.remove('is-current', 'is-correct', 'is-wrong', 'is-miss');
  });
  if (nearest) {
    nearest.classList.add('is-current');
    if (state.lastResult && state.lastResult.targetNote && nearest.dataset.eventId === state.lastResult.targetNote.id) {
      nearest.classList.add(
        state.lastResult.type === 'correct' ? 'is-correct' :
        state.lastResult.type === 'miss' ? 'is-miss' : 'is-wrong'
      );
    }
  }

  const title = $('[data-feedback-title]');
  const copy = $('[data-feedback-copy]');
  const score = $('[data-live-score]');
  const detection = state.lastDetection;
  const hasPitch = state.micAllowed
    && detection?.rms >= 0.005
    && detection.pitch?.confidence >= 0.65
    && detection.pitch.frequency > 0;
  const currentNote = state.currentNote;
  const lastResult = state.lastResult;
  const resultFresh = lastResult && Math.abs(state.playerTime - lastResult.currentTime) < 1.2;

  if (!state.scoringEnabled) {
    title.textContent = '评分已关闭';
    copy.textContent = '视频、谱面和动作保持同步；自动纠错仍可使用，重新开启后继续判定。';
    score.textContent = '--';
  } else if (!state.playing) {
    title.textContent = state.playerTime > 0 ? '已暂停' : '准备就绪';
    copy.textContent = state.playerTime > 0 ? '可点击谱面音符精确定位。' : '点击播放，跟随老师开始演奏。';
    score.textContent = '--';
  } else if (resultFresh && currentNote) {
    const targetName = currentNote.type === 'chord'
      ? (currentNote.chord || '和弦')
      : midiToNoteName(currentNote.midi);
    if (lastResult.type === 'correct') {
      title.textContent = '完美';
      copy.textContent = `目标：${targetName}`;
    } else if (lastResult.type === 'miss') {
      title.textContent = '漏音 / 节奏偏';
      copy.textContent = `目标：${targetName} · ${Math.abs(lastResult.timingDeviation).toFixed(0)} ms`;
    } else if (lastResult.type === 'wrong-pitch') {
      title.textContent = '音高偏差';
      copy.textContent = `目标：${targetName} · 听到 ${midiToNoteName(freqToMidi(lastResult.playedNote.pitch))}`;
    } else {
      title.textContent = '未命中';
      copy.textContent = `目标：${targetName}`;
    }
    score.textContent = lastResult.score === 'perfect' ? 'Perfect' : (lastResult.score === 'good' ? 'Good' : 'Miss');
  } else if (hasPitch) {
    const noteName = midiToNoteName(detection.pitch.midi);
    title.textContent = `识别到 ${noteName}`;
    copy.textContent = `${Math.round(detection.pitch.frequency)} Hz · ${detection.onset ? '起音清晰' : '持续聆听中'}`;
    score.textContent = noteName;
  } else if (state.micAllowed) {
    title.textContent = '正在聆听';
    copy.textContent = currentNote
      ? `当前目标：${midiToNoteName(currentNote.midi)}`
      : '请弹响一个清晰的单音，系统会显示实时音高。';
    score.textContent = currentNote ? midiToNoteName(currentNote.midi) : '--';
  } else {
    title.textContent = '跟随播放';
    copy.textContent = '仅观看模式不会生成演奏判定；开启麦克风可查看实时音高。';
    score.textContent = '--';
  }

  if (state.scoringEnabled) {
    const liveScore = scorePracticeResults(state.practiceResults);
    const hasJudgements = state.practiceResults.some((result) => result.resultType !== 'extra');
    score.textContent = hasJudgements ? String(liveScore.total) : '--';
    score.title = hasJudgements
      ? `音准 ${liveScore.noteAccuracy} · 完整度 ${liveScore.completeness} · 节奏 ${liveScore.timing}`
      : '完成演奏判定后显示综合得分';
  } else {
    score.title = '评分模式已关闭';
  }

  renderHandStack();
}

function toggleLoop(force) {
  const enabled = force !== undefined ? force : !state.loopEnabled;
  state.loopEnabled = enabled;
  updateLoopUI();
  if (!state.loopEnabled) {
    showToast('循环已关闭');
    return;
  }
  const range = getLoopRange();
  const label = state.focusMode ? '专项循环' : '片段循环';
  showToast(`${label}已开启：${formatTime(range.start, true)}–${formatTime(range.end, true)}`);
}

function hasCustomLoopRange() {
  return Number.isFinite(state.loopStart)
    && Number.isFinite(state.loopEnd)
    && state.loopEnd - state.loopStart >= 0.25;
}

function updateLoopUI() {
  const track = $('[data-seek-track]');
  const rangeElement = $('[data-loop-range]');
  const aMarker = $('[data-loop-marker="a"]');
  const bMarker = $('[data-loop-marker="b"]');
  const toggle = $('[data-loop-toggle]');
  const duration = Math.max(0.001, state.duration);
  const hasA = !state.focusMode && Number.isFinite(state.loopStart);
  const hasB = !state.focusMode && Number.isFinite(state.loopEnd);
  const custom = hasCustomLoopRange() && !state.focusMode;
  const visualRange = custom
    ? { start: state.loopStart, end: state.loopEnd }
    : (state.loopEnabled ? getLoopRange() : null);
  track?.classList.toggle('is-looping', state.loopEnabled);
  track?.classList.toggle('has-loop-range', Boolean(visualRange));
  if (aMarker) {
    aMarker.hidden = !hasA;
    if (hasA) aMarker.style.left = `${Math.max(0, Math.min(100, state.loopStart / duration * 100))}%`;
  }
  if (bMarker) {
    bMarker.hidden = !hasB;
    if (hasB) bMarker.style.left = `${Math.max(0, Math.min(100, state.loopEnd / duration * 100))}%`;
  }
  if (rangeElement && visualRange) {
    const left = Math.max(0, Math.min(100, visualRange.start / duration * 100));
    const right = Math.max(left, Math.min(100, visualRange.end / duration * 100));
    rangeElement.style.left = `${left}%`;
    rangeElement.style.width = `${right - left}%`;
  } else if (rangeElement) {
    rangeElement.style.removeProperty('left');
    rangeElement.style.removeProperty('width');
  }
  if (toggle) {
    toggle.classList.toggle('is-active', state.loopEnabled);
    toggle.setAttribute('aria-pressed', String(state.loopEnabled));
    toggle.setAttribute('aria-label', state.loopEnabled ? '暂停 A-B 循环' : '开启 A-B 循环');
    toggle.title = custom
      ? `A ${formatTime(state.loopStart, true)} · B ${formatTime(state.loopEnd, true)}`
      : '未设置 A/B 时循环当前练习片段';
  }
}

function setLoopPoint(point) {
  const current = Math.max(0, Math.min(state.duration, state.playerTime));
  if (point === 'a') {
    state.loopStart = current;
    if (Number.isFinite(state.loopEnd) && state.loopEnd <= current + 0.25) state.loopEnd = null;
    state.loopEnabled = false;
    updateLoopUI();
    showToast(`A 点已设为 ${formatTime(current, true)}，请继续播放后设置 B 点。`);
    return;
  }
  if (!Number.isFinite(state.loopStart)) {
    showToast('请先设置 A 点。', 'error');
    return;
  }
  if (current <= state.loopStart + 0.25) {
    showToast('B 点必须至少位于 A 点之后 0.25 秒。', 'error');
    return;
  }
  state.loopEnd = current;
  state.loopEnabled = true;
  updateLoopUI();
  showToast(`A-B 循环已开启：${formatTime(state.loopStart, true)}–${formatTime(state.loopEnd, true)}`);
}

function clearCustomLoop() {
  state.loopStart = null;
  state.loopEnd = null;
  state.loopEnabled = false;
  updateLoopUI();
  showToast('A-B 循环点已清除。');
}

function showVoiceHelp() {
  const help = $('[data-voice-help]');
  if (help) {
    const body = $('p', help);
    if (body) body.textContent = VOICE_HELP_TEXT;
    openLayer(help);
  }
}

function updateVoiceUI() {
  $$('[data-voice-pill]').forEach((pill) => {
    pill.classList.toggle('is-on', state.voiceEnabled);
    pill.setAttribute('aria-pressed', String(state.voiceEnabled));
  });
  $$('[data-voice-dot]').forEach((dot) => {
    dot.classList.toggle('is-recording', state.voiceRecording);
    dot.classList.toggle('is-processing', state.voiceProcessing);
  });
  const switchButton = $('[data-action="toggle-voice"]');
  if (switchButton) {
    switchButton.classList.toggle('is-on', state.voiceEnabled);
    switchButton.setAttribute('aria-checked', String(state.voiceEnabled));
  }
  const wakeSwitch = $('[data-action="toggle-wake-word"]');
  if (wakeSwitch) {
    wakeSwitch.classList.toggle('is-on', state.voiceWakeWord);
    wakeSwitch.setAttribute('aria-checked', String(state.voiceWakeWord));
  }
}

function toggleVoiceControl(element) {
  if (!VoiceController.isSupported()) {
    showToast('当前浏览器不支持语音控制', 'error');
    return;
  }
  const on = !state.voiceEnabled;
  state.voiceEnabled = on;
  if (element) toggleSwitch(element);
  updateVoiceUI();
  savePreferences();
  showToast(on ? '语音控制已开启，按住语音按钮说话' : '语音控制已关闭');
}

function toggleWakeWord(element) {
  state.voiceWakeWord = !state.voiceWakeWord;
  if (element) toggleSwitch(element);
  updateVoiceUI();
  savePreferences();
  showToast(state.voiceWakeWord ? '唤醒词模式已开启' : '唤醒词模式已关闭');
}

let voiceController = null;

function initVoiceControl() {
  if (!VoiceController.isSupported()) return;

  voiceController = new VoiceController({
    dispatcher(action, payload) {
      handleAction(action, null, payload);
    },
    onStateChange(stateName, detail) {
      if (stateName === 'recording') {
        state.voiceRecording = true;
        state.voiceProcessing = false;
        showToast('正在聆听…');
      } else if (stateName === 'processing') {
        state.voiceRecording = false;
        state.voiceProcessing = true;
      } else if (stateName === 'idle') {
        state.voiceRecording = false;
        state.voiceProcessing = false;
      } else if (stateName === 'error') {
        state.voiceRecording = false;
        state.voiceProcessing = false;
        showToast(detail || '语音处理失败', 'error');
      } else if (stateName === 'unrecognized') {
        showToast(detail ? `未识别："${detail}"` : '未识别语音命令');
      } else if (stateName === 'executed') {
        if (detail?.reply) showToast(detail.reply);
      }
      updateVoiceUI();
    },
  });
}

function startVoiceRecording() {
  if (!state.voiceEnabled) return;
  voiceController?.start();
}

function stopVoiceRecording() {
  voiceController?.stop();
}

function frameStep(direction) {
  seekPlayer(state.playerTime + direction / 30);
}

const FOCUS_SPEEDS = [0.6, 0.75, 0.9, 1.0];
const FOCUS_REQUIRED_CORRECT = 2;

/**
 * 错误类型 → 专项练习提示映射。
 * 每项给出简短标题（用于 data-focus-tip）与详细文案（用于 data-focus-tip-detail）。
 * detail 是函数，可读取错误事件的真实弦/品/和弦信息。
 */
const FOCUS_TIPS = {
  'wrong-pitch': {
    short: '按准落点',
    title: '音高偏差',
    detail: (event) => `目标 ${event.chord || midiToNoteName(event.midi)}：按准 ${event.string} 弦 ${event.fret} 品，听到正确音高再继续。`,
  },
  'miss': {
    short: '听清再走',
    title: '漏音 / 节奏偏',
    detail: (event) => `注意 ${event.string} 弦是否清晰发声；若被消音，检查左手是否误触琴弦。`,
  },
  'extra': {
    short: '只弹目标',
    title: '多弹了音',
    detail: (event) => `此段只弹 ${event.chord || midiToNoteName(event.midi)}，避免多弹相邻琴弦。`,
  },
  default: {
    short: '慢动作练习',
    title: '专注这个动作',
    detail: (event) => `注意 ${event.string} 弦 ${event.fret} 品的按法，跟随老师慢动作练习。`,
  },
};

function focusTipFor(errorType) {
  return FOCUS_TIPS[errorType] || FOCUS_TIPS.default;
}

/**
 * 计算一段练习结果的可比较指标（百分比）。
 * @param {{ correct?: number, errors?: number, total?: number, timingErrors?: number, accuracy?: number } | null} stats
 * @returns {{ accuracy: number, chord: number, timing: number }}
 */
function metricsFromStats(stats) {
  const total = Number(stats?.total) || 0;
  const correct = Number(stats?.correct) || 0;
  const errors = Number(stats?.errors) || 0;
  const timingErrors = Number(stats?.timingErrors) || 0;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const chord = total > 0 ? Math.round(((total - errors) / total) * 100) : 0;
  const timing = total > 0 ? Math.max(0, 100 - Math.round((timingErrors / total) * 100)) : 0;
  return { accuracy, chord, timing };
}

/**
 * 返回当前可用循环范围。
 * 纠错模式用 focusLoopStart/End；否则用当前练习片段；都没有则覆盖整段。
 */
function getLoopRange() {
  if (state.focusMode) {
    return { start: state.focusLoopStart, end: state.focusLoopEnd };
  }
  if (hasCustomLoopRange()) {
    return { start: state.loopStart, end: state.loopEnd };
  }
  const seg = state.currentSegment;
  if (seg && Number.isFinite(seg.startTime) && Number.isFinite(seg.endTime)) {
    return { start: seg.startTime, end: Math.min(seg.endTime, state.duration) };
  }
  return { start: 0, end: state.duration };
}

function enterFocusMode(errorEvent, errorType) {
  if (!errorEvent || state.focusMode) return;
  state.focusMode = true;
  state.focusEvent = errorEvent;
  state.focusErrorType = errorType || state.lastResult?.type || 'default';

  // 循环范围：错误前 1 小节 + 错误小节 + 错误后 1 小节
  const beatsPerBar = Number.parseInt(String(state.timeSignature || '4/4').split('/')[0] || '4', 10) || 4;
  const measureDuration = state.bpm ? (60 / state.bpm) * beatsPerBar : 2;
  const measureIndex = errorEvent.measureIndex || 1;
  state.focusLoopStart = Math.max(0, (measureIndex - 2) * measureDuration);
  state.focusLoopEnd = Math.min(state.duration, (measureIndex + 1) * measureDuration);

  state.focusResults = [];
  state.focusLoopCount = 0;

  // 快照进入纠错前的指标，用于后续前后对比
  const beforeResults = state.practiceResults.filter(
    (r) => r.videoTime >= state.focusLoopStart && r.videoTime <= state.focusLoopEnd,
  );
  const beforeStats = summarizeAttempt(
    beforeResults.map((r) => ({ resultType: r.resultType, timingOffsetMs: r.timingOffsetMs })),
  );

  state.focusFsm = new FocusStateMachine({
    speeds: FOCUS_SPEEDS,
    requiredCorrect: FOCUS_REQUIRED_CORRECT,
  });
  state.focusFsm.enter(beforeStats);

  renderFocusView();
  pausePlayer();
  navigate('focus');
  showToast('检测到连续错误，进入专项练习');
}

function renderFocusView() {
  const event = state.focusEvent;
  const fsm = state.focusFsm;
  if (!event || !fsm) return;

  const measureIndex = event.measureIndex || 6;
  const startTime = state.focusLoopStart;
  const endTime = state.focusLoopEnd;
  const speedPercent = Math.round(fsm.currentSpeed * 100);

  const subtitle = $('[data-focus-subtitle]');
  if (subtitle) subtitle.textContent = `第 ${measureIndex} 小节 · 回看循环 ${formatTime(startTime, true)}–${formatTime(endTime, true)}`;

  const speedLabel = $('[data-focus-speed-label]');
  if (speedLabel) speedLabel.textContent = `老师动作 · ${speedPercent}% 速度`;

  // 提示文案根据错误类型生成，覆盖简短标题与详细说明
  const tip = focusTipFor(state.focusErrorType);
  const issueTitle = $('[data-focus-issue-title]');
  if (issueTitle) issueTitle.textContent = `${event.chord || midiToNoteName(event.midi)} · ${tip.title}`;
  const tipStrong = $('[data-focus-tip]');
  if (tipStrong) tipStrong.textContent = tip.short;
  const tipDetail = $('[data-focus-tip-detail]');
  if (tipDetail) tipDetail.textContent = tip.detail(event);

  const roundEl = $('[data-focus-round]');
  if (roundEl) roundEl.textContent = `第 ${Math.min(fsm.attempts + 1, 4)} / 4 轮`;

  const targetEl = $('[data-focus-target]');
  if (targetEl) targetEl.textContent = `目标：连续正确 ${FOCUS_REQUIRED_CORRECT} 次`;

  // 速度阶梯：已通过 / 练习中 / 待解锁
  const ladder = $$('[data-speed-ladder] > div');
  ladder.forEach((step, index) => {
    const isCurrent = index === fsm.speedStep;
    step.classList.toggle('is-current', isCurrent);
    step.classList.toggle('is-done', index < fsm.speedStep);
    const span = $('span', step);
    if (span) {
      if (index < fsm.speedStep) span.textContent = '通过';
      else if (isCurrent) span.textContent = fsm.isPassed ? '已通过' : '练习中';
      else span.textContent = fsm.isPassed ? '已通过' : '待解锁';
    }
  });
}

function startFocusAttempt() {
  const fsm = state.focusFsm;
  if (!fsm || !fsm.canRetry) return;
  fsm.startAttempt();
  const countdown = $('[data-countdown]');
  const number = $('span', countdown);
  countdown.hidden = false;
  let count = 3;
  number.textContent = String(count);
  const measureIndex = state.focusEvent?.measureIndex || 6;
  const interval = window.setInterval(() => {
    count -= 1;
    if (count > 0) {
      number.textContent = String(count);
      return;
    }
    if (count === 0) {
      number.textContent = '开始';
      $('small', countdown).textContent = `弹奏第 ${measureIndex} 小节`;
      return;
    }
    window.clearInterval(interval);
    countdown.hidden = true;
    $('small', countdown).textContent = '准备演奏';
    fsm.finishCountIn();
    // 每轮只统计本轮结果，便于评估与对比
    state.focusResults = [];
    state.focusLoopCount = 0;
    state.loopEnabled = true;
    state.playerSpeed = fsm.currentSpeed;
    const video = $('#playerVideo');
    if (video) video.playbackRate = state.playerSpeed;
    state.playerTime = state.focusLoopStart;
    seekPlayer(state.focusLoopStart);
    playPlayer();
  }, 680);
}

function evaluateFocusAttempt() {
  const fsm = state.focusFsm;
  if (!fsm) return;
  const results = state.focusResults.filter(
    (r) => r.videoTime >= state.focusLoopStart && r.videoTime <= state.focusLoopEnd,
  );
  fsm.finishLoop(
    results.map((r) => ({ resultType: r.resultType, timingOffsetMs: r.timingOffsetMs })),
  );

  const comparison = $('[data-comparison]');
  const comparisonTitle = $('[data-comparison-title]');
  const comparisonNext = $('[data-comparison-next]');
  const comparisonMetrics = $('[data-comparison-metrics]');
  if (comparison) comparison.hidden = false;

  // 用真实前后指标填充对比卡的三条数值
  if (comparisonMetrics) {
    const before = metricsFromStats(fsm.beforeStats);
    const after = metricsFromStats(fsm.afterStats);
    const pairs = [
      [before.accuracy, after.accuracy],
      [before.chord, after.chord],
      [before.timing, after.timing],
    ];
    $$('span', comparisonMetrics).forEach((span, index) => {
      const pair = pairs[index];
      if (!pair) return;
      const beforeEl = $('b', span);
      const afterEl = $('strong', span);
      if (beforeEl) beforeEl.textContent = `${pair[0]}%`;
      if (afterEl) afterEl.textContent = `${pair[1]}%`;
    });
  }

  const action = fsm.lastAction;
  if (action === SpeedAction.PASSED) {
    if (comparisonTitle) comparisonTitle.textContent = '这个难点已经通过了！';
    if (comparisonNext) comparisonNext.textContent = '下一步：回到完整跟练。';
  } else if (action === SpeedAction.SPEED_UP) {
    if (comparisonTitle) comparisonTitle.textContent = '这一档速度已经稳定了。';
    if (comparisonNext) comparisonNext.textContent = `下一步：提到 ${Math.round(fsm.currentSpeed * 100)}% 速度，保持相同动作。`;
  } else if (action === SpeedAction.SLOW_DOWN) {
    if (comparisonTitle) comparisonTitle.textContent = '这一档还不够稳定，先回到慢一点的速度。';
    if (comparisonNext) comparisonNext.textContent = `已降速到 ${Math.round(fsm.currentSpeed * 100)}%，再来一次。`;
  } else {
    if (comparisonTitle) comparisonTitle.textContent = '再来一次，注意老师动作。';
    if (comparisonNext) comparisonNext.textContent = '保持当前速度，专注目标音符。';
  }

  renderFocusView();
  comparison?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
}

function exitFocusMode() {
  state.focusFsm?.exit();
  state.focusMode = false;
  state.focusEvent = null;
  state.focusErrorType = 'default';
  state.focusFsm = null;
  state.loopEnabled = false;
  state.playerSpeed = 1;
  const video = $('#playerVideo');
  if (video) video.playbackRate = 1;
  const comparison = $('[data-comparison]');
  if (comparison) comparison.hidden = true;
}

function renderBeginnerTutorial() {
  const progress = beginnerProgress(state.beginnerStep);
  $$('[data-beginner-panel]').forEach((panel) => {
    const active = Number(panel.dataset.beginnerPanel) === state.beginnerStep;
    panel.hidden = !active;
    panel.setAttribute('aria-hidden', String(!active));
  });
  $$('[data-beginner-step]').forEach((button) => {
    const step = Number(button.dataset.beginnerStep);
    const active = step === state.beginnerStep;
    button.classList.toggle('is-active', active);
    button.classList.toggle('is-complete', step < state.beginnerStep || state.beginnerComplete);
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });

  const count = $('[data-beginner-count]');
  const bar = $('[data-beginner-progress]');
  const previous = $('[data-action="beginner-prev"]');
  const next = $('[data-action="beginner-next"]');
  const finish = $('[data-action="finish-beginner"]');
  if (count) count.textContent = `${progress.current} / ${progress.total}`;
  if (bar) bar.style.setProperty('--value', `${progress.percent}%`);
  if (previous) previous.disabled = progress.isFirst;
  if (next) next.hidden = progress.isLast;
  if (finish) finish.hidden = !progress.isLast;

  $$('[data-beginner-entry-status]').forEach((label) => {
    label.textContent = state.beginnerComplete ? '基础已完成 · 随时复习' : '3 分钟 · 只学马上要用的';
  });
}

function openBeginnerTutorial() {
  state.beginnerStep = 0;
  renderBeginnerTutorial();
  openLayer($('[data-beginner-layer]'));
}

function finishBeginnerTutorial({ startDemo = false } = {}) {
  state.beginnerComplete = true;
  savePreferences();
  renderBeginnerTutorial();
  closeLayer($('[data-beginner-layer]'));
  showToast('准备完成：现在可以直接照着谱面和动作提示练习。');
  if (startDemo) void prepareDemo();
}

function managedLayers() {
  return [
    $('[data-mic-modal]'),
    $('[data-settings-layer]'),
    $('[data-voice-help]'),
    $('[data-beginner-layer]'),
  ].filter(Boolean);
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
  if (managedLayers().every((candidate) => candidate.hidden)) {
    document.body.style.overflow = '';
  }
  if (restoreFocus && state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
}

function activeLayer() {
  return managedLayers().find((layer) => !layer.hidden) || null;
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

function handleAction(action, element, payload = {}) {
  switch (action) {
    case 'open-beginner':
      openBeginnerTutorial();
      return;
    case 'close-beginner':
      closeLayer($('[data-beginner-layer]'));
      return;
    case 'beginner-prev':
      state.beginnerStep = moveBeginnerStep(state.beginnerStep, -1);
      renderBeginnerTutorial();
      return;
    case 'beginner-next':
      state.beginnerStep = moveBeginnerStep(state.beginnerStep, 1);
      renderBeginnerTutorial();
      return;
    case 'beginner-step':
      state.beginnerStep = normalizeBeginnerStep(element.dataset.beginnerStep);
      renderBeginnerTutorial();
      return;
    case 'finish-beginner':
      finishBeginnerTutorial();
      return;
    case 'beginner-demo':
      finishBeginnerTutorial({ startDemo: true });
      return;
    case 'timeline-zoom-in':
      state.timelineZoomIndex = Math.min(TIMELINE_BAR_COUNTS.length - 1, state.timelineZoomIndex + 1);
      renderTimeline(true);
      updatePlayerUI();
      return;
    case 'timeline-zoom-out':
      state.timelineZoomIndex = Math.max(0, state.timelineZoomIndex - 1);
      renderTimeline(true);
      updatePlayerUI();
      return;
    case 'timeline-zoom-reset':
      state.timelineZoomIndex = 2;
      renderTimeline(true);
      updatePlayerUI();
      return;
    case 'adjust-speed': {
      const steps = [0.5, 0.6, 0.75, 0.9, 1];
      const current = state.playerSpeed;
      const index = steps.indexOf(current);
      let nextIndex = payload.delta > 0 ? index + 1 : index - 1;
      nextIndex = Math.max(0, Math.min(steps.length - 1, nextIndex));
      setPlayerSpeed(steps[nextIndex]);
      return;
    }
    case 'set-speed':
      setPlayerSpeed(payload.speed);
      return;
    case 'seek-to-segment-start': {
      const segmentStart = getCurrentSegmentStart();
      seekPlayer(segmentStart);
      showToast('已回到片段开头');
      return;
    }
    case 'navigate':
      if (payload.route && ROUTES.has(payload.route)) navigate(payload.route);
      return;
    case 'next-segment':
      showToast('下一片段');
      return;
    case 'prev-segment':
      showToast('上一片段');
      return;
    case 'show-voice-help':
      showVoiceHelp();
      return;
    case 'toggle-voice':
      toggleVoiceControl(element);
      return;
    case 'toggle-wake-word':
      toggleWakeWord(element);
      return;
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
    case 'retry-analysis':
      void retryRemoteAnalysis();
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
    case 'open-focus': {
      const lastResult = state.lastResult;
      const errorEvent = lastResult?.targetNote || state.currentNote;
      if (errorEvent) {
        enterFocusMode(errorEvent, lastResult?.type);
      } else {
        // 没有具体错误事件时，跳到当前片段开头并开启循环，而非写死的演示区间
        const range = getLoopRange();
        seekPlayer(range.start);
        state.loopEnabled = true;
        $('[data-seek-track]')?.classList.add('is-looping');
        showToast(`已开启片段循环：${formatTime(range.start, true)}–${formatTime(range.end, true)}`);
        navigate('focus');
      }
      break;
    }
    case 'open-mic': {
      const shouldEnable = payload.enabled !== undefined ? payload.enabled : !state.micAllowed;
      if (state.simMode) {
        if (shouldEnable) {
          buildSimulator();
          showToast(`已启用模拟演奏：${state.simulator?.modeLabel || state.simMode}`);
        } else if (state.micAllowed) {
          state.micAllowed = false;
          state.micDetector = null;
          updateMicrophoneUI();
          showToast('模拟演奏已暂停，可从顶部重新开启。');
        }
        return;
      }
      if (shouldEnable) {
        if (!state.micAllowed) openMicModal();
      } else if (state.micAllowed) {
        void stopMicrophone();
        showToast('麦克风已关闭，原始音频不会被保存。');
      }
      break;
    }
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
      applyLayoutPreferences();
      openLayer($('[data-settings-layer]'));
      break;
    case 'close-settings':
      closeLayer($('[data-settings-layer]'));
      break;
    case 'reset-layout':
      state.layoutVideoShare = 72;
      state.layoutTimelineScale = 100;
      state.layoutLeftHandShare = 50;
      state.minimizedPanels = normalizePanelStates();
      state.handCropOffsets = normalizeHandCropOffsets();
      applyLayoutPreferences({ persist: true });
      applyPanelStates({ persist: true });
      drawHandCloseups();
      showToast('跟练面板尺寸已恢复默认。');
      break;
    case 'close-voice-help':
      closeLayer($('[data-voice-help]'));
      break;
    case 'toggle-auto-slow':
      toggleSwitch(element);
      state.autoSlowDown = element.classList.contains('is-on');
      break;
    case 'toggle-scoring':
      setScoringMode(!state.scoringEnabled);
      break;
    case 'toggle-overlay':
      toggleSwitch(element);
      break;
    case 'toggle-play':
      if (payload.play === true && !state.playing) playPlayer();
      else if (payload.play === false && state.playing) pausePlayer();
      else togglePlayer();
      break;
    case 'toggle-mute':
      togglePlayerMute();
      break;
    case 'toggle-loop': {
      const enabled = payload.enabled !== undefined ? payload.enabled : !state.loopEnabled;
      toggleLoop(enabled);
      break;
    }
    case 'set-loop-a':
      setLoopPoint('a');
      break;
    case 'set-loop-b':
      setLoopPoint('b');
      break;
    case 'clear-loop':
      clearCustomLoop();
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
      void submitPracticeResults().then(() => {
        if (state.remoteCourse?.id) loadPracticeSummary(state.remoteCourse.id);
      });
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

  const panelButton = event.target.closest('[data-panel-toggle]');
  if (panelButton) {
    togglePanel(panelButton.dataset.panelToggle);
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

  const handViewButton = event.target.closest('[data-hand-view]');
  if (handViewButton) {
    applyHandViewMode(handViewButton.dataset.handView, { persist: true });
    showToast(state.handViewMode === 'zoom' ? '已切换为视频手部放大。' : '已切换为动作示意图。');
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
  document.addEventListener('input', (event) => {
    const control = event.target.closest?.('[data-layout-control]');
    if (control) updateLayoutPreference(control.dataset.layoutControl, control.value);
  });
  const playerVideo = $('#playerVideo');
  const overviewVideo = $('#overviewVideo');
  overviewVideo?.addEventListener('loadeddata', () => {
    overviewVideo.hidden = false;
    const fallback = $('.overview-art [data-video-fallback]');
    if (fallback) fallback.hidden = true;
  });
  overviewVideo?.addEventListener('error', () => {
    if (!overviewVideo.currentSrc) return;
    overviewVideo.hidden = true;
    const fallback = $('.overview-art [data-video-fallback]');
    if (fallback) fallback.hidden = false;
  });
  playerVideo?.addEventListener('loadedmetadata', () => {
    const actualDuration = Number(playerVideo.duration);
    if (!Number.isFinite(actualDuration) || actualDuration <= 0) return;
    state.mediaDuration = actualDuration;
    state.duration = actualDuration;
    state.playerTime = Math.min(state.playerTime, actualDuration);
    updateCourseCopy();
    updatePlayerUI();
  });
  playerVideo?.addEventListener('volumechange', updateMuteButton);
  playerVideo?.addEventListener('ended', () => {
    if (state.loopEnabled) {
      const range = getLoopRange();
      if (range.end > range.start) {
        seekPlayer(range.start);
        playerVideo.play().catch(() => pausePlayer());
        return;
      }
    }
    state.playerTime = state.duration;
    pausePlayer();
    void submitPracticeResults().then(() => {
      if (state.remoteCourse?.id) loadPracticeSummary(state.remoteCourse.id);
      navigate('results');
    });
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
    voiceController?.stop?.();
  });
  window.addEventListener('resize', () => {
    applyLayoutPreferences();
  });

  $$('[data-voice-pill]').forEach((voicePill) => {
    const start = (event) => {
      event.preventDefault();
      if (!state.voiceEnabled) {
        toggleVoiceControl();
      }
      startVoiceRecording();
    };
    const stop = (event) => {
      event.preventDefault();
      stopVoiceRecording();
    };
    voicePill.addEventListener('mousedown', start);
    voicePill.addEventListener('touchstart', start);
    voicePill.addEventListener('mouseup', stop);
    voicePill.addEventListener('mouseleave', stop);
    voicePill.addEventListener('touchend', stop);
  });
}

function bootstrap() {
  loadPreferences();
  renderBeginnerTutorial();
  applyLayoutPreferences();
  // ?sim=<mode> 开启 MIDI/程序化用户模拟，替代真实麦克风监听。
  // 支持 perfect / miss / late50 / late100 / late200 / early50 / early100 /
  // wrong@<time> / wrong@id=<id> / jitter / partial。
  const simMode = new URLSearchParams(window.location.search).get('sim');
  if (simMode) {
    state.simMode = simMode;
    state.micResolved = true;
    state.micAllowed = true;
    showToast(`已启用模拟演奏模式：${simMode}（无需麦克风）`);
  }
  state.defaultTabEvents = $$('.tab-event').map((event) => event.cloneNode(true));
  buildWaveforms();
  initUpload();
  initVoiceControl();
  initEvents();
  initPanelResizers();
  initHandCropDragging();
  applyHandViewMode();
  applyPanelStates();
  applyScoringMode();
  updateCourseCopy();
  updateMicrophoneUI();
  updateVoiceUI();
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
