import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Question, QuestionResultsState, QuizScope } from '../../types'
import { startQuiz, readSession } from '../useQuiz'
import { writeQuestions, writeQuestionResults, writeFlagged } from '../useLearningData'
import { writeQuizMode } from '../useQuizMode'
import { mulberry32 } from '../../utils/quizEngine'

// Content input only: session construction, scope filtering and engines remain real.
// #287 内置题集改经资产槽位加载（trivia-set），mock 调度池合并接缝为空数组（仅替换题集数据，槽位常量照旧）
vi.mock(import('../../data/trivia-set'), async (importOriginal) => ({
  ...(await importOriginal()),
  loadedTriviaQuestions: () => [] as Question[],
}))

function question(id: string, category = 'Think', book = 'level1'): Question {
  return { id, category, book, type: 'zh2en', prompt: id, options: ['yes', 'no', 'maybe', 'never'], answerIndex: 0, wordId: id, difficulty: 1 }
}

// #272：惊喜会话固定新题优先、偏好记忆拆除后错题优先只剩学科范围可达；惊喜新题优先行为见 useQuiz-scope 测试
const scope: QuizScope = { kind: 'subject', category: 'Think', book: 'level1' }

beforeEach(() => {
  localStorage.clear()
})

describe('#244 错题优先公开会话（#272 起仅学科）', () => {
  it('AC1：3 错 + 7 对 + 10 新 → 3 错 + 7 新，不重放原套答对题', () => {
    const pool = Array.from({ length: 20 }, (_, i) => question(String(100000 + i)))
    const wrongIds = pool.slice(0, 3).map(q => q.id)
    const correctIds = pool.slice(3, 10).map(q => q.id)
    const freshIds = pool.slice(10).map(q => q.id)
    const results: QuestionResultsState = {}
    for (const id of wrongIds) results[id] = [{ outcome: 'wrong', timestamp: '2026-09-11T00:00:00.000Z' }]
    for (const id of correctIds) results[id] = [{ outcome: 'correct', timestamp: '2026-09-11T00:00:00.000Z' }]
    writeQuestions(pool)
    writeQuestionResults(results)
    writeQuizMode('wrong')

    const session = startQuiz(mulberry32(244), scope)!
    expect(session.scope).toEqual(scope)
    expect(session.mode).toBe('wrong')
    const ids = session.questions.map(q => q.id)
    expect(ids).toHaveLength(10)
    expect(new Set(ids).size).toBe(10)
    expect(new Set(ids.slice(0, 3))).toEqual(new Set(wrongIds))
    expect(ids.slice(3).every(id => freshIds.includes(id))).toBe(true)
    expect(ids.filter(id => correctIds.includes(id))).toEqual([])
  })

  it('AC7：短轮不跨分册、大类或题库归属补位', () => {
    // 同 scope 竞争题与跨库题并存；类型与稀缺度都不改身份（9 号段属惊喜，不入学科补位）。
    writeQuestions([
      question('100000'), question('100001'), question('100002'),
      question('100003', 'Think', 'level2'), question('100004', '小学'),
      question('900000'),
    ])
    writeQuestionResults({
      '100000': [{ outcome: 'wrong', timestamp: '2026-09-11T00:00:00.000Z' }],
      '100002': [{ outcome: 'correct', timestamp: '2026-09-11T00:00:00.000Z' }],
    })
    writeQuizMode('wrong')

    const session = startQuiz(mulberry32(244), scope)!
    expect(session.scope).toEqual(scope)
    expect(session.mode).toBe('wrong')
    expect(session.questions.map(q => q.id)).toEqual(['100000', '100001', '100002'])
    expect(session.questions.every(q => q.category === 'Think' && q.book === 'level1')).toBe(true)
  })

  it('AC6：范围为空或全红旗不创建零题会话', () => {
    writeQuizMode('wrong')
    writeQuestions([question('100000', 'Think', 'level2')])
    expect(startQuiz(mulberry32(244), scope)).toBeNull()
    expect(readSession()).toBeNull()

    writeQuestions([question('100001'), question('100000', 'Think', 'level2')])
    writeFlagged({ '100001': { flaggedAt: 1 }, '100000': { flaggedAt: 1 } })
    expect(startQuiz(mulberry32(244), scope)).toBeNull()
    expect(readSession()).toBeNull()
  })
})
