// 出题模式引擎（#103）：新题优先 / 错题优先两独立纯函数——不复用不修改 R24 难度分层引擎
// （quizEngine.drawQuestions 零触碰）。题级抽题：不用难度带 / 词窗口 / 同词硬去重
// （同轮同词多题允许，学习文件扩充题库后可触发）；排除 sq_flagged 红旗题（普通模式不做此排除）；
// 轮长恒 10，可用题不足 10 时全量返回（沿 drawQuestions 先例）。
// 新题 / 错题判定唯一数据源 = sq_question_results（QuestionResultsState，index 0 = 最新，每题最近 5 条）。
import type { FlaggedState, Question, QuestionResultsState } from '../types'
import { shuffleGroup, type RandomSource } from './quizEngine'

/** 新模式轮长（Brief：轮长恒 10） */
export const MODE_ROUND_LENGTH = 10

export interface ModeDrawParams {
  /** 题池（原题对象不修改） */
  pool: Question[]
  /** 逐题作答记录（sq_question_results 当前值） */
  results: QuestionResultsState
  /** 红旗标记（sq_flagged 当前值）：有条目的题不出 */
  flagged: FlaggedState
  /** 随机源（可注入，测试用 seeded 源） */
  random: RandomSource
}

/** 新题 = 逐题作答记录为空，或记录全为 skipped（跳过不算答过，Brief 第 2 条） */
export function isNewQuestion(questionId: string, results: QuestionResultsState): boolean {
  const records = results[questionId]
  return records === undefined || records.every((r) => r.outcome === 'skipped')
}

/**
 * 错题在列判定（Brief 第 3 条）：出现过 wrong 记录，且未「连续答对 2 次」出列
 * （「连对 2 次」= 最近两条记录均为 correct）；出列后再答错（最新为 wrong）自然重新入列。
 */
export function isWrongListed(questionId: string, results: QuestionResultsState): boolean {
  const records = results[questionId]
  if (records === undefined) return false
  if (!records.some((r) => r.outcome === 'wrong')) return false
  return !(records[0].outcome === 'correct' && records[1]?.outcome === 'correct')
}

/** 候选 = 题池排除红旗题（sq_flagged 键存在即排除） */
function unflaggedPool(pool: Question[], flagged: FlaggedState): Question[] {
  return pool.filter((q) => flagged[q.id] === undefined)
}

/** 新题优先：全部新题在前（块内乱序），不足 10 用已答过的题随机补满（补位块内乱序） */
export function drawFreshFirstRound({ pool, results, flagged, random }: ModeDrawParams): Question[] {
  const candidates = unflaggedPool(pool, flagged)
  const head = shuffleGroup(
    candidates.filter((q) => isNewQuestion(q.id, results)),
    random,
  ).slice(0, MODE_ROUND_LENGTH)
  if (head.length < MODE_ROUND_LENGTH) {
    head.push(
      ...shuffleGroup(
        candidates.filter((q) => !isNewQuestion(q.id, results)),
        random,
      ).slice(0, MODE_ROUND_LENGTH - head.length),
    )
  }
  return head
}

/** 错题优先（#244）：错题块在前（块内乱序），不足 10 依补位链「新题 → 答对过且不在错题列的题」补满（各块内乱序） */
export function drawWrongFirstRound({ pool, results, flagged, random }: ModeDrawParams): Question[] {
  const candidates = unflaggedPool(pool, flagged)
  const head = shuffleGroup(
    candidates.filter((q) => isWrongListed(q.id, results)),
    random,
  ).slice(0, MODE_ROUND_LENGTH)
  for (const tier of [
    // 补位第一梯队：新题
    candidates.filter((q) => isNewQuestion(q.id, results)),
    // 补位第二梯队：答对过的题（有 correct 记录且不在错题列）
    candidates.filter(
      (q) => !isWrongListed(q.id, results) && (results[q.id] ?? []).some((r) => r.outcome === 'correct'),
    ),
  ]) {
    if (head.length >= MODE_ROUND_LENGTH) break
    head.push(...shuffleGroup(tier, random).slice(0, MODE_ROUND_LENGTH - head.length))
  }
  return head
}
