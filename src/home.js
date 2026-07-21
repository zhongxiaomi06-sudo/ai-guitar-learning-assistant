/**
 * home.js
 * 个人主页：上传视频、URL 抓取、演示课程、后端 API 课程列表
 */

import { courses as api } from './shared/utils/api.js';
import { formatTime } from './shared/utils/index.js';

const DEMO_COURSE_ID = '';

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
 * 渲染课程列表
 */
async function renderCourses() {
  const grid = document.getElementById('coursesGrid');
  const emptyState = document.getElementById('emptyState');
  const countEl = document.getElementById('courseCount');

  if (!grid) return;

  try {
    const courses = await api.list();

    if (countEl) {
      countEl.textContent = `${courses.length} 个课程`;
    }

    if (courses.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    grid.innerHTML = courses.map((course) => `
      <article class="course-card" data-id="${course.id}">
        <div class="course-thumb" style="background: ${generateThumbColor()}">
          <div class="play-icon">▶</div>
          ${course.duration ? `<span class="course-duration">${formatTime(course.duration)}</span>` : ''}
        </div>
        <div class="course-body">
          <h3 class="course-title" title="${course.title}">${course.title}</h3>
          <div class="course-meta">
            <span>${course.bpm ? course.bpm + ' BPM' : 'BPM 未检测'}</span>
            <span>·</span>
            <span>${course.status === 'ready' ? '可练习' : '处理中'}</span>
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

    grid.querySelectorAll('.course-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        window.location.href = `/index.html?course=${id}`;
      });
    });
  } catch (err) {
    console.error('[Home] failed to load courses', err);
    if (emptyState) {
      emptyState.style.display = 'flex';
      emptyState.textContent = '加载课程失败，请确认后端服务已启动';
    }
  }
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

  try {
    const title = file.name.replace(/\.[^/.]+$/, '');
    const course = await api.upload(file, title);
    window.location.href = `/index.html?course=${course.id}`;
  } catch (err) {
    console.error('[Home] upload failed', err);
    alert('上传失败：' + err.message);
  }
}

/**
 * 处理 URL 上传
 * @param {string} url
 */
async function handleUrlUpload(url) {
  try {
    const course = await api.fromUrl(url, `链接课程 ${new Date().toLocaleTimeString()}`);
    window.location.href = `/index.html?course=${course.id}`;
  } catch (err) {
    console.error('[Home] URL upload failed', err);
    alert('URL 提交失败：' + err.message);
  }
}

/**
 * 初始化演示课程
 */
function initDemoCourses() {
  const demoCards = document.querySelectorAll('.demo-card');
  demoCards.forEach((card) => {
    card.addEventListener('click', async () => {
      if (DEMO_COURSE_ID) {
        window.location.href = `/index.html?course=${DEMO_COURSE_ID}`;
        return;
      }
      try {
        const courses = await api.list();
        if (courses.length > 0) {
          window.location.href = `/index.html?course=${courses[0].id}`;
        } else {
          alert('暂无演示课程，请先上传视频');
        }
      } catch (err) {
        alert('加载演示课程失败');
      }
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
