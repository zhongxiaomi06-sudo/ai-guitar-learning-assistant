/**
 * pages/about.js - 关于页
 */

import { $, setHTML } from '../assets/js/utils/dom.js';
import { local } from '../assets/js/utils/storage.js';

const THEME_KEY = 'app-theme';

export function render() {
  const main = $('#main');
  const currentTheme = local.get(THEME_KEY, 'system');

  setHTML(main, `
    <section class="page">
      <h2 class="page-title">关于架构</h2>
      <p class="page-desc mb-md">
        H5 双端基础架构采用原生 JavaScript + Vite 构建工具，
        不依赖第三方框架，开箱即用，便于二次扩展。
      </p>

      <div class="card mb-md">
        <div class="setting-row">
          <div>
            <div class="setting-label">主题模式</div>
            <div class="setting-desc">跟随系统 / 浅色 / 深色</div>
          </div>
          <select class="btn btn-ghost" id="themeSelect" style="min-width:120px">
            <option value="system" ${currentTheme === 'system' ? 'selected' : ''}>跟随系统</option>
            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>浅色</option>
            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>深色</option>
          </select>
        </div>
      </div>

      <div class="card">
        <h3 class="mb-md">目录结构</h3>
        <pre style="font-family:var(--font-mono);font-size:var(--font-size-sm);overflow:auto">
public/
  index.html          入口页面
src/
  assets/
    css/              样式文件
    js/
      utils/          工具函数
      core/           核心模块
  pages/              页面控制器
        </pre>
      </div>

      <div class="text-center mt-md">
        <button class="btn btn-primary" id="backHome">返回首页</button>
      </div>
    </section>
  `);

  $('#themeSelect').addEventListener('change', (e) => {
    const theme = e.target.value;
    local.set(THEME_KEY, theme);
    applyTheme(theme);
  });

  $('#backHome').addEventListener('click', () => {
    window.location.hash = '#/';
  });
}

/**
 * 应用主题
 * @param {string} theme
 */
export function applyTheme(theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export default { render, applyTheme };
