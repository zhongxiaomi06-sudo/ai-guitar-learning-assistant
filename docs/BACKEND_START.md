# 后端起步方案：从最小可行服务开始

> 目标：让前端能跑通第一条真实数据链路，而不是一步到位搭完整 AI pipeline。
> 版本：v1.0
> 最后更新：2026-07-21

## 当前项目状态

- 默认前端是 `index.html` → `src/product-app.js` 的艺术化单页；`home.html` 只做兼容重定向。
- 后端 FastAPI 代码已提供课程 CRUD、视频上传、谱面 JSON 和视频读取服务，但开发时仍需单独启动。
- `src/shared/utils/api.js` 已提供 API 客户端，默认单页对真实课程和媒体的接入仍在完善；界面偏好仍会使用 `localStorage`。
- 仓库不包含可直接使用的演示视频或 `demo_score.json`，不能把某个开发者本地存储中的数据视为开箱即用资产。
- Web Audio / YIN 已具备基础实现（见 `src/core/audio/analyzer.js`），但尚未完成目标谱面驱动的实时评分验证。
- URL 抓取当前仅记录链接，不自动下载（受法律和反爬限制）。
- **当前最大 Gap**：后端数据、艺术化产品入口和麦克风检测尚未形成同一条经过验证的端到端跟练链路；仓库也保留了多套过渡期前端实现。

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

## 第一阶段：最小可行后端（代码已完成）

目标：让前端能调用 API，并在准备好授权素材后接入一个真实 DEMO 课程和谱面。

**状态**：API、模型、数据库和存储层代码已提交；运行可用性取决于本地环境变量、依赖与存储配置。目录结构如下：

```text
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

## 第二阶段：接入可复现的 DEMO 数据（部分完成）

目标：用一段真实吉他教学视频 + 人工精修谱面，跑通前端执行页。

1. ✅ 后端支持上传视频与谱面，并可通过 API 读取。
2. ✅ `src/home.js` 和 `src/main.js` 包含课程上传/读取的过渡实现。
3. ⏳ 默认艺术化入口正在接入课程、视频和谱面状态。
4. ⏳ 需要准备具有明确授权、可重复获取的演示视频与谱面资产。
5. ⏳ 谱面尚未驱动默认跟练界面的时间轴和评分。

**注意**：`backend/storage/` 被 `.gitignore` 排除。开发者本地曾使用过的媒体文件不会随 clone 获得，也不应在没有授权说明时要求其他人从第三方平台重新下载。

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

## 安装依赖

创建虚拟环境并安装后端依赖（Basic Pitch 在 Python 3.11+ 的 PyPI 元数据会声明 tensorflow，但我们使用 ONNX 路径，因此需要先 `--no-deps` 安装）：

```bash
cd backend
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell
# .venv\Scripts\Activate.ps1

pip install --no-deps -r requirements-pipeline.txt
pip install -r requirements.txt

# 开发测试依赖
pip install -r requirements-dev.txt
```

Docker 构建已内置上述两步（先 `requirements-pipeline.txt --no-deps`，再 `requirements.txt`）。

## 安装依赖

创建虚拟环境并安装后端依赖（Basic Pitch 在 Python 3.11+ 的 PyPI 元数据会强制依赖 TensorFlow，但我们使用 ONNX 路径，因此需要先 `--no-deps` 安装）：

```bash
cd backend
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell
# .venv\Scripts\Activate.ps1

pip install --no-deps -r requirements-pipeline.txt
pip install -r requirements.txt

# 开发测试依赖
pip install -r requirements-dev.txt
```

Docker 构建已内置上述两步（先 `requirements-pipeline.txt --no-deps`，再 `requirements.txt`）。

## 端口与 CORS

前端开发服务器固定在 **3000** 端口（见 `vite.config.js`）。后端默认 CORS 白名单已包含 `http://localhost:3000` 和 `http://127.0.0.1:3000`。前端 API 基地址：

- 开发环境：`http://127.0.0.1:8000`（由 `src/shared/utils/api.js` 自动推断，也可通过 `VITE_API_BASE` 覆盖）
- 生产环境：同域 `/api`（需要反向代理或网关）

## 前后端连通性验证

已验证项目（2026-07-21）：

| 检查项 | 结果 |
|--------|------|
| 后端健康检查 | `GET /health` → `{"status":"ok"}` |
| CORS 预检 | `OPTIONS /api/v1/courses` 返回 `Access-Control-Allow-Origin: http://localhost:3000` |
| 课程列表 | `GET /api/v1/courses` 正常返回 JSON |
| 视频读取 | `GET /api/v1/courses/{id}/video` 返回 `video/mp4` 流 |
| 谱面读取 | `GET /api/v1/courses/{id}/score` 返回 `application/json` |
| 前端开发服务器 | `npm run dev` 在 3000 端口启动成功 |
| 前端 API 调用 | 默认入口 `src/product-app.js` 成功调用 `courses.list()` 与 `courses.getScore()` |

## 性能基线

- 课程列表/详情/视频/谱面 API：毫秒级响应。
- 谱面 JSON 大小：实测 50–85 KB，无加载压力。
- 自动解析流水线：60 秒视频约 30–60 秒（取决于机器），通过 `POST /api/v1/courses/{id}/parse` 异步排队，不阻塞 HTTP 响应。

## 已知生态问题

1. **双前端过渡**：当前默认入口是 `index.html` → `src/product-app.js`（艺术化单页，已接通后端）。`src/main.js`、`src/home.js`、`src/app.js`、`src/ui-demo.js` 为过渡期旧实现，尚未完全整合，仓库中保留以便后续择优合并。
2. **解析流水线依赖**：Basic Pitch 的 PyPI 元数据强制 TensorFlow，需使用 `--no-deps` 安装，已通过 `requirements-pipeline.txt` + `Dockerfile` 两步安装解决。

## 运行方式

启动后端（SQLite 默认）：

```bash
cd backend
source .venv/bin/activate      # macOS / Linux
# .venv\Scripts\Activate.ps1  # Windows PowerShell
uvicorn app.main:app --reload
```

启动前端：

```bash
npm run dev
```

访问：

- 默认产品页：`http://localhost:3000/index.html#/home`
- 兼容入口：`http://localhost:3000/home.html`（会重定向到默认产品页）
- API 文档：`http://localhost:8000/docs`

过渡模块中的 `?course=<course_id>` 读取逻辑尚未成为默认 HTML 入口的稳定契约；在文档确认前不要依赖该 URL 作为生产路由。

## 与现有文档关系

- `PROJECT.md`：产品需求总纲，后端边界要服从其中 MVP 范围。
- `../TECHNICAL_RESEARCH.md`：完整技术栈调研，第三阶段开始大量参考。
- `AUDIO_TO_TAB_PIPELINE.md`：第三阶段具体实现步骤。
- `PROGRESS.md`：项目进度跟踪入口。
