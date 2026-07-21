# AI 吉他跟弹系统 — 前端包

> 这是一个前端独立包，用于 AI 吉他视频跟弹项目。当前阶段为 MVP 前端原型，核心目标是实现“视频 + 谱面 + 实时匹配反馈”的完整桌面/平板端体验。

---

## 项目定位

**前端核心能力**：让用户能够跟着吉他教学视频把谱子弹出来。

- 不教乐理，只关注声音结果是否弹对。
- 提供视频播放、流动六线谱、音游式匹配反馈、实时建议、自适应练习设置。
- 所有上传的课程自动保存到浏览器本地（`localStorage`），可在个人主页继续练习。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 构建工具 | Vite 5 |
| 语言 | 原生 JavaScript（ES Modules） |
| 样式 | 原生 CSS + CSS 变量 |
| 响应式 | CSS Grid + 媒体查询（16:9 / 16:10 / 4:3 适配） |
| 音频 | Web Audio API（预留接口） |
| 存储 | localStorage（IndexedDB 待扩展） |

> 注：当前为前端独立原型，未绑定后端框架。后端 AI 解析、视频抓取等服务在后续阶段接入。

---

## 目录结构

```
.
├── docs/                      # 产品、技术、进度文档
├── backend/                   # FastAPI 后端（Step 1 已完成）
│   ├── app/
│   │   ├── main.py            # API 入口
│   │   ├── api/               # 路由
│   │   ├── models/            # SQLAlchemy 模型
│   │   ├── schemas/           # Pydantic 模型
│   │   └── services/          # 存储服务
│   ├── docker-compose.yml     # PostgreSQL + Redis + MinIO
│   ├── Dockerfile
│   └── requirements.txt
├── src/                       # 前端 Vite 源码
├── index.html                 # 执行页（跟练）
├── home.html                  # 个人主页
└── vite.config.js
```

---

## 页面说明

### 1. 个人主页（`home.html`）

- 上传本地视频（MP4 / MOV）
- 粘贴视频 URL（Bilibili / YouTube 等）
- 选择演示课程
- 查看“我的课程”列表与进度
- 每次上传自动保存到 `localStorage`

### 2. 执行页（`index.html`）

核心跟练界面，包含：

| 区域 | 说明 |
|------|------|
| 视频面板 | 16:9 比例播放教学视频 |
| 乐谱面板 | 窄边栏流动六线谱，横向滚动 |
| 手型图 | 基于谱面生成的左手按弦/右手拨弦示意 |
| 匹配面板 | 音游式右→左流动音符 + 麦克风音高检测 + 音高偏差仪表 |
| 建议面板 | 实时反馈、下一步提示、准确率/连击/小节 |
| 设置浮窗 | 可折叠悬浮窗：速度、难度、判定偏移、自动调速、输入设备、键盘调试 |

匹配面板基于麦克风输入判定：系统实时检测弹奏音高，映射到吉他琴弦，当对应车道的音符到达判定线时自动触发判定。无需按键，符合项目核心。提供「键盘调试」开关，仅在无吉他测试时手动开启。

匹配面板内置音游模式：音符从右向左流动，6 根弦对应 6 条水平车道；音符到达左侧判定线时，按数字键 1–6 或点击/触摸对应车道；判定结果实时显示 Perfect / Good / Miss、粒子爆炸与连击。

## 核心前端特性

### 音游模式

- **右→左流动**：6 根弦对应 6 条水平车道，音符从右侧出现并向左移动。
- **麦克风判定**：通过 Web Audio API 实时采集吉他声音，使用 YIN 音高检测算法估算音高，并映射到对应琴弦触发判定。
- **判定系统**：当检测到弹奏 onset 且音高落在目标琴弦频段时，对左侧判定线附近的音符触发 Perfect / Good / Miss 判定。
- **判定偏移**：用户可在设置中调整 ±150ms 的判定偏移，补偿音频采集延迟。
- **键盘调试**：设置浮窗提供「键盘调试」开关，无吉他时可用数字键 1–6 模拟击打，默认关闭。

### 自适应练习设置

| 设置项 | 控件 |
|--------|------|
| 速度 | 0.5x / 0.75x / 1.0x 芯片按钮 |
| 难度 | 宽松 / 标准 / 严格 分段按钮 |
| 判定偏移 | 范围滑块（-150ms ~ +150ms） |
| 自动调速 | 紧凑开关 |
| 输入设备 | 下拉选择 |

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
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload  # http://localhost:8000
```

后端默认使用 SQLite（`./storage/app.db`）和本地文件存储，无需 Docker 即可运行。生产环境可切到 PostgreSQL + MinIO，见 `backend/docker-compose.yml`。

### API 预览

启动后端后访问：

- 文档：`http://localhost:8000/docs`
- 健康检查：`GET /health`
- 课程列表：`GET /api/v1/courses`
- 上传视频：`POST /api/v1/courses/upload` (multipart/form-data: title, video)
- 课程视频流：`GET /api/v1/courses/{id}/video`
- 课程谱面：`GET /api/v1/courses/{id}/score`

---

## 构建产物

执行 `npm run build` 后生成 `dist/` 目录，包含 `index.html` 与 `home.html` 及打包后的 JS/CSS。

---

## 后续计划

1. 接入真实 DEMO 视频与谱面数据。
2. 实现音频 Onset 检测与视频-谱面对齐。
3. 实现麦克风实时音高检测与和弦识别。
4. 将匹配反馈从演示模式接入真实音频比对。
5. 实现自适应调速、A/B 循环、错误回看。
6. 后端 AI 扒谱与视频抓取服务接入。

---

## 项目文档

- 完整产品文档：`docs/PROJECT.md`
- 项目进度：`docs/PROGRESS.md`
- 原始 PRD：`CLAUDE.md`

---

## 许可证

MIT
