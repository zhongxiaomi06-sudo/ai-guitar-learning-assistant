/**
 * main.js
 * 吉他 AI 跟弹系统入口
 */

import { GuitarApp } from './app.js';
import { initDemoUI } from './ui-demo.js';
import { courses as api } from './shared/utils/api.js';

/**
 * 从 URL 参数获取课程 ID
 * @returns {string | null}
 */
function getCourseIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('course');
}

/**
 * 在执行页加载课程
 * @param {object} course
 * @param {string} videoUrl
 */
function loadCourseIntoPlayer(course, videoUrl) {
  const video = document.getElementById('videoPlayer');
  const overlay = document.getElementById('videoOverlay');
  const status = document.getElementById('videoStatus');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const title = document.querySelector('.guitar-subtitle');

  if (!video || !course) return;

  if (videoUrl) {
    video.src = videoUrl;
    video.load();
  }

  if (overlay) overlay.classList.add('hidden');
  if (status) {
    status.textContent = '已导入';
    status.classList.add('active');
  }
  if (title) title.textContent = course.title;
  [startBtn, pauseBtn, resetBtn].forEach((btn) => {
    if (btn) btn.disabled = false;
  });

  if (document.getElementById('scoreBpm')) {
    document.getElementById('scoreBpm').textContent = course.bpm ? `${course.bpm} BPM` : '-- BPM';
  }
}

async function bootstrap() {
  const app = new GuitarApp();
  app.initPanels();

  // 第一版：使用 ui-demo 的独立音游循环，避免与 GuitarApp 循环冲突
  initDemoUI();

  // 如果从主页带课程 ID 跳转，从后端加载课程与谱面
  const courseId = getCourseIdFromUrl();
  if (courseId) {
    try {
      const course = await api.get(courseId);
      const videoUrl = api.getVideoUrl(courseId);
      loadCourseIntoPlayer(course, videoUrl);

      // 如果后端已有谱面，加载到 GuitarApp（后续完整实现）
      if (course.score_path) {
        const score = await api.getScore(courseId);
        console.log('[GuitarApp] loaded score', score);
      }
    } catch (err) {
      console.error('[GuitarApp] failed to load course from backend', err);
    }
  }

  console.log('[GuitarApp] bootstrapped');
}

bootstrap().catch((err) => {
  console.error('[GuitarApp] bootstrap failed', err);
});
