# 音频 → 六线谱 流水线

## 技术栈

| 步骤 | 工具 | 环境 |
|------|------|------|
| 音频提取 | FFmpeg | 命令行 |
| 音频→MIDI | Basic Pitch (Spotify) | Python 3.10+ |
| MIDI 解析 | @tonejs/midi | Node.js |
| 弦品求解 | 自研 DP | Node.js / 浏览器 |
| 六线谱渲染 | alphaTab | 浏览器 |
| 谱面数据格式 | Canonical Score JSON | 跨端通用 |

## 任务

### 1. 音频预处理

- [ ] FFmpeg 从视频提取音轨：`ffmpeg -i input.mp4 -vn -ac 1 -ar 22050 analysis.wav`
- [ ] 验证音轨存在、音量正常

### 2. Basic Pitch 转录

- [ ] `pip install basic-pitch`
- [ ] `basic-pitch ./output ./analysis.wav --save-note-events`
- [ ] 读取 `*_basic_pitch.mid` 和 `*_basic_pitch.note_events.csv`
- [ ] 参数调优：onset-threshold / frame-threshold / minimum-note-length

### 3. MIDI 解析

- [ ] `npm install @tonejs/midi`
- [ ] 解析 MIDI → `[{midi, startTime, endTime, velocity}, ...]`
- [ ] 按时间排序，合并同时音符为和弦组

### 4. 弦品求解器

- [ ] 实现 `midiToCandidates(midi)` → `[{string, fret}, ...]`
- [ ] 实现 DP 代价函数：`cost(prev, curr)` → 手指移动代价
- [ ] 实现 `findBestPath(notes)` → 最优弦品序列
- [ ] 和弦组：加入手指跨度约束和常见和弦形状优先
- [ ] 空弦偏好可配置
- [ ] 输出前3个候选路径（供人工校对）

### 5. 谱面生成

- [ ] 弦品结果 + MIDI 时间 → Canonical Score JSON
- [ ] 小节切分（基于 BPM 和拍号）
- [ ] 音符时值量化
- [ ] 输出 `{title, bpm, timeSignature, bars: [...]}`

### 6. 谱面渲染

- [ ] 集成 alphaTab
- [ ] Score JSON → alphaTex 转换适配器
- [ ] 六线谱滚动 + 播放光标
- [ ] 音符点击 → 跳转视频时间

### 7. 串联脚本

- [ ] Node.js 脚本：读 MIDI → 弦品求解 → 输出 Score JSON
- [ ] 前端加载 Score JSON → alphaTab 渲染
- [ ] 端到端验证：一段吉他音频 → 可读六线谱
