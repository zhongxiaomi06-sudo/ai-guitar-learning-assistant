# 后端起步方案：从最小可行服务开始

> 目标：让前端能跑通第一条真实数据链路，而不是一步到位搭完整 AI pipeline。
> 版本：v1.0
> 最后更新：2026-07-21

## 当前项目状态

- 前端已可跑：`home.html`（上传/URL/演示课程） + `index.html`（执行页，含音游模式）。
- 后端 FastAPI 已启动：提供课程 CRUD、视频上传、谱面 JSON、视频流服务。
- 前端已从 `localStorage` 切换到后端 API（`src/shared/utils/api.js`）。
- 已下载 Bilibili 演示视频并裁剪为 60 秒，已生成 `demo_score.json` 并上传到后端本地存储。
- 实时音高检测已接入 Web Audio API（前端 YIN 简化实现，见 `src/core/audio/analyzer.js`）。
- URL 抓取当前仅记录链接，不自动下载（受法律和反爬限制）。
- **当前最大 Gap**：后端谱面数据已可获取，但音游模式仍使用随机音符，尚未被真实谱面驱动；`app.js` 与 `ui-demo.js` 两套前端系统尚未整合。

## 后端职责边界（MVP 阶段）

后端在这个阶段只做三件事：

1. **课程管理**：保存课程元数据（标题、视频地址、谱面地址、BPM、进度等）。
2. **视频/文件服务**：接收上传或 URL，提供可播放的代理文件和谱面 JSON。
3. **解析任务编排（可选）**：把音频/视频丢给 FFmpeg + Basic Pitch 等工具，异步生成谱面。

以下工作**先放在前端或本地脚本**做，不要急于服务端化：

- 实时音高检测（用浏览器 Web Audio API）。
- 实时匹配与评分（用前端 `core/matching`）。
- 自适应调速/循环（用前端 `core/practice`）。
- 复杂 AI 视觉/手部识别（MVP 不做）。

## 推荐起步架构

```text
guitar/
├── backend/                 # 新增后端目录
│   ├── app/                 # FastAPI 主应用
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── courses.py   # 课程 CRUD、上传、解析
│   │   │   └── score.py     # 谱面 JSON 服务
│   │   ├── models/          # SQLAlchemy 模型
│   │   ├── schemas/         # Pydantic 模型
│   │   ├── services/        # 业务逻辑
│   │   └── tasks/           # Celery 异步任务（后续）
│   ├── alembic/             # 数据库迁移
│   ├── docker-compose.yml   # PostgreSQL + MinIO + Redis + 后端
│   ├── requirements.txt
│   └── Dockerfile
├── src/                     # 前端（保持现有 Vite）
├── docs/
└── ...
```

## 推荐技术栈

| 层级 | 推荐 | 理由 |
|------|------|------|
| API 框架 | FastAPI + Python 3.11 | 后续要接 Basic Pitch / PyTorch / FFmpeg，Python 生态最顺。 |
| 数据库 | PostgreSQL 15 | 关系型数据清晰，课程、谱面、进度、用户都合适。 |
| 对象存储 | MinIO（本地开发） / S3 / R2 | 视频文件不走数据库。 |
| 缓存/任务队列 | Redis + Celery | 解析视频是长任务，必须异步。 |
| 容器 | Docker Compose | 一键拉起本地环境。 |
| 部署 | 待定 | 先用本地 Docker，云服务器后续再定。 |

## 第一阶段：最小可行后端（已完成）

目标：让前端能调用 API，获取一个真实 DEMO 课程和谱面。

**状态**：已完成。目录结构与文件如下：
backend/app/
├── __init__.py
├── main.py
├── database.py
├── config.py
├── api/
│   ├── __init__.py
│   ├── courses.py
│   └── score.py
├── models/
│   ├── __init__.py
│   └── course.py
├── schemas/
│   ├── __init__.py
│   └── course.py
└── services/
    ├── __init__.py
    └── storage.py
```

### 3. 数据库模型（`models/course.py`）

```python
from sqlalchemy import Column, String, Integer, Float, DateTime, JSON, Text
from sqlalchemy.sql import func
from app.database import Base

class Course(Base):
    __tablename__ = "courses"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    source_url = Column(Text, nullable=True)
    video_path = Column(String, nullable=True)      # 对象存储 key
    score_path = Column(String, nullable=True)      # 对象存储 key
    duration = Column(Float, default=0)
    bpm = Column(Integer, default=0)
    time_signature = Column(String, default="4/4")
    key = Column(String, default="C")
    metadata_json = Column(JSON, default=dict)
    status = Column(String, default="pending")      # pending / ready / error
    progress = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
```

### 4. 核心 API（`api/courses.py`）

- `POST /api/v1/courses/upload` — 本地上传视频，生成课程，返回 `course_id`。
- `POST /api/v1/courses/from-url` — 提交 URL，后端排队下载（第一阶段可返回占位）。
- `GET /api/v1/courses` — 课程列表。
- `GET /api/v1/courses/{id}` — 课程详情。
- `DELETE /api/v1/courses/{id}` — 删除课程。
- `GET /api/v1/courses/{id}/video` — 返回视频流或预签名 URL。
- `GET /api/v1/courses/{id}/score` — 返回谱面 JSON。

### 5. 第一阶段不做的

- 用户认证（先用无用户或单用户模式）。
- 真实 URL 下载（受法律和反爬限制，先放本地文件）。
- AI 自动扒谱（先用预精修 `score.json`）。
- Celery（先用同步处理，小文件不影响）。

## 第二阶段：接入真实 DEMO 数据（已完成）

目标：用一段真实吉他教学视频 + 人工精修谱面，跑通前端执行页。

1. ✅ 已下载 Bilibili 吉他教学视频《拥抱》并裁剪为 60 秒。
2. ✅ 已手工编写 `demo_score.json`，符合 `src/shared/types/index.js` 的 `Project` 结构。
3. ✅ 已把视频和谱面上传到后端本地存储。
4. ✅ 已修改 `home.js`：上传时调用后端 `POST /api/v1/courses/upload`。
5. ✅ 已修改 `main.js`：从后端 `GET /api/v1/courses/{id}/score` 加载谱面（目前仅 console.log，尚未驱动 UI）。

**注意**：演示视频和 `demo_score.json` 保存在本地 `backend/storage/`（已被 `.gitignore` 排除），Git 仓库中不包含这些媒体文件。新环境需重新生成或下载。

## 第三阶段：异步解析流水线（3–5 天）

目标：让用户上传任意吉他视频后，后端能自动生成谱面。

```text
上传视频 → FFmpeg 提取音频 → Basic Pitch → 弦品求解 → 小节/拍号量化 → Score JSON
```

步骤：

1. 接入 Celery + Redis，把解析任务异步化。
2. 写 `tasks/transcribe.py`：
   - `ffmpeg -i input.mp4 -vn -ac 1 -ar 22050 analysis.wav`
   - `basic-pitch ./output ./analysis.wav`
   - 读取 MIDI 和 note_events CSV。
3. 写 `services/tab_solver.py`：把 MIDI 音高映射到吉他弦品，输出候选。
4. 写 `services/score_builder.py`：生成 `Canonical Score JSON`。
5. 解析完成后更新 `Course.status = "ready"`。

## 第四阶段：与前端实时链路打通（2–3 天）

目标：前端在播放视频时，后端提供精确时间轴对齐。

1. 后端提供 `GET /api/v1/courses/{id}/timeline`：包含音符、和弦、事件、视频时间戳。
2. 前端用 `requestAnimationFrame` + 视频 `currentTime` 驱动谱面滚动。
3. 前端用 Web Audio API 采集麦克风，实时检测音高，与目标谱面对比。
4. 后端不参与实时评分，只提供目标数据。

## 已决策事项

1. **前端技术栈**：保留 Vite + 原生 JavaScript。React/Next.js 作为未来可选升级，当前不迁移。
2. **后端是否独立仓库**：先放在同一仓库 `guitar/backend/`，等 MVP 验证后再拆。
3. **本地开发是否用 Docker**：默认使用 SQLite + 本地文件存储，零配置即可运行；Docker Compose 用于需要 PostgreSQL + MinIO 的环境。

## 运行方式

启动后端（SQLite 默认）：

```bash
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload
```

启动前端：

```bash
npm run dev
```

访问：

- 主页：`http://localhost:3000/home.html`
- 执行页：`http://localhost:3000/index.html?course=<course_id>`
- API 文档：`http://localhost:8000/docs`

## 与现有文档关系

- `PROJECT.md`：产品需求总纲，后端边界要服从其中 MVP 范围。
- `TECHNICAL_RESEARCH.md`：完整技术栈调研，第三阶段开始大量参考。
- `AUDIO_TO_TAB_PIPELINE.md`：第三阶段具体实现步骤。
- `PROGRESS.md`：本文件应作为后端进度跟踪入口。
