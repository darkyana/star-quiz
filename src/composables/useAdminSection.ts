// 家庭管理页拉取样板收敛（#251）：「busy 防重 → 拿结果 → 成功刷新哪几路 / 失败写哪种错误」
// 这段组合编排原先全部留在页面手写——三路列表刷新器逐字同构、各动作函数重复
// busy 守卫 / 结果解包 / 错误赋值 / 刷新（同段样板在单文件内约九份），此处收口为：
// 拉取器实例化 useAdminSection（数据 / 错误 / 忙 / 刷新四件套）+ 动作包装原语 runAdminAction。
// 契约依赖（src/cloud/admin.ts）：拉取 / 动作函数永不抛错，返回 { ok: true; 载荷 } | AdminFailure；
// 本模块不做错误归一与文案映射（错误类别 → 文案映射表留页面，现仅一页消费）。
// 行为零变化（票内硬边界）：加载、报错、防重复、刷新时机与收敛前页面手写逐项等价。

import { ref, type Ref } from 'vue'
import type { AdminErrorKind, AdminFailure } from '../cloud/admin'

/** 拉取 / 动作成功分支的最小约束（载荷字段随端点不同，由调用点的 pick / onSuccess 显式消费） */
type AdminSuccess = { ok: true }

/** 远端列表拉取器（#251 接口形状：数据 / 错误 / 忙 / 刷新） */
export interface AdminSection<Rows> {
  /** 行数据（拉取失败整组清空） */
  rows: Ref<Rows[]>
  /** 错误类别（拉取成功清空；文案映射归页面 copy 表） */
  error: Ref<AdminErrorKind | null>
  /** 刷新进行中 */
  busy: Ref<boolean>
  /** 刷新：成功写数据清错误 / 失败清数据写错误；忙期间重复调用合并为同一次拉取 */
  refresh: () => Promise<void>
}

/**
 * 实例化一路远端列表：传入拉取函数（永不抛错、返回既有结果联合）与
 * 「成功分支取行数组」的 pick（载荷字段名随端点不同，取哪一字段在调用点显式可见）。
 * 刷新语义与收敛前页面手写逐项等价（成功写数据清错误 / 失败清数据写错误）；
 * 忙期间重复刷新合并为同一次拉取（票面拍板，替代原先并发拉取后完成者覆盖）。
 */
export function useAdminSection<Success extends AdminSuccess, Rows>(
  fetch: () => Promise<Success | AdminFailure>,
  pick: (success: Success) => Rows[],
): AdminSection<Rows> {
  const rows = ref<Rows[]>([]) as Ref<Rows[]>
  const error = ref<AdminErrorKind | null>(null)
  const busy = ref(false)
  let pending: Promise<void> | null = null

  async function run(): Promise<void> {
    busy.value = true
    try {
      const result = await fetch()
      if (result.ok) {
        rows.value = pick(result)
        error.value = null
      } else {
        rows.value = []
        error.value = result.kind
      }
    } finally {
      busy.value = false
      pending = null
    }
  }

  function refresh(): Promise<void> {
    if (pending === null) pending = run()
    return pending
  }

  return { rows, error, busy, refresh }
}

/** 动作包装的失败去向：传错误 ref = 包装直接写入；传函数 = 特例编排（如批准 / 拒绝的 conflict 走 toast + 刷新，不写错误） */
export type AdminActionErrorSink =
  | Ref<AdminErrorKind | null>
  | ((kind: AdminErrorKind) => Promise<void> | void)

/** 动作包装分支钩子（执行序见 runAdminAction） */
export interface AdminActionHandlers<Success extends AdminSuccess> {
  /** 忙释放后、结果分支前执行（确认弹窗状态机清理等与结果无关的收尾，保持收敛前清理时机） */
  onSettled?: () => void
  /** 失败分支的错误去向（形状见 AdminActionErrorSink） */
  onError: AdminActionErrorSink
  /** 成功分支（busy 已释放）：「动作成功后刷新哪几路」在此声明（页面级业务编排，不进模块） */
  onSuccess?: (success: Success) => Promise<void> | void
}

/**
 * 动作包装原语：吃掉每个动作函数手写的 busy 守卫 / 置忙 / 释放与结果解包。
 * 执行序与收敛前页面手写逐字节对齐：忙则忽略 → 置忙 → await 动作（永不抛错）→ 释放忙 →
 * onSettled 收尾 → 成功走 onSuccess（含载荷）/ 失败按错误去向写入（或交给特例编排）。
 */
export async function runAdminAction<Success extends AdminSuccess>(
  busy: Ref<boolean>,
  action: () => Promise<Success | AdminFailure>,
  handlers: AdminActionHandlers<Success>,
): Promise<void> {
  if (busy.value) return
  busy.value = true
  const result = await action()
  busy.value = false
  handlers.onSettled?.()
  if (result.ok) {
    await handlers.onSuccess?.(result)
    return
  }
  const sink = handlers.onError
  if (typeof sink === 'function') await sink(result.kind)
  else sink.value = result.kind
}
