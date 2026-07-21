/**
 * 弦间前端产品原型
 * 串联上传、解析、课程概览、同步跟练、专项纠错与结果页。
 */

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

const state = {
  view: 'home',
  file: null,
  videoUrl: null,
  courseTitle: '清晨指弹练习',
  duration: DEMO_DURATION,
  analysisTimer: null,
  analysisIndex: -1,
  analysisComplete: false,
  micResolved: false,
  micAllowed: false,
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

  if (view === 'analysis' && state.analysisIndex < 0 && !state.analysisComplete) {
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
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    const done = (value) => {
      probe.removeAttribute('src');
      probe.load();
      resolve(value);
    };
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? probe.duration : DEMO_DURATION);
    probe.onerror = () => done(DEMO_DURATION);
    probe.src = url;
  });
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
  state.courseTitle = file.name.replace(/\.[^.]+$/, '') || '未命名吉他课程';
  state.duration = DEMO_DURATION;

  $('[data-dropzone]').hidden = true;
  $('[data-selected-file]').hidden = false;
  $('[data-file-name]').textContent = file.name;
  $('[data-file-meta]').textContent = `正在读取时长 · ${formatBytes(file.size)} · 本地视频`;
  updateCourseCopy();
  setVideoSources();

  const duration = await readVideoDuration(state.videoUrl);
  if (state.file !== file) return;
  if (duration > 600) {
    showToast('视频超过 10 分钟，请截取需要练习的片段后重试。', 'error');
    resetVideoSelection();
    return;
  }
  state.duration = duration;
  $('[data-file-meta]').textContent = `${formatTime(duration)} · ${formatBytes(file.size)} · 质量检查通过`;
  updateCourseCopy();
  showToast(duration < 30
    ? '视频少于 30 秒，仍可解析，建议使用更完整的练习片段。'
    : '视频质量检查完成，可以开始解析。');
}

function resetVideoSelection() {
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = null;
  state.videoUrl = null;
  state.courseTitle = '清晨指弹练习';
  state.duration = DEMO_DURATION;
  $('[data-dropzone]').hidden = false;
  $('[data-selected-file]').hidden = true;
  const input = $('#videoInput');
  if (input) input.value = '';
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
  savePreferences();
}

function setVideoSources() {
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
    if (state.videoUrl) {
      video.src = state.videoUrl;
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

function prepareDemo() {
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

function beginAnalysis() {
  if (state.analysisTimer || state.analysisComplete || state.view !== 'analysis') return;
  advanceAnalysis();
  state.analysisTimer = window.setInterval(advanceAnalysis, 720);
}

function advanceAnalysis() {
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
  button.disabled = true;
  button.textContent = '正在检查环境…';
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
    state.micResolved = true;
    state.micAllowed = true;
    updateMicrophoneUI();
    closeLayer($('[data-mic-modal]'));
    showToast('麦克风已连接 · 环境噪声较低 · 预计延迟 42 ms');
    if (state.pendingView) navigate(state.pendingView);
    state.pendingView = null;
  } catch {
    showToast('未能获取麦克风权限，可以选择“仅观看课程”继续。', 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function skipMicrophone() {
  state.micResolved = true;
  state.micAllowed = false;
  updateMicrophoneUI();
  closeLayer($('[data-mic-modal]'));
  showToast('已进入仅观看模式，可随时在顶部开启麦克风。');
  if (state.pendingView) navigate(state.pendingView);
  state.pendingView = null;
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
  if (state.videoUrl && video) {
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
  if (state.videoUrl && video && Number.isFinite(video.currentTime)) {
    state.playerTime = video.currentTime;
  } else {
    const elapsed = Math.min(0.1, Math.max(0, (timestamp - state.lastFrameAt) / 1000));
    state.playerTime += elapsed * state.playerSpeed;
  }
  state.lastFrameAt = timestamp;

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
  if (state.videoUrl && video && Number.isFinite(video.duration)) {
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
  if (!state.playing) {
    title.textContent = state.playerTime > 0 ? '已暂停' : '准备就绪';
    copy.textContent = state.playerTime > 0 ? '可点击谱面音符精确定位。' : '点击播放，跟随老师开始演奏。';
    score.textContent = state.playerTime > 0 ? '88' : '--';
  } else if (state.playerTime > 28 && state.playerTime < 34) {
    title.textContent = '有一个漏音';
    copy.textContent = '1 弦发声不够清晰，先继续完成这个乐句。';
    score.textContent = '84';
  } else {
    title.textContent = state.micAllowed ? '正在聆听' : '跟随播放';
    copy.textContent = state.playerTime < 17 ? '节奏很稳，保持当前的右手力度。' : '换把前稍微放松手腕，不要完全抬起食指。';
    score.textContent = String(Math.min(94, 86 + Math.floor(state.playerTime / 8)));
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
      resetAnalysis();
      navigate('analysis');
      break;
    case 'reset-file':
      resetVideoSelection();
      break;
    case 'use-demo':
      prepareDemo();
      break;
    case 'skip-analysis':
      finishAnalysis();
      break;
    case 'analysis-complete':
      navigate('overview');
      break;
    case 'preview-course': {
      const video = $('#overviewVideo');
      if (state.videoUrl && video) {
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
      openMicModal();
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
  });
  window.addEventListener('resize', () => {
    if (state.view === 'player') updatePlayerUI();
  });
}

function bootstrap() {
  loadPreferences();
  buildWaveforms();
  initUpload();
  initEvents();
  updateCourseCopy();
  updateMicrophoneUI();
  setVideoSources();
  chooseTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  activateView(routeFromHash());
}

bootstrap();
