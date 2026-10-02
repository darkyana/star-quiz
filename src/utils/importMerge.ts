// R21 追加导入合并纯函数（Spec 20260826-R21-追加导入 REQ-R21-2-1/2-2/2-4）
// 纯函数零副作用：不触碰 localStorage、不 import 组合层；重编号只改 id，其余字段原样。
// 失败源当前唯一 = id 序号溢出（起始 + N − 1 > 999999，整次原子拒绝）。

import type { Question } from '../types'

/** id 序号值域上限（Question.id 注释契约：6 位数字字符串，1~999999） */
const MAX_ID = 999999

/**
 * 追加合并：incoming 按原顺序重编号（起始 = existing 可解析为数字的 id 最大值 + 1，
 * 无可解析 id 或空库从 1 起）追加到 existing 末尾。不修改入参数组（返回新数组）。
 */
export function mergeAppendQuestions(
  existing: Question[],
  incoming: Question[],
): { ok: true; data: Question[] } | { ok: false; reason: string } {
  let max = 0
  for (const question of existing) {
    const n = Number(question.id)
    // 脏 id（NaN 等不可解析）跳过，不参与顺延也不与新生成数字 id 撞号
    if (Number.isInteger(n) && n > max) max = n
  }
  const start = max + 1
  if (start + incoming.length - 1 > MAX_ID) {
    return { ok: false, reason: '题库编号已满，无法追加导入' }
  }
  const renumbered = incoming.map((question, index) => ({
    ...question,
    id: String(start + index).padStart(6, '0'),
  }))
  return { ok: true, data: [...existing, ...renumbered] }
}
