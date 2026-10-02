// 题库归属单点判定（#234，ADR 0014「来源即身份」）：
// 内置题集序号占 9 号段（9xxxxx）→ 惊喜题库，其余 → 学科题库；Question.type 从不参与身份
// （trivia 至此只是尚未启用的纯形式标签，家长导入的 trivia 形式题照归学科题库）。
// 将来若上题库实体注册表，往本判定链头插层即可，已定方案零返工。
import type { QuizKind } from '../types'

/** 9 号段判定：以 '9' 开头的 6 位数字序号（900000~999999），内置题集保留段 */
export function isBuiltinTriviaId(id: string): boolean {
  return /^9\d{5}$/.test(id)
}

/** 归属单点判定：消费点（会话范围派生 / 会话校验 / 默认学科分册选择 / 导入拒收）一律经此，不得自行判 type */
export function bankOf(id: string): QuizKind {
  return isBuiltinTriviaId(id) ? 'trivia' : 'subject'
}
