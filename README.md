# 弦间 · AI 吉他陪练

> 一个以艺术化单页界面呈现“视频 → 课程 → 跟练”流程的 MVP。前端使用 Vite + 原生 JavaScript，仓库同时包含正在渐进接入的 FastAPI 后端。

---

## 项目定位

**前端核心能力**：让用户能够跟着吉他教学视频把谱子弹出来。

- 不教乐理，只关注声音结果是否弹对。
- 默认页面覆盖视频导入、解析演示、课程概览、同步跟练、专项纠错、结果与课程库。
- 后端提供课程、视频和谱面 API；艺术化入口已接入上传、课程库、视频和可用谱面，后端离线时仍可使用本地演示。
- `localStorage` 只保存主题、标题和播放位置等界面偏好，不作为课程或媒体的权威数据源。

---

### 当前阶段

- `index.html` 是默认产品入口，由 `src/product-app.js` 驱动，并通过 `#/home` 等哈希路由切换完整流程。
- `home.html` 仅负责兼容旧地址并重定向到艺术化单页首页。
- 后端已经具备课程 CRUD、视频上传/读取、谱面 JSON 与解析触发接口；默认入口会展示并轮询真实后端状态，不会把等待中的任务误报为解析完成。
- Web Audio / YIN 音高检测已经接入默认跟练页，可显示实时音高；目标谱面评分和纠错闭环尚未完成。
- FFmpeg + Basic Pitch 音频转谱 MVP 已接入上传流程，可生成 Canonical Score JSON；模型输出仍需人工校验，且尚未接入持久任务队列，不能视为生产级自动扒谱。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端构建 | Vite 5 |
| 前端语言 | 原生 JavaScript（ES Modules） |
| 前端样式 | 原生 CSS + CSS 变量 |
| 后端框架 | FastAPI + Python 3.12 |
| 后端数据库 | SQLite（本地开发）/ PostgreSQL（Docker） |
| 后端存储 | 本地文件系统 / MinIO |
| 音频处理 | FFmpeg + Basic Pitch（后端转谱）/ Web Audio API（前端 YIN） |
| 部署 | Docker Compose（可选） |


---

## 目录结构

```
.
├── docs/                      # 产品、技术、进度与测试方案文档
├── backend/                   # FastAPI 后端与音频转谱流水线
│   ├── app/
│   │   ├── main.py            # API 入口
│   │   ├── api/               # 路由
│   │   ├── models/            # SQLAlchemy 模型
│   │   ├── schemas/           # Pydantic 模型
│   │   ├── services/          # 存储、转录、弦品求解与谱面构建
│   │   └── tasks/             # 进程内后台解析任务（MVP）
│   ├── scripts/               # 本地演示与辅助脚本
│   ├── docker-compose.yml     # PostgreSQL + Redis + MinIO
│   ├── Dockerfile
│   └── requirements.txt
├── src/
│   ├── product-app.js         # 当前艺术化单页入口
│   ├── shared/utils/api.js    # 后端 API 客户端
│   ├── core/                  # 音频、视频、谱面、匹配与练习模块
│   └── assets/css/            # 当前产品视觉样式
├── index.html                 # 默认单页入口
├── home.html                  # 兼容入口，重定向到 index.html#/home
└── vite.config.js
```

---

## 页面说明

### 默认单页（`index.html`）

页面使用哈希路由串联以下视图：

| 路由 | 当前作用 |
|------|----------|
| `#/home` | 本地视频选择、示例课程与继续练习入口 |
| `#/analysis` | 本地示例展示流程动画；后端课程展示真实状态与进度 |
| `#/overview` | 课程摘要和练习片段概览 |
| `#/player` | 视频、双手提示、波形、和弦轨和六线谱同步工作区 |
| `#/focus` | 难点循环、动作回看和提速阶梯 |
| `#/results` | 单次练习结果与掌握度展示 |
| `#/library` | 展示真实后端课程；后端离线时保留内置示例 |

`home.html` 不再维护另一套页面，只把旧链接导向 `index.html#/home`。后端课程可通过 `?course=<id>` 直接载入上述单页状态。

## 核心前端特性

### 已具备

- 艺术化暖纸/夜间视觉、桌面与移动端响应式布局。
- 本地 MP4/MOV 选择、时长和大小检查、视频预览与自定义播放控制。
- 分析、概览、跟练、专项练习和结果页的可交互产品流程。
- 麦克风授权、音频分析和音高检测的基础模块。
- FastAPI 课程、视频、谱面接口及可切换的本地/MinIO 存储层。
- FFmpeg + Basic Pitch 转录、可演奏弦品求解与 Canonical Score JSON 构建。
- 键盘导航、跳过链接、模态框焦点约束和减少动态效果适配。

### 尚未完成

- 生产级自动转谱质量、人工校谱能力与 Celery/Redis 持久任务队列。
- 后端谱面驱动的播放器时间轴、音符生成和目标匹配。
- 经真实吉他输入验证的 Perfect / Good / Miss 评分、纠错和自适应调速闭环。
- 用户认证、权限隔离和生产级媒体处理。

### 响应式适配

针对桌面与平板主流屏幕比例优化：

- 16:9（默认）
- 16:10
- 4:3
- 21:9 超宽屏

---

## 快速开始

### 前端

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run lint
```

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # macOS / Linux
# .venv\Scripts\Activate.ps1  # Windows PowerShell
pip install --no-deps -r requirements-pipeline.txt  # Basic Pitch，绕过 TensorFlow
pip install -r requirements.txt
uvicorn app.main:app --reload  # http://localhost:8000
```

后端默认使用 SQLite（`./storage/app.db`）和本地文件存储，无需 Docker 即可运行。生产环境可切到 PostgreSQL + MinIO，见 `backend/docker-compose.yml`。

### 本地演示课程

仓库已包含 Bilibili《拥抱》60 秒裁剪 demo 视频和预生成的 72 BPM 4/4 谱面（位于 `backend/storage/`，不纳入版本控制）。启动后端后，运行：

```bash
cd backend
python scripts/seed_demo.py
```

脚本会创建一个 `status=ready` 的演示课程，并输出可直接在浏览器打开的地址，例如：

```text
http://localhost:5173/?course=bcf4b374c965#/home
```

打开后点击“使用 48 秒示例课程”即可进入真实后端驱动的课程概览与跟练页面。

### API 预览

启动后端后访问：

- 文档：`http://localhost:8000/docs`
- 健康检查：`GET /health`
- 课程列表：`GET /api/v1/courses`
- 课程详情：`GET /api/v1/courses/{id}`
- 上传视频：`POST /api/v1/courses/upload` (multipart/form-data: title, video)
- 触发转谱：`POST /api/v1/courses/{id}/parse`
- 提交 URL：`POST /api/v1/courses/from-url` (JSON: title, source_url)
- 更新课程：`PATCH /api/v1/courses/{id}`
- 删除课程：`DELETE /api/v1/courses/{id}`
- 课程视频流：`GET /api/v1/courses/{id}/video`
- 课程谱面：`GET /api/v1/courses/{id}/score`
- 上传谱面：`POST /api/v1/courses/{id}/score` (multipart/form-data: score)
- 输入质量检查：`POST /api/v1/courses/{id}/quality`
- 统一时间轴：`GET /api/v1/courses/{id}/timeline`
- 练习片段：`GET /api/v1/courses/{id}/segments`
- 片段进度：`POST /api/v1/courses/{id}/segments/{segment_id}/progress`
- 练习结果：`POST /api/v1/practice/results` 与 `GET /api/v1/practice/results`
- 练习汇总：`GET /api/v1/practice/summary/{course_id}`
- 薄弱小节：`GET /api/v1/practice/weak-spots/{course_id}`

> 演示课程（Bilibili《拥抱》60 秒裁剪版）可通过 `python scripts/seed_demo.py` 直接入库，媒体文件不纳入版本控制。

---

## 构建产物

执行 `npm run build` 后生成 `dist/` 目录，包含 `index.html` 与 `home.html` 及打包后的 JS/CSS。

---

## 后续计划

详见 `docs/p0-gaps.md`。当前最优先补齐的闭环：

1. 用后端 `timeline` 和 `segments` 驱动跟练页音符与片段。
2. 将 `MatchingEngine` 接入播放循环，实现实时判定与错误反馈。
3. 提交练习结果并驱动课程库进度、薄弱小节、前后对比。
4. 实现基于真实错误的自动专项纠错、降速循环、达标提速。
5. 补齐和弦/换把手型、音频-视频时间对齐、麦克风延迟校准。
6. 用 `docs/midi-user-simulation.md` 中的 MIDI 模拟流程在无实机情况下验证上述闭环。

---

## 项目文档

- 完整产品文档：`docs/PROJECT.md`
- P0 关键缺口清单：`docs/p0-gaps.md`
- 后端起步方案：`docs/BACKEND_START.md`
- 技术栈调研：`TECHNICAL_RESEARCH.md`
- 音频转谱流水线：`docs/AUDIO_TO_TAB_PIPELINE.md`
- 项目进度：`docs/PROGRESS.md`
- 无实机 MIDI 用户模拟流程：`docs/midi-user-simulation.md`
- 语音控制功能构建方案：`docs/voice-control-build.md`

---

## 许可证

MIT
