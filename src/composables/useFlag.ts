// 旗子规则模块（#69 架构盘点第 5 件：自 Quiz.vue 提取，旗子规则的单一来源）。
// 接口 = 同步 + 切换；存储访问经 useLearningData 的 flagged()/writeFlagged()（存储所有权仍归数据所有方）。
// 升旗动画态（hoistFlag）是 UI 职责，留 Quiz.vue。
// 写入形状全库只此一处：{ flaggedAt, childId }（#69 拍板删 correct；#173 数据行挂孩子维度，恒默认孩子）。

import { DEFAULT_CHILD_ID } from '../types'
import { flagged, writeFlagged } from './useLearningData'

/** 是否标记 = sq_flagged 中该 questionId 键存在与否 */
export function isFlagged(questionId: string): boolean {
  return flagged()[questionId] !== undefined
}

/** 切换：未标 → 写 { flaggedAt: Date.now() } 并返回 true；已标 → 删该键返回 false */
export function toggleFlag(questionId: string): boolean {
  const state = flagged()
  if (state[questionId] === undefined) {
    state[questionId] = { flaggedAt: Date.now(), childId: DEFAULT_CHILD_ID } // #173 数据行挂孩子维度（现阶段恒默认孩子）
    writeFlagged(state)
    return true
  }
  delete state[questionId]
  writeFlagged(state)
  return false
}
