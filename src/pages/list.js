/**
 * pages/list.js - 列表页
 */

import { $, setHTML } from '../assets/js/utils/dom.js';

const items = [
  { id: 1, title: '响应式布局', desc: '基于 CSS 媒体查询，一套代码适配手机与电脑。', tag: 'CSS' },
  { id: 2, title: '设备检测', desc: '通过 UA 与 API 判断移动端、桌面端、微信等环境。', tag: 'JS' },
  { id: 3, title: '视口适配', desc: '移动端使用 rem 动态缩放，电脑端保持原生 px。', tag: 'Viewport' },
  { id: 4, title: 'Hash 路由', desc: '轻量级前端路由，无需后端配合即可切换页面。', tag: 'Router' },
  { id: 5, title: '事件总线', desc: '发布订阅模式，实现模块间解耦通信。', tag: 'Events' },
  { id: 6, title: '本地存储', desc: 'localStorage/sessionStorage 的安全封装。', tag: 'Storage' },
];

export function render() {
  const main = $('#main');

  setHTML(main, `
    <section class="page">
      <h2 class="page-title">功能列表</h2>
      <p class="page-desc mb-md">本架构内置的常用模块与能力说明。</p>
      <div class="list-grid">
        ${items.map((item) => `
          <article class="list-item">
            <div>
              <span class="badge">${item.tag}</span>
            </div>
            <h3>${item.title}</h3>
            <p>${item.desc}</p>
          </article>
        `).join('')}
      </div>
      <div class="text-center mt-md">
        <button class="btn btn-ghost" id="backHome">返回首页</button>
      </div>
    </section>
  `);

  $('#backHome').addEventListener('click', () => {
    window.location.hash = '#/';
  });
}

export default { render };
