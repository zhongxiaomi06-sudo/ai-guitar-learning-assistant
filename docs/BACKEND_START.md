# 后端起步方案：从最小可行服务开始

> 目标：让前端能跑通第一条真实数据链路，而不是一步到位搭完整 AI pipeline。
> 版本：v1.0  
> 最后更新：2026-07-22

## 当前项目状态

- 默认前端是 `index.html` → `src/product-app.js` 的艺术化单页；`home.html` 只做兼容重定向。
- 后端 FastAPI 已提供课程 CRUD、视频上传、谱面 JSON、视频读取、输入质量检查、解析流水线、时间轴、片段、练习结果、薄弱小节与片段进度服务。
- `src/shared/utils/api.js` 已提供 API 客户端；`index.html` 可通过 `?course=<id>` 直接载入后端课程。
- 仓库的 `backend/storage/` 已包含 Bilibili《拥抱》60 秒裁剪 demo 视频和预生成的 72 BPM 4/4 谱面（不纳入版本控制），运行 `python scripts/seed_demo.py` 可一键创建演示课程。
- Web Audio / YIN 已具备基础实现（见 `src/core/audio/analyzer.js`），目标谱面驱动的实时评分闭环由前端 `core/matching` 与 `core/practice` 承载，后端提供时间轴/片段/练习结果支撑。
- URL 抓取当前仅记录链接，不自动下载（受法律和反爬限制）。
- **当前最大 Gap**：后端谱面/时间轴数据尚未与艺术化跟练页完成最终绑定；多过渡期前端实现仍需后续收敛。

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
| API 框架 | FastAPI + Python 3.12 | 后续要接 Basic Pitch / FFmpeg，Python 生态最顺。 |
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

### 4. 核心 API（`api/courses.py` / `api/score.py` / `api/practice.py`）

- `POST /api/v1/courses/upload` — 本地上传视频，生成课程，返回 `course_id`。
- `POST /api/v1/courses/from-url` — 提交 URL，后端排队下载（第一阶段可返回占位）。
- `GET /api/v1/courses` — 课程列表。
- `GET /api/v1/courses/{id}` — 课程详情。
- `PATCH /api/v1/courses/{id}` — 更新课程元数据。
- `DELETE /api/v1/courses/{id}` — 删除课程。
- `GET /api/v1/courses/{id}/video` — 返回视频流或预签名 URL。
- `GET /api/v1/courses/{id}/score` — 返回谱面 JSON。
- `POST /api/v1/courses/{id}/quality` — 提取音频并检查输入质量（音量、噪声、时长）。
- `POST /api/v1/courses/{id}/parse` — 排队音频 → 六线谱解析任务。
- `GET /api/v1/courses/{id}/timeline` — 返回统一时间轴演奏事件（含视频/音频时间、弦品、手型提示）。
- `GET /api/v1/courses/{id}/segments` — 返回自动拆分练习片段与达标条件。
- `POST /api/v1/courses/{id}/score` — 上传人工精修 Canonical Score JSON。
- `POST /api/v1/practice/results` — 提交一次练习检测事件。
- `GET /api/v1/practice/results` — 查询练习事件。
- `GET /api/v1/practice/summary/{course_id}` — 汇总正确率、节奏偏差等统计。
- `GET /api/v1/practice/weak-spots/{course_id}` — 聚合薄弱小节/事件。
- `POST /api/v1/courses/{id}/segments/{segment_id}/progress` — 更新片段状态。
- `GET /api/v1/courses/{id}/segments/{segment_id}/progress` — 查询片段状态。

### 4.1 解析流水线行为

- `POST /api/v1/courses/{id}/parse` 会异步执行以下步骤：
  1. 提取音频并检查时长（< 1 秒或 > 10 分钟会失败）。
  2. 检查音频质量：无音轨/静音、音量过低、噪声过高会失败并记录原因。
  3. 自动检测 BPM 与拍号（若课程未设置 BPM）。
  4. 用 Basic Pitch 转录音符，求解弦位，生成 Canonical Score JSON。
  5. 验证谱面质量：音符数、把位合理性、时长匹配。
  6.  transient 失败（如 FFmpeg / Basic Pitch 偶发错误）会自动重试。
- 失败时课程状态变为 `error`，`metadata_json.last_error` 包含可展示给用户的原因。

### 5. 第一阶段不做的

- 用户认证（先用无用户或单用户模式）。
- 真实 URL 下载（受法律和反爬限制，先放本地文件）。
- AI 自动扒谱（先用预精修 `score.json`）。
- Celery（先用同步处理，小文件不影响）。

## 第二阶段：接入可复现的 DEMO 数据（已完成）

目标：用一段真实吉他教学视频 + 人工精修谱面，跑通前端执行页。

1. ✅ 后端支持上传视频与谱面，并可通过 API 读取。
2. ✅ 默认艺术化入口 `src/product-app.js` 已接入课程列表、课程详情、视频与谱面状态。
3. ✅ 仓库本地包含 Bilibili《拥抱》60 秒裁剪 demo 视频与 72 BPM 4/4 精修谱面（`backend/storage/`）。
4. ✅ 运行 `python scripts/seed_demo.py` 可将 demo 视频与谱面一键注册为 `status=ready` 的演示课程。
5. ✅ 通过 `http://localhost:5173/?course=<id>#/home` 可直接打开演示课程。
6. ✅ 前端点击“使用 48 秒示例课程”即可进入后端驱动的课程概览与跟练页。

**注意**：`backend/storage/` 被 `.gitignore` 排除。已有该目录的开发者可直接运行 seed 脚本；首次克隆的开发者需要自行准备视频与谱面，或用 `run_pipeline.py` 重新生成。

## 第三阶段：异步解析流水线（已完成）

目标：让用户上传任意吉他视频后，后端能自动生成谱面。

当前已实现：

```text
上传视频 → FFmpeg 提取音频 → 输入质量检查 → 自动 BPM/拍号 → Basic Pitch → 弦品求解 → 小节量化 → 谱面质量验收 → Score JSON
```

步骤：

1. ✅ 用 `BackgroundTasks` 异步化解析任务（Celery/Redis 列为 P1）。
2. ✅ 写 `tasks/transcribe.py`：执行流水线并记录失败状态与原因。
3. ✅ 写 `services/tab_solver.py`：把 MIDI 音高映射到吉他弦品，输出候选。
4. ✅ 写 `services/score_builder.py`：生成 `Canonical Score JSON`。
5. ✅ 解析完成后更新 `Course.status = "ready"` 或 `"error"`。
6. ✅ 输入质量检查、自动 BPM/拍号、解析重试、谱面质量验收。

## 第四阶段：与前端实时链路打通（后端已完成，前端绑定中）

目标：前端在播放视频时，后端提供精确时间轴对齐，前端用麦克风实时检测并比对。

1. ✅ 后端提供 `GET /api/v1/courses/{id}/timeline`：包含音符、和弦、事件、视频时间戳。
2. ✅ 后端提供 `GET /api/v1/courses/{id}/segments`：练习片段与达标条件。
3. ✅ 后端提供 `POST /api/v1/practice/results`：保存实时检测事件。
4. ✅ 后端提供 `GET /api/v1/practice/weak-spots/{course_id}`：聚合薄弱小节。
5. ✅ 前端 `core/audio/analyzer.js` 与 `core/matching/engine.js` 已具备 YIN 音高检测与匹配引擎。
6. ⏳ 前端默认艺术化跟练页尚未完全用后端时间轴驱动音符高亮与评分反馈（由用户并行完善）。

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

## 端口与 CORS

前端开发服务器默认在 **5173** 端口（Vite 默认），预览模式在 **4173** 端口。后端默认 CORS 白名单已包含：

- `http://localhost:3000`、`http://127.0.0.1:3000`
- `http://localhost:5173`、`http://127.0.0.1:5173`
- `http://localhost:4173`、`http://127.0.0.1:4173`

前端 API 基地址：

- 开发环境：`http://127.0.0.1:8000`（由 `src/shared/utils/api.js` 自动推断，也可通过 `VITE_API_BASE` 覆盖）
- 生产环境：同域 `/api`（需要反向代理或网关）

## 本地演示课程

启动后端并安装依赖后，运行：

```bash
cd backend
python scripts/seed_demo.py
```

脚本会查找 `backend/storage/videos/` 与 `backend/storage/scores/` 中的 demo 文件，创建一条 `status=ready` 的课程，并输出可直接在浏览器打开的地址，例如：

```text
http://localhost:5173/?course=bcf4b374c965#/home
```

打开后点击“使用 48 秒示例课程”，即可进入后端驱动的课程概览与跟练页。

## 前后端连通性验证

已验证项目（2026-07-22）：

| 检查项 | 结果 |
|--------|------|
| 后端健康检查 | `GET /health` → `{"status":"ok"}` |
| CORS 预检 | `OPTIONS /api/v1/courses` 返回 `Access-Control-Allow-Origin: http://localhost:5173` |
| 课程列表 | `GET /api/v1/courses` 正常返回 JSON |
| 视频读取 | `GET /api/v1/courses/{id}/video` 返回 `video/mp4` 流 |
| 谱面读取 | `GET /api/v1/courses/{id}/score` 返回 `application/json` |
| 时间轴 | `GET /api/v1/courses/{id}/timeline` 返回 231 个事件 |
| 练习片段 | `GET /api/v1/courses/{id}/segments` 返回 5 个片段 |
| 输入质量检查 | `POST /api/v1/courses/{id}/quality` 返回 `ok: true` |
| 前端开发服务器 | `npm run dev` 在 5173 端口启动成功 |
| 前端 API 调用 | 默认入口 `src/product-app.js` 成功调用 `courses.list()` 与 `courses.getScore()` |

## 性能基线

- 课程列表/详情/视频/谱面 API：毫秒级响应。
- 谱面 JSON 大小：实测 50–85 KB，无加载压力。
- 自动解析流水线：60 秒视频约 30–60 秒（取决于机器），通过 `POST /api/v1/courses/{id}/parse` 异步排队，不阻塞 HTTP 响应。

## 已知生态问题

1. **前端入口统一**：当前默认入口为 `index.html` → `src/product-app.js`（艺术化单页，已接通后端）。过渡期旧实现已清理，后续功能直接在该单页入口上迭代。
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
