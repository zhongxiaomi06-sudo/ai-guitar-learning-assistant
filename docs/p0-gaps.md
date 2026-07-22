# P0 缺口清单

> 本文档记录当前项目与路演闭环之间的关键差距。P0 指「影响 DEMO 可用性与完整性的最小闭环」，必须优先完成。
> 最后更新：2026-07-22

## 判定原则

- 只列会阻塞「用户完整走一次跟练—纠错—恢复」闭环的问题。
- 已完成项标记为 `[x]`，未完成项标记为 `[ ]`。
- 每个缺口都给出：现象、影响、建议修复方向、验收方式。

---

## 1. 前端默认入口未接入后端时间轴

- **状态**：`[x]` 已完成
- **现象**：`activateRemoteCourse()` 已在载入课程后并行请求 `GET /timeline` 与 `GET /segments`，缓存到 `state.timeline` / `state.segments`；`renderScore()` 优先调用 `renderTimeline()`，`MatchingEngine` 在有 timeline 时改用 `TimelineModel`。
- **验收**：上传两段不同视频并解析完成后，进入跟练页能看到不同的音符分布与时间。

---

## 2. 实时匹配引擎未接入播放循环

- **状态**：`[x]` 已完成
- **现象**：`playerFrame()` 在 `state.playing && state.micAllowed` 时，根据 `playerTime` 取出目标事件，把 `detection` 转为 `PlayedNote` 交给 `MatchingEngine.match()`，结果写入 `state.lastResult` 并缓存到 `state.practiceResults`；连续 3 次同音符错误会触发专项纠错。
- **验收**：播放视频时，故意弹奏正确/错误/漏音/节奏偏移，UI 能给出对应反馈。

---

## 3. 练习结果未提交到后端

- **状态**：`[x]` 已完成
- **现象**：`finish-practice` 与片段结束时会将 `state.practiceResults` 批量 POST 到 `practice/results`；结果页 `loadPracticeSummary()` 调用 `summary` 与 `weak-spots`；课程库载入时并行拉取各 ready 课程的 summary，用真实正确率驱动卡片进度条与「继续练习」文案。
- **验收**：完成一次练习后刷新页面，课程库显示该课程的最新进度和薄弱小节。

---

## 4. 纠错模式仍是硬编码演示

- **状态**：`[x]` 已完成
- **现象**：`enterFocusMode(errorEvent, errorType)` 按 `measureIndex` 与 `bpm` 计算循环范围；`FOCUS_TIPS` 按错误类型（错音/漏音/多弹/默认）生成 `data-focus-tip` 与 `data-focus-tip-detail`；`evaluateFocusAttempt()` 用 `focusResults` 填充对比卡前后数值；`toggleLoop`、`open-focus` 兜底与 `playerFrame` 非纠错循环改用 `getLoopRange()`（当前练习片段），移除全部硬编码 `17.42`/`28`。
- **验收**：在不同小节故意制造不同错误，进入专项练习后能看到对应的时间范围、提示和速度阶梯状态。

---

## 5. 手型图未反映真实和弦/换把

- **状态**：`[x]` 已完成
- **现象**：`timeline.py` 的 `_detect_barre()`/`_assign_fingers()` 对同一品位相邻弦识别横按（`barreRange`，食指覆盖）；`build_timeline` 两遍扫描，用 `_common_fingers()` 标记跨拍保留指、`_next_shift()` 给出换把方向与目标品；`_pick_shape()` 区分扫弦/拨弦与拨弦手指。前端 `renderHandStack()` 用当前目标音符的 `leftHandShape`/`rightHandShape` 实时刷新左手落点、横按/换把提示与右手拨弦方向。
- **验收**：和弦进行（如 Am → C → G → Em）的左手落点与真实按法一致，且换把提示出现在正确时间。

---

## 6. 没有真实的音频-视频时间对齐

- **状态**：`[x]` 已完成
- **现象**：`transcription.get_av_offset()` 用 ffprobe 取音频流相对视频流的 `start_time` 差作为 A/V 偏移；`audio_pipeline` 将其写入 `score.avOffset`；`build_timeline` 把 `audioTime`（= note.startTime）与 `videoTime`（= audioTime + avOffset）分别保留。前端 `TimelineModel` 与 `timelineEvents()` 优先使用 `videoTime` 作为视频跳转/高亮/匹配时钟，`audioTime` 仅作音频参考。
- **验收**：多段测试视频中，点击任意音符，视频与谱面光标都落在同一视觉时刻。

---

## 7. 麦克风校准与延迟修正未实现

- **状态**：`[x]` 已完成
- **现象**：新增 `core/audio/calibrator.js` 的 `MicCalibrator`：`allowMicrophone()` 在权限通过后监听约 3 秒环境噪声，取 95 分位 RMS 自适应 `detector.onsetThreshold`；用 `estimateLatency(audioContext.baseLatency + outputLatency)` 估计输入延迟并存入 `state.calibrationOffset`；`classifyEnvironment()` 对噪声过高/音量过低/蓝牙高延迟给出提示；`playerFrame` 在构造 `PlayedNote` 时用 `onsetTime - calibrationOffset` 补偿延迟。
- **验收**：同一台机器上，用不同浏览器测试，onset 偏差稳定在 ±50 ms 内。

---

## 8. 自动降速/循环/提速状态机未运行

- **状态**：`[x]` 已完成
- **现象**：新增 `core/practice/stateMachine.js` 的 `FocusStateMachine`，显式状态 `IDLE → WATCH_TEACHER → COUNT_IN → LISTENING → ANALYZING → RETRY/SLOW_DOWN/SPEED_UP → PASSED`；连续 3 次同音符错误自动 `enterFocusMode`；`evaluateFocusAttempt()` 经状态机 `finishLoop` 按结果决定重试/降速/提速/通过，对比卡与速度阶梯由状态机驱动；正常跟练非纠错循环改用片段范围。
- **验收**：在跟练页连续弹错 3 次，系统自动进入 60% 速度的专项循环；连续弹对 2 次，自动提到 75%。

---

## 9. 演示课程的「精修数据」机制未实现

- **状态**：`[ ]` 未完成
- **现象**：`prepareDemo()` 优先找后端 `status=ready` 的课程，否则回退到写死的内置示例。没有基于内容指纹命中预精修数据。
- **影响**：
  - 路演时若后端没有可用课程，会展示静态示例，缺少真实视频与谱面同步。
  - 用户上传的演示视频无法稳定加载人工精修结果。
- **修复方向**：
  1. 定义一个 `DEMO_PRESET_ID`（或文件哈希）。
  2. 上传时计算文件哈希，命中后直接从 `backend/storage/presets/` 读取人工精修 score、timeline、segments。
  3. 前端仍展示正常上传/检查/解析流程，但内部走快速路径。
  4. 普通视频继续走真实解析 pipeline。
- **验收**：上传预设演示视频，解析完成后进入跟练页，时间轴与人工校对数据一致。

---

## 10. 移动端兼容与响应式细节未收尾

- **状态**：`[ ]` 未完成（P0 中低优先级）
- **现象**：桌面布局已较完善，但跟练页在较小屏幕上双手特写、谱面、视频面板可能重叠或无法操作。
- **影响**：路演若使用非 16:9 屏幕，可能出现布局问题。
- **修复方向**：
  1. 在 `player-view` 中，窄屏时隐藏右侧双手特写，改为可切换的浮层/抽屉。
  2. 六线谱区域在横向空间不足时改为横向滚动。
  3. 麦克风按钮、速度控制在触控设备上放大点击区域。
- **验收**：在 13 寸笔记本和常见外接显示器（1080p / 2K）上，跟练页各元素无重叠、可点击。

---

## 推荐修复顺序

1. **先接 timeline**（缺口 1）：✅ 已完成。
2. **再接匹配引擎**（缺口 2）：✅ 已完成。
3. **同时补结果提交**（缺口 3）：✅ 已完成。
4. **再做纠错状态机**（缺口 4、8）：✅ 已完成。
5. **最后补手型/对齐/校准**（缺口 5、6、7）：✅ 已完成。

剩余：缺口 9（精修演示数据指纹命中）与缺口 10（移动端响应式收尾）尚未开始。完成 1-8 即构成完整路演闭环。
