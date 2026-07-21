/**
 * shared/types/index.js
 * 项目核心数据结构类型定义（JSDoc）
 * 便于在模块间保持一致，未来可迁移到 TypeScript。
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} title
 * @property {string} sourceVideoUrl
 * @property {string} localVideoPath
 * @property {number} duration
 * @property {number} bpm
 * @property {[number, number]} timeSignature
 * @property {string} key
 * @property {Bar[]} bars
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Bar
 * @property {string} id
 * @property {number} index
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} duration
 * @property {Beat[]} beats
 * @property {number} difficulty
 */

/**
 * @typedef {Object} Beat
 * @property {string} id
 * @property {string} barId
 * @property {number} index
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} position
 */

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} barId
 * @property {string} beatId
 * @property {number} startTime
 * @property {number} endTime
 * @property {'single' | 'chord' | 'rest'} type
 * @property {number} [string]
 * @property {number} [fret]
 * @property {string} [chordName]
 * @property {{ string: number, fret: number }[]} notes
 * @property {number} audioStartTime
 * @property {number} audioEndTime
 * @property {HandShape} leftHandShape
 * @property {PickShape} rightHandShape
 * @property {string[]} commonErrors
 * @property {number} difficulty
 */

/**
 * @typedef {Object} HandShape
 * @property {'open' | 'barre' | 'single' | 'mute'} type
 * @property {{ finger: number, string: number, fret: number }[]} fingerPositions
 * @property {{ fromString: number, toString: number, fret: number }} [barreRange]
 */

/**
 * @typedef {Object} PickShape
 * @property {'down' | 'up' | 'strum-down' | 'strum-up' | 'mute' | 'pluck'} direction
 * @property {number[]} strings
 */

/**
 * @typedef {Object} MatchResult
 * @property {number} currentTime
 * @property {Note} targetNote
 * @property {PlayedNote} playedNote
 * @property {'perfect' | 'good' | 'miss' | 'pending'} score
 * @property {number} pitchDeviation
 * @property {number} timingDeviation
 * @property {'correct' | 'wrong-pitch' | 'wrong-string' | 'miss' | 'extra'} type
 * @property {string} suggestion
 */

/**
 * @typedef {Object} PlayedNote
 * @property {number} [string]
 * @property {number} [fret]
 * @property {number} pitch
 * @property {number} velocity
 * @property {number} onsetTime
 * @property {number} duration
 */

/**
 * @typedef {Object} PracticeSession
 * @property {string} projectId
 * @property {number} startTime
 * @property {number} speed
 * @property {{ start: number, end: number }} loopRange
 * @property {number} currentBarIndex
 * @property {number} currentScore
 * @property {number} streak
 * @property {MatchResult[]} errors
 * @property {boolean} isAutoSlowDown
 * @property {number} targetSpeed
 */

/**
 * @typedef {Object} AppSettings
 * @property {number} speed
 * @property {'game' | 'ktv'} matchMode
 * @property {'loose' | 'normal' | 'strict'} difficulty
 * @property {boolean} autoSlowDown
 * @property {string} inputDeviceId
 * @property {'light' | 'dark'} theme
 */

export const Types = {};
