# 吉他 AI 跟弹系统 — 项目进度

> 项目目标：让用户能够跟着指定视频把吉他谱“弹出来”，而非完整学习乐理。
> 
> 新增：后端起步方案见 `docs/BACKEND_START.md`。

## 相关文档

- `docs/PROJECT.md`：项目完整产品文档，包含所有产品细节、数据模型、验收标准与实施计划。
- `docs/BACKEND_START.md`：后端最小可行起步方案，含技术栈、阶段划分、第一个可执行命令。
- `docs/TECHNICAL_RESEARCH.md`：完整技术栈调研与 AI pipeline 架构。
- `docs/AUDIO_TO_TAB_PIPELINE.md`：音频 → 六线谱具体实现步骤。
- `CLAUDE.md`：原始 PRD 参考。

## 当前状态

**阶段**：后端音频 → 六线谱流水线已跑通并输出合理 Score JSON；当前最大 Gap 是谱面数据尚未驱动音游模式，存在 `app.js` 与 `ui-demo.js` 两套并行前端系统
**技术栈**：前端 Vite + 原生 JS；后端 FastAPI + SQLAlchemy + 本地文件存储；Python 3.12 + Basic Pitch ONNX
**基础构建工具**：Vite（前端）、Uvicorn（后端）
**最近更新**：2026-07-21 — 修复音频流水线碎音符与弦品求解，输出 18 小节/234 音符的演示谱面。

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
│   ├── main.js              # 应用入口
│   ├── app.js               # 应用壳
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
│   └── pages/                 # 页面级组件
└── index.html                 # 入口 HTML
```

## 已完成的任务

- [x] 项目目标与需求确认（弹出来而非学会）
- [x] 五面板 UI 设计
- [x] 数据模型设计（Project/Bar/Beat/Note/HandShape/Session）
- [x] 系统流程与模块拆分
- [x] Vite + ESLint 基础工程环境搭建
- [x] 基础项目目录与文件架构建立
- [x] 核心模块占位代码（音频、视频、谱面、匹配、练习）
- [x] 入口页面与五面板页面骨架
- [x] `PROJECT.md` 完整产品文档编写
- [x] `PROGRESS.md` 实时更新
- [x] 执行页：16:9 视频 + 窄边栏流动六线谱 + 手型图
- [x] 执行页音游模式改为右→左流动，默认流速降低
- [x] 执行页音游模式与独立音游模拟效果一致，并已合并清理
- [x] 加入判定偏移量设置（-150ms ~ +150ms）
- [x] 音游模式判定改为麦克风音频输入（YIN 音高检测），键盘仅作调试开关
- [x] 设置区改为可折叠悬浮窗
- [x] 个人主页：本地上传、URL 抓取、演示课程
- [x] 主页与执行页导航联动（通过 `?course=ID` 传参）
- [x] `README.md` 前端说明文档
- [x] 本地 Git 初始化并提交
- [x] 推送到 GitHub 仓库
- [x] 清理旧 H5 架构目录（`src/components`、`src/pages`、`src/assets/js`）
- [x] 删除独立音游模拟 `rhythm-demo.html`，能力合并到执行页
- [x] 后端第一步：FastAPI 最小 API（课程上传/列表/详情/视频/谱面）
- [x] 后端本地 SQLite + 本地文件存储（可切换 PostgreSQL + MinIO）
- [x] 后端 docker-compose.yml 与 Dockerfile
- [x] 下载 Bilibili 演示视频并裁剪为 60 秒
- [x] 为演示视频生成 demo_score.json（手工和弦谱面）
- [x] 上传演示视频与谱面到后端 API
- [x] 前端从后端 API 加载课程（替代 localStorage）
- [x] 移除未使用的 localStorage 工具与同步模块

## 待办

- [x] 后端解析流水线服务（`transcription.py` / `tab_solver.py` / `score_builder.py` / `audio_pipeline.py`）
- [x] 本地命令行脚本 `scripts/run_pipeline.py` 跑通 Bilibili 演示视频
- [x] 流水线输出 Canonical Score JSON（18 小节 / 234 音符 / 品 0–11）
- [x] 合并同音高碎音符、同弦同品重叠音符，减少重复检测
- [x] 优化 DP 弦品求解代价函数，避免高把位大跳
- [x] 更新 `docs/AUDIO_TO_TAB_PIPELINE.md` 为当前 Python 实现
- [ ] 将谱面数据真正驱动音游模式音符生成
- [ ] 整合 `app.js` 与 `ui-demo.js`，消除两套并行前端系统
- [ ] 实时音高检测与谱面对齐
- [ ] 自适应练习策略（调速/循环）完整实现
- [ ] 后端异步任务队列（Celery）接入流水线

## 未决事项

1. 视频自动抓取的法律/合规方案（当前仅支持本地上传，URL 仅记录不下载）。
2. AI 扒谱技术栈已确定为 Basic Pitch ONNX；当前为单声道吉他弹唱，后续如需人声/伴奏分离可引入 Demucs/Spleeter。

## 下一步

1. 将后端生成的 Score JSON 接入音游模式，用真实音符替换随机生成。
2. 整合 `app.js` 与 `ui-demo.js`，让正式架构驱动 UI。
3. 实现视频-谱面时间轴对齐与播放光标同步。
4. 按 `PROJECT.md` 第 12 节 P0 优先级推进路演闭环。

## 备注

- 基础架构采用 ES Modules，保持与 Vite 兼容。
- 所有核心模块先写 JSDoc 类型和接口，待技术栈确定后再完整实现。
- 不提前引入重型 AI 或 CV 库，避免技术栈锁定。
- `PROJECT.md` 是当前项目执行的完整基准文档。
- Bilibili 演示视频与 `demo_score.json` 仅保存在本地 `backend/storage/`（已被 `.gitignore` 排除），不在 Git 仓库中。首次 clone 后需按 `docs/BACKEND_START.md` 重新生成或从 Bilibili 下载。
