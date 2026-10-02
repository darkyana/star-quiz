// #172 家底键损坏恢复提示（共享 Toast 联动模块）：
// 经 #169 registerCorruptionResetHandler 钩子在「被发现那一刻」收到事件（上云参与键：家底 + 可弃先验，
// 铁律「不论可弃与否」）；已拍板口径：答题会话进行中不得弹 → 置延后标记，等下次非答题时机（路由切换）补弹。
// 模块级 ref 跨页面存活，App.vue 全局挂 StarToastStandard 承载显示（不新建样式，#139 组件自管 2400ms）。

import { ref, type Ref } from 'vue'
import { copy } from '../copy'
import { registerCorruptionResetHandler } from './useDataInfra'
import { readSession } from './useQuiz'

/** 当前应显示的损坏恢复提示文案（空串 = 无提示；StarToastStandard 契约：页面监听 expired 清空） */
const notice = ref('')

/** 答题会话进行中收到的事件延后标记（会话结束 / 下次非答题时机补弹） */
let deferred = false

/** 答题会话进行中判定（#172 验收约束）：sq_session 存在且 status = in_progress */
function quizInProgress(): boolean {
  const session = readSession()
  return session !== null && session.status === 'in_progress'
}

/** #169 钩子回调：被发现那一刻——答题中 → 延后；否则立即弹共享 Toast 文案 */
function onCorruptionReset(): void {
  if (quizInProgress()) {
    deferred = true
    return
  }
  notice.value = copy.corruptionRecoveryToast
}

let installed = false

/**
 * 组合根挂点（main.ts，须在 initAppState() 之前注册，否则启动期损坏事件收不到）：
 * 注册 #169 损坏重置钩子；幂等。
 */
export function installCorruptionNotice(): void {
  if (installed) return
  installed = true
  registerCorruptionResetHandler(onCorruptionReset)
}

/** 读取当前提示（App.vue 全局 Toast 的 message 绑定源） */
export function corruptionNotice(): Ref<string> {
  return notice
}

/** Toast 计时到点回调（StarToastStandard expired 事件） */
export function clearCorruptionNotice(): void {
  notice.value = ''
}

/**
 * 延后提示补弹（App.vue 路由切换时机调用 = 「下次非答题时机」）：
 * 有延后标记且当前不在答题会话 → 弹出并清标记；仍在答题 → 继续延后。
 */
export function flushCorruptionNotice(): void {
  if (!deferred) return
  if (quizInProgress()) return
  deferred = false
  notice.value = copy.corruptionRecoveryToast
}
