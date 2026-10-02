// 出题模式状态模块（#103）：拥有 sq_quiz_mode（孩子端首页选择的出题方式，记住上次选择）。
// 键沿仓内 sq_* 风格、生命周期自管理（#168 起经 useDataInfra 登记册入册并经原语读写；
// 仍不注册初始值，不参与 init 初始化与迁移——键缺失 = 默认 normal，首次切换才落盘）。
// 切换只影响下一轮：startQuiz 调用时读取当前值分派引擎；进行中的轮由 QuizSession.mode 快照定格。
// #272：出题方式按 kind 分流的惊喜偏好记忆整体拆除——惊喜会话固定新题优先，本键只记学科偏好。
// 旧按 kind 落盘的对象形状（{subject,trivia}）读入时按值非法删键回 normal，学科偏好保守归一。

import type { QuizMode } from '../types'
import { STORAGE_KEYS, readRawValue, writeValue, deleteValue } from './useDataInfra'
import { copy } from '../copy'

// #168 收编入册：键名现由登记册单一来源，导出保持兼容
export const QUIZ_MODE_KEY = STORAGE_KEYS.quizMode

export interface QuizModeMeta {
  key: QuizMode
  /** 模式名（#108 r2 定稿 D · 组一直白系） */
  name: string
  /** 分段切换器短名（#152 G3 三分段直显：探针 P1-r2 分段文案「普通 / 新题优先 / 错题优先」；缺省回落 name */
  shortName?: string
  /** 一句话说明 */
  desc: string
  /** 24 viewBox 图标 path（fill 语义，与 Home big-star 同源星星 + 两枚自绘） */
  icon: string
}

/** 平涂星星（普通模式：与 Home.vue big-star 同源 path） */
const ICON_STAR =
  'M 12.94 3.71 L 14.31 6.92 Q 14.82 8.12 16.12 8.23 L 19.60 8.54 Q 21.99 8.76 20.18 10.33 L 17.54 12.63 Q 16.57 13.48 16.86 14.75 L 17.64 18.16 Q 18.17 20.49 16.11 19.26 L 13.12 17.47 Q 12.00 16.80 10.88 17.47 L 7.89 19.26 Q 5.83 20.49 6.36 18.16 L 7.14 14.75 Q 7.43 13.48 6.46 12.63 L 3.82 10.33 Q 2.01 8.76 4.40 8.54 L 7.88 8.23 Q 9.18 8.12 9.69 6.92 L 11.06 3.71 Q 12.00 1.50 12.94 3.71 Z'
/** 四角闪光（新题优先：新出场） */
const ICON_SPARKLE = 'M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z'
/** 重来圈箭头（错题优先：再来一次） */
const ICON_REPLAY =
  'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z'

/** 三模式元数据（顺序 = 分段切换器段序；文案自 copy.quiz.mode 收口——文案收口批迁移，措辞 = #108 r2 定稿组一，shortName 对齐探针分段） */
export const QUIZ_MODE_META: QuizModeMeta[] = [
  { key: 'normal', name: copy.quiz.mode.normal.name, shortName: copy.quiz.mode.normal.shortName, desc: copy.quiz.mode.normal.desc, icon: ICON_STAR },
  { key: 'fresh', name: copy.quiz.mode.fresh.name, shortName: copy.quiz.mode.fresh.shortName, desc: copy.quiz.mode.fresh.desc, icon: ICON_SPARKLE },
  { key: 'wrong', name: copy.quiz.mode.wrong.name, shortName: copy.quiz.mode.wrong.shortName, desc: copy.quiz.mode.wrong.desc, icon: ICON_REPLAY },
]

export function isQuizMode(value: unknown): value is QuizMode {
  return value === 'normal' || value === 'fresh' || value === 'wrong'
}

// findQuizModeMeta / isScalarMode 已删（#276 review fixes）：前者集成分支上无消费方，后者只是 isQuizMode 纯转发。

/** 缺失/损坏回 normal。 */
export function readQuizMode(): QuizMode {
  const raw = readRawValue(QUIZ_MODE_KEY)
  if (raw === null) return 'normal'
  try {
    const value = JSON.parse(raw)
    if (isQuizMode(value)) return value
    // #169 对齐注释口径（#168 遗留 Spec 缺口）：值非法同样移除键回 normal（日志带键名与原因）
    console.warn(`[star-quiz] 数据键 ${QUIZ_MODE_KEY} 值非法，已删除（回 normal，值：${JSON.stringify(value)}）`)
    deleteValue(QUIZ_MODE_KEY)
    return 'normal'
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 数据键 ${QUIZ_MODE_KEY} 损坏，已删除（原因：${reason} JSON 解析失败）`)
    deleteValue(QUIZ_MODE_KEY)
    return 'normal'
  }
}

/** 写入模式（JSON 落盘，与仓内键口径一致）；记住上次选择（仅学科入口使用，#272 起惊喜固定新题优先、无偏好可记） */
export function writeQuizMode(mode: QuizMode): void {
  writeValue(QUIZ_MODE_KEY, mode)
}
