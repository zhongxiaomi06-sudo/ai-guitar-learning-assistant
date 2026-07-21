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

**阶段**：艺术化默认入口、FastAPI 课程 API 与音频 → 六线谱 MVP 已合并到同一仓库。后端已补齐时间轴、片段、练习结果、输入质检等 API，前后端可通信。当前优先级是完成后端 P0 可用性项（稳定性、自动 BPM、薄弱小节、片段状态），再让前端用真实时间轴驱动跟练。

**技术栈**：前端 Vite + 原生 JavaScript；后端 FastAPI + SQLAlchemy；存储支持本地文件系统与 MinIO；转谱运行时为 Python 3.11 + FFmpeg + Basic Pitch 包默认模型（ONNX 路径，已绕过 TensorFlow 依赖）。

**基础构建工具**：Vite（前端）、Uvicorn（后端）。

**最近更新**：2026-07-21 — 重新梳理全部待办为 P0/P1/P2，聚焦 DEMO 可用性闭环。

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
- [x] 统一时间轴 API：`GET /api/v1/courses/{id}/timeline` 输出事件级视频/音频时间、弦品、手型
- [x] 练习片段自动生成：`GET /api/v1/courses/{id}/segments` 拆分片段并给出达标条件
- [x] 练习结果存储 API：`POST /api/v1/practice/results` + 查询 + 汇总统计
- [x] 视频音频输入质量检查：`POST /api/v1/courses/{id}/quality`
- [x] 146 后端测试 + 15 前端测试全部通过

## 待办（P0/P1/P2 优先级）

> P0：影响当前 DEMO 可用性与完整性的最小闭环，必须优先完成。  
> P1：提升体验或生产稳定性，可在 P0 之后做。  
> P2：更优/未来功能，可推后。

### P0 — 当前 DEMO 必须完成

- [ ] **后端：解析流水线稳定性与质量验收**
  - 用多段真实媒体跑通上传 → 解析 → 轮询 → 出谱。
  - 解析失败自动重试（FFmpeg / Basic Pitch 偶发失败）。
  - 自动判定输出谱面是否可用（音符数、把位合理性、时长匹配）。
  - 低质量谱面返回降级状态，而不是直接标记 `ready`。
- [ ] **后端：音频输入质量检查增强**
  - 无音轨/静音检测并阻止解析。
  - 音量过低/过高提示。
  - 视频时长过短/过长检测。
- [ ] **后端：从音频自动检测 BPM 与拍号**
  - 当前 `parse` 依赖调用方传入 BPM，DEMO 应自动检测或合理默认。
  - 至少支持 4/4、3/4、2/4 的拍号推断。
- [ ] **后端：练习结果聚合 → 薄弱小节 API**
  - 基于 `practice_results` 按小节/片段统计错误类型。
  - 返回 `GET /api/v1/courses/{id}/weak-spots`。
- [ ] **后端：练习片段状态持久化**
  - 支持 `POST /api/v1/courses/{id}/segments/{segment_id}/progress` 更新状态。
  - 保存 `locked / practicing / passed` 到数据库或课程 `metadata_json`。
- [ ] **前端：默认入口接入真实后端时间轴**
  - `product-app.js` 用 `GET /api/v1/courses/{id}/timeline` 驱动跟练音符。
  - 用 `GET /api/v1/courses/{id}/segments` 展示练习片段。

### P1 — 体验与生产稳定性

- [ ] **后端：用 Celery/Redis 替换 `BackgroundTasks`**
  - 解析任务持久化，服务端重启后可恢复。
- [ ] **后端：更合理的手型与和弦生成**
  - `timeline` 中的手型目前只是单音单指，需要真实和弦手型、保留指、换把提示。
- [ ] **后端：URL 自动下载**
  - 集成 yt-dlp / you-get，但需先明确法律与合规方案。
- [ ] **前端：实时音高检测与目标谱面对齐**
  - 用 Web Audio YIN 输出与 timeline 事件比对，给出正确/错音/漏音/节奏偏差。
- [ ] **前端：自适应调速/循环**
  - 根据薄弱小节自动降速、拆句、循环，达标后提速。

### P2 — 更优/未来

- [ ] **后端：音频源分离（Demucs/Spleeter）**
  - 处理人声/伴奏混合视频，提高转谱准确度。
- [ ] **后端：视觉质量检查**
  - 检测画面模糊、过暗、抖动、左右手可见度。
- [ ] **后端：用户/会话体系**
  - 跨设备保存课程、进度、最佳成绩。
- [ ] **后端：人工谱面编辑器支持**
  - 修正 pipeline 输出的音高、把位、时间轴。
- [ ] **工程：清理过渡期前端文件**
  - 收敛或删除 `src/pages`、`src/assets/js`、`rhythm-demo.html` 等旧实现。

## 下一步

1. 完成后端 P0 项：解析稳定性、输入质检、BPM/拍号检测、薄弱小节/片段状态。
2. 然后前端用后端时间轴驱动真实音符，完成“上传 → 解析 → 跟练 → 纠错 → 重练”闭环。
3. 最后再做 P1 的生产任务队列与手型优化。

## 备注

- 基础架构采用 ES Modules，保持与 Vite 兼容。
- 所有核心模块先写 JSDoc 类型和接口，待技术栈确定后再完整实现。
- 重型 AI/CV 依赖保持在后端流水线边界内，避免污染前端和普通 API 启动路径。
- `PROJECT.md` 是当前项目执行的完整基准文档。
- 示例媒体和谱面不属于仓库的可复现资产；若使用本地 `backend/storage/` 数据，需要按 `BACKEND_START.md` 自行准备，并遵守来源平台的版权与使用条款。
