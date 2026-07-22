# 吉他 AI 跟弹系统 — 项目进度

> 项目目标：让用户能够跟着指定视频把吉他谱“弹出来”，而非完整学习乐理。
>
> 后端起步方案见 `BACKEND_START.md`。

## 相关文档

- `PROJECT.md`：项目完整产品文档，包含产品细节、数据模型、验收标准与实施计划。
- `p0-gaps.md`：当前 P0 关键缺口清单与修复顺序。
- `midi-user-simulation.md`：无实机情况下的 MIDI 用户模拟验证流程。
- `voice-control-build.md`：语音控制功能架构文档（百度 ASR + LLM 命令解析）。
- `BACKEND_START.md`：后端最小可行起步方案。
- `../TECHNICAL_RESEARCH.md`：完整技术栈调研与 AI pipeline 架构。
- `AUDIO_TO_TAB_PIPELINE.md`：音频 → 六线谱具体实现步骤。
- `../CLAUDE.md`：原始 PRD 参考。

## 当前状态

**阶段**：后端 P0 可用性项已完成并保持稳定：解析流水线具备输入质检、自动 BPM/拍号、失败重试、谱面质量验收；时间轴、片段、练习结果、薄弱小节、片段状态 API 均已可用。已合并 agent 分支的边界加固与产品前端，并修复合并中的后端 P0 兼容性冲突。前端默认入口由用户并行完善中。

**技术栈**：前端 Vite + 原生 JavaScript；后端 FastAPI + SQLAlchemy；存储支持本地文件系统与 MinIO；转谱运行时为 Python 3.12 + FFmpeg + Basic Pitch 包默认模型（ONNX 路径，已绕过 TensorFlow 依赖）。

**基础构建工具**：Vite（前端）、Uvicorn（后端）。

**最近更新**：2026-07-22 — 完成 P0 缺口 1–8：前端默认入口接入后端时间轴/片段/练习结果；实时匹配引擎接入播放循环并自动触发专项纠错；`FocusStateMachine` 驱动观看→倒数→聆听→分析→升降速/通过状态机；纠错提示按错误类型生成、对比卡用真实前后数据；后端 `get_av_offset` 检测 A/V 偏移并区分 `videoTime`/`audioTime`；`MicCalibrator` 做环境噪声自适应阈值与输入延迟补偿；`timeline.py` 增加横按/保留指/换把提示并驱动前端双手特写。新增 52 前端测试 + 161 后端测试（2 个 `soundfile` 缺失导致的环境性失败除外）。

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
- [x] 解析流水线自动 BPM/拍号检测、输入质量门、解析重试与谱面质量验收
- [x] 练习薄弱小节聚合：`GET /api/v1/practice/weak-spots/{course_id}`
- [x] 练习片段状态持久化：`POST /api/v1/courses/{id}/segments/{segment_id}/progress`
- [x] 149 后端测试 + 15 前端测试全部通过
- [x] 语音控制功能：前端推按式录音（MediaRecorder）+ 后端百度 ASR 转写 + DeepSeek LLM 命令解析 + fallback 关键词匹配
- [x] 前端默认入口接入真实后端时间轴（`p0-gaps` 缺口 1）
- [x] 实时匹配引擎接入播放循环并自动触发专项纠错（缺口 2）
- [x] 练习结果提交 + 课程库用 summary/weak-spots 驱动进度（缺口 3）
- [x] 纠错模式按错误类型生成提示、对比卡用真实前后数据、移除硬编码循环（缺口 4）
- [x] `FocusStateMachine` 显式状态机驱动纠错流转（缺口 8）
- [x] 后端 A/V 偏移检测，`videoTime`/`audioTime` 分离，前端按视频时钟定位（缺口 6）
- [x] `MicCalibrator` 环境噪声自适应阈值 + 输入延迟补偿 + 设备告警（缺口 7）
- [x] `timeline.py` 横按/保留指/换把提示，前端 `renderHandStack` 实时刷新双手特写（缺口 5）

## 待办（P0/P1/P2 优先级）

> P0：影响当前 DEMO 可用性与完整性的最小闭环，必须优先完成。  
> P1：提升体验或生产稳定性，可在 P0 之后做。  
> P2：更优/未来功能，可推后。

### P0 — 当前 DEMO 必须完成

- [x] **后端：解析流水线稳定性与质量验收**
  - 用多段真实媒体跑通上传 → 解析 → 轮询 → 出谱。
  - 解析失败自动重试（FFmpeg / Basic Pitch 偶发失败）。
  - 自动判定输出谱面是否可用（音符数、把位合理性、时长匹配）。
  - 低质量谱面返回降级状态，而不是直接标记 `ready`。
- [x] **后端：音频输入质量检查增强**
  - 无音轨/静音检测并阻止解析。
  - 音量过低/过高提示。
  - 视频时长过短/过长检测。
- [x] **后端：从音频自动检测 BPM 与拍号**
  - 当前 `parse` 依赖调用方传入 BPM，DEMO 应自动检测或合理默认。
  - 至少支持 4/4、3/4、2/4 的拍号推断。
- [x] **后端：练习结果聚合 → 薄弱小节 API**
  - 基于 `practice_results` 按小节/片段统计错误类型。
  - 返回 `GET /api/v1/courses/{id}/weak-spots`。
- [x] **后端：练习片段状态持久化**
  - 支持 `POST /api/v1/courses/{id}/segments/{segment_id}/progress` 更新状态。
  - 保存 `locked / practicing / passed` 到数据库或课程 `metadata_json`。
- [x] **前端：默认入口接入真实后端时间轴**
  - `product-app.js` 用 `GET /api/v1/courses/{id}/timeline` 驱动跟练音符。
  - 用 `GET /api/v1/courses/{id}/segments` 展示练习片段。
  - 用 `GET /api/v1/practice/summary` / `weak-spots` 驱动课程库进度。
- [x] **前端：实时匹配 + 纠错状态机**
  - `playerFrame` 调用 `MatchingEngine.match`，连续错误自动进入专项纠错。
  - `FocusStateMachine` 驱动观看→倒数→聆听→分析→升降速/通过，对比卡用真实前后数据。
- [x] **后端：A/V 对齐 + 麦克风校准 + 手型提示**
  - `get_av_offset` 检测音视频偏移，`videoTime`/`audioTime` 分离。
  - `MicCalibrator` 自适应 onset 阈值与输入延迟补偿。
  - `timeline` 增加横按、保留指、换把提示，前端双手特写实时渲染。

### P1 — 体验与生产稳定性

- [ ] **后端：用 Celery/Redis 替换 `BackgroundTasks`**
  - 解析任务持久化，服务端重启后可恢复。
- [ ] **后端：URL 自动下载**
  - 集成 yt-dlp / you-get，但需先明确法律与合规方案。

### P2 — 更优/未来

- [ ] **后端：音频源分离（Demucs/Spleeter）**
  - 处理人声/伴奏混合视频，提高转谱准确度。
- [ ] **后端：视觉质量检查**
  - 检测画面模糊、过暗、抖动、左右手可见度。
- [ ] **后端：用户/会话体系**
  - 跨设备保存课程、进度、最佳成绩。
- [ ] **后端：人工谱面编辑器支持**
  - 修正 pipeline 输出的音高、把位、时间轴。
- [x] **工程：清理过渡期前端文件**
  - 已删除 `src/pages`、`src/assets/js`、`src/main.js`、`src/home.js`、`src/app.js`、`src/ui-demo.js` 等旧实现；`docs/superpowers/plans` 旧规划文档已清理。当前唯一默认入口为 `index.html` → `src/product-app.js`。

## 下一步

1. 端到端验证：上传 → 解析 → 谱面 → 时间轴 → 跟练 → 错误反馈 → 循环/降速 → 完成页（缺口 1–8 已就位）。
2. 处理 `p0-gaps` 剩余项：缺口 9（精修演示数据指纹命中）、缺口 10（移动端响应式收尾）。
3. 然后处理 P1：生产任务队列（Celery/Redis）、URL 自动下载的合规方案。
4. 补充 `soundfile` 依赖以恢复音频质量检查测试。

## 备注

- 基础架构采用 ES Modules，保持与 Vite 兼容。
- 所有核心模块先写 JSDoc 类型和接口，待技术栈确定后再完整实现。
- 重型 AI/CV 依赖保持在后端流水线边界内，避免污染前端和普通 API 启动路径。
- `PROJECT.md` 是当前项目执行的完整基准文档。
- 示例媒体和谱面不属于仓库的可复现资产；若使用本地 `backend/storage/` 数据，需要按 `BACKEND_START.md` 自行准备，并遵守来源平台的版权与使用条款。
