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
| 后端框架 | FastAPI + Python 3.11 |
| 后端数据库 | SQLite（本地开发）/ PostgreSQL（Docker） |
| 后端存储 | 本地文件系统 / MinIO |
| 音频处理 | FFmpeg + Basic Pitch（后端转谱）/ Web Audio API（前端 YIN） |
| 部署 | Docker Compose（可选） |

> **过渡期说明**：仓库保留了艺术化单页与较早的五面板实现。构建时以 `index.html` → `src/product-app.js` 为准；`src/main.js`、`src/home.js`、`src/app.js` 与 `src/ui-demo.js` 作为后端和音频能力的过渡实现保留，后续会择优整合，而不是假定它们已经成为默认页面入口。

---

## 目录结构

```
.
├── docs/                      # 产品、技术、进度文档
├── backend/                   # FastAPI 后端与音频转谱流水线
│   ├── app/
│   │   ├── main.py            # API 入口
│   │   ├── api/               # 路由
│   │   ├── models/            # SQLAlchemy 模型
│   │   ├── schemas/           # Pydantic 模型
│   │   ├── services/          # 存储、转录、弦品求解与谱面构建
│   │   └── tasks/             # 进程内后台解析任务（MVP）
│   ├── docker-compose.yml     # PostgreSQL + Redis + MinIO
│   ├── Dockerfile
│   └── requirements.txt
├── src/
│   ├── product-app.js         # 当前艺术化单页入口
│   ├── shared/utils/api.js    # 后端 API 客户端
│   ├── core/                  # 音频、视频、谱面、匹配与练习模块
│   ├── assets/css/product.css # 当前产品视觉样式
│   └── main.js 等             # 过渡期五面板实现，尚未作为默认入口
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
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # macOS / Linux
# .venv\Scripts\Activate.ps1  # Windows PowerShell
pip install -r requirements.txt
uvicorn app.main:app --reload  # http://localhost:8000
```

后端默认使用 SQLite（`./storage/app.db`）和本地文件存储，无需 Docker 即可运行。生产环境可切到 PostgreSQL + MinIO，见 `backend/docker-compose.yml`。

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

> 演示课程（Bilibili《拥抱》60 秒裁剪版）需在后端本地生成，媒体文件不纳入版本控制。详见 `docs/BACKEND_START.md` 第二阶段。

---

## 构建产物

执行 `npm run build` 后生成 `dist/` 目录，包含 `index.html` 与 `home.html` 及打包后的 JS/CSS。

---

## 后续计划

1. 将谱面数据真正驱动音游模式（当前音符仍为随机生成）。
2. 实现音频 Onset 检测与视频-谱面对齐。
3. 完善麦克风实时音高检测与和弦识别。
4. 将匹配反馈从演示模式接入真实音频比对。
5. 实现自适应调速、A/B 循环、错误回看。
6. 将进程内解析任务迁移到持久队列，并补齐人工校谱与合规视频抓取。

---

## 项目文档

- 完整产品文档：`docs/PROJECT.md`
- 后端起步方案：`docs/BACKEND_START.md`
- 技术栈调研：`TECHNICAL_RESEARCH.md`
- 音频转谱流水线：`docs/AUDIO_TO_TAB_PIPELINE.md`
- 项目进度：`docs/PROGRESS.md`

---

## 许可证

MIT
