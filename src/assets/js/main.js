/**
 * main.js - 应用入口
 */

import { $, $$, on, addClass, removeClass, toggleClass } from './utils/dom.js';
import { router } from './core/router.js';
import { initViewport } from './core/viewport.js';
import { isMobile } from './core/device.js';
import { bus } from './core/events.js';
import { local } from './utils/storage.js';
import home from '../../pages/home.js';
import list from '../../pages/list.js';
import about from '../../pages/about.js';

const THEME_KEY = 'app-theme';

/**
 * 初始化导航高亮与移动端菜单
 */
function initNav() {
  const nav = $('#mainNav');
  const menuBtn = $('#menuBtn');
  const links = $$('.app-nav a');

  // 移动端菜单切换
  if (isMobile() && menuBtn) {
    addClass(nav, 'is-hidden');
    on(menuBtn, 'click', () => {
      toggleClass(nav, 'is-open');
      const isOpen = nav.classList.contains('is-open');
      nav.setAttribute('aria-hidden', String(!isOpen));
      menuBtn.setAttribute('aria-expanded', String(isOpen));
    });

    links.forEach((link) => {
      on(link, 'click', () => {
        removeClass(nav, 'is-open');
        nav.setAttribute('aria-hidden', 'true');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // 路由切换时高亮导航
  bus.on('route:change', ({ path }) => {
    links.forEach((link) => {
      const route = link.dataset.route;
      const isActive =
        (route === 'home' && (path === '/' || path === '')) || route === path.slice(1);
      link.classList.toggle('active', isActive);
    });
  });
}

/**
 * 初始化路由
 */
function initRouter() {
  router
    .on('/', home.render)
    .on('/home', home.render)
    .on('/list', list.render)
    .on('/about', about.render)
    .notFound(() => {
      const main = $('#main');
      main.innerHTML = `
        <section class="page text-center">
          <h2 class="page-title">404</h2>
          <p class="page-desc">页面未找到</p>
          <button class="btn btn-primary mt-md" id="backHome">返回首页</button>
        </section>
      `;
      $('#backHome').addEventListener('click', () => {
        window.location.hash = '#/';
      });
    });

  router.start();
}

/**
 * 初始化主题
 */
function initTheme() {
  const savedTheme = local.get(THEME_KEY, 'system');
  about.applyTheme(savedTheme);
}

/**
 * 启动应用
 */
function bootstrap() {
  initViewport();
  initTheme();
  initNav();
  initRouter();

  console.log('[H5] app bootstrapped');
}

bootstrap();
