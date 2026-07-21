/**
 * main.js
 * 吉他 AI 跟弹系统入口
 */

import { GuitarApp } from './app.js';
import { initDemoUI } from './ui-demo.js';
import { local } from './shared/utils/storage.js';

const COURSES_KEY = 'guitar-courses';

/**
 * 从 URL 参数获取课程 ID
 * @returns {string | null}
 */
function getCourseIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('course');
}

/**
 * 从本地存储加载课程
 * @param {string} id
 * @returns {object | null}
 */
function loadCourse(id) {
  const courses = local.get(COURSES_KEY, []);
  return courses.find((c) => c.id === id) || null;
}

/**
 * 在执行页加载课程
 * @param {object} course
 */
function loadCourseIntoPlayer(course) {
  const video = document.getElementById('videoPlayer');
  const overlay = document.getElementById('videoOverlay');
  const status = document.getElementById('videoStatus');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const title = document.querySelector('.guitar-subtitle');

  if (!video || !course) return;

  const url = course.localUrl || course.sourceUrl;
  if (url) {
    video.src = url;
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

  // 如果从主页带课程 ID 跳转，加载该课程视频
  const courseId = getCourseIdFromUrl();
  if (courseId) {
    const course = loadCourse(courseId);
    if (course) loadCourseIntoPlayer(course);
  }

  console.log('[GuitarApp] bootstrapped');
}

bootstrap().catch((err) => {
  console.error('[GuitarApp] bootstrap failed', err);
});
