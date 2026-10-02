/**
 * AC1-1 ~ AC1-8 / AC2-1 ~ AC2-7 / AC8-3 ~ AC8-6、AC8-8 纯函数验收复核
 * 来源：Spec §4 REQ-1 / REQ-2 / REQ-8 验收标准（Given-When-Then 逐条落地）。
 * Spec §4 声明：纯函数走单测；本文件为验收层独立复核（随机源用 Spec §2 规定的 seeded mulberry32）。
 * R24 起 drawQuestions 为对象参数形式（分层抽题引擎）；AC1 组经 drawLegacy 包装保留原纯随机语义口径复核。
 */
import { describe, it, expect } from 'vitest'
import type { Question, StarEntry } from '../../src/types/index'
import { drawQuestions, shuffleOptions, grade, mulberry32 } from '../../src/utils/quizEngine'
import { computeBalance, earnForQuiz, redeemReward } from '../../src/composables/useStarData'
import { formatRelativeTime } from '../../src/utils/relativeTime'

function makeQ(id: string, answerIndex = 0): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex, wordId: id }
}

const pool20: Question[] = Array.from({ length: 20 }, (_, i) => makeQ(`p${String(i + 1).padStart(2, '0')}`))

/** AC1 既有语义口径包装：全缺省难度 3 + level 3（全 comfort 带宽）+ 首局 + 空词窗口 */
function drawLegacy(pool: Question[], count: number, random: () => number): Question[] {
  return drawQuestions({
    pool,
    level: 3,
    lastRoundCorrect: null,
    recentWords: [],
    random,
    count,
  })
}

describe('AC1 Quiz Engine（8 条）', () => {
  it('AC1-1 抽 10 题：长度 10、id 互不重复、全部属于原题池', () => {
    const got = drawLegacy(pool20, 10, mulberry32(42))
    expect(got).toHaveLength(10)
    const ids = got.map((q) => q.id)
    expect(new Set(ids).size).toBe(10)
    const poolIds = new Set(pool20.map((q) => q.id))
    for (const id of ids) expect(poolIds.has(id)).toBe(true)
  })

  it('AC1-2 题池不足：6 题全量返回，id 集合与原题池相同', () => {
    const pool6 = pool20.slice(0, 6)
    const got = drawLegacy(pool6, 10, mulberry32(42))
    expect(got).toHaveLength(6)
    expect(new Set(got.map((q) => q.id))).toEqual(new Set(pool6.map((q) => q.id)))
  })

  it('AC1-3 空题池返回 []', () => {
    expect(drawLegacy([], 10, mulberry32(42))).toEqual([])
  })

  it('AC1-4 不修改原题池：调用后与原深拷贝相等', () => {
    const before = JSON.parse(JSON.stringify(pool20))
    drawLegacy(pool20, 10, mulberry32(42))
    expect(pool20).toHaveLength(20)
    expect(pool20).toEqual(before)
  })

  it('AC1-5 随机源可注入 + 确定性：同 seed 两次结果一致，不同 seed 至少一处不同', () => {
    const a1 = drawLegacy(pool20, 10, mulberry32(42))
    const a2 = drawLegacy(pool20, 10, mulberry32(42))
    const b = drawLegacy(pool20, 10, mulberry32(43))
    const idsA = a1.map((q) => q.id)
    const idsB = b.map((q) => q.id)
    // 确定性
    expect(a2.map((q) => q.id)).toEqual(idsA)
    // 至少一处不同：id 序列不同 或 任一题选项顺序不同
    const sameIds = idsA.every((id, i) => id === idsB[i])
    const optsA = shuffleOptions(pool20[0], mulberry32(99))
    const optsB = shuffleOptions(pool20[0], mulberry32(100))
    const optsDiffer = optsA.options.some((o, i) => o !== optsB.options[i])
    expect(sameIds && !optsDiffer).toBe(false)
  })

  it('AC1-6 选项乱序含 4 项：为原选项的排列', () => {
    const question = makeQ('t1')
    question.options = ['a', 'b', 'c', 'd']
    const got = shuffleOptions(question, mulberry32(42))
    expect(got.options).toHaveLength(4)
    expect(new Set(got.options)).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('AC1-7 answerIndex 重映射 + 不修改原题', () => {
    const question = makeQ('t2', 2)
    question.options = ['a', 'b', 'c', 'd']
    const before = JSON.parse(JSON.stringify(question))
    const got = shuffleOptions(question, mulberry32(42))
    expect([0, 1, 2, 3]).toContain(got.answerIndex)
    expect(got.options[got.answerIndex]).toBe('c')
    expect(question.options).toEqual(before.options)
    expect(question.answerIndex).toBe(before.answerIndex)
  })

  it('AC1-8 grade 三态判分', () => {
    expect(grade(1, 1)).toBe('correct')
    expect(grade(0, 1)).toBe('wrong')
    expect(grade(null, 1)).toBe('skipped')
  })
})

describe('AC2 星星流水（7 条）', () => {
  function entry(type: 'earn' | 'redeem', amount: number): StarEntry {
    return { id: `e${Math.random()}`, timestamp: 1, type, amount, source: type === 'earn' ? '答题得星' : '兑换：x' }
  }

  it('AC2-1 余额实时求和', () => {
    const entries = [entry('earn', 5), entry('redeem', 2), entry('earn', 3)]
    expect(computeBalance(entries)).toBe(6)
  })

  it('AC2-2 空流水余额 0', () => {
    expect(computeBalance([])).toBe(0)
  })

  it('AC2-3 答题入账一条（append-only，不改原数组）', () => {
    const got = earnForQuiz([], { quizId: 'q1', correctCount: 7, totalCount: 10 })
    expect(got).toHaveLength(1)
    const e = got[0]
    expect(typeof e.id).toBe('string')
    expect(e.id.length).toBeGreaterThan(0)
    expect(typeof e.timestamp).toBe('number')
    expect(e.type).toBe('earn')
    expect(e.amount).toBe(7)
    expect(e.source).toBe('答题得星')
    expect(e.quizId).toBe('q1')
  })

  it('AC2-4 满分追加奖励：第二条 amount 3 / source 满分奖励', () => {
    const got = earnForQuiz([], { quizId: 'q1', correctCount: 10, totalCount: 10 })
    expect(got).toHaveLength(2)
    expect(got[1]).toMatchObject({ type: 'earn', amount: 3, source: '满分奖励', quizId: 'q1' })
  })

  it('AC2-5 0 分不写流水', () => {
    const got = earnForQuiz([], { quizId: 'q1', correctCount: 0, totalCount: 10 })
    expect(got).toHaveLength(0)
  })

  it('AC2-6 兑换扣星写流水（来源文本快照）', () => {
    const entries = [entry('earn', 10)]
    const reward = { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' }
    const got = redeemReward(entries, reward)
    expect(got.ok).toBe(true)
    const appended = (got as { ok: true; entries: StarEntry[] }).entries
    expect(appended).toHaveLength(2)
    expect(appended[1]).toMatchObject({ type: 'redeem', amount: 5, source: '兑换：菠萝油' })
  })

  it('AC2-7 兑换超余额逻辑层拒绝（C3），entries 不变', () => {
    const entries = [entry('earn', 3)]
    const before = JSON.parse(JSON.stringify(entries))
    const reward = { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' }
    const got = redeemReward(entries, reward)
    expect(got.ok).toBe(false)
    const unchanged = (got as { ok: false; entries: StarEntry[] }).entries
    expect(unchanged).toEqual(before)
  })
})

describe('AC8 相对时间 formatRelativeTime（五档 + 边界）', () => {
  it('AC8-3 59 秒内 → 刚刚', () => {
    const now = new Date(2026, 7, 21, 12, 0, 0).getTime()
    expect(formatRelativeTime(now - 59_000, now)).toBe('刚刚')
  })

  it('AC8-4 分钟前边界：60s → 1 分钟前；59 分钟 → 59 分钟前', () => {
    const now = new Date(2026, 7, 21, 12, 0, 0).getTime()
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 分钟前')
    expect(formatRelativeTime(now - 3_540_000, now)).toBe('59 分钟前')
  })

  it('AC8-5 小时前边界：60 分钟 → 1 小时前', () => {
    const now = new Date(2026, 7, 21, 12, 0, 0).getTime()
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1 小时前')
  })

  it('AC8-6 天前与日期边界：6 天 → 6 天前；7 天 → YYYY-MM-DD', () => {
    const now = new Date(2026, 7, 21, 0, 0, 0).getTime()
    expect(formatRelativeTime(now - 518_400_000, now)).toBe('6 天前')
    expect(formatRelativeTime(now - 604_800_000, now)).toBe('2026-08-14')
  })

  it('AC8-8 24 小时边界：23h59m → 23 小时前；24h → 1 天前', () => {
    const now = new Date(2026, 7, 21, 12, 0, 0).getTime()
    expect(formatRelativeTime(now - 86_340_000, now)).toBe('23 小时前')
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('1 天前')
  })
})
