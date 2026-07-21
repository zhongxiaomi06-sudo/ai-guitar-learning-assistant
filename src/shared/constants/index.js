/**
 * shared/constants/index.js
 * 全局常量与配置默认值
 */

/** 吉他弦数 */
export const STRING_COUNT = 6;

/** 标准调音（1-6 弦） */
export const STANDARD_TUNING = [329.63, 246.94, 196.0, 146.83, 110.0, 82.41];

/** 速度范围 */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 1.0;
export const SPEED_STEP = 0.05;

/** 判定阈值 */
export const THRESHOLD_PERFECT_PITCH = 25;   // 音分
export const THRESHOLD_GOOD_PITCH = 50;       // 音分
export const THRESHOLD_PERFECT_TIME = 50;     // ms
export const THRESHOLD_GOOD_TIME = 100;       // ms

/** 调速策略 */
export const AUTO_SLOWDOWN_MISS_COUNT = 3;
export const AUTO_SPEEDUP_STREAK_COUNT = 5;

/** 默认设置 */
export const DEFAULT_SETTINGS = {
  speed: 1.0,
  matchMode: 'game',
  difficulty: 'normal',
  autoSlowDown: true,
  inputDeviceId: '',
  theme: 'light',
};

/** 音符频率表（用于音高检测） */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const CONSTANTS = {
  STRING_COUNT,
  STANDARD_TUNING,
  MIN_SPEED,
  MAX_SPEED,
  SPEED_STEP,
  THRESHOLD_PERFECT_PITCH,
  THRESHOLD_GOOD_PITCH,
  THRESHOLD_PERFECT_TIME,
  THRESHOLD_GOOD_TIME,
  AUTO_SLOWDOWN_MISS_COUNT,
  AUTO_SPEEDUP_STREAK_COUNT,
  DEFAULT_SETTINGS,
  NOTE_NAMES,
};

export default CONSTANTS;
