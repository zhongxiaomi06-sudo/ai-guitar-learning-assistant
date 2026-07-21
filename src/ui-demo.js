/**
 * ui-demo.js
 * 与 rhythm-demo.html 一致的执行页演示 UI：右→左音游 + 音高仪表 + 可折叠设置
 */

const LANE_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const KEY_MAP = {
  '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5,
  'a': 0, 's': 1, 'd': 2, 'f': 3, 'g': 4, 'h': 5,
  'A': 0, 'S': 1, 'D': 2, 'F': 3, 'G': 4, 'H': 5,
};

let gameState = {
  playing: false,
  lastSpawn: 0,
  notes: [],
  particles: [],
  floatingTexts: [],
  score: 0,
  combo: 0,
  hits: { perfect: 0, good: 0, miss: 0 },
  totalNotes: 0,
  speed: 0.7,
  bpm: 80,
  offset: 0,
  autoPlay: false,
  laneFlash: [0, 0, 0, 0, 0, 0],
};

/**
 * 渲染流动六线谱
 */
function renderDemoTab() {
  const tabLines = document.getElementById('tabLines');
  const tabRuler = document.getElementById('tabRuler');
  if (!tabLines || !tabRuler) return;

  tabLines.innerHTML = Array.from({ length: 6 }, (_, i) => `
    <div class="tab-line" data-string="${i + 1}"></div>
  `).join('');

  tabRuler.innerHTML = Array.from({ length: 5 }, (_, i) => `
    <div class="tab-bar-mark" style="left: ${i * 20 + 10}%;">${i + 1}</div>
  `).join('');

  const demoNotes = [
    { string: 3, fret: 2, left: '15%' },
    { string: 2, fret: 3, left: '25%' },
    { string: 1, fret: 0, left: '35%' },
    { string: 3, fret: 2, left: '45%' },
    { string: 2, fret: 3, left: '55%' },
    { string: 1, fret: 0, left: '65%' },
  ];

  demoNotes.forEach((note, index) => {
    const line = tabLines.children[note.string - 1];
    const el = document.createElement('div');
    el.className = `tab-note ${index === 0 ? 'active' : ''}`;
    el.textContent = note.fret;
    el.style.left = note.left;
    line.appendChild(el);
  });
}

/**
 * 渲染示例手型图
 */
function renderDemoHandShapes() {
  const leftHand = document.getElementById('leftHandBox');
  const rightHand = document.getElementById('rightHandBox');

  if (leftHand) {
    leftHand.innerHTML = `
      <div class="hand-shape-title">左手</div>
      <div class="hand-shape-content">
        <div class="fretboard-demo">
          <div class="fret-row"><span class="dot active">1</span><span>2</span><span>3</span></div>
          <div class="fret-row"><span></span><span class="dot active">2</span><span></span></div>
          <div class="fret-row"><span></span><span></span><span class="dot active">3</span></div>
        </div>
      </div>
    `;
  }

  if (rightHand) {
    rightHand.innerHTML = `
      <div class="hand-shape-title">右手</div>
      <div class="hand-shape-content">
        <span class="pick-direction">↓</span> 下拨 3 弦
      </div>
    `;
  }
}

/**
 * 获取 canvas 尺寸相关
 */
function getCanvasMetrics() {
  const canvas = document.getElementById('matchGameCanvas');
  const rect = canvas.getBoundingClientRect();
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    width: rect.width,
    height: rect.height,
    laneHeight: rect.height / 6,
    hitLineX: rect.width * 0.22,
  };
}

/**
 * 生成音符
 */
function spawnNote() {
  const { width } = getCanvasMetrics();
  const lane = Math.floor(Math.random() * 6);
  const fret = Math.floor(Math.random() * 5);
  gameState.notes.push({
    lane,
    fret,
    x: width + 40,
    hit: false,
    missed: false,
    id: Math.random(),
  });
  gameState.totalNotes++;
}

/**
 * 创建粒子
 */
function createParticles(lane, x) {
  const { laneHeight } = getCanvasMetrics();
  const y = lane * laneHeight + laneHeight / 2;
  const color = LANE_COLORS[lane];
  for (let i = 0; i < 14; i++) {
    gameState.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 8 + 2,
      vy: (Math.random() - 0.5) * 8,
      life: 1,
      color,
      size: Math.random() * 4 + 2,
    });
  }
}

/**
 * 显示飘字
 */
function showFloatingText(text, type) {
  const { width, height } = getCanvasMetrics();
  const color = type === 'perfect' ? '#22c55e' : type === 'good' ? '#f59e0b' : '#ef4444';
  gameState.floatingTexts.push({
    text,
    x: width * 0.22 + 60,
    y: height / 2,
    life: 1,
    color,
    scale: 1,
  });

  const hitFeedback = document.getElementById('hitFeedback');
  const feedbackText = document.getElementById('feedbackText');
  if (hitFeedback) {
    hitFeedback.textContent = text;
    hitFeedback.style.color = color;
    hitFeedback.className = `matching-status ${type === 'miss' ? 'miss' : type === 'good' ? 'warn' : 'hit'}`;
  }
  if (feedbackText) {
    feedbackText.setAttribute('data-type', type === 'perfect' || type === 'good' ? 'correct' : 'miss');
    feedbackText.textContent = text;
  }
}

/**
 * 击打车道
 */
function hitLane(lane) {
  if (!gameState.playing) return;
  gameState.laneFlash[lane] = 1;

  const { hitLineX } = getCanvasMetrics();
  const notesInLane = gameState.notes
    .filter((n) => n.lane === lane && !n.hit && !n.missed)
    .sort((a, b) => Math.abs(a.x - hitLineX) - Math.abs(b.x - hitLineX));

  if (notesInLane.length === 0) return;

  const note = notesInLane[0];
  const distance = Math.abs(note.x - hitLineX);
  let result = 'miss';
  if (distance <= 35) result = 'perfect';
  else if (distance <= 80) result = 'good';

  if (result === 'miss') {
    gameState.combo = 0;
    gameState.hits.miss++;
    showFloatingText('Miss', 'miss');
  } else {
    note.hit = true;
    gameState.combo++;
    gameState.score += result === 'perfect' ? 100 + gameState.combo * 2 : 50 + gameState.combo;
    gameState.hits[result]++;
    createParticles(lane, note.x);
    showFloatingText(result === 'perfect' ? 'Perfect!' : 'Good', result);
  }

  updateStats();
}

/**
 * 更新统计
 */
function updateStats() {
  const total = gameState.hits.perfect + gameState.hits.good + gameState.hits.miss;
  const accuracy = total === 0 ? 0 : Math.round(((gameState.hits.perfect + gameState.hits.good * 0.5) / total) * 100);
  const accuracyText = document.getElementById('accuracyText');
  const streakText = document.getElementById('streakText');
  const barText = document.getElementById('barText');
  const accuracyBadge = document.getElementById('accuracyBadge');
  if (accuracyText) accuracyText.textContent = accuracy + '%';
  if (streakText) streakText.textContent = gameState.combo;
  if (barText) barText.textContent = '1';
  if (accuracyBadge) accuracyBadge.textContent = accuracy + '%';
}

/**
 * 自动演示
 */
function autoPlay() {
  if (!gameState.autoPlay) return;
  const { hitLineX } = getCanvasMetrics();
  const offsetPx = gameState.offset * gameState.speed;
  gameState.notes.forEach((note) => {
    if (!note.hit && !note.missed && note.x >= hitLineX - 10 - offsetPx && note.x <= hitLineX + 15 - offsetPx) {
      hitLane(note.lane);
    }
  });
}

/**
 * 更新游戏状态
 */
function updateGame(dt) {
  if (!gameState.playing) return;

  gameState.notes.forEach((note) => {
    note.x -= dt * gameState.speed;
  });

  const { hitLineX } = getCanvasMetrics();
  const missThreshold = hitLineX - 100;
  gameState.notes.forEach((note) => {
    if (!note.hit && !note.missed && note.x < missThreshold) {
      note.missed = true;
      gameState.combo = 0;
      gameState.hits.miss++;
      showFloatingText('Miss', 'miss');
      updateStats();
    }
  });

  gameState.notes = gameState.notes.filter((n) => !n.hit && !n.missed && n.x > -80);

  const now = performance.now();
  const interval = 60000 / gameState.bpm / 2;
  if (now - gameState.lastSpawn > interval) {
    spawnNote();
    gameState.lastSpawn = now;
  }

  gameState.particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;
    p.life -= 0.025;
  });
  gameState.particles = gameState.particles.filter((p) => p.life > 0);

  gameState.floatingTexts.forEach((t) => {
    t.x += 1.5;
    t.y -= 1;
    t.life -= 0.02;
    t.scale += 0.004;
  });
  gameState.floatingTexts = gameState.floatingTexts.filter((t) => t.life > 0);

  gameState.laneFlash = gameState.laneFlash.map((v) => Math.max(0, v - 0.08));

  autoPlay();
}

/**
 * 绘制游戏
 */
function drawGame() {
  const { ctx, width, height, laneHeight, hitLineX } = getCanvasMetrics();
  if (!ctx) return;

  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#ffffff';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 6; i++) {
    const y = i * laneHeight;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(30, 41, 59, 0.5)' : 'rgba(30, 41, 59, 0.3)';
    ctx.fillRect(0, y, width, laneHeight);

    if (gameState.laneFlash[i] > 0) {
      ctx.fillStyle = `rgba(34, 197, 94, ${gameState.laneFlash[i] * 0.25})`;
      ctx.fillRect(0, y, width, laneHeight);
    }

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + laneHeight);
    ctx.lineTo(width, y + laneHeight);
    ctx.stroke();
  }

  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hitLineX, 0);
  ctx.lineTo(hitLineX, height);
  ctx.stroke();

  ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
  ctx.fillRect(hitLineX - 25, 0, 50, height);

  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = LANE_COLORS[i];
    ctx.fillText((i + 1).toString(), 12, i * laneHeight + laneHeight / 2);
  }

  gameState.notes.forEach((note) => {
    const y = note.lane * laneHeight + laneHeight / 2;
    const radius = Math.min(laneHeight * 0.32, 18);

    const gradient = ctx.createRadialGradient(note.x, y, 0, note.x, y, radius * 1.5);
    gradient.addColorStop(0, LANE_COLORS[note.lane] + '80');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(note.x, y, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = LANE_COLORS[note.lane];
    ctx.beginPath();
    ctx.arc(note.x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(note.fret.toString(), note.x, y + 1);
  });

  gameState.particles.forEach((p) => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  gameState.floatingTexts.forEach((t) => {
    ctx.globalAlpha = t.life;
    ctx.fillStyle = t.color;
    ctx.font = `bold ${22 * t.scale}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(t.text, t.x, t.y);
  });
  ctx.globalAlpha = 1;
}

/**
 * 游戏循环
 */
function gameLoop() {
  const now = performance.now();
  const dt = now - (gameState.lastFrame || now);
  gameState.lastFrame = now;

  updateGame(dt);
  drawGame();
  updatePitchGauge();

  requestAnimationFrame(gameLoop);
}

/**
 * 更新音高仪表
 */
function updatePitchGauge() {
  const gauge = document.getElementById('gaugeCurrent');
  if (!gauge) return;
  const top = 30 + Math.random() * 40;
  gauge.style.top = `${top}%`;
}

/**
 * 切换游戏开始/暂停
 */
function toggleGame() {
  if (gameState.playing) {
    gameState.playing = false;
  } else {
    gameState.playing = true;
    gameState.lastFrame = performance.now();
    gameState.lastSpawn = performance.now();
  }
}

/**
 * 重置游戏
 */
function resetGame() {
  gameState.playing = false;
  gameState.notes = [];
  gameState.particles = [];
  gameState.floatingTexts = [];
  gameState.score = 0;
  gameState.combo = 0;
  gameState.hits = { perfect: 0, good: 0, miss: 0 };
  gameState.totalNotes = 0;
  updateStats();
  const feedbackText = document.getElementById('feedbackText');
  if (feedbackText) {
    feedbackText.setAttribute('data-type', 'pending');
    feedbackText.textContent = '等待开始...';
  }
  const hitFeedback = document.getElementById('hitFeedback');
  if (hitFeedback) {
    hitFeedback.textContent = '准备';
    hitFeedback.className = 'matching-status';
  }
}

/**
 * 初始化速度芯片
 */
function initSpeedChips() {
  const chips = document.querySelectorAll('#speedChips .chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const speedMap = { '0.5': 0.35, '0.75': 0.52, '1.0': 0.7 };
      gameState.speed = speedMap[chip.dataset.speed] || 0.7;
    });
  });
}

/**
 * 初始化难度芯片
 */
function initDifficultyChips() {
  const chips = document.querySelectorAll('#difficultyChips .chip');
  const badge = document.getElementById('difficultyBadge');
  const labels = { loose: '宽松', normal: '标准', strict: '严格' };

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      if (badge) badge.textContent = labels[chip.dataset.difficulty] || '标准';
    });
  });
}

/**
 * 初始化自动调速开关
 */
function initAutoSlowToggle() {
  const toggle = document.getElementById('autoSlowToggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const active = toggle.getAttribute('data-active') === 'true';
    toggle.setAttribute('data-active', String(!active));
    toggle.classList.toggle('active', !active);
    const text = toggle.querySelector('.toggle-text');
    if (text) text.textContent = !active ? '开' : '关';
  });
}

/**
 * 初始化判定偏移
 */
function initOffsetControl() {
  const slider = document.getElementById('offsetSlider');
  const value = document.getElementById('offsetValue');
  if (!slider || !value) return;

  slider.addEventListener('input', (e) => {
    gameState.offset = parseInt(e.target.value);
    value.textContent = `${gameState.offset}ms`;
  });
}

/**
 * 初始化可折叠设置面板
 */
function initFloatingSettings() {
  const toggle = document.getElementById('settingsToggle');
  const panel = document.getElementById('settingsPanel');
  const close = document.getElementById('settingsClose');

  if (toggle && panel) {
    toggle.addEventListener('click', () => panel.classList.toggle('open'));
  }
  if (close && panel) {
    close.addEventListener('click', () => panel.classList.remove('open'));
  }
  // 点击面板外部关闭
  document.addEventListener('click', (e) => {
    if (!panel || !toggle) return;
    if (!panel.contains(e.target) && !toggle.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
}

/**
 * 初始化导入按钮和游戏控制
 */
function initControls() {
  const importBtn = document.getElementById('importBtn');
  const overlay = document.getElementById('videoOverlay');
  const videoStatus = document.getElementById('videoStatus');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const nextHint = document.getElementById('nextHint');
  const scoreBpm = document.getElementById('scoreBpm');

  if (importBtn) {
    importBtn.addEventListener('click', () => {
      if (overlay) overlay.classList.add('hidden');
      if (videoStatus) {
        videoStatus.textContent = '已导入';
        videoStatus.classList.add('active');
      }
      [startBtn, pauseBtn, resetBtn].forEach((btn) => {
        if (btn) btn.disabled = false;
      });
      const feedbackText = document.getElementById('feedbackText');
      if (feedbackText) {
        feedbackText.setAttribute('data-type', 'correct');
        feedbackText.textContent = '准备就绪！';
      }
      if (nextHint) nextHint.textContent = '准备：第 3 弦 2 品';
      if (scoreBpm) scoreBpm.textContent = '120 BPM';
      // 开始自动演示
      if (!gameState.playing) toggleGame();
    });
  }

  if (startBtn) startBtn.addEventListener('click', toggleGame);
  if (pauseBtn) pauseBtn.addEventListener('click', () => { gameState.playing = false; });
  if (resetBtn) resetBtn.addEventListener('click', resetGame);

  // 键盘控制
  window.addEventListener('keydown', (e) => {
    const lane = KEY_MAP[e.key];
    if (lane !== undefined) hitLane(lane);
  });

  // 点击 canvas
  const canvas = document.getElementById('matchGameCanvas');
  if (canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const lane = Math.floor(y / (rect.height / 6));
      if (lane >= 0 && lane < 6) hitLane(lane);
    });
  }

  // 快速操作
  const slowBtn = document.getElementById('slowBtn');
  if (slowBtn) {
    slowBtn.addEventListener('click', () => {
      document.querySelectorAll('#speedChips .chip').forEach((c) => c.classList.remove('active'));
      const half = document.querySelector('#speedChips [data-speed="0.5"]');
      if (half) half.classList.add('active');
      gameState.speed = 0.35;
    });
  }
}

/**
 * 窗口变化时重绘
 */
function initResize() {
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const { canvas } = getCanvasMetrics();
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
      }
    }, 150);
  });
}

/**
 * 初始化演示 UI
 */
export function initDemoUI() {
  renderDemoTab();
  renderDemoHandShapes();
  initFloatingSettings();
  initSpeedChips();
  initDifficultyChips();
  initAutoSlowToggle();
  initOffsetControl();
  initControls();
  initResize();

  // 初始化 canvas 尺寸
  const canvas = document.getElementById('matchGameCanvas');
  if (canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  requestAnimationFrame(gameLoop);
}

export default { initDemoUI };
