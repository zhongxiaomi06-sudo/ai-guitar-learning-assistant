# 语音控制功能构建文档

> 本文档描述「弦间」跟练系统中的语音控制功能。用户在持琴练习时，按住顶部语音按钮说话，松开后系统通过百度语音识别 + LLM 命令解析完成播放、调速、循环、导航等操作。
> 最后更新：2026-07-22

---

## 1. 目标

在跟练场景下，用户双手持吉他，眼睛看谱面，频繁伸手点击键盘或鼠标会打断演奏节奏。语音控制用于：

- **播放/暂停**：开始或暂停跟练。
- **调速**：加快、减慢、恢复默认速度。
- **循环**：开启/关闭 A/B 循环，回到难点。
- **导航**：返回概览、进入纠错、下一片段、上一片段。
- **麦克风**：开启/关闭麦克风监听。
- **辅助**：显示帮助、结束练习。

**范围边界**：

- 首版仅支持桌面端浏览器（需要 `MediaRecorder` 和 `getUserMedia`）。
- 采用「按住说话、松开识别」的推按式（push-to-talk）交互，避免持续监听导致的误触发。
- 仅作为辅助入口，不替代原有按钮/键盘控制。
- 后端未配置百度/LLM 凭据时，语音入口仍可见但会返回错误提示。

---

## 2. 技术方案

### 2.1 整体架构

采用「前端录音 + 后端识别 + LLM 解析」的三段式架构：

```text
浏览器 MediaRecorder 录制 WebM/Opus 音频
  → POST /api/v1/voice/recognize
  → 后端 ffmpeg 转码为 16kHz WAV
  → 百度语音识别 (ASR) 返回中文转写文本
  → LLM 将自然语言解析为结构化 JSON 命令
  → 前端收到 { action, payload } 并执行
```

**为什么不用浏览器原生 Web Speech API**：

- Web Speech API 在 Firefox 不支持，Chrome/Edge 依赖厂商云端且无法自定义。
- 吉他练习环境有琴声干扰，百度 ASR 支持短语音专用模型，对中文短语识别更稳定。
- LLM 解析可处理「把速度调到 75%」这类带参数的自然语言，关键词匹配难以覆盖。
- 后端代理便于切换 ASR/LLM 供应商，不绑定前端实现。

### 2.2 命令设计

| 命令 | 口令示例 | action | payload |
|------|----------|--------|---------|
| 播放 | 「播放」「开始」「继续」 | `toggle-play` | `{ play: true }` |
| 暂停 | 「暂停」「停」 | `toggle-play` | `{ play: false }` |
| 重练 | 「重练」「重来」「再来一次」 | `seek-to-segment-start` | `{}` |
| 降速 | 「慢一点」「降速」 | `adjust-speed` | `{ delta: -1 }` |
| 提速 | 「快一点」「提速」 | `adjust-speed` | `{ delta: 1 }` |
| 原速 | 「原速」「恢复速度」 | `set-speed` | `{ speed: 1 }` |
| 开循环 | 「循环」「开启循环」 | `toggle-loop` | `{}` |
| 关循环 | 「关闭循环」 | `toggle-loop` | `{}` |
| 开麦克风 | 「打开麦克风」「开启麦克风」 | `open-mic` | `{ enabled: true }` |
| 关麦克风 | 「关闭麦克风」 | `open-mic` | `{ enabled: false }` |
| 返回 | 「返回」「回去」 | `navigate` | `{ route: 'overview' }` |
| 下一片段 | 「下一片段」「下一首」 | `next-segment` | `{}` |
| 上一片段 | 「上一片段」「上一首」 | `prev-segment` | `{}` |
| 纠错 | 「纠错」「攻克难点」 | `open-focus` | `{}` |
| 帮助 | 「帮助」「有什么命令」 | `show-voice-help` | `{}` |
| 结束 | 「结束」「完成」 | `finish-practice` | `{}` |

LLM 可理解带参数的变体，例如：
- 「把速度调到 75%」→ `{ action: 'set-speed', payload: { speed: 0.75 } }`
- 「跳到第三小节」→ 后续扩展

---

## 3. 模块结构

### 3.1 前端模块

```
src/
├── core/voice/
│   ├── recorder.js      # MediaRecorder 录音封装
│   ├── client.js        # 后端通信（POST 音频 blob）
│   ├── controller.js    # 推按式语音控制器（状态机）
│   └── commands.js       # 命令表（用于帮助浮层和文档）
└── product-app.js       # 集成：状态管理、UI 更新、事件分发
```

### 3.2 后端模块

```
backend/app/
├── config.py                       # 百度 ASR + LLM 配置项
├── api/voice.py                    # POST /api/v1/voice/recognize
└── services/voice_service.py       # 转码 + 百度 ASR + LLM 解析 + fallback
```

### 3.3 数据流

```text
用户按住语音按钮
  → VoiceRecorder.start() (MediaRecorder)
  → 松开按钮 / 超时 6 秒
  → VoiceRecorder.stop() → Blob
  → sendVoiceCommand(blob) → POST /api/v1/voice/recognize
  → voice_service.recognize_and_parse()
      → ffmpeg 转 16kHz WAV
      → 百度 ASR → 中文转写文本
      → LLM 解析 (或 fallback 关键词匹配) → { action, payload, reply }
  → VoiceController._execute()
  → dispatcher(action, payload) → handleAction()
  → 更新 state + UI + 视频/音频
  → onStateChange('executed') → 显示 reply toast
```

---

## 4. 核心实现

### 4.1 前端录音：`src/core/voice/recorder.js`

使用 `MediaRecorder` 录制 WebM/Opus 音频，按 100ms 分片收集：

```js
export class VoiceRecorder {
  _chooseMimeType() {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (const type of preferred) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  async start() {
    this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.audioStream, options);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.recordedChunks.push(event.data);
    };
    this.mediaRecorder.start(100);
  }

  stop() {
    // 返回 Promise<Blob|null>，释放音频流
  }
}
```

### 4.2 后端通信：`src/core/voice/client.js`

将音频 blob 作为 `multipart/form-data` 发送到后端：

```js
export async function sendVoiceCommand(audioBlob) {
  const form = new FormData();
  const extension = audioBlob.type?.includes('webm') ? 'webm' : 'ogg';
  form.append('audio', audioBlob, `voice.${extension}`);
  return postForm('/api/v1/voice/recognize', form, { timeoutMs: 30_000 });
}
```

### 4.3 推按式控制器：`src/core/voice/controller.js`

`VoiceController` 是一个状态机，管理 `idle → recording → processing → idle` 的状态流转：

- **start()**：开始录音，设置 6 秒自动超时。
- **stop()**：停止录音，发送到后端，执行返回的命令。
- **冷却期**：命令执行后 1.2 秒冷却，防止误触发。
- **isSupported()**：检测 `getUserMedia` 和 `MediaRecorder` 是否可用。

```js
export class VoiceController {
  constructor(options = {}) {
    this.dispatcher = options.dispatcher || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.maxDurationMs = options.maxDurationMs || 6000;
    this.cooldownMs = options.cooldownMs || 1200;
    this.recorder = new VoiceRecorder();
    // ...
  }

  async start() {
    await this.recorder.start();
    this.recording = true;
    this.onStateChange('recording');
    this.timer = window.setTimeout(() => this.stop(), this.maxDurationMs);
  }

  async stop() {
    const blob = await this.recorder.stop();
    const result = await sendVoiceCommand(blob);
    this._execute(result);
  }

  _execute(result) {
    if (!result || result.action === 'unrecognized') {
      this.onStateChange('unrecognized', result?.raw_text || '');
      return;
    }
    this.dispatcher(result.action, result.payload || {});
    this.onStateChange('executed', result);
  }
}
```

状态回调映射：

| 状态 | 说明 | UI 效果 |
|------|------|---------|
| `recording` | 正在录音 | 语音按钮闪烁「正在聆听…」 |
| `processing` | 后端识别中 | 按钮显示处理动画 |
| `idle` | 空闲 | 恢复默认 |
| `error` | 出错 | toast 错误提示 |
| `unrecognized` | 未识别到命令 | toast「未识别」 |
| `executed` | 命令已执行 | 显示 LLM 返回的 `reply` |

### 4.4 后端服务：`backend/app/services/voice_service.py`

#### 音频转码

使用 `ffmpeg` 将浏览器录制的 WebM/Opus 转换为百度 ASR 要求的 16kHz 单声道 PCM WAV：

```python
def _ensure_wav_16k(input_bytes: bytes, suffix: str) -> bytes:
    subprocess.run([
        "ffmpeg", "-y", "-i", str(src_path),
        "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", str(dst_path),
    ], check=True, ...)
```

#### 百度语音识别

获取百度 OAuth token（缓存 30 天），发送 base64 编码的 WAV 到短语音识别 API：

```python
async def _transcribe_with_baidu(audio_bytes: bytes, settings: Settings) -> str:
    token = await _get_baidu_token(settings)
    body = {
        "format": "wav", "rate": 16000, "channel": 1,
        "cuid": cuid, "token": token,
        "len": len(audio_bytes),
        "speech": base64.b64encode(audio_bytes).decode("utf-8"),
        "dev_pid": settings.baidu_speech_dev_pid,
    }
    # POST https://vop.baidu.com/server_api
    return result[0]  # 转写文本
```

#### LLM 命令解析

将转写文本发送给 LLM（OpenAI 兼容接口），返回结构化 JSON：

```python
async def _parse_with_llm(transcript: str, settings: Settings) -> dict:
    user_prompt = _build_command_prompt(transcript)  # 包含命令 schema 和示例
    # POST {llm_api_base}/chat/completions
    # 解析返回的 JSON: { action, payload, confidence, raw_text, reply }
```

#### Fallback 关键词匹配

当 LLM 未配置或解析失败时，使用中文关键词匹配作为降级方案：

```python
_FALLBACK_KEYWORDS = [
    ("play", ["播放", "开始", "继续"], {"action": "toggle-play", "payload": {"play": True}}),
    ("pause", ["暂停", "停"], {"action": "toggle-play", "payload": {"play": False}}),
    # ... 16 条命令
]
```

### 4.5 后端 API：`backend/app/api/voice.py`

```python
@router.post("/recognize")
async def recognize_voice_command(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    suffix = _detect_suffix(audio.filename)
    result = await recognize_and_parse(audio_bytes, suffix)
    return result
```

返回格式：

```json
{
  "action": "toggle-play",
  "payload": { "play": true },
  "confidence": 1.0,
  "raw_text": "播放",
  "reply": "已播放"
}
```

### 4.6 前端集成：`product-app.js`

#### 状态管理

```js
const state = {
  voiceEnabled: false,
  voiceRecording: false,
  voiceProcessing: false,
  voiceWakeWord: false,
  // ...
};
```

语音开关和唤醒词设置通过 `localStorage` 持久化（`loadPreferences` / `savePreferences`）。

#### 初始化

```js
function initVoiceControl() {
  if (!VoiceController.isSupported()) return;
  voiceController = new VoiceController({
    dispatcher(action, payload) {
      handleAction(action, null, payload);
    },
    onStateChange(stateName, detail) {
      // 更新 state.voiceRecording / voiceProcessing
      // 显示 toast 提示
      updateVoiceUI();
    },
  });
}

function bootstrap() {
  loadPreferences();    // 恢复 voiceEnabled / voiceWakeWord
  initVoiceControl();   // 创建 VoiceController
  updateVoiceUI();      // 同步 UI 开关状态
}
```

#### 推按式事件绑定

语音按钮支持鼠标和触摸的按住-松开：

```js
voicePill.addEventListener('mousedown', start);   // 开始录音
voicePill.addEventListener('touchstart', start);
voicePill.addEventListener('mouseup', stop);       // 停止并发送
voicePill.addEventListener('mouseleave', stop);
voicePill.addEventListener('touchend', stop);
```

按住时如果语音控制未开启，先自动开启再开始录音。

#### UI 更新

```js
function updateVoiceUI() {
  pill.classList.toggle('is-on', state.voiceEnabled);
  dot.classList.toggle('is-recording', state.voiceRecording);
  dot.classList.toggle('is-processing', state.voiceProcessing);
  switchButton.classList.toggle('is-on', state.voiceEnabled);
}
```

---

## 5. 后端配置

### 5.1 环境变量

在 `backend/.env` 中配置（参考 `backend/.env.example`）：

```ini
# 百度语音识别
BAIDU_SPEECH_APP_ID=你的AppID
BAIDU_SPEECH_API_KEY=你的APIKey
BAIDU_SPEECH_SECRET_KEY=你的SecretKey
BAIDU_SPEECH_DEV_PID=1537
# 1537 = 普通话, 1737 = 英语

# LLM 命令解析（OpenAI 兼容接口）
LLM_API_BASE=https://api.openai.com/v1
LLM_API_KEY=你的密钥
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.0
```

### 5.2 依赖

- `httpx>=0.27.0`：异步 HTTP 请求（百度 ASR + LLM 调用）
- `ffmpeg`：系统级音频转码（需安装到 PATH）

### 5.3 降级策略

| 条件 | 行为 |
|------|------|
| 百度凭据未配置 | 语音处理返回 503 错误，前端提示「语音处理失败」 |
| LLM 密钥未配置 | 使用 fallback 关键词匹配解析命令 |
| LLM 返回非法 JSON | 使用 fallback 关键词匹配 |
| ffmpeg 未安装 | 转码失败，返回 503 错误 |
| 浏览器不支持 MediaRecorder | 语音入口可见但点击时提示不支持 |

---

## 6. 命令帮助浮层

用户说「帮助」或点击设置中的「查看命令」时，显示命令列表浮层：

```html
<div class="voice-help-layer" data-voice-help hidden>
  <div class="modal-backdrop" data-action="close-voice-help"></div>
  <section class="voice-help-drawer" role="dialog" aria-modal="true">
    <p>按住顶部"语音"按钮，说出命令后松开。录音会发送到后端识别并解析为操作。</p>
    <pre class="voice-help-list">
播放 / 暂停
慢一点 / 快一点 / 原速
重来 / 循环 / 关闭循环
纠错 / 返回 / 下一片段 / 上一片段
打开麦克风 / 关闭麦克风
结束
    </pre>
  </section>
</div>
```

点击背景或关闭按钮触发 `close-voice-help` action，调用 `closeLayer` 关闭浮层。

---

## 7. 测试方案

### 7.1 手动测试流程

1. 在 `backend/.env` 中配置百度 ASR 凭据和 LLM 密钥。
2. 确保系统已安装 `ffmpeg`。
3. 启动后端：`cd backend && uvicorn app.main:app --reload`。
4. 启动前端：`npm run dev`。
5. 在浏览器中打开 `http://localhost:5173`。
6. 在设置面板中开启「语音控制」开关。
7. 按住顶部「语音」按钮，说「播放」，松开后视频应开始播放。
8. 按住说「暂停」，视频应暂停。
9. 按住说「慢一点」，速度应降低一档。
10. 按住说「原速」，恢复 1.0。
11. 按住说「循环」，开启 A/B 循环。
12. 按住说「纠错」，进入 focus 模式。
13. 按住说「帮助」，显示命令帮助浮层。
14. 未配置凭据时，按住按钮应显示「语音处理失败」错误提示。
15. 在 Firefox 中验证 `isSupported()` 返回 false 并提示不支持。

### 7.2 后端 API 测试

```bash
# 直接测试语音识别接口
curl -X POST http://127.0.0.1:8000/api/v1/voice/recognize \
  -F "audio=@test.webm"
```

预期返回：

```json
{
  "action": "toggle-play",
  "payload": { "play": true },
  "confidence": 1.0,
  "raw_text": "播放",
  "reply": "已播放"
}
```

### 7.3 抗干扰设计

- **推按式交互**：只在用户主动按住时录音，避免持续监听将琴声识别为命令。
- **冷却期**：命令执行后 1.2 秒冷却，防止重复触发。
- **超时保护**：最长录音 6 秒，超时自动停止并发送。
- **LLM 置信度**：低置信度结果标记为 `unrecognized`，不执行误识别命令。

---

## 8. 隐私与权限

### 8.1 用户告知

开启语音控制时提示：

```text
按住顶部语音按钮说话，松开后录音发送到后端进行语音识别。
录音仅用于命令识别，不会保存。
```

### 8.2 实现要求

- 默认关闭，必须用户主动在设置中开启。
- 推按式录音：只在按住按钮期间采集音频，松开立即停止。
- 音频流在 `stop()` 后立即释放（`getTracks().forEach(track => track.stop())`）。
- 后端不持久化音频文件，转码和识别在内存中完成。
- `beforeunload` 时调用 `voiceController.stop()` 释放资源。

---

## 9. 风险与降级

| 风险 | 应对 |
|------|------|
| 浏览器不支持 MediaRecorder | `isSupported()` 检测，提示不支持 |
| 用户拒绝麦克风权限 | 录音失败，提示在设置中手动控制 |
| 百度凭据未配置 | 后端返回 503，前端 toast 提示 |
| LLM 未配置 | 使用 fallback 关键词匹配 |
| ffmpeg 未安装 | 转码失败，返回 503 错误 |
| 网络延迟 | 30 秒超时，处理中显示等待动画 |
| 中文口音/方言识别率低 | 后续可切换百度 ASR 的方言模型 (dev_pid) |
| 琴声干扰识别 | 推按式交互避免持续监听，用户主动控制录音时机 |

---

## 10. 后续扩展

- 支持命令参数：「跳到第六小节」「把速度调到 75%」（LLM 已支持，需扩展 action 处理）。
- 支持方言识别：切换百度 ASR 的 `dev_pid`（如四川话 1637、粤语 1637）。
- 接入流式 ASR：支持长句连续语音输入。
- 语音反馈：用 `SpeechSynthesis` 播报 LLM 返回的 `reply`。
- 多语言支持：英文、日语命令解析。
- 与 MIDI 模拟结合：在自动化测试中加入语音命令验证。
