/**
 * R27 逐题答题记录写入单测（Spec 20260825-v0.7.2-R27，AC-R27-2-1 ~ AC-R27-2-8）
 * settleQuiz 首次结算分支写入 + abandonQuiz 删会话前写入（两链路共用三态映射 / 滚动窗口 5 条 / 同轮共享 ISO 时间戳）。
 * 手动 seed 会话 + 直接断言 localStorage（与 useQuiz.test.ts 同模式）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Question, QuestionResultsState, QuizSession } from '../../types'
import { settleQuiz, abandonQuiz } from '../useQuiz'

const RESULTS_KEY = 'sq_question_results'
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function makePool(n: number): Question[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q_${String(i).padStart(3, '0')}`,
    type: 'zh2en',
    prompt: `word_${i}`,
    options: [`a${i}`, `b${i}`, `c${i}`, `d${i}`],
    answerIndex: i % 4,
    wordId: `w_${i}`,
  }))
}

function seedSession(partial: Partial<QuizSession> = {}): QuizSession {
  const session: QuizSession = {
    quizId: 'quiz_r27',
    status: 'in_progress',
    questions: makePool(10),
    currentIndex: 0,
    answers: [],
    correctCount: 0,
    createdAt: 1_000_000,
    ...partial,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
  return session
}

function results(): QuestionResultsState {
  const raw = localStorage.getItem(RESULTS_KEY)
  return raw === null ? {} : (JSON.parse(raw) as QuestionResultsState)
}

/** 收集一轮全部记录的时间戳，断言：均为合法 ISO 8601 且同轮全部相同 */
function expectSharedIsoTimestamp(timestamps: string[]): void {
  expect(timestamps).not.toHaveLength(0)
  for (const t of timestamps) expect(t).toMatch(ISO_RE)
  expect(new Set(timestamps).size).toBe(1)
}

beforeEach(() => {
  localStorage.clear()
})

describe('settleQuiz 首次结算写入 sq_question_results（AC-R27-2-1 / 2 / 5 / 7）', () => {
  it('AC-R27-2-1 三态映射 + 同轮共享 ISO 时间戳：5 对各 1 条 correct、3 错各 1 条 wrong、2 不会各 1 条 skipped', () => {
    const questions = makePool(10)
    const answers = [
      ...questions.slice(0, 5).map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })),
      ...questions.slice(5, 8).map((q) => ({ questionId: q.id, selectedIndex: 1, correct: false })),
      ...questions.slice(8).map((q) => ({ questionId: q.id, selectedIndex: null, correct: false })),
    ]
    seedSession({ status: 'pending', score: 5, earnedStars: 5, currentIndex: 10, answers, correctCount: 5 })
    localStorage.setItem('sq_stars', JSON.stringify([]))

    expect(settleQuiz()).toBe('settled')

    const state = results()
    for (const q of questions.slice(0, 5)) {
      expect(state[q.id]).toHaveLength(1)
      expect(state[q.id][0].outcome).toBe('correct')
    }
    for (const q of questions.slice(5, 8)) {
      expect(state[q.id]).toHaveLength(1)
      expect(state[q.id][0].outcome).toBe('wrong')
    }
    for (const q of questions.slice(8)) {
      expect(state[q.id]).toHaveLength(1)
      expect(state[q.id][0].outcome).toBe('skipped')
    }
    expectSharedIsoTimestamp(questions.flatMap((q) => state[q.id].map((r) => r.timestamp)))
  })

  it('AC-R27-2-2 未作答题不写：answers 仅含 10 题中的 6 题，其余 4 个 questionId 无记录', () => {
    const questions = makePool(10)
    const answers = questions
      .slice(0, 6)
      .map((q, i) => ({ questionId: q.id, selectedIndex: i % 2 === 0 ? 0 : 1, correct: i % 2 === 0 }))
    seedSession({ status: 'pending', score: 3, earnedStars: 3, currentIndex: 6, answers, correctCount: 3 })
    localStorage.setItem('sq_stars', JSON.stringify([]))

    settleQuiz()

    const state = results()
    expect(Object.keys(state)).toHaveLength(6)
    for (const q of questions.slice(0, 6)) expect(state[q.id]).toHaveLength(1)
    for (const q of questions.slice(6)) expect(state[q.id]).toBeUndefined()
  })

  it('AC-R27-2-5 二次结算幂等：返回 idempotent 且每题记录数与首次结算后相等（不二次追加）', () => {
    const questions = makePool(10)
    const answers = questions.map((q, i) => ({ questionId: q.id, selectedIndex: i < 7 ? 0 : null, correct: i < 7 }))
    seedSession({ status: 'pending', score: 7, earnedStars: 7, currentIndex: 10, answers, correctCount: 7 })
    localStorage.setItem('sq_stars', JSON.stringify([]))

    expect(settleQuiz()).toBe('settled')
    const afterFirst = results()
    for (const q of questions) expect(afterFirst[q.id]).toHaveLength(1)

    expect(settleQuiz()).toBe('idempotent')
    expect(results()).toEqual(afterFirst)
  })

  it('AC-R27-2-7 无记录的题写入首条：questionId 键被创建、数组长度 1、新记录位于 index 0', () => {
    expect(localStorage.getItem(RESULTS_KEY)).toBeNull()
    const questions = makePool(10)
    const answers = questions.map((q, i) => ({ questionId: q.id, selectedIndex: i === 0 ? 1 : 0, correct: i !== 0 }))
    seedSession({ status: 'pending', score: 9, earnedStars: 9, currentIndex: 10, answers, correctCount: 9 })
    localStorage.setItem('sq_stars', JSON.stringify([]))

    settleQuiz()

    const state = results()
    expect(Object.keys(state)).toHaveLength(10)
    const records = state[questions[0].id]
    expect(records).toHaveLength(1)
    expect(records[0].outcome).toBe('wrong')
    expect(records[0].timestamp).toMatch(ISO_RE)
  })
})

describe('settleQuiz 不写场景（AC-R27-2-4 / AC-R27-2-6）', () => {
  it('AC-R27-2-4 无会话 / in_progress 直访结算：返回 redirect 且 sq_question_results 不变', () => {
    const preset: QuestionResultsState = { q_000: [{ outcome: 'correct', timestamp: '2026-01-01T00:00:00.000Z' }] }
    localStorage.setItem(RESULTS_KEY, JSON.stringify(preset))

    expect(settleQuiz()).toBe('redirect')
    expect(localStorage.getItem(RESULTS_KEY)).toBe(JSON.stringify(preset))

    seedSession({ status: 'in_progress' })
    localStorage.setItem('sq_stars', JSON.stringify([]))
    expect(settleQuiz()).toBe('redirect')
    expect(localStorage.getItem(RESULTS_KEY)).toBe(JSON.stringify(preset))
  })

  it('AC-R27-2-6 已有 5 条记录的题再写入：仍 5 条，index 0 为新记录 t6，t1 被丢弃，t2~t5 依次位于 index 1~4', () => {
    const t = (n: number) => `2026-01-01T00:00:0${n}.000Z`
    const history = [t(5), t(4), t(3), t(2), t(1)] // index 0 = t5 最新 … index 4 = t1 最旧
    localStorage.setItem(
      RESULTS_KEY,
      JSON.stringify({ q_000: history.map((timestamp, i) => ({ outcome: i % 2 === 0 ? 'correct' : 'wrong', timestamp })) }),
    )
    const questions = makePool(10)
    const answers = questions.map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true }))
    seedSession({ status: 'pending', score: 10, earnedStars: 13, currentIndex: 10, answers, correctCount: 10 })
    localStorage.setItem('sq_stars', JSON.stringify([]))

    settleQuiz()

    const records = results().q_000
    expect(records).toHaveLength(5)
    expect(records[0].timestamp).toMatch(ISO_RE)
    expect(history).not.toContain(records[0].timestamp) // t6 为新时刻
    expect(records.slice(1).map((r) => r.timestamp)).toEqual([t(5), t(4), t(3), t(2)])
  })
})

describe('abandonQuiz 删会话前写入（AC-R27-2-3 / AC-R27-2-8）', () => {
  it('AC-R27-2-3 放弃写入已作答 5 题（2 correct / 2 wrong / 1 skipped），未作答 5 题无记录；sq_stars 不变、会话删除；随后 settleQuiz 返回 redirect', () => {
    const questions = makePool(10)
    const answers = [
      { questionId: questions[0].id, selectedIndex: 0, correct: true },
      { questionId: questions[1].id, selectedIndex: 2, correct: true },
      { questionId: questions[2].id, selectedIndex: 1, correct: false },
      { questionId: questions[3].id, selectedIndex: 3, correct: false },
      { questionId: questions[4].id, selectedIndex: null, correct: false },
    ]
    seedSession({ currentIndex: 5, answers, correctCount: 2 })
    localStorage.setItem(
      'sq_stars',
      JSON.stringify([{ id: 'e1', timestamp: 2_000_000, type: 'earn', amount: 3, source: '答题得星' }]),
    )
    const starsBefore = localStorage.getItem('sq_stars')

    abandonQuiz()

    const state = results()
    expect(state[questions[0].id][0].outcome).toBe('correct')
    expect(state[questions[1].id][0].outcome).toBe('correct')
    expect(state[questions[2].id][0].outcome).toBe('wrong')
    expect(state[questions[3].id][0].outcome).toBe('wrong')
    expect(state[questions[4].id][0].outcome).toBe('skipped')
    for (const q of questions.slice(0, 5)) expect(state[q.id]).toHaveLength(1)
    for (const q of questions.slice(5)) expect(state[q.id]).toBeUndefined()
    expectSharedIsoTimestamp(questions.slice(0, 5).flatMap((q) => state[q.id].map((r) => r.timestamp)))
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(localStorage.getItem('sq_stars')).toBe(starsBefore)
    expect(settleQuiz()).toBe('redirect')
  })

  it('AC-R27-2-8 放弃重复调用零追加：第二次 abandonQuiz 后与首次放弃后逐字相等', () => {
    const questions = makePool(10)
    const answers = questions
      .slice(0, 3)
      .map((q, i) => ({ questionId: q.id, selectedIndex: i === 0 ? null : 0, correct: i !== 0 }))
    seedSession({ currentIndex: 3, answers, correctCount: 2 })

    abandonQuiz()
    const afterFirst = localStorage.getItem(RESULTS_KEY)
    expect(Object.keys(results())).toHaveLength(3)

    abandonQuiz()

    expect(localStorage.getItem(RESULTS_KEY)).toBe(afterFirst)
    expect(localStorage.getItem('sq_session')).toBeNull()
  })
})
