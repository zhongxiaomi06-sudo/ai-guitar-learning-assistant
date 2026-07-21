/**
 * home.js
 * 个人主页：上传视频、URL 抓取、演示课程、本地保存课程列表
 */

import { local } from './shared/utils/storage.js';
import { uid, formatTime } from './shared/utils/index.js';

const COURSES_KEY = 'guitar-courses';

/**
 * 生成课程封面缩略图（颜色渐变）
 * @returns {string}
 */
function generateThumbColor() {
  const colors = [
    'linear-gradient(135deg, #2563eb, #3b82f6)',
    'linear-gradient(135deg, #7c3aed, #a855f7)',
    'linear-gradient(135deg, #059669, #10b981)',
    'linear-gradient(135deg, #d97706, #f59e0b)',
    'linear-gradient(135deg, #dc2626, #ef4444)',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * 从文件创建视频 URL
 * @param {File} file
 * @returns {string}
 */
function createVideoUrl(file) {
  return URL.createObjectURL(file);
}

/**
 * 创建课程对象
 * @param {object} data
 * @returns {object}
 */
function createCourse(data) {
  return {
    id: uid('course'),
    title: data.title || '未命名课程',
    sourceUrl: data.sourceUrl || '',
    localUrl: data.localUrl || '',
    duration: data.duration || 0,
    bpm: data.bpm || 0,
    thumbColor: generateThumbColor(),
    progress: 0,
    status: 'ready',
    lastPracticed: null,
    createdAt: Date.now(),
  };
}

/**
 * 加载课程列表
 * @returns {object[]}
 */
function loadCourses() {
  return local.get(COURSES_KEY, []);
}

/**
 * 保存课程列表
 * @param {object[]} courses
 */
function saveCourses(courses) {
  local.set(COURSES_KEY, courses);
}

/**
 * 渲染课程列表
 */
function renderCourses() {
  const courses = loadCourses();
  const grid = document.getElementById('coursesGrid');
  const emptyState = document.getElementById('emptyState');
  const countEl = document.getElementById('courseCount');

  if (countEl) {
    countEl.textContent = `${courses.length} 个课程`;
  }

  if (!grid) return;

  if (courses.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  grid.innerHTML = courses.map((course) => `
    <article class="course-card" data-id="${course.id}">
      <div class="course-thumb" style="background: ${course.thumbColor}">
        <div class="play-icon">▶</div>
        ${course.duration ? `<span class="course-duration">${formatTime(course.duration)}</span>` : ''}
      </div>
      <div class="course-body">
        <h3 class="course-title" title="${course.title}">${course.title}</h3>
        <div class="course-meta">
          <span>${course.bpm ? course.bpm + ' BPM' : 'BPM 未检测'}</span>
          <span>·</span>
          <span>${course.lastPracticed ? '最近练习' : '未练习'}</span>
        </div>
        <div class="course-progress">
          <div class="progress-label">
            <span>掌握进度</span>
            <span>${course.progress}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${course.progress}%"></div>
          </div>
        </div>
        <span class="course-status ${course.status === 'completed' ? 'completed' : 'ready'}">
          ${course.status === 'completed' ? '已完成' : '可练习'}
        </span>
      </div>
    </article>
  `).join('');

  // 绑定点击事件
  grid.querySelectorAll('.course-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      window.location.href = `/index.html?course=${id}`;
    });
  });
}

/**
 * 添加课程并保存
 * @param {object} data
 */
function addCourse(data) {
  const courses = loadCourses();
  const course = createCourse(data);
  courses.unshift(course);
  saveCourses(courses);
  renderCourses();
  return course;
}

/**
 * 获取视频时长
 * @param {File} file
 * @returns {Promise<number>}
 */
function getVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => resolve(0);
    video.src = URL.createObjectURL(file);
  });
}

/**
 * 初始化上传区域
 */
function initUpload() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const urlInput = document.getElementById('urlInput');
  const fetchUrlBtn = document.getElementById('fetchUrlBtn');
  const uploadBtn = document.getElementById('uploadBtn');

  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => fileInput?.click());
  }

  if (dropzone) {
    dropzone.addEventListener('click', () => fileInput?.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) await handleFileUpload(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await handleFileUpload(file);
      fileInput.value = '';
    });
  }

  if (fetchUrlBtn) {
    fetchUrlBtn.addEventListener('click', async () => {
      const url = urlInput?.value.trim();
      if (!url) return;
      await handleUrlUpload(url);
      if (urlInput) urlInput.value = '';
    });
  }
}

/**
 * 处理文件上传
 * @param {File} file
 */
async function handleFileUpload(file) {
  if (!file.type.startsWith('video/')) {
    alert('请选择视频文件');
    return;
  }

  const duration = await getVideoDuration(file);
  const localUrl = createVideoUrl(file);

  addCourse({
    title: file.name.replace(/\.[^/.]+$/, ''),
    localUrl,
    duration,
  });
}

/**
 * 处理 URL 上传
 * @param {string} url
 */
async function handleUrlUpload(url) {
  // TODO: 后端抓取后替换为真实 URL
  addCourse({
    title: `链接课程 ${new Date().toLocaleTimeString()}`,
    sourceUrl: url,
    duration: 0,
  });
}

/**
 * 初始化演示课程
 */
function initDemoCourses() {
  const demoCards = document.querySelectorAll('.demo-card');
  demoCards.forEach((card) => {
    card.addEventListener('click', () => {
      addCourse({
        title: '入门练习曲',
        sourceUrl: '',
        duration: 45,
        bpm: 120,
      });
    });
  });
}

/**
 * 初始化主页
 */
export function initHome() {
  renderCourses();
  initUpload();
  initDemoCourses();
}

export default { initHome };
