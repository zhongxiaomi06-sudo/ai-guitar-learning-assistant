/**
 * app.js
 * 吉他 AI 跟弹应用壳：协调五面板、核心逻辑与实时循环
 */

import { VideoPanel } from './features/videoPanel/index.js';
import { ScorePanel } from './features/scorePanel/index.js';
import { MatchingPanel } from './features/matchingPanel/index.js';
import { SuggestionsPanel } from './features/suggestionsPanel/index.js';
import { SettingsPanel } from './features/settingsPanel/index.js';
import { GuitarDetector } from './core/audio/detector.js';
import { ScoreModel } from './core/score/model.js';
import { MatchingEngine } from './core/matching/engine.js';
import { ScoringSystem } from './core/matching/scoring.js';
import { PracticeSession } from './core/practice/session.js';
import { LoopController } from './core/practice/loop.js';
import { SpeedController } from './core/practice/speed.js';
import { VideoFetcher } from './core/video/fetcher.js';
import { DEFAULT_SETTINGS } from './shared/constants/index.js';

export class GuitarApp {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.detector = new GuitarDetector(this.audioContext);
    this.scoring = new ScoringSystem();
    this.speedCtrl = new SpeedController();
    this.session = null;
    this.loopCtrl = null;
    this.scoreModel = null;
    this.matchingEngine = null;
    this.lastMatchedNoteId = null;
    this.rafId = null;

    this.panels = {};
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * 初始化面板
   */
  initPanels() {
    this.panels.video = new VideoPanel(document.querySelector('.video-panel'));
    this.panels.score = new ScorePanel(document.querySelector('.score-panel'));
    this.panels.matching = new MatchingPanel(document.querySelector('.matching-panel'));
    this.panels.suggestions = new SuggestionsPanel(document.querySelector('.suggestions-panel'));
    this.panels.settings = new SettingsPanel(document.querySelector('.settings-panel'));
  }

  /**
   * 加载项目
   * @param {import('./shared/types/index.js').Project} project
   * @param {string | File} videoSource
   */
  async loadProject(project, videoSource) {
    this.scoreModel = new ScoreModel(project);
    this.matchingEngine = new MatchingEngine(this.scoreModel);
    this.session = new PracticeSession(project.id);
    this.loopCtrl = new LoopController(this.panels.video.player);

    await this.panels.video.load(videoSource);
    await this.initAudioInput();
    this.bindEvents();
    this.startLoop();
  }

  /**
   * 初始化音频输入
   */
  async initAudioInput() {
    const devices = await VideoFetcher.enumerateAudioDevices();
    this.panels.settings.renderDevices(devices);

    if (this.settings.inputDeviceId) {
      const stream = await VideoFetcher.getAudioInput(this.settings.inputDeviceId);
      await this.detector.start(stream);
    } else if (devices.length > 0) {
      this.settings.inputDeviceId = devices[0].deviceId;
      const stream = await VideoFetcher.getAudioInput(this.settings.inputDeviceId);
      await this.detector.start(stream);
    }
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resetBtn = document.getElementById('resetBtn');

    startBtn?.addEventListener('click', () => this.start());
    pauseBtn?.addEventListener('click', () => this.pause());
    resetBtn?.addEventListener('click', () => this.reset());

    this.panels.video.onTimeUpdate((time) => this.onTimeUpdate(time));

    this.panels.settings.onChange('speed', (speed) => {
      this.settings.speed = speed;
      this.speedCtrl.setTarget(speed);
      this.panels.video.setSpeed(speed);
    });

    this.panels.settings.onChange('matchMode', (mode) => {
      this.settings.matchMode = mode;
      this.panels.matching.setMode(mode);
    });

    this.panels.settings.onChange('difficulty', (difficulty) => {
      this.settings.difficulty = difficulty;
      // TODO: 根据难度调整判定阈值
    });

    this.panels.settings.onChange('autoSlowDown', (enabled) => {
      this.settings.autoSlowDown = enabled;
      if (this.session) this.session.isAutoSlowDown = enabled;
    });

    this.panels.settings.onChange('inputDevice', async (deviceId) => {
      this.settings.inputDeviceId = deviceId;
      this.detector.stop();
      const stream = await VideoFetcher.getAudioInput(deviceId);
      await this.detector.start(stream);
    });

    this.panels.settings.init();
  }

  /**
   * 开始练习
   */
  start() {
    this.panels.video.play();
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  /**
   * 暂停练习
   */
  pause() {
    this.panels.video.pause();
  }

  /**
   * 重置
   */
  reset() {
    this.panels.video.seek(0);
    this.scoring.reset();
    this.session?.reset();
    this.lastMatchedNoteId = null;
    this.panels.suggestions.updateStats(this.scoring);
  }

  /**
   * 时间更新回调
   * @param {number} time
   */
  onTimeUpdate(time) {
    this.panels.score.render(this.scoreModel.project, time);
  }

  /**
   * 实时主循环
   */
  startLoop() {
    const loop = () => {
      this.tick();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * 每帧处理
   */
  tick() {
    if (!this.scoreModel) return;

    const videoTime = this.panels.video.player.getCurrentTime();
    const detection = this.detector.getDetection();
    const currentTarget = this.scoreModel.getNoteAtTime(videoTime);
    const targetIdentity = currentTarget?.id
      || (currentTarget ? `${currentTarget.startTime}:${currentTarget.endTime}` : null);
    if (!currentTarget) this.lastMatchedNoteId = null;
    if (currentTarget && detection.onset && detection.pitch.confidence >= 0.65 && targetIdentity !== this.lastMatchedNoteId) {
      const playedNote = {
        pitch: detection.pitch.frequency,
        rms: detection.rms,
        velocity: detection.rms,
        // AudioContext 与视频有不同的时间原点；实时判定统一映射到视频时间轴。
        onsetTime: videoTime,
        duration: 0,
      };
      const result = this.matchingEngine.match(videoTime, playedNote);
      this.lastMatchedNoteId = targetIdentity;
      this.scoring.add(result);
      this.session?.handleResult(result);
      this.panels.suggestions.showFeedback(result);
      this.panels.suggestions.updateStats(this.scoring);
      this.panels.matching.updateResult(result);
    }

    const nextNote = this.scoreModel.getNoteAtTime(videoTime + 0.5);
    this.panels.suggestions.showNextHint(nextNote);
    this.panels.score.renderHandShapes(this.scoreModel.getNoteAtTime(videoTime));

    const upcomingNotes = this.scoreModel.getUpcomingNotes(videoTime, 2);
    if (this.settings.matchMode === 'game') {
      this.panels.matching.renderGame(upcomingNotes, videoTime);
    } else {
      const targetNote = this.scoreModel.getNoteAtTime(videoTime);
      const targetFreq = targetNote ? 440 : 0; // TODO: 计算目标频率
      this.panels.matching.renderKTV(targetFreq, detection.pitch.frequency);
    }
    // 自适应调速
    if (this.settings.autoSlowDown && this.session) {
      this.panels.video.setSpeed(this.session.speed);
    }
  }
}

export default GuitarApp;
