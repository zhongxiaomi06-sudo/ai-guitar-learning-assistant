# AI 吉他视频自动扒谱与实时陪练技术调研方�?
> 调研日期�?026-07-21  
> 对应产品需求：`docs/PROJECT.md`  
> 目标：为“视频上�?�?自动扒谱 �?谱音画同�?�?实时纠错 �?难点循环 �?恢复原速”提供可落地、可验证、可替换的开源技术路�?
## 1. 调研结论

GitHub 上目前没有一个成熟项目能够直接完成本产品的全部链路。可落地方案不是寻找单一“万能扒谱库”，而是组合音频转录、节拍分析、六线谱推断、视觉追踪、实时音频分析和谱面渲染等模块，再自行实现四个关键产品模块：

1. 音高到吉他琴弦、品位和指法的约束求解器�?2. 谱面、声音、原视频和左右手动作的统一时间轴�?3. 基于目标谱面的教学友好型实时评分引擎�?4. 根据错误自动降速、拆句、循环和提速的练习状态机�?
推荐采用“精修演示数�?+ 普通视频真实解�?+ 真实麦克风监听”的混合路线�?
- 路演视频使用人工校对的谱面、时间点和动作标记，确保展示稳定�?- 普�?MP4/MOV 视频执行真实 AI 解析，并显示结果可信度�?- 实时跟练真实运行，不使用预设正确或错误结果�?- 低可信度能力主动降级，不伪造精确手指或琴弦结论�?
## 2. 推荐技术栈

| 层级 | 推荐技�?| GitHub/来源 | 主要用�?| 采用结论 |
|---|---|---|---|---|
| Web 框架 | Next.js、React、TypeScript | https://github.com/vercel/next.js | 上传、课程、跟练页�?| 采用 |
| 谱面渲染 | alphaTab | https://github.com/CoderLine/alphaTab | 六线谱、和弦、播放光�?| 采用 |
| 波形与区�?| wavesurfer.js | https://github.com/katspaugh/wavesurfer.js | 音频波形、标记、A/B 循环 | 采用 |
| 媒体处理 | FFmpeg | https://github.com/FFmpeg/FFmpeg | 转码、抽音轨、缩略图、时间戳 | 采用 |
| 通用音符识别 | Basic Pitch | https://github.com/spotify/basic-pitch | 复音音符、起止时间、MIDI | 采用 |
| 吉他弦品识别 | FretNet | https://github.com/cwitkowitz/guitar-transcription-continuous | 每弦音高、弦品预测参�?| 二次开�?|
| 吉他 CRNN 参�?| music-transcription | https://github.com/trimplexx/music-transcription | onset �?fret 多任务预�?| 实验对照 |
| 节拍与小�?| Beat This! | https://github.com/CPJKU/beat_this | beat、downbeat、小节边�?| 采用 |
| 综合转录对照 | Omnizart | https://github.com/Music-and-Culture-Technology-Lab/omnizart | 音符、和弦、节拍对�?| 对照验证 |
| 音频特征 | librosa | https://github.com/librosa/librosa | CQT、Chroma、特征与评估 | 采用 |
| 手部追踪 | MediaPipe | https://github.com/google-ai-edge/mediapipe | 21 点手部骨架、视频追�?| 采用 |
| 视觉几何 | OpenCV | https://github.com/opencv/opencv | 指板透视、直线、光流、滤�?| 采用 |
| 检测框�?| Detectron2 �?RT-DETR | https://github.com/facebookresearch/detectron2 | 吉他、琴颈、指板检�?| 二选一验证 |
| 浏览器音�?| Web Audio API、AudioWorklet | 浏览器原�?| 麦克风采集、实时处�?| 采用 |
| 浏览�?MIR 参�?| Essentia.js | https://github.com/MTG/essentia.js | onset、pitch、chroma 原型 | 仅验�?评估许可 |
| 变速播�?| 原生 preservesPitch | 浏览器原�?| 0.5×�?× 保持音高播放 | 首�?|
| 变速备�?| SoundTouchJS | https://github.com/cutterbl/SoundTouchJS | AudioWorklet 变速与音高保持 | 备�?|
| AI API | FastAPI、Python | https://github.com/fastapi/fastapi | API 与模型服�?| 采用 |
| AI 推理 | PyTorch、ONNX Runtime | 官方仓库 | GPU/CPU 模型推理 | 采用 |
| 异步任务 | Celery、Redis | 官方仓库 | 视频解析队列与进�?| 采用 |
| 数据�?| PostgreSQL | https://github.com/postgres/postgres | 课程、时间轴、练习记�?| 采用 |
| 对象存储 | S3、R2 �?MinIO | https://github.com/minio/minio | 视频、音频、封面和结果 | 采用 |


> **实际决策备注**：调研阶段推荐 Web 框架采用 Next.js，但项目最终为快速验证 MVP，决定保留现有 Vite + 原生 JavaScript 架构。Next.js 作为后续升级候选，待核心交互闭环验证后再评估迁移。

## 3. 总体系统架构

```text
┌───────────────────────────────────────────────────────────�?�?                    Next.js Web                           �?�?上传 / 解析进度 / 课程 / 跟练 / 纠错 / 结果               �?└───────────────┬───────────────────────┬───────────────────�?                �?REST/SSE              �?WebSocket
                �?                      �?┌─────────────────────────�?  ┌─────────────────────────────�?�?FastAPI 产品 API        �?  �?实时评分服务                �?�?用户/课程/任务/结果     �?  �?目标事件对齐/二次评分       �?└───────────┬─────────────�?  └──────────────┬──────────────�?            �?                               �?            �?                               �?┌───────────────────�?             ┌───────────────────────�?�?PostgreSQL/Redis  �?             �?Scoring Engine        �?└───────────┬───────�?             �?教学友好型判�?       �?            �?                     └───────────────────────�?            �?┌───────────────────────────────────────────────────────────�?�?                   异步解析流水�?                        �?├──────────────┬──────────────────┬─────────────────────────�?�?Media Worker �?Audio AI Worker  �?Vision AI Worker        �?�?FFmpeg       �?Pitch/Beat/Chord �?Hand/Fretboard/Motion   �?└──────┬───────┴─────────┬────────┴────────────┬────────────�?       �?                �?                    �?       └─────────────────┴─────────────────────�?                         �?              ┌─────────────────────────�?              �?Timeline Composer       �?              �?统一谱音画动作时间轴    �?              └────────────┬────────────�?                           �?              ┌─────────────────────────�?              �?Course JSON + alphaTab  �?              └─────────────────────────�?```

## 4. 离线视频解析流水�?
### 4.1 上传与媒体标准化

输入：本�?MP4/MOV�?
处理步骤�?
1. 前端取得预签名上传地址�?2. 文件直接上传对象存储，避免通过 API 服务器中转大文件�?3. 使用 SHA-256 或感知指纹识别精修演示视频�?4. FFprobe 读取时长、分辨率、帧率、音轨、编码和旋转信息�?5. FFmpeg 生成标准代理视频、单声道分析音频、封面和低分辨率视觉分析视频�?6. 所有事件时间统一为原始视频时间轴上的浮点秒数�?
建议输出�?
```text
source.mp4             原始文件
proxy.mp4              Web 播放代理文件
analysis.wav           44.1 kHz �?22.05 kHz 单声道分析音�?vision.mp4             视觉分析代理视频
thumbnail.webp         课程封面
media-metadata.json    媒体参数与时间基
```

必须保留原始 PTS/DTS 与旋转信息，禁止仅按帧号估算时间。可变帧率视频必须先建立帧时间映射�?
### 4.2 输入质量评估

在正式转录前计算�?
- 音频是否存在�?- RMS/LUFS 音量�?- 削波比例�?- 噪声底估计�?- 音乐占比�?- 视频清晰度、亮度和抖动�?- 手部检测覆盖率�?- 指板检测覆盖率�?
输出统一质量对象�?
```json
{
  "audio": {
    "present": true,
    "level": "good",
    "noise": "medium",
    "clippingRatio": 0.002
  },
  "video": {
    "sharpness": 0.83,
    "brightness": 0.72,
    "leftHandVisibility": 0.91,
    "rightHandVisibility": 0.87,
    "fretboardVisibility": 0.79
  }
}
```

### 4.3 音符识别

第一版使�?Spotify Basic Pitch�?
```text
analysis.wav
    �?Basic Pitch
    �?候选音符：onset、offset、MIDI pitch、velocity、confidence
```

选择理由�?
- 支持复音输入�?- 单乐器录音适配本项目�?- 模型较轻�?- �?Python 包和多种推理格式�?- Apache-2.0 许可证�?
Basic Pitch 只负责候选音符，不直接作为六线谱最终结果。扫弦、闷音、泛音、击弦、勾弦和滑音均需要单独后处理或降级表达�?
### 4.4 节拍、小节和乐句

使用 Beat This! 输出�?
- beat 时间点�?- downbeat 时间点�?- BPM 曲线�?- 小节边界�?
处理顺序�?
```text
音频
  �?beat/downbeat
  �?拍号候�?  �?小节网格
  �?音符量化
  �?乐句分段
```

乐句分段综合�?
- 长休止�?- 和弦循环边界�?- 小节边界�?- 音符密度变化�?- 重复旋律�?- 视觉换把或动作停顿�?
第一版允许人工精修演示视频的拍号、小节和乐句；普通视频保�?AI 可信度�?
### 4.5 和弦识别

不依赖单一和弦模型，采用融合方案：

```text
Basic Pitch 音符集合
      +
CQT/HPCP/Chroma
      +
Beat This 拍点
      +
吉他常用和弦模板
      �?每拍和弦概率
      �?时序平滑
      �?最终和弦轨
```

和弦后处理规则：

- 优先�?beat/downbeat 附近切换和弦�?- 抑制数十毫秒内的快速标签抖动�?- 根音、三音和七音权重高于重复五音�?- 结合当前调性降低不合理和弦概率�?- 结合吉他常用开放和弦和把位�?- 置信度过低时输出 `N`，不强行命名�?
### 4.6 音高到琴弦和品位

这是必须自行实现的核心模块�?
标准调弦下，同一个音高可能出现在多个弦品位置。需要建立候选：

```text
MIDI 音高 �?[(琴弦, 品位), ...]
```

使用 Beam Search 或动态规划选择整段最合理的指法路径�?
硬约束：

- 音高必须与调弦和品位一致�?- 同一琴弦同一时刻不能出现两个不同品位�?- 品位不得超出产品支持范围�?
软约束：

| 约束 | 建议权重 |
|---|---:|
| 视频估计把位一�?| 5.0 |
| 常用和弦形状一�?| 4.0 |
| 相邻事件换把距离�?| 3.0 |
| 同时音符手指跨度可达 | 3.0 |
| 保留公共手指 | 2.0 |
| 避免不必要跨�?| 1.5 |
| 合理使用空弦 | 1.0，可配置 |

输出至少保留前三个候选路径，便于人工校对和后续视觉融合�?
### 4.7 六线谱生�?
将最终演奏事件转换为内部 Score JSON，再适配 alphaTab�?
内部模型不可直接绑定 alphaTab，以便未来替换谱面引擎或支持移动端原生渲染�?
```text
Analysis Events
    �?Canonical Score JSON
    ├── alphaTex/alphaTab Adapter
    ├── MusicXML Adapter
    └── MIDI Export Adapter
```

第一版必须支持：

- 音符与和弦�?- 琴弦与品位�?- 拍号和小节�?- 基本时值与休止�?- 播放光标�?- 音符点击定位�?
装饰音、复杂连音、泛音和特殊技法可在后续扩展�?
## 5. 左右手视觉分�?
### 5.1 首版目标边界

首版自动视觉能力的可靠目标是�?
- 定位左右手�?- 生成稳定的左右手裁切特写�?- 标记手指骨架和大致移动方向�?- 识别明显换把时刻�?- 在高可信度情况下显示指尖落点�?
首版不应承诺仅凭任意单机位视频，准确识别每次按弦手指和每次拨弦琴弦。遮挡、运动模糊和琴弦尺寸会使纯视觉精确识别不可靠�?
### 5.2 视觉流水�?
```text
vision.mp4
    �?人物/吉他/琴颈/指板检�?    �?MediaPipe 两手关键�?    �?左右手角色判�?    �?指板四角与透视校正
    �?品丝线和六弦几何网格
    �?指尖映射至弦品候�?    �?与音频弦品候选融�?    �?动作事件与稳定裁切框
```

### 5.3 左右手角色判�?
不要直接依赖 MediaPipe �?Left/Right 标签，因为视频可能镜像�?
推荐规则�?
- 更靠近琴颈并沿指板长轴移动的手为按弦手�?- 更靠近音�?琴桥并呈周期拨动的手为拨弦手�?- 结合琴颈方向和人体姿态进行稳定判断�?- 一旦在前几秒建立角色，使用轨迹 ID 保持一致，避免逐帧交换�?
### 5.4 指板坐标�?
检测指板四角后进行单应性变换，将斜视指板变成标准矩形坐标�?
标准坐标�?
```text
x：沿琴颈方向，对应品�?y：跨琴颈方向，对应琴�?```

品位不是等距分布，应使用十二平均律位置关系或从可见品丝拟合。琴弦可使用六条几何模板线，再结合可见边缘微调�?
### 5.5 手指落点与动�?
MediaPipe 提供 21 个手部关键点。关注：

- 四指指尖�?- 四指末端关节�?- 拇指指尖�?- 手腕�?
动作事件包括�?
```text
finger_down
finger_up
position_shift
fingering_hold
pluck_up
pluck_down
strum_up
strum_down
```

音频起音用于校正视觉动作时间：视觉手指接触发生在音频起音之前或附近，拨弦动作与起音高度相关�?
### 5.6 裁切稳定

智能双视图不能直接使用逐帧检测框，否则画面会抖动�?
处理方法�?
- 检测框加入边距�?- 使用卡尔曼滤波或指数平滑�?- 短时间丢失时沿用上一轨迹�?- 裁切速度设最大变化率�?- 换把时提前扩大左手裁切区域�?- 输出离线 crop track，而不是浏览器实时重新检测�?
## 6. 多模态统一时间�?
### 6.1 时间规范

所有离线分析结果统一使用原始媒体秒数�?
```text
sourceTimeSeconds: number
```

必须区分�?
- `sourceTime`：原始视频中的时间�?- `playbackTime`：播放器当前媒体位置�?- `audioContextTime`：浏览器音频时钟�?- `inputTime`：麦克风采集时间�?- `wallClockTime`：系统墙钟时间，仅用于日志�?
### 6.2 演奏事件

```json
{
  "id": "note_024",
  "type": "note",
  "sourceStart": 18.420,
  "sourceEnd": 18.710,
  "measureIndex": 6,
  "beatPosition": 2.0,
  "midiPitch": 64,
  "pitchName": "E4",
  "string": 1,
  "fret": 0,
  "chordId": "chord_018",
  "confidence": {
    "pitch": 0.94,
    "timing": 0.91,
    "stringFret": 0.78
  },
  "leftMotionId": "lm_024",
  "rightMotionId": "rm_024"
}
```

### 6.3 动作事件

```json
{
  "id": "lm_024",
  "hand": "left",
  "action": "fingering_hold",
  "sourceStart": 18.100,
  "sourceEnd": 18.760,
  "cropTrackId": "left_crop_main",
  "fingerPositions": [
    {"finger": 1, "string": 2, "fret": 1, "confidence": 0.82}
  ],
  "confidence": 0.81
}
```

### 6.4 播放同步原则

- 原视频播放器是播放时钟主源�?- 谱面、波形、和弦轨和动作视图订阅同一时钟�?- UI 使用 `requestAnimationFrame` 更新，分析数据不直接驱动播放器�?- 点击任意事件时统一调用 `seekTo(sourceTime)`�?- 循环结束误差需经过自动补偿，避免多轮后逐渐漂移�?- 变速只改变播放速度，不修改源事件时间�?
## 7. 浏览器实时跟�?
### 7.1 核心策略

实时跟练不做开放式“再次扒完整首曲”，而做谱面引导的候选约束识别�?
已知当前目标音符或和弦后，系统只需判断�?
- 是否发生有效起音�?- 目标音是否出现�?- 是否出现明显的非目标音�?- 和弦关键组成音是否缺失�?- 用户起音相对目标时间提前或延后多少�?
这种方式比开放式实时转录更快、更稳定，也更符合教学需求�?
### 7.2 浏览器音频链�?
```text
navigator.mediaDevices.getUserMedia
    �?AudioContext
    �?AudioWorkletProcessor
    �?环形缓冲�?    �?DC Removal / Noise Gate / Gain Normalization
    �?Onset Detection
    �?Pitch / Chroma / Spectral Features
    �?Target-Constrained Matcher
    �?即时 UI 反馈
```

AudioWorklet 中禁止执行大型模型和频繁分配对象。复杂推理放�?Worker、WASM 或服务端�?
### 7.3 本地与服务端分工

浏览器本地：

- 麦克风权限和设备选择�?- 环境噪声、输入音量和延迟校准�?- 起音检测�?- 单音基频估计�?- 基础 Chroma�?- 当前目标的快速匹配�?- 即时颜色和节奏反馈�?
服务端：

- 复杂复音与和弦分析�?- 整个乐句的二次对齐�?- 错误聚合�?- 前后练习比较�?- 长期薄弱点分析�?
### 7.4 延迟校准

开始练习前�?
1. 获取音频输入设备�?2. 监听环境 3 秒�?3. 用户按提示弹一个空弦�?4. 测得麦克风起音时间�?5. 估算输入、处理和显示的总偏移�?6. 本轮练习统一使用该偏移修正�?
蓝牙设备可能引入较高且不稳定延迟，应提示用户改用电脑麦克风或有线设备�?
## 8. 教学友好型评分引�?
### 8.1 结果类型

```text
correct
wrong_note
wrong_chord
missing_note
early
late
uncertain
not_detected
```

### 8.2 判定输入

- 目标演奏事件�?- 麦克风观测事件�?- 当前 BPM 和音符时值�?- 校准延迟�?- 环境噪声评分�?- 音高/和弦模型置信度�?- 前后目标事件�?
### 8.3 时间容错

容错窗口不能永久固定为一个毫秒数，应根据音符时值和速度计算�?
```text
beatDurationMs = 60000 / BPM
toleranceMs = clamp(beatDurationMs × noteToleranceRatio, minMs, maxMs)
```

建议初始区间�?
- 轻微偏差：约 80�?50 ms，仅标黄�?- 明显偏差：超过动态阈值后标为 early/late�?- 连续流畅演奏时适当放宽单音时间阈值�?- 关键换把和重拍可使用更严格的相对节奏判断�?
这些值必须通过真实用户数据校准，不应作为最终常量�?
### 8.4 错音判定

需要满足：

- 检测音高持续若干帧�?- 音高置信度达到阈值�?- 不属于上一音符的自然延音�?- 与目标音差异超过调音偏差容忍范围�?- 环境质量允许给出确定结论�?
低置信度结果标记�?`uncertain`，不在演奏中显示红色错误�?
### 8.5 和弦完整�?
组成音权重不同：

- 根音：高权重�?- 三音：高权重，决定大小调性质�?- 七音或扩展音：视目标和弦而定�?- 重复五音：较低权重�?
最终展示“缺少哪根弦”时，必须同时具备可靠的弦品推断或目标和弦指法；否则只展示“缺�?E 音”，避免输出伪精确琴弦�?
### 8.6 错误聚合

不要逐帧生成独立错误。将相邻观测聚合为演奏事件，再将多个事件聚合为教学问题：

```text
多次 1 弦漏�?    �?C 和弦指法问题

连续三个音都�?    �?整体进入偏慢

只在换把后首音漏�?    �?换把准备不足
```

## 9. 自动练习状态机

### 9.1 状�?
```text
IDLE
WATCH_TEACHER
COUNT_IN
LISTENING
ANALYZING
RETRY_SAME_SPEED
SLOW_DOWN
SPEED_UP
PASSED
```

### 9.2 默认流程

```text
检测到重复错误
  �?创建错误前后练习区间
  �?WATCH_TEACHER
  �?60% COUNT_IN
  �?LISTENING
  �?ANALYZING
      ├── 未通过 �?RETRY_SAME_SPEED �?SLOW_DOWN
      └── 通过   �?SPEED_UP
  �?75%
  �?90%
  �?100%
  �?PASSED
```

### 9.3 达标建议

- 关键音符正确率不低于 90%�?- 和弦完整度不低于 85%�?- 明显节奏偏差不超�?2 次�?- 目标错误连续正确 2 次�?
这些阈值作为初始产品配置存储，后续允许按难度、BPM 和用户历史动态调整�?
## 10. 变速与循环

### 10.1 首选方�?
优先验证浏览器原生：

```javascript
video.playbackRate = 0.75;
video.preservesPitch = true;
```

MVP 速度档：

```text
50%�?0%�?5%�?0%�?00%
```

### 10.2 SoundTouchJS 备�?
原生播放出现音高保持或兼容性问题时，使�?SoundTouchJS AudioWorklet 实现。接入前必须验证�?
- Chrome、Safari、Edge�?- MP4/MOV 代理视频�?- 0.5× 长时间循环�?- 视频与处理音频是否漂移�?- 移动端耗电和爆音�?
### 10.3 循环区间

默认区间为错误前一小节至错误后一小节。单次换把错误可缩短�?2�? 秒�?
循环需要：

- 在进入点前保留视觉准备时间�?- 在结束点后保留动作衔接时间�?- 每轮开始包含可配置的倒计时�?- 避免硬切产生爆音，音频边界加入短淡入淡出�?
## 11. 数据模型

### 11.1 Course

```text
id
title
sourceVideoUrl
proxyVideoUrl
analysisAudioUrl
duration
bpm
timeSignature
tuning
analysisStatus
analysisVersion
overallConfidence
demoPresetId
createdAt
updatedAt
```

### 11.2 Measure

```text
id
courseId
index
sourceStart
sourceEnd
beatTimes[]
chords[]
difficulty
difficultyTags[]
confidence
```

### 11.3 PerformanceEvent

```text
id
courseId
measureId
type
sourceStart
sourceEnd
beatPosition
midiPitch
pitchName
string
fret
chordId
fingering
confidence
```

### 11.4 MotionEvent

```text
id
performanceEventId
hand
actionType
sourceStart
sourceEnd
cropTrackId
fingerPositions
direction
confidence
```

### 11.5 ObservationEvent

```text
id
practiceSessionId
targetEventId
inputStart
correctedSourceTime
detectedPitches
detectedChord
timingOffsetMs
confidence
environmentQuality
```

### 11.6 EvaluationResult

```text
id
observationId
resultType
severity
expected
actual
explanation
suggestedAction
```

## 12. API 建议

### 12.1 上传

```text
POST /uploads
POST /courses
POST /courses/{id}/analyze
GET  /analysis-jobs/{id}
GET  /analysis-jobs/{id}/events
```

解析进度建议使用 SSE，因为主要是服务端单向推送，连接和重连逻辑比双�?WebSocket 简单�?
### 12.2 课程

```text
GET /courses
GET /courses/{id}
GET /courses/{id}/timeline
GET /courses/{id}/score
GET /courses/{id}/segments
```

### 12.3 跟练

```text
POST /practice-sessions
POST /practice-sessions/{id}/calibration
POST /practice-sessions/{id}/observations
POST /practice-sessions/{id}/finish
GET  /practice-sessions/{id}/summary
```

需要低延迟双向传输时，再为音频特征或短音频块增�?WebSocket，不应默认把完整原始麦克风流持续传给服务端�?
## 13. 推荐仓库结构

```text
apps/
  web/                       Next.js Web
services/
  api/                       FastAPI 产品 API
  media-worker/              FFmpeg 预处�?  transcription-worker/      Basic Pitch、Beat This、和弦、弦�?  vision-worker/             MediaPipe、指板和动作
  realtime-scoring/          服务端二次评�?packages/
  timeline-schema/           跨前后端统一时间�?  score-model/               Canonical Score JSON
  score-adapter-alphatab/    alphaTab 转换
  scoring-engine/            教学友好型规�?  practice-engine/           练习状态机
  shared-types/              API 类型
models/
  configs/
  checkpoints/
evaluation/
  datasets/
  scripts/
  reports/
```

## 14. 开源许可证风险

| 项目 | 许可�?| 建议 |
|---|---|---|
| Basic Pitch | Apache-2.0 | 可用于商�?MVP，保留版权和许可�?|
| Beat This! | MIT | 可采用；训练数据许可需单独核查 |
| MediaPipe | Apache-2.0 | 可采�?|
| FretNet | MIT | 可研究和二次开�?|
| alphaTab | MPL-2.0 | 可采用；修改其文件时遵守文件级开源要�?|
| SoundTouchJS | MPL-2.0 | 可采用；同样注意文件级修改义�?|
| librosa | ISC | 可采�?|
| Essentia/Essentia.js | AGPL-3.0 | 闭源商业产品需谨慎，优先用于原型或另行授权 |
| Ultralytics | AGPL-3.0/商业许可 | 不建议未经许可直接集成闭源服�?|
| Demucs | MIT，但原仓库归�?| 仅作为可选分离实验，不作为核心依�?|

模型权重、代码许可证和训练数据许可证是三件不同的事情，接入前必须分别记录�?
## 15. 不推荐的技术路�?
### 15.1 单独使用 Basic Pitch 直接生成六线�?
原因：它只输出音高，不能唯一确定琴弦和品位，也不知道老师的真实指法�?
### 15.2 只使用视觉判断每个音�?
原因：手指遮挡、运动模糊、琴弦过细和单机位透视导致误差过高。视觉应与音频融合�?
### 15.3 实时跟练重新做开放式完整转录

原因：延迟高、错误空间大，并浪费已知目标谱面的先验。应采用目标约束识别�?
### 15.4 首版训练一个端到端超大模型

原因：数据不足、调试困难、不可解释，无法快速定位是音高、节拍、弦品还是视觉出错�?
### 15.5 首版默认使用 Demucs 分离

单人木吉他教学视频通常不需要音源分离。只有检测到伴奏、人声或其他乐器时才进入可选分离分支�?
## 16. 技术验证计�?
### 16.1 PoC A：音频转�?
样本�?0 �?30�?0 秒木吉他视频�?
比较�?
- Basic Pitch�?- FretNet�?- trimplexx CRNN�?- Omnizart 对照�?
指标�?
- Note onset F1�?- Note with offset F1�?- Multi-pitch F1�?- String/fret F1�?- 每分钟人工修正次数�?- 单分钟视频推理耗时�?
输出：确定初版音频模型组合和失败类型�?
### 16.2 PoC B：节拍与谱面

- Beat This 输出拍点�?downbeat�?- 音符量化到小节�?- 生成 Canonical Score JSON�?- alphaTab 渲染�?- 点击音符跳转视频�?
验收：完整播�?90 秒后谱面光标与视频无可见漂移�?
### 16.3 PoC C：智能双手裁�?
- MediaPipe 跟踪两只手�?- 判定按弦手和拨弦手�?- 输出平滑裁切轨迹�?- 检测明显换把�?
指标�?
- 手部覆盖率�?- 裁切丢失帧率�?- 错误交换左右手次数�?- 裁切中心抖动�?
### 16.4 PoC D：实时跟�?
- AudioWorklet 采集�?- 环境校准�?- 起音与单音检测�?- 目标约束匹配�?- 错误时间定位�?
指标�?
- 端到端反馈延迟�?- 正确音误报率�?- 明显错音召回率�?- 漏音召回率�?- 不同麦克风与噪声下的稳定性�?
## 17. 分阶段实�?
### 阶段 0：数据与评估基线，约 1 �?
- 准备 20 段验证视频�?- 制作人工真值谱面与时间点�?- 定义事件 JSON Schema�?- 建立离线评分脚本�?
完成标准：任何模型更换后都能得到可比较的指标报告�?
### 阶段 1：四个独�?PoC，约 2 �?
- Basic Pitch/Beat This 音频 PoC�?- alphaTab 同步 PoC�?- MediaPipe 双手裁切 PoC�?- AudioWorklet 实时监听 PoC�?
完成标准：确认每条关键技术链可以工作，并记录失败边界�?
### 阶段 2：路演闭环，�?3�? �?
- 上传与解析进度�?- 精修演示视频指纹命中�?- 谱面、视频、波形和双手同步�?- 真实麦克风跟练�?- 错误定位�?- 降速、拆句、循环�?- 前后比较与提速�?
完成标准：在 5�? 分钟内稳定展示完整闭环�?
### 阶段 3：普通视频真实解析，�?4�? �?
- 弦品 Beam Search�?- 和弦融合与时序平滑�?- 指板检测与视觉融合�?- 低可信度降级�?- 普通上传视频解析报告�?
完成标准：普通单人木吉他视频能够生成可练习初稿，并明确标识不确定结果�?
### 阶段 4：移动端

- 复用时间轴、课程和评分协议�?- 原生或跨平台 UI�?- 移动端麦克风与延迟校准�?- 横屏跟练和离线缓存�?
## 18. MVP 技术验收标�?
### 18.1 上传解析

- MP4/MOV 上传和断点状态可恢复�?- 解析任务可查询、可重试�?- 演示视频稳定读取精修结果�?- 普通视频真实运行分析流程�?
### 18.2 谱音画同�?
- 音符、和弦和小节具有原视频时间点�?- 点击音符可跳到对应视频位置�?- 左右手裁切与原视频同步�?- 变速和多轮循环后无明显漂移�?
### 18.3 实时检�?
- 可完成麦克风权限、环境检查和校准�?- 能识别路演设计中的错音、漏音和明显节奏错误�?- 反馈定位到具体事件与小节�?- 环境噪声下不会持续误报�?
### 18.4 智能练习

- 能根据错误创建循环区间�?- 能从 60% 逐步提升�?100%�?- 能跳回老师动作�?- 能比较两次练习结果�?- 连续失败时能够缩短片段或降低速度�?
## 19. 技术决策摘�?
最终推荐组合：

```text
离线音频：FFmpeg + Basic Pitch + Beat This + 自研弦品求解
离线视觉：MediaPipe + 自研指板检�?+ OpenCV + 音视融合
谱面显示：Canonical Score JSON + alphaTab
实时监听：AudioWorklet + 轻量 DSP + 目标约束匹配 + 服务端二次评�?练习闭环：自研错误聚�?+ 自适应练习状态机
服务端：FastAPI + Celery + Redis + PostgreSQL + S3/R2
前端：Next.js + TypeScript + alphaTab + wavesurfer.js
```

最需要投入研发的顺序�?
1. 统一时间轴和内部事件协议�?2. 谱面引导的实时低误报评分�?3. 音高到弦品的指法求解�?4. 音频与左右手动作融合�?5. 自适应练习状态机�?
不要�?MVP 成败押在“任意视频一次性完美扒谱”上。先通过精修演示数据证明完整学习体验，再用普通视频解析持续积累数据和提升模型，是风险最低、最符合当前产品目标的技术路线�?
## 20. GitHub 项目索引

### 核心采用

- Basic Pitch：https://github.com/spotify/basic-pitch
- Beat This：https://github.com/CPJKU/beat_this
- alphaTab：https://github.com/CoderLine/alphaTab
- MediaPipe：https://github.com/google-ai-edge/mediapipe
- FFmpeg：https://github.com/FFmpeg/FFmpeg
- OpenCV：https://github.com/opencv/opencv
- librosa：https://github.com/librosa/librosa
- wavesurfer.js：https://github.com/katspaugh/wavesurfer.js

### 研究与对�?
- FretNet：https://github.com/cwitkowitz/guitar-transcription-continuous
- GuitarSet：https://github.com/marl/GuitarSet
- Guitar Tab CRNN：https://github.com/trimplexx/music-transcription
- Omnizart：https://github.com/Music-and-Culture-Technology-Lab/omnizart
- MT3：https://github.com/magenta/mt3
- YourMT3：https://github.com/mimbres/YourMT3
- madmom：https://github.com/CPJKU/madmom

### 浏览器音频与播放

- Essentia.js：https://github.com/MTG/essentia.js
- SoundTouchJS：https://github.com/cutterbl/SoundTouchJS
- VexFlow：https://github.com/0xfe/vexflow
- OpenSheetMusicDisplay：https://github.com/opensheetmusicdisplay/opensheetmusicdisplay

### 数据与论文入�?
- GuitarSet 工具与说明：https://github.com/marl/GuitarSet
- FretNet 论文：https://arxiv.org/abs/2212.03023
- Beat This 论文：https://arxiv.org/abs/2407.21658
- Basic Pitch 项目与论文入口：https://github.com/spotify/basic-pitch

