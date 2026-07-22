/**
 * core/voice/commands.js
 * Command table used for the help overlay and optional front-end fallback parsing.
 * The real parsing happens on the backend via LLM / Baidu.
 */

export const VOICE_COMMANDS = [
  { id: 'play', keywords: ['播放', '开始', '继续'], action: 'toggle-play', payload: { play: true } },
  { id: 'pause', keywords: ['暂停', '停'], action: 'toggle-play', payload: { play: false } },
  { id: 'restart', keywords: ['重练', '重来', '再来一次', '重播'], action: 'seek-to-segment-start', payload: {} },
  { id: 'slow-down', keywords: ['慢一点', '降速', '慢'], action: 'adjust-speed', payload: { delta: -1 } },
  { id: 'speed-up', keywords: ['快一点', '提速', '快'], action: 'adjust-speed', payload: { delta: 1 } },
  { id: 'normal-speed', keywords: ['原速', '恢复速度', '正常速度'], action: 'set-speed', payload: { speed: 1 } },
  { id: 'toggle-loop', keywords: ['循环'], action: 'toggle-loop', payload: { enabled: true } },
  { id: 'close-loop', keywords: ['关闭循环'], action: 'toggle-loop', payload: { enabled: false } },
  { id: 'open-mic', keywords: ['打开麦克风', '开启麦克风'], action: 'open-mic', payload: { enabled: true } },
  { id: 'close-mic', keywords: ['关闭麦克风'], action: 'open-mic', payload: { enabled: false } },
  { id: 'back', keywords: ['返回', '回去'], action: 'navigate', payload: { route: 'overview' } },
  { id: 'next-segment', keywords: ['下一片段', '下一个', '下一首'], action: 'next-segment', payload: {} },
  { id: 'prev-segment', keywords: ['上一片段', '上一个', '上一首'], action: 'prev-segment', payload: {} },
  { id: 'focus', keywords: ['纠错', '攻克难点', '难点'], action: 'open-focus', payload: {} },
  { id: 'help', keywords: ['帮助', '有什么命令', '命令'], action: 'show-voice-help', payload: {} },
  { id: 'finish', keywords: ['结束', '完成'], action: 'finish-practice', payload: {} },
];

export const VOICE_HELP_TEXT = `你可以这样说：
播放 / 暂停
慢一点 / 快一点 / 原速
重来 / 循环 / 关闭循环
纠错 / 返回 / 下一片段 / 上一片段
打开麦克风 / 关闭麦克风
结束`;

export default VOICE_COMMANDS;
