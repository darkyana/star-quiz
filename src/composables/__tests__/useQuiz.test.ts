/**
 * T3 答题会话状态机单测（Spec §4 REQ-3，AC3-1 ~ AC3-8、AC3-10 ~ AC3-13、AC6-7）
 * 直接操作 localStorage（F5）；随机断言注入 seeded 源保证确定性。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Question, QuizSession } from '../../types'
import {
  startQuiz,
  answerQuiz,
  finishQuiz,
  settleQuiz,
  abandonQuiz,
  clearSession,
} from '../useQuiz'
import { mulberry32 } from '../../utils/quizEngine'

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
    quizId: 'quiz_manual',
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

function session(): QuizSession {
  return JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession
}

function stars(): unknown[] {
  return JSON.parse(localStorage.getItem('sq_stars') as string) ?? []
}

beforeEach(() => {
  localStorage.clear()
})

describe('startQuiz 开始答题（AC3-1 ~ AC3-3）', () => {
  it('AC3-1 题池 10 题生成 in_progress 会话', () => {
    localStorage.setItem('sq_questions', JSON.stringify(makePool(10)))
    const s = startQuiz(mulberry32(42))
    expect(s).not.toBeNull()
    const raw = localStorage.getItem('sq_session')
    expect(raw).not.toBeNull()
    const stored = session()
    expect(stored.status).toBe('in_progress')
    expect(stored.quizId).toBeTruthy()
    expect(stored.questions).toHaveLength(10)
    expect(stored.currentIndex).toBe(0)
    expect(stored.answers).toEqual([])
    expect(stored.correctCount).toBe(0)
  })

  it('AC3-2 题池空返回 null 且不创建会话', () => {
    localStorage.setItem('sq_questions', JSON.stringify([]))
    expect(startQuiz(mulberry32(42))).toBeNull()
    expect(localStorage.getItem('sq_session')).toBeNull()
  })

  it('AC3-3 两次开始 quizId 不同，且题目顺序或选项顺序至少一处不同', () => {
    localStorage.setItem('sq_questions', JSON.stringify(makePool(10)))
    const first = startQuiz(mulberry32(42)) as QuizSession
    const second = startQuiz(mulberry32(43)) as QuizSession
    expect(first.quizId).not.toBe(second.quizId)
    const idOrderDiffers = first.questions.some((q, i) => q.id !== second.questions[i].id)
    let optionDiffers = false
    for (const q of second.questions) {
      const inFirst = first.questions.find((f) => f.id === q.id)
      if (inFirst && JSON.stringify(inFirst.options) !== JSON.stringify(q.options)) {
        optionDiffers = true
        break
      }
    }
    expect(idOrderDiffers || optionDiffers).toBe(true)
  })
})

describe('answerQuiz 作答进度（AC3-4）', () => {
  it('AC3-4 答对追加答案、推进 currentIndex、更新 correctCount', () => {
    seedSession({ questions: makePool(10) })
    const first = session()
    // 第 1 题 answerIndex = 0（makePool 第 0 题 answerIndex=0）
    answerQuiz(0)
    const after = session()
    expect(after.currentIndex).toBe(1)
    expect(after.answers).toHaveLength(1)
    expect(after.answers[0]).toEqual({ questionId: first.questions[0].id, selectedIndex: 0, correct: true })
    expect(after.correctCount).toBe(1)
  })

  it('答错 / 选不会判分正确', () => {
    seedSession({ questions: makePool(10) })
    // 第 1 题 answerIndex = 0，答错选 1
    answerQuiz(1)
    expect(session().answers[0]).toEqual({ questionId: 'q_000', selectedIndex: 1, correct: false })
    answerQuiz(null)
    expect(session().answers[1]).toEqual({ questionId: 'q_001', selectedIndex: null, correct: false })
    expect(session().correctCount).toBe(0)
  })

  it('无会话或已答完时忽略', () => {
    answerQuiz(0)
    expect(localStorage.getItem('sq_session')).toBeNull()
    const s = seedSession({ questions: makePool(10), currentIndex: 10, answers: makePool(10).map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })), correctCount: 10 })
    answerQuiz(0)
    expect(session().currentIndex).toBe(s.currentIndex)
  })
})

describe('finishQuiz 答完转 pending（AC3-5 / AC6-9）', () => {
  it('AC3-5 写入 score 与 earnedStars，status → pending', () => {
    const questions = makePool(10)
    const answers = questions.map((q, i) => ({ questionId: q.id, selectedIndex: i === 0 ? null : 0, correct: i !== 0 }))
    seedSession({ questions, currentIndex: 10, answers, correctCount: 7 })
    finishQuiz()
    const s = session()
    expect(s.status).toBe('pending')
    expect(s.score).toBe(7)
    expect(s.earnedStars).toBe(7)
  })

  it('AC6-9 题池不足全对：earnedStars = 答对数 + 3（折算满分）', () => {
    const questions = makePool(5)
    const answers = questions.map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true }))
    seedSession({ questions, currentIndex: 5, answers, correctCount: 5 })
    finishQuiz()
    const s = session()
    expect(s.status).toBe('pending')
    expect(s.score).toBe(5)
    expect(s.earnedStars).toBe(8)
  })

  it('满分 10/10：earnedStars = 13', () => {
    const questions = makePool(10)
    const answers = questions.map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true }))
    seedSession({ questions, currentIndex: 10, answers, correctCount: 10 })
    finishQuiz()
    expect(session().earnedStars).toBe(13)
  })

  it('未答完不可 finish（保持 in_progress）', () => {
    seedSession({ questions: makePool(10), currentIndex: 3, answers: [], correctCount: 0 })
    finishQuiz()
    expect(session().status).toBe('in_progress')
  })
})

describe('settleQuiz 结算与幂等（AC3-6 / AC3-7 / AC3-11 / AC6-7）', () => {
  it('AC3-6 首次结算入账：写一条答题得星流水，会话 → settled', () => {
    const s = seedSession({ status: 'pending', score: 7, earnedStars: 7 })
    localStorage.setItem('sq_stars', JSON.stringify([]))
    const result = settleQuiz()
    expect(result).toBe('settled')
    const entries = stars()
    expect(entries).toHaveLength(1)
    expect((entries[0] as { quizId: string }).quizId).toBe(s.quizId)
    expect((entries[0] as { amount: number }).amount).toBe(7)
    expect(session().status).toBe('settled')
  })

  it('AC3-7 已入账再次结算幂等：不新增流水', () => {
    const s = seedSession({ status: 'settled', score: 7, earnedStars: 7, settledAt: 2_000_000 })
    localStorage.setItem(
      'sq_stars',
      JSON.stringify([{ id: 'e1', timestamp: 2_000_000, type: 'earn', amount: 7, source: '答题得星', quizId: s.quizId }]),
    )
    const result = settleQuiz()
    expect(result).toBe('idempotent')
    expect(stars()).toHaveLength(1)
    expect(session().status).toBe('settled')
  })

  it('AC6-7 满分结算写两条流水（答题得星 + 满分奖励）', () => {
    seedSession({ status: 'pending', score: 10, earnedStars: 13 })
    localStorage.setItem('sq_stars', JSON.stringify([]))
    settleQuiz()
    const entries = stars() as { type: string; amount: number; source: string }[]
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: 'earn', amount: 10, source: '答题得星' })
    expect(entries[1]).toMatchObject({ type: 'earn', amount: 3, source: '满分奖励' })
  })

  it('AC3-11 无会话 / in_progress 直访结算：返回 redirect 且不写流水', () => {
    const resultNone = settleQuiz()
    expect(resultNone).toBe('redirect')
    expect(localStorage.getItem('sq_stars')).toBeNull()
    seedSession({ status: 'in_progress', answers: [], correctCount: 0 })
    const resultProgress = settleQuiz()
    expect(resultProgress).toBe('redirect')
    expect(localStorage.getItem('sq_stars')).toBeNull()
    expect(session().status).toBe('in_progress')
  })

  it('0 分 pending 会话结算：不写流水但会话 → settled', () => {
    seedSession({ status: 'pending', score: 0, earnedStars: 0 })
    localStorage.setItem('sq_stars', JSON.stringify([]))
    settleQuiz()
    expect(stars()).toHaveLength(0)
    expect(session().status).toBe('settled')
  })
})

describe('abandonQuiz / clearSession 作废与清空（AC3-8）', () => {
  it('AC3-8 abandonQuiz 删除会话且不写流水', () => {
    seedSession({ status: 'in_progress' })
    localStorage.setItem('sq_stars', JSON.stringify([]))
    abandonQuiz()
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(stars()).toEqual([])
  })

  it('clearSession 删除会话（结算页回到首页）', () => {
    seedSession({ status: 'settled' })
    clearSession()
    expect(localStorage.getItem('sq_session')).toBeNull()
  })
})

describe('sq_session 损坏恢复（AC3-10，E1）', () => {
  it('非法 JSON → startQuiz 触发 removeItem + console.warn（含键名与 JSON）→ 视为无会话，可重新开始', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('sq_session', '{invalid json')
    localStorage.setItem('sq_questions', JSON.stringify(makePool(10)))
    const s = startQuiz(mulberry32(42))
    expect(s).not.toBeNull()
    const raw = localStorage.getItem('sq_session') as string
    expect(raw).not.toContain('{invalid json')
    const parsed = JSON.parse(raw) as QuizSession
    expect(parsed.status).toBe('in_progress')
    expect(parsed.quizId).toBeTruthy()
    expect(warnSpy).toHaveBeenCalled()
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('sq_session')
    expect(msg).toContain('JSON')
    warnSpy.mockRestore()
  })
})
