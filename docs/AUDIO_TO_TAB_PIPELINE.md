# 音频 → 六线谱 流水线

## 技术栈

| 步骤 | 工具 | 环境 |
|------|------|------|
| 音频提取 | FFmpeg | Python 3.11 |
| 音频→MIDI note events | Basic Pitch (Spotify，当前使用包默认模型) | Python 3.11 |
| 弦品求解 | 自研动态规划 (DP) | Python 3.11 |
| 谱面数据格式 | Canonical Score JSON | 跨端通用 |
| 谱面渲染 | 前端自研 rhythm game / 六线谱 | 浏览器 |

## 实现文件

- `backend/app/services/transcription.py` — 视频提取音频 + Basic Pitch 转录
- `backend/app/services/tab_solver.py` — MIDI → 弦品 DP 求解
- `backend/app/services/score_builder.py` — 弦品结果 → Canonical Score JSON
- `backend/app/services/audio_pipeline.py` — 端到端流水线编排
- `backend/scripts/run_pipeline.py` — 本地命令行测试脚本

## 流程

### 1. 音频预处理

- FFmpeg 从视频提取单声道 22050 Hz WAV：`ffmpeg -i input.mp4 -vn -ac 1 -ar 22050 analysis.wav`
- 通过 `ffprobe` 读取视频时长
- 在进入音频提取和模型推理前拒绝超过 10 分钟的媒体
- 媒体命令异常不记录完整输入 URL，避免泄露对象存储签名参数

### 2. Basic Pitch 转录

- `basic-pitch` 0.4.0 当前通过包默认模型推理；Linux 安装可能包含 TensorFlow，不能宣称仅依赖 ONNX
- 可调参数：`onset_threshold` / `frame_threshold` / `minimum_note_length`（毫秒）
- 输出 note events：`(start, end, pitch, confidence)`
- 过滤非吉他音区（标准调弦 19 品，默认 MIDI 40–83）
- 合并同音高碎音符、删除过短噪声（< 80 ms）

### 3. 弦品求解

- 标准调弦：E2 A2 D3 G3 B3 E4（弦 6 到弦 1，MIDI 40/45/50/55/59/64）
- `midi_to_candidates(midi)` 枚举每个音高所有可行弦品
- 按起始时间分组为和弦组
- DP 束搜索（beam search）最小化：
  - 单和弦代价：手指跨度、空弦偏好、高把位惩罚、重复弦惩罚
  - 转移代价：平均把位跳跃、同弦大跳、跨度变化
- 输出 1-indexed 弦号与品数

### 4. 谱面生成

- 根据 BPM 和拍号切分小节/拍
- BPM 可由调用方显式指定（`--bpm 72`），也可留 0 让 `tempo.py` 自动估计；拍号默认为 4/4，调性默认 C
- 将音符分配到起始拍
- 同弦同品重叠/相邻音符合并，减少重复检测
- 输出 Canonical Score JSON：`{id, title, sourceVideoUrl, duration, bpm, timeSignature, key, bars}`

## 本地运行

```powershell
cd backend
.venv\Scripts\activate
python scripts/run_pipeline.py storage/videos/bcf4b374c965.mp4 `
  --title "拥抱 - 吉他弹唱" --bpm 72 --key C `
  --output storage/scores/bcf4b374c965_auto_score.json --keep-work-dir
```

## 当前状态

- [x] FFmpeg 音频提取
- [x] Basic Pitch 转录（默认模型）
- [x] 吉他音区过滤与碎音合并
- [x] DP 弦品求解
- [x] Canonical Score JSON 生成
- [x] 后端 API 触发流水线（`AudioPipeline.process_course`）
- [ ] 人工校对/后编辑 UI
- [ ] 更高级的多声部分离（vocal / guitar 分离）
- [ ] 用 Celery/RQ 等持久任务队列替换进程内 `BackgroundTasks`
- [ ] 接入更稳定的调性估计，替换默认调性元数据
