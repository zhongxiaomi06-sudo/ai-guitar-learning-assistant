/**
 * pages/home.js - 首页
 */

import { $, setHTML } from '../assets/js/utils/dom.js';
import { getInfo } from '../assets/js/core/device.js';
import { formatDate } from '../assets/js/utils/tools.js';

export function render() {
  const info = getInfo();
  const main = $('#main');

  setHTML(main, `
    <section class="page">
      <h2 class="page-title">首页</h2>
      <p class="page-desc mb-md">
        这是一个同时兼容手机端与电脑端的 H5 基础架构示例。下面是当前设备信息：
      </p>

      <div class="info-panel mb-md">
        <div>
          <dt>访问时间</dt>
          <dd>${formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')}</dd>
        </div>
        <div>
          <dt>设备类型</dt>
          <dd>${info.mobile ? '移动端' : '电脑端'}${info.wechat ? ' / 微信' : ''}</dd>
        </div>
        <div>
          <dt>操作系统</dt>
          <dd>${info.ios ? 'iOS' : info.android ? 'Android' : '其他'}</dd>
        </div>
        <div>
          <dt>屏幕尺寸</dt>
          <dd>${info.width} × ${info.height} / DPR ${info.dpr}</dd>
        </div>
        <div>
          <dt>触摸支持</dt>
          <dd>${info.touch ? '支持' : '不支持'}</dd>
        </div>
      </div>

      <div class="text-center">
        <button class="btn btn-primary" id="goList">查看列表</button>
        <button class="btn btn-ghost mt-md" id="goAbout">关于架构</button>
      </div>
    </section>
  `);

  $('#goList').addEventListener('click', () => {
    window.location.hash = '#/list';
  });

  $('#goAbout').addEventListener('click', () => {
    window.location.hash = '#/about';
  });
}

export default { render };
