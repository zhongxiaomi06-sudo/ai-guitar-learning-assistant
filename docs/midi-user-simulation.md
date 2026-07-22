# MIDI 用户模拟流程

> 本文档描述一种「无真实吉他」的验证方式：用 MIDI、合成音频或程序化注入模拟一个「会弹的用户」和「会弹错的用户」，走完上传、解析、跟练、纠错、提速的完整闭环。
> 这不是全面测试（不覆盖真实噪声、音色、麦克风延迟），而是用来在开发/路演前快速验证产品逻辑。
> 最后更新：2026-07-22

---

## 1. 目标

在没有真实吉他、没有真实演奏者的情况下，用程序化的方式模拟用户行为，验证：

- 后端 pipeline 能把视频/音频正确解析成谱面。
- 前端能按时间轴驱动谱面、视频和双手提示。
- 实时匹配引擎能识别「正确」「错音」「漏音」「节奏偏」。
- 纠错状态机能根据错误自动降速、循环、提速。
- 练习结果能沉淀并用于结果回看与薄弱小节定位。

**不验证**：真实吉他音色、环境噪声、麦克风硬件延迟、蓝牙音频延迟、用户真实手型。

---

## 2. 总体思路

把「用户演奏」抽象成一条按时间发送的 `PlayedNote` 流，而不是从麦克风采集音频。这条流可以：

- 完全准时、完全正确地演奏目标谱面（用于验证 happy path）。
- 在指定位置故意弹错音（用于验证错音检测）。
- 在指定位置跳过音符（用于观察漏音时结果页的空缺分布）。
- 整体提前或延后若干毫秒（用于验证节奏偏差）。
- 随机加入小幅抖动（用于模拟真人节奏不稳定）。

根据想验证的层级，可以选择三种实现方式：

| 方式 | 数据流 | 适用场景 |
|------|--------|----------|
| **A. 直接注入 PlayedNote** | 跳过麦克风/检测器，直接给 `MatchingEngine` 喂 synthetic note | 单元测试匹配引擎、快速验证判定逻辑 |
| **B. 合成音频 + 真实检测器** | 用 Web Audio 生成吉他式音，走 `GuitarDetector` 的完整音频路径 | 验证 YIN 检测器与匹配引擎的联动 |
| **C. MIDI 文件 → WAV → 视频** | 把 MIDI 渲染成音频并与视频混流，上传走完整后端 pipeline | 验证解析、对齐、时间轴、端到端闭环 |

---

## 3. 方式 A：直接注入 PlayedNote（最推荐先落地）

### 3.1 实现位置

调试开关为 URL 参数 `?sim=<mode>`（如 `?sim=perfect`、`?sim=wrong@6.2`、`?sim=late50`），在 `src/product-app.js` 的 `bootstrap()` 中解析；模拟器实现于 `src/core/practice/simulator.js`。

实现策略**不是**在 `playerFrame` 里加一条独立的模拟分支，而是把 `UserSimulator` 直接赋给 `state.micDetector`：`playerFrame` 仍调用 `state.micDetector.getDetection(state.playerTime)`，模拟器与真实 `GuitarDetector` 同接口，因此匹配、反馈、纠错状态机走的是同一条代码路径，只换掉了「声音来源」。

### 3.2 模拟器接口

已实现于 `src/core/practice/simulator.js`，核心是 `UserSimulator` 类。它把任意时间轴/谱面事件归一化后，按模式生成虚拟演奏事件，并能直接替换 `GuitarDetector`。

```js
// src/core/practice/simulator.js（已实现）

export class UserSimulator {
  constructor(timeline, mode = 'perfect') { /* 归一化事件 + 解析模式 */ }

  /** 按视频时间返回下一个虚拟演奏事件，每个事件只触发一次。 */
  nextNote(videoTime) {
    // 触发窗口：videoTime ∈ [event.startTime, event.startTime + FIRE_WINDOW]
    // 返回的 onsetTime = event.startTime + 模式偏移（用户「实际演奏时间」）
    // partial 模式：按事件 id 确定性漏掉 ~30% 音符
    return { pitch, rms, onsetTime, string, fret, targetId } | null;
  }

  /** 兼容 GuitarDetector.getDetection()，可直接赋给 state.micDetector。 */
  getDetection(videoTime) {
    // 在 GuitarDetector 返回结构上额外携带 onsetTime（用户实际演奏时间），
    // 让调用方用它代替采样时刻计算节奏偏差。
    return { time, pitch: { frequency, midi, confidence }, onset, rms, onsetTime? };
  }

  /** 兼容 GuitarDetector.stop()：空操作，便于在 beforeunload 等处安全调用。 */
  stop() {}
  get isListening() { return true; }

  /** 重置触发状态，用于循环、回跳或重新练习。 */
  reset() { /* 清空 triggered 集合 */ }

  get modeLabel() { /* 人类可读的模式名 */ }
}
```

**关键设计**：`onsetTime` 返回的是「模拟用户的实际演奏时间」= 目标时间 + 模式偏移，而不是采样时刻。这样匹配引擎计算出的节奏偏差方向与大小都与模式一致，且不受 `requestAnimationFrame` / 采样节拍抖动影响。`getDetection()` 额外携带 `onsetTime`，`playerFrame` 优先使用它，真实麦克风检测不携带该字段时回退到当前播放时间。

**模式列表**（`parseMode` 解析）：`perfect` / `miss` / `late50` / `late100` / `late200` / `early50` / `early100` / `wrong@<time>` / `wrong@id=<id>` / `jitter` / `partial`。

> 注：`late100`（0.10 s）因浮点误差落在 `GOOD_TIME`（100 ms）边界，会被判定为节奏 `miss`；`late50`（0.05 s）落在 `PERFECT_TIME`（50 ms）边界，判定为 `correct`（good 而非 perfect）。这是阈值边界的确定性行为，详见 `tests/user-simulation.test.js`。

### 3.3 接入 `product-app.js`

已实现：在 `bootstrap()` 中读取 URL 参数 `?sim=<mode>`，开启模拟模式后跳过麦克风授权流程，把 `UserSimulator` 直接作为 `state.micDetector`。

```js
// product-app.js 关键改动

// bootstrap() 中解析 ?sim=
const simMode = new URLSearchParams(window.location.search).get('sim');
if (simMode) {
  state.simMode = simMode;
  state.micResolved = true;   // 跳过麦克风弹窗
  state.micAllowed = true;
}

// 谱面/时间轴就绪后构建模拟器（在 rebuildMatchingEngine 末尾调用）
function buildSimulator() {
  if (!state.simMode) return;
  const events = state.scoreModel?.notes?.length ? state.scoreModel.notes : state.timeline;
  const simulator = new UserSimulator(events, state.simMode);
  state.simulator = simulator;
  state.micDetector = simulator;   // 直接替换 GuitarDetector
}

// playerFrame 中采样
state.lastDetection = state.micDetector.getDetection(state.playerTime);
// 真实 GuitarDetector.getDetection 忽略该参数；模拟器用它按谱面触发。

// 匹配时优先使用模拟器给出的实际演奏时间
const playedNote = {
  pitch: detection.pitch.frequency,
  rms: detection.rms,
  onsetTime: Number.isFinite(detection.onsetTime) ? detection.onsetTime : state.playerTime,
};
```

**循环与回跳**：`seekPlayer` 在回跳超过 0.1 s 时调用 `simulator.reset()`，让循环范围内的音符可以重新触发；`startPracticeSession` 也会重置模拟器。`beforeunload` 中的 `state.micDetector?.stop()` 对模拟器是安全的空操作。

**用法**：先载入一个带谱面的课程（如 `?course=<id>&sim=perfect`），或上传/解析完视频后，进入跟练页即可看到模拟演奏驱动判定。顶部麦克风状态会显示「模拟 · <模式>」。

### 3.4 典型模拟场景

| URL 参数 | 模拟行为 | 期望结果 |
|----------|----------|----------|
| `?sim=perfect` | 每个目标音符准时、正确弹出 | 音符变绿，得分 perfect，最后进入 results |
| `?sim=miss` | 全程不弹 | 所有音符保持空心，不产生判定事件，结果页显示未检测到有效演奏 |
| `?sim=late50` | 整体晚 50 ms | 落在 PERFECT_TIME 边界 → correct(good)，不触发错误 |
| `?sim=late100` | 整体晚 100 ms | 落在 GOOD_TIME 边界 → 节奏 miss |
| `?sim=late200` | 整体晚 200 ms | 明显 late，标记为 miss |
| `?sim=early50` / `early100` | 整体提前 | 与 late 对称的偏差判定 |
| `?sim=wrong@6.2` | 在 6.2 秒处弹错音（高半音） | 该音符变红，提示「听到 X，目标 Y」 |
| `?sim=wrong@id=note_03` | 只让指定 id 的音符弹错 | 仅该音符判 wrong-pitch，其余正确 |
| `?sim=jitter` | 按事件 id 确定性 ±30 ms 抖动 | 全程 correct，验证容错 |
| `?sim=partial` | 按事件 id 确定性漏掉 ~30% 音符 | 被漏音符不触发，结果页对应位置显示未检测到演奏 |

> 注：自动进入专项纠错由「**同一目标音符**连续 3 次错误记录」触发（见 `product-app.js` 的 `autoSlowDown` 逻辑），通常需要循环片段反复弹同一处难点才会命中。`miss` 与 `partial` 漏掉的是「不触发」而非「弹错」，不会产生错误记录，因此不会自动进入纠错；可手动点击错误记录或谱面音符进入专项练习。

---

## 4. 方式 B：合成音频 + 真实检测器（验证音频路径）

> **状态：尚未实现（设计草案）**，见第 8 节。下方代码为参考实现思路，非仓库中已有代码。

### 4.1 原理

在测试页或测试脚本中，用 `OscillatorNode` + `GainNode` + 包络生成单音，输出到 `MediaStreamAudioDestinationNode`，再通过 `getUserMedia` 捕获这个虚拟麦克风流。

这样 `GuitarDetector` / `AudioAnalyzer` 走的就是真实音频处理路径，只是信号源是程序生成的。

### 4.2 实现示例

```js
async function createVirtualGuitarStream() {
  const audioContext = new AudioContext();
  const dest = audioContext.createMediaStreamDestination();

  function pluck(frequency, when, duration = 0.5) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth'; // 模拟吉他谐波
    osc.frequency.value = frequency;

    osc.connect(gain);
    gain.connect(dest);

    osc.start(when);
    gain.gain.setValueAtTime(0.2, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.stop(when + duration);
  }

  return {
    stream: dest.stream,
    context: audioContext,
    pluck,
  };
}

// 使用：
const virtual = await createVirtualGuitarStream();
const detector = new GuitarDetector(virtual.context);
await detector.start(virtual.stream);

// 模拟用户弹奏 E4
virtual.pluck(midiToFreq(64), virtual.context.currentTime + 0.1);
```

### 4.3 与方式 A 的区别

- 方式 A 只验证匹配逻辑，不验证 YIN/Onset/RMS 计算。
- 方式 B 验证从音频到检测的完整链路，但音色仍与真实吉他不同。
- 方式 B 更适合在浏览器自动化测试中使用，例如 Playwright。

---

## 5. 方式 C：MIDI 文件 → 视频 → 后端 Pipeline（验证解析闭环）

> **状态：尚未实现（设计草案）**，见第 8 节。下方流程与脚本均为参考思路，`backend/scripts/render_demo_from_midi.py` 尚未创建。

### 5.1 使用场景

- 想验证后端 Basic Pitch + 弦品求解 + 时间轴生成是否正确。
- 没有合适的吉他教学视频，但有一段 MIDI。

### 5.2 步骤

1. 准备 MIDI 文件：包含标准调弦下的吉他旋律/和弦，每轨对应一根弦或一个音符。
2. 用 `pretty_midi` / `fluidsynth` / `timidity` 把 MIDI 渲染成 WAV。
3. 准备一段与 MIDI 等长的视频（可以是静态画面或任意背景视频）。
4. 用 FFmpeg 将音频混入视频：
   ```bash
   ffmpeg -i background.mp4 -i midi_render.wav -c:v copy -map 0:v -map 1:a -shortest output.mp4
   ```
5. 上传 `output.mp4` 到 `/api/v1/courses/upload`。
6. 触发 `/parse`，轮询到 `ready`。
7. 获取 `/score` 和 `/timeline`，与原始 MIDI 对比：
   - 音符数量是否一致（允许 ±10% 的合并/拆分）。
   - 时间偏差是否在 ±100 ms 内。
   - 弦品选择是否合理（无超过 19 品、无跨度过大）。

### 5.3 后端辅助脚本

可在 `backend/scripts/` 下增加 `render_demo_from_midi.py`：

```python
import argparse
import pretty_midi
from pydub import AudioSegment


def midi_to_wav(midi_path: str, output_wav: str, soundfont: str = ""):
    midi = pretty_midi.PrettyMIDI(midi_path)
    audio = midi.fluidsynth(fs=22050, sf2_path=soundfont)
    # ... 写入 WAV


def mux_with_video(video_path: str, audio_path: str, output_path: str):
    import subprocess
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path, "-i", audio_path,
        "-c:v", "copy", "-map", "0:v", "-map", "1:a",
        "-shortest", output_path,
    ], check=True)


if __name__ == "__main__":
    # CLI 入口
    pass
```

---

## 6. 推荐组合：开发期使用方式 A，集成期使用方式 B + C

| 阶段 | 主要使用方式 | 目的 |
|------|-------------|------|
| 日常开发 | A | 快速验证匹配、反馈、纠错状态机 |
| 检测器调优 | B | 验证 YIN 参数、onset 阈值、RMS 门限 |
| Pipeline 回归 | C | 验证后端解析、时间轴、谱面质量 |
| 路演前 | A + 少量真实吉他 | 在稳定可控环境下走完整闭环，再用真实设备最终验证 |

---

## 7. 与真实测试的关系

MIDI 模拟是**前置过滤器**，不是**最终验证**。

- 先用它快速发现和修复 80% 的逻辑问题。
- 在路演或上线前，仍需要用真实吉他 + 真实麦克风做至少一次端到端验证，覆盖：
  - 琴弦共振是否导致误检。
  - 背景噪声是否触发误报。
  - 设备延迟是否在可接受范围。
  - 真实和弦的扫弦是否能被识别为和弦。

---

## 8. 已落地与下一步

### 已完成（方式 A）

1. ✅ `src/core/practice/simulator.js` — `UserSimulator` 类已实现。
   - `onsetTime` 返回目标时间 + 模式偏移，偏差方向/大小确定；
   - `getDetection` 兼容 `GuitarDetector` 并额外携带 `onsetTime`；
   - `stop()` / `isListening` 使其可作为 `state.micDetector` 的直接替换；
   - `partial` 模式按事件 id 确定性漏音，`jitter` 模式按 id 确定性抖动；
   - 修复了早期对称触发窗口导致「完美模式提前 80 ms、late/early 方向相反」的缺陷。
2. ✅ `src/product-app.js` — `?sim=<mode>` URL 参数接入，替换麦克风检测流程（见 3.3）。
3. ✅ `simulation.html` — 独立浏览器测试页，内置 12 音符旋律，无需后端/麦克风即可观察 `UserSimulator` + `MatchingEngine` 联动。启动 `npm run dev` 后访问 `http://localhost:3000/simulation.html`。
4. ✅ `tests/user-simulation.test.js` — 覆盖 perfect / miss / late50 / late100 / late200 / early50 / wrong@<time> / wrong@id=<id> / jitter / partial / reset / getDetection 兼容性 / normalizeEvents 容错 等场景，`npm test` 运行。

### 仍待完成

5. ⬜ `backend/scripts/render_demo_from_midi.py`：把 MIDI 渲染成音频并与视频混流，用于方式 C 的后端 pipeline 回归。
6. ⬜ 方式 B（合成音频 + 真实检测器）：用 `OscillatorNode` 验证 YIN/Onset/RMS 链路，可接入 Playwright 浏览器自动化。
