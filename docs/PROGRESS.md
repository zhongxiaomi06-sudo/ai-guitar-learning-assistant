# 吉他 AI 跟弹系统 — 项目进度

> 项目目标：让用户能够跟着指定视频把吉他谱“弹出来”，而非完整学习乐理。
>
> 后端起步方案见 `BACKEND_START.md`。

## 相关文档

- `PROJECT.md`：项目完整产品文档，包含产品细节、数据模型、验收标准与实施计划。
- `BACKEND_START.md`：后端最小可行起步方案。
- `../TECHNICAL_RESEARCH.md`：完整技术栈调研与 AI pipeline 架构。
- `AUDIO_TO_TAB_PIPELINE.md`：音频 → 六线谱具体实现步骤。
- `../CLAUDE.md`：原始 PRD 参考。

## 当前状态

**阶段**：艺术化单页原型与 FastAPI MVP 已合并到同一仓库。默认入口仍是 `index.html` → `src/product-app.js`；课程 API、真实媒体与音频检测正在渐进接入，内置分析和部分反馈仍是演示数据。

**技术栈**：前端 Vite + 原生 JavaScript；后端 FastAPI + SQLAlchemy；存储支持本地文件系统与 MinIO。

**基础构建工具**：Vite（前端）、Uvicorn（后端）。

**最近更新**：2026-07-21 — 合并 GitHub 后端/音频实现与本地艺术化前端，修正冲突和文档边界。

## 项目定位

- 核心：视频 + 动态乐谱 + 音游/KTV 匹配 + 实时建议，五面板同屏。
- 不教乐理，不评价手型，只关注“声音是否弹对”。
- AI 自动扒谱暂时搁置，MVP 使用人工导入 Tab/MIDI 作为占位数据。
- 手部动作不通过 AI 识别，直接基于谱面生成手型示意图。

## MVP 范围

1. 一个指定视频（DEMO 视频）的完整处理 pipeline。
2. 视频播放、乐谱展示、匹配 UI、实时建议、用户设置五面板。
3. 基于音频相似性（Onset + DTW）的视频-谱面对齐。
4. 实时麦克风采集 + 音高/节奏比对。
5. 错误反馈、自动降速、难点循环、逐步恢复速度。
6. 基于谱面的左手按弦/右手拨弦示意图。

## 技术架构（暂定）

```
guitar/
├── docs/                    # 文档
│   ├── PROGRESS.md          # 本文件
│   └── PRD.md               # 产品需求/技术方案
├── public/                  # 静态资源
├── src/
│   ├── product-app.js       # 当前艺术化单页入口
│   ├── main.js              # 过渡期五面板入口，未被默认 HTML 引用
│   ├── home.js              # 过渡期课程 API 页面逻辑
│   ├── app.js               # 五面板应用壳
│   ├── assets/              # 样式、图片、字体
│   │   ├── css/
│   │   └── images/
│   ├── core/                # 核心逻辑（框架无关）
│   │   ├── audio/           # 音频处理、音高检测、播放
│   │   ├── video/           # 视频抓取、播放、同步
│   │   ├── score/           # 谱面模型、渲染、手型生成
│   │   ├── matching/        # 匹配引擎、打分、反馈
│   │   └── practice/        # 练习会话、调速、循环
│   ├── features/            # UI 功能模块
│   │   ├── videoPanel/      # 视频面板
│   │   ├── scorePanel/      # 乐谱面板
│   │   ├── matchingPanel/   # 匹配 UI 面板
│   │   ├── suggestionsPanel/# 建议面板
│   │   └── settingsPanel/   # 设置面板
│   ├── shared/                # 共享资源
│   │   ├── types/           # JSDoc/类型定义
│   │   ├── utils/           # 工具函数
│   │   └── constants/       # 常量
│   └── pages/               # 早期页面模块，过渡期保留
├── backend/                 # FastAPI、数据库与存储服务
├── index.html               # 默认入口 HTML
└── home.html                # 兼容入口，跳转到 index.html#/home
```

## 已完成的任务

- [x] 项目目标与需求确认（弹出来而非学会）
- [x] 艺术化单页 UI：创建、解析、概览、跟练、专项练习、结果与课程库
- [x] 暖纸/夜间主题、响应式布局和基础无障碍交互
- [x] 数据模型与前端核心模块拆分（音频、视频、谱面、匹配、练习）
- [x] Vite + ESLint 基础工程环境搭建
- [x] 本地 MP4/MOV 选择、校验、预览与自定义播放控制
- [x] Web Audio / YIN 音高检测基础实现
- [x] 后端第一步：FastAPI 最小 API（课程上传/列表/详情/视频/谱面）
- [x] 后端本地 SQLite + 本地文件存储（可切换 PostgreSQL + MinIO）
- [x] 后端 Docker Compose、Dockerfile 与环境变量示例
- [x] 前端后端 API 客户端
- [x] 技术调研、产品文档与音频转谱方案

## 待办

- [ ] 完成艺术化默认入口与课程 API 的上传、恢复和错误降级闭环
- [ ] 将谱面数据真正驱动音游模式音符生成
- [ ] 整合 `product-app.js`、`app.js` 与 `ui-demo.js`，收敛过渡期实现
- [ ] 将实时音高检测与目标谱面、视频时间轴对齐
- [ ] 自适应练习策略（调速/循环）完整实现
- [ ] 后端异步解析流水线（FFmpeg + Basic Pitch）
- [ ] 清点并处理 `src/pages`、`src/assets/js`、`rhythm-demo.html` 等过渡文件

## 未决事项

1. 视频自动抓取的法律/合规方案（当前仅支持本地上传，URL 仅记录不下载）。
2. AI 扒谱技术栈调研结论（Basic Pitch 已作为候选，需在 Python 3.10 环境验证）。

## 下一步

1. 稳定艺术化单页与后端课程/媒体 API 的真实链路，并保留无后端时的清晰降级。
2. 将谱面数据接入跟练视图，用真实目标事件替代演示数据。
3. 收敛 `product-app.js`、`app.js` 与 `ui-demo.js` 的重复职责。
4. 实现视频、谱面与麦克风检测的统一时间轴，再推进评分和自适应练习。

## 备注

- 基础架构采用 ES Modules，保持与 Vite 兼容。
- 所有核心模块先写 JSDoc 类型和接口，待技术栈确定后再完整实现。
- 不提前引入重型 AI 或 CV 库，避免技术栈锁定。
- `PROJECT.md` 是当前项目执行的完整基准文档。
- 示例媒体和谱面不属于仓库的可复现资产；若使用本地 `backend/storage/` 数据，需要按 `BACKEND_START.md` 自行准备，并遵守来源平台的版权与使用条款。
