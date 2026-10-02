/**
 * #103 出题模式引擎独立验收（票内 Agent Brief 第 2~4 条 AC 逐条）：
 * 新题优先（drawFreshFirstRound）/ 错题优先（drawWrongFirstRound）两独立纯函数——
 * 题级抽题（不用难度带 / 词窗口 / 同词去重）、排除红旗题、轮长恒 10（可用题不足全量）。
 * 判定唯一数据源 = QuestionResultsState（outcome 三态，index 0 = 最新）。
 */
import { describe, it, expect } from 'vitest'
import type { FlaggedState, Question, QuestionResultsState } from '../../src/types'
import { mulberry32 } from '../../src/utils/quizEngine'
import {
  drawFreshFirstRound,
  drawWrongFirstRound,
  isWrongListed,
  isNewQuestion,
  type ModeDrawParams,
} from '../../src/utils/quizModeEngine'

function makeQ(id: string, wordId = id): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId }
}

/** records 参数：index 0 = 最新（与 sq_question_results 落盘口径一致） */
function resultsOf(entries: Array<[string, Array<'correct' | 'wrong' | 'skipped'>]>): QuestionResultsState {
  const state: QuestionResultsState = {}
  for (const [id, outcomes] of entries) {
    state[id] = outcomes.map((outcome) => ({ outcome, timestamp: '2026-09-01T00:00:00.000Z' }))
  }
  return state
}

function params(
  pool: Question[],
  results: QuestionResultsState = {},
  flagged: FlaggedState = {},
  seed = 42,
): ModeDrawParams {
  return { pool, results, flagged, random: mulberry32(seed) }
}

// ===== 新题优先（Brief 第 2 条）=====

describe('新题优先：四类题排序 = 新题块（零记录 + 仅 skipped）在前', () => {
  const pool = [
    makeQ('zero1'), makeQ('zero2'),
    makeQ('skip1'), makeQ('skip2'),
    makeQ('ok1'), makeQ('ok2'), makeQ('ok3'), makeQ('ok4'),
    makeQ('bad1'), makeQ('bad2'),
  ]
  const results = resultsOf([
    ['skip1', ['skipped']], ['skip2', ['skipped', 'skipped']],
    ['ok1', ['correct']], ['ok2', ['wrong', 'correct']], ['ok3', ['correct']], ['ok4', ['correct']],
    ['bad1', ['wrong']], ['bad2', ['skipped', 'wrong']],
  ])

  it('恰好 4 道新题全部在前 4 位（零记录与仅 skipped 同属新题块），6 道已答过的补位在后', () => {
    const got = drawFreshFirstRound(params(pool, results))
    expect(got).toHaveLength(10)
    const head = new Set(got.slice(0, 4).map((q) => q.id))
    expect(head).toEqual(new Set(['zero1', 'zero2', 'skip1', 'skip2']))
    const tail = new Set(got.slice(4).map((q) => q.id))
    expect(tail).toEqual(new Set(['ok1', 'ok2', 'ok3', 'ok4', 'bad1', 'bad2']))
  })

  it('新题块与补位块各自内部乱序：换 seed 后块内集合不变（块结构稳定）', () => {
    for (const seed of [1, 7, 99, 2026]) {
      const got = drawFreshFirstRound(params(pool, results, {}, seed))
      expect(got).toHaveLength(10)
      expect(new Set(got.slice(0, 4).map((q) => q.id))).toEqual(new Set(['zero1', 'zero2', 'skip1', 'skip2']))
      expect(new Set(got.slice(4).map((q) => q.id))).toEqual(new Set(['ok1', 'ok2', 'ok3', 'ok4', 'bad1', 'bad2']))
    }
  })

  it('确定性：同 seed 两次调用 id 序列一致', () => {
    const a = drawFreshFirstRound(params(pool, results))
    const b = drawFreshFirstRound(params(pool, results))
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id))
  })

  it('纯函数：不修改传入题池与记录', () => {
    const poolCopy = JSON.parse(JSON.stringify(pool)) as Question[]
    const resultsCopy = JSON.parse(JSON.stringify(results)) as QuestionResultsState
    drawFreshFirstRound(params(pool, results))
    expect(pool).toEqual(poolCopy)
    expect(results).toEqual(resultsCopy)
  })
})

describe('新题优先：新题不足 10 补满 / 超出取 10 / 边界', () => {
  it('新题 3 道 + 已答过 12 道 → 恰 10 题：前 3 为新题，后 7 均为已答过的题', () => {
    const fresh = [makeQ('n1'), makeQ('n2'), makeQ('n3')]
    const answered = Array.from({ length: 12 }, (_, i) => makeQ(`a${i + 1}`))
    const results = resultsOf(answered.map((q) => [q.id, ['correct'] as const]))
    const got = drawFreshFirstRound(params([...fresh, ...answered], results))
    expect(got).toHaveLength(10)
    expect(new Set(got.slice(0, 3).map((q) => q.id))).toEqual(new Set(['n1', 'n2', 'n3']))
    for (const q of got.slice(3)) expect(q.id).toMatch(/^a\d+$/)
  })

  it('新题 15 道 → 恰 10 题且全部为新题', () => {
    const fresh = Array.from({ length: 15 }, (_, i) => makeQ(`n${i + 1}`))
    const got = drawFreshFirstRound(params(fresh))
    expect(got).toHaveLength(10)
    for (const q of got) expect(q.id).toMatch(/^n\d+$/)
  })

  it('可用题不足 10（5 新 + 3 已答）→ 全量 8 题返回，新题块在前', () => {
    const pool = [...Array.from({ length: 5 }, (_, i) => makeQ(`n${i}`)), makeQ('a1'), makeQ('a2'), makeQ('a3')]
    const results = resultsOf([['a1', ['wrong']], ['a2', ['correct']], ['a3', ['skipped', 'correct']]])
    const got = drawFreshFirstRound(params(pool, results))
    expect(got).toHaveLength(8)
    expect(new Set(got.slice(0, 5).map((q) => q.id))).toEqual(new Set(['n0', 'n1', 'n2', 'n3', 'n4']))
  })

  it('空题池返回 []', () => {
    expect(drawFreshFirstRound(params([]))).toEqual([])
  })

  it('全部已答过（无新题）→ 已答过的题随机补满 10', () => {
    const pool = Array.from({ length: 10 }, (_, i) => makeQ(`a${i}`))
    const results = resultsOf(pool.map((q) => [q.id, ['correct'] as const]))
    const got = drawFreshFirstRound(params(pool, results))
    expect(got).toHaveLength(10)
    expect(new Set(got.map((q) => q.id))).toEqual(new Set(pool.map((q) => q.id)))
  })
})

// ===== 错题优先（Brief 第 3 条）=====

describe('错题优先：wrong 且未连对 2 次的题全在前；连对 2 次出列；出列后再错重新入列', () => {
  // wrong1: [wrong] 最新错；wrong2: [correct, wrong] 错后对 1 次仍在列；
  // wrong3: [skipped, wrong] 错后跳过仍在列；wrong4: [wrong, correct, correct] 出列后再错重新入列
  const wrongListed = ['wrong1', 'wrong2', 'wrong3', 'wrong4']
  // grad1: [correct, correct, wrong] 连对 2 次出列；grad2: [correct, correct] 连对 2 次出列（无错史也对过）
  const graduated = ['grad1', 'grad2']
  // ok1: 仅对过；skip1: 仅跳过（不算错题 → 新题）；zero1: 零记录（新题）
  const results = resultsOf([
    ['wrong1', ['wrong']],
    ['wrong2', ['correct', 'wrong']],
    ['wrong3', ['skipped', 'wrong']],
    ['wrong4', ['wrong', 'correct', 'correct']],
    ['grad1', ['correct', 'correct', 'wrong']],
    ['grad2', ['correct', 'correct']],
    ['ok1', ['correct']],
    ['skip1', ['skipped']],
  ])
  const pool = [
    ...wrongListed.map(makeQ), ...graduated.map(makeQ), makeQ('ok1'), makeQ('skip1'), makeQ('zero1'),
  ]

  it('isWrongListed 判定：4 题在列 / 出列 2 题不在列 / 无错史不在列', () => {
    for (const id of wrongListed) expect(isWrongListed(id, results)).toBe(true)
    for (const id of graduated) expect(isWrongListed(id, results)).toBe(false)
    expect(isWrongListed('ok1', results)).toBe(false)
    expect(isWrongListed('skip1', results)).toBe(false)
    expect(isWrongListed('zero1', results)).toBe(false)
    expect(isWrongListed('not_in_results', results)).toBe(false)
  })

  it('错题块在前：前 4 位恰为在列错题（乱序），出列题与对过题/新题补位在后', () => {
    const got = drawWrongFirstRound(params(pool, results))
    // 池共 9 → 全量 9 题返回：前 4 = 在列错题，后 5 = 出列题（graduated）+ 对过/新题
    expect(got).toHaveLength(9)
    expect(new Set(got.slice(0, 4).map((q) => q.id))).toEqual(new Set(wrongListed))
    expect(new Set(got.slice(4).map((q) => q.id))).toEqual(new Set([...graduated, 'ok1', 'skip1', 'zero1']))
  })

  it.each([1, 7, 99, 2026])('#244 AC3 新题不足：2 错 → 3 新 → 5 对，块内不锁排列（seed %i）', (seed) => {
    const wrongs = [makeQ('w1'), makeQ('w2')]
    const corrects = Array.from({ length: 8 }, (_, i) => makeQ(`c${i}`))
    const fresh = [makeQ('n0'), makeQ('n1'), makeQ('n2')]
    const res = resultsOf([
      ...corrects.map((q): [string, ['correct']] => [q.id, ['correct']]),
      ['w1', ['wrong']], ['w2', ['correct', 'wrong']],
      ['c1', ['skipped', 'correct']], ['c2', ['correct', 'correct', 'wrong']],
    ])
    const got = drawWrongFirstRound(params([...wrongs, ...corrects, ...fresh], res, {}, seed))
    expect(got).toHaveLength(10)
    expect(new Set(got.map(q => q.id)).size).toBe(10)
    expect(new Set(got.slice(0, 2).map((q) => q.id))).toEqual(new Set(['w1', 'w2']))
    expect(new Set(got.slice(2, 5).map((q) => q.id))).toEqual(new Set(['n0', 'n1', 'n2']))
    for (const q of got.slice(5)) expect(q.id).toMatch(/^c\d$/)
  })

  it.each([10, 12])('#244 AC4 错题 %i 道：新题与答对题不抢名额', (count) => {
    const wrongs = Array.from({ length: count }, (_, i) => makeQ(`w${i}`))
    const res = resultsOf([...wrongs.map((q): [string, ['wrong']] => [q.id, ['wrong']]), ['c1', ['correct']]])
    const got = drawWrongFirstRound(params([...wrongs, makeQ('n1'), makeQ('c1')], res))
    expect(got).toHaveLength(10)
    expect(new Set(got.map(q => q.id)).size).toBe(10)
    for (const q of got) expect(q.id).toMatch(/^w\d+$/)
  })

  it('#244 AC2 无错题且新题足量 → 10 道新题，答对题不抢名额', () => {
    const corrects = [makeQ('c1'), makeQ('c2')]
    const fresh = Array.from({ length: 12 }, (_, i) => makeQ(`n${i}`))
    const res = resultsOf([['c1', ['correct']], ['c2', ['skipped', 'correct']]])
    const got = drawWrongFirstRound(params([...corrects, ...fresh], res))
    expect(got).toHaveLength(10)
    expect(new Set(got.map(q => q.id)).size).toBe(10)
    for (const q of got) expect(q.id).toMatch(/^n\d+$/)
  })

  it('#244 AC5 新题耗尽：错题在前，刚连对两次出列的题可补位', () => {
    const corrects = Array.from({ length: 7 }, (_, i) => makeQ(`c${i}`))
    const res = resultsOf([
      ...corrects.map((q): [string, ['correct']] => [q.id, ['correct']]),
      ['w1', ['wrong']], ['w2', ['correct', 'wrong']],
      ['graduated', ['correct', 'correct', 'wrong']],
    ])
    const got = drawWrongFirstRound(params([...corrects, makeQ('graduated'), makeQ('w1'), makeQ('w2')], res))
    expect(got).toHaveLength(10)
    expect(new Set(got.slice(0, 2).map(q => q.id))).toEqual(new Set(['w1', 'w2']))
    expect(new Set(got.slice(2).map(q => q.id))).toEqual(new Set(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'graduated']))
  })

  it('空题池返回 []；可用题不足 10 全量返回（错题在前）', () => {
    expect(drawWrongFirstRound(params([]))).toEqual([])
    const pool = [makeQ('c1'), makeQ('w1'), makeQ('n1'), makeQ('n2')]
    const res = resultsOf([['w1', ['wrong']], ['c1', ['correct']]])
    const got = drawWrongFirstRound(params(pool, res))
    expect(got).toHaveLength(4)
    expect(new Set(got.map(q => q.id)).size).toBe(4)
    expect(got[0].id).toBe('w1')
    expect(new Set(got.slice(1, 3).map(q => q.id))).toEqual(new Set(['n1', 'n2']))
    expect(got[3].id).toBe('c1')
  })

  it('纯函数：不修改传入题池与记录；同 seed 确定性', () => {
    const pool2 = [...wrongListed.map(makeQ), makeQ('ok1')]
    const res2 = resultsOf([['wrong1', ['wrong']], ['ok1', ['correct']]])
    const poolCopy = structuredClone(pool2)
    const resultsCopy = structuredClone(res2)
    const a = drawWrongFirstRound(params(pool2, res2))
    const b = drawWrongFirstRound(params(pool2, res2))
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id))
    expect(pool2).toEqual(poolCopy)
    expect(res2).toEqual(resultsCopy)
  })
})

describe('isNewQuestion：skipped 归新题（跳过不算答过）', () => {
  const results = resultsOf([
    ['zero', []],
    ['skipOnly', ['skipped']],
    ['skipMix', ['skipped', 'skipped']],
    ['hasCorrect', ['skipped', 'correct']],
    ['hasWrong', ['wrong', 'skipped']],
  ])

  it('零记录 / 仅 skipped → 新题；含 correct 或 wrong 记录 → 不是新题', () => {
    expect(isNewQuestion('zero', results)).toBe(true)
    expect(isNewQuestion('not_in_results', results)).toBe(true)
    expect(isNewQuestion('skipOnly', results)).toBe(true)
    expect(isNewQuestion('skipMix', results)).toBe(true)
    expect(isNewQuestion('hasCorrect', results)).toBe(false)
    expect(isNewQuestion('hasWrong', results)).toBe(false)
  })
})

// ===== 两新模式共同约束（Brief 第 4 条）=====

describe('共同约束：排除红旗题 / 同轮同词多题允许', () => {
  it('新题优先：sq_flagged 有条目的题（含新题与已答过）不出；未标红旗照常出现', () => {
    const pool = [makeQ('f1'), makeQ('f2'), makeQ('a1'), makeQ('a2')]
    const results = resultsOf([['a1', ['correct']], ['a2', ['correct']]])
    const flagged: FlaggedState = { f1: { flaggedAt: 1 }, a1: { flaggedAt: 2 } }
    const got = drawFreshFirstRound(params(pool, results, flagged))
    const ids = got.map((q) => q.id)
    expect(ids).not.toContain('f1')
    expect(ids).not.toContain('a1')
    expect(ids).toContain('f2')
    expect(ids).toContain('a2')
  })

  it('#244 AC8 错题优先：三个梯队均排除红旗，短轮不回收红旗凑数', () => {
    const pool = ['w1', 'w2', 'n1', 'n2', 'c1', 'c2'].map(id => makeQ(id))
    const results = resultsOf([['w1', ['wrong']], ['w2', ['wrong']], ['c1', ['correct']], ['c2', ['correct']]])
    const flagged: FlaggedState = { w1: { flaggedAt: 1 }, n1: { flaggedAt: 2 }, c1: { flaggedAt: 3 } }
    const got = drawWrongFirstRound(params(pool, results, flagged))
    expect(got.map(q => q.id)).toEqual(['w2', 'n2', 'c2'])
  })

  it('同词多题允许：同 wordId 的两道新题可同轮出现（题级抽题不做同词去重）', () => {
    const q1 = makeQ('n1', 'sameWord')
    const q2 = makeQ('n2', 'sameWord')
    const got = drawFreshFirstRound(params([q1, q2]))
    expect(got.map((q) => q.id).sort()).toEqual(['n1', 'n2'])
  })

  it('错题模式同词多题：同 wordId 两道错题可同轮出现', () => {
    const q1 = makeQ('w1', 'sameWord')
    const q2 = makeQ('w2', 'sameWord')
    const results = resultsOf([['w1', ['wrong']], ['w2', ['wrong']]])
    const got = drawWrongFirstRound(params([q1, q2, makeQ('n1')], results))
    expect(new Set(got.slice(0, 2).map((q) => q.id))).toEqual(new Set(['w1', 'w2']))
  })
})
