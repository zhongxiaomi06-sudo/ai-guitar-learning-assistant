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

**阶段**：艺术化默认入口、FastAPI 课程 API 与音频 → 六线谱 MVP 已合并到同一仓库。前后端 API 已验证连通（CORS、上传、视频/谱面读取、异步解析排队）。当前最大缺口是后端 Score JSON 尚未驱动跟练音符与评分，仓库内仍有多套过渡期前端。

**技术栈**：前端 Vite + 原生 JavaScript；后端 FastAPI + SQLAlchemy；存储支持本地文件系统与 MinIO；转谱运行时为 Python 3.11 + FFmpeg + Basic Pitch 包默认模型（ONNX 路径，已绕过 TensorFlow 依赖）。

**基础构建工具**：Vite（前端）、Uvicorn（后端）。

**最近更新**：2026-07-21 — 完成合并后检查：134 后端测试 + 15 前端测试通过，前后端开发服务器可正常通信，修复 Basic Pitch 依赖安装问题，并补充文档。

## 项目定位

- 核心：视频 + 动态乐谱 + 音游/KTV 匹配 + 实时建议，五面板同屏。
- 不教乐理，不评价手型，只关注“声音是否弹对”。
- AI 自动转谱已有可运行的 MVP，但输出仍需人工校验与后续编辑能力，不能视为生产级准确谱面。
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
- [x] 后端解析流水线服务（`transcription.py` / `tab_solver.py` / `score_builder.py` / `audio_pipeline.py`）
- [x] 本地命令行脚本 `scripts/run_pipeline.py` 与 Canonical Score JSON 输出
- [x] 上传后触发后台解析、轮询进度与错误状态的 MVP 链路
- [x] 合并碎音符并优化可演奏弦品路径求解
- [x] 合并 agent audit fixes 分支（CI、测试、产品化前端、后端增强）
- [x] 修复 Basic Pitch 依赖安装问题（Python 3.11+ 绕过 TensorFlow）
- [x] 验证前后端开发服务器 API 连通性（CORS、课程列表、视频、谱面、解析排队）
- [x] 134 后端测试 + 15 前端测试全部通过

## 待办

- [ ] 用真实媒体做端到端稳定性、失败重试与谱面质量验收
- [ ] 将谱面数据真正驱动音游模式音符生成
- [ ] 整合 `product-app.js`、`app.js` 与 `ui-demo.js`，收敛过渡期实现
- [ ] 将实时音高检测与目标谱面、视频时间轴对齐
- [ ] 自适应练习策略（调速/循环）完整实现
- [ ] 清点并处理 `src/pages`、`src/assets/js`、`rhythm-demo.html` 等过渡文件
- [ ] 用 Celery/Redis 等持久任务队列替换进程内 `BackgroundTasks`

## 未决事项

1. 视频自动抓取的法律/合规方案（当前仅支持本地上传，URL 仅记录不下载）。
2. 当前通过 Basic Pitch 包默认模型完成音符转录，并未固定为 ONNX-only；单声道吉他弹唱若需人声/伴奏分离，可后续评估 Demucs/Spleeter。

## 下一步

1. 将后端生成的 Score JSON 接入跟练模式，用真实目标事件替换演示音符。
2. 用真实媒体验收上传、解析、轮询、失败重试和课程恢复链路。
3. 收敛 `product-app.js`、`app.js` 与 `ui-demo.js` 的重复职责。
4. 实现视频、谱面与麦克风检测的统一时间轴，再推进评分和自适应练习。

## 备注

- 基础架构采用 ES Modules，保持与 Vite 兼容。
- 所有核心模块先写 JSDoc 类型和接口，待技术栈确定后再完整实现。
- 重型 AI/CV 依赖保持在后端流水线边界内，避免污染前端和普通 API 启动路径。
- `PROJECT.md` 是当前项目执行的完整基准文档。
- 示例媒体和谱面不属于仓库的可复现资产；若使用本地 `backend/storage/` 数据，需要按 `BACKEND_START.md` 自行准备，并遵守来源平台的版权与使用条款。
