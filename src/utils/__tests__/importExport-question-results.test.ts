/**
 * R36 学习文件 questionResults 校验单测（Spec 20260827-v0.10.0-R36 REQ-R36-4）
 * 2.0 契约：questionResults 必填（缺字段拒绝）；覆盖模式语义下做孤儿清理（questionId 不在文件题池的条目删除，题在逐字保留）；
 * 字段类型非法 → 整文件原子拒绝（本地数据逐字不变）。
 */
import { describe, it, expect } from 'vitest'
import type { Question, QuestionResult, QuestionResultsState } from '../../types'
import { validateLearningImport } from '../importExport'

const NOW = '2026-08-27T10:30:00.000Z'

function makeQuestion(id: string): Question {
  return {
    id,
    type: 'zh2en',
    prompt: `题目${id}`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 0,
    wordId: id,
    difficulty: 3,
  }
}

/** 题 A 的 5 条记录（index 0 = 最新，三态混排） */
function resultsOfQuestionA(withChildId = false): QuestionResult[] {
  // #173：2.0 文件导入按默认补 childId（default 孩子）；withChildId = 期望补齐后的形状
  const c = withChildId ? 'default' : undefined
  return [
    { outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z', ...(c ? { childId: c } : {}) },
    { outcome: 'wrong', timestamp: '2026-08-24T10:00:00.000Z', ...(c ? { childId: c } : {}) },
    { outcome: 'skipped', timestamp: '2026-08-23T10:00:00.000Z', ...(c ? { childId: c } : {}) },
    { outcome: 'correct', timestamp: '2026-08-22T10:00:00.000Z', ...(c ? { childId: c } : {}) },
    { outcome: 'correct', timestamp: '2026-08-21T10:00:00.000Z', ...(c ? { childId: c } : {}) },
  ]
}

/** 题 B 的 3 条记录（不在题池的孤儿题） */
function resultsOfOrphanB(): QuestionResult[] {
  return [
    { outcome: 'wrong', timestamp: '2026-08-25T09:00:00.000Z' },
    { outcome: 'wrong', timestamp: '2026-08-24T09:00:00.000Z' },
    { outcome: 'skipped', timestamp: '2026-08-23T09:00:00.000Z' },
  ]
}

function learningFileText(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    version: '2.0',
    exportedAt: NOW,
    questionPool: [makeQuestion('000001'), makeQuestion('000002')],
    flagged: {},
    questionResults: {},
  }
  return JSON.stringify({ ...base, ...overrides })
}

describe('R36 validateLearningImport questionResults 合法导入 + 孤儿清理', () => {
  it('题在新题池 → data.questionResults 内容与文件值一致（含满窗口 5 条；#173 起每条补 childId、归一 version "3.0"）', () => {
    const results: QuestionResultsState = { '000001': resultsOfQuestionA() }
    const result = validateLearningImport(learningFileText({ questionResults: results }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.version).toBe('3.0')
      expect(result.data.questionResults).toEqual({ '000001': resultsOfQuestionA(true) })
    }
  })

  it('题 A（在新题池，5 条）逐字保留，孤儿题 B（不在题池，3 条）被清理', () => {
    const results: QuestionResultsState = {
      '000001': resultsOfQuestionA(),
      '999999': resultsOfOrphanB(),
    }
    const result = validateLearningImport(learningFileText({ questionResults: results }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.questionResults).toEqual({ '000001': resultsOfQuestionA(true) })
      // 内容与顺序逐字保留（#173 仅补 childId 一列）
      expect(JSON.stringify(result.data.questionResults['000001'])).toBe(JSON.stringify(resultsOfQuestionA(true)))
      expect(Object.keys(result.data.questionResults)).toEqual(['000001'])
    }
  })

  it('空对象 {} → ok（无记录，覆盖语义 = 清空）', () => {
    const result = validateLearningImport(learningFileText({ questionResults: {} }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.questionResults).toEqual({})
    }
  })
})

describe('R36 validateLearningImport questionResults 原子校验', () => {
  it('整体非对象（数组 / 字符串）→ 整文件拒绝', () => {
    expect(validateLearningImport(learningFileText({ questionResults: [] }))).toEqual({
      ok: false,
      reason: 'questionResults 必须是对象',
      code: 'invalid',
      })
    expect(validateLearningImport(learningFileText({ questionResults: 'x' }))).toEqual({
      ok: false,
      reason: 'questionResults 必须是对象',
      code: 'invalid',
      })
  })

  it('某题的值非数组（值为非数组对象）→ 整文件拒绝', () => {
    expect(validateLearningImport(learningFileText({ questionResults: { '000001': { outcome: 'correct' } } }))).toEqual({
      ok: false,
      reason: 'questionResults 000001：记录必须是数组',
      code: 'invalid',
      })
  })

  it('元素缺 outcome → 整文件拒绝', () => {
    const bad = [{ timestamp: '2026-08-25T10:00:00.000Z' }]
    expect(validateLearningImport(learningFileText({ questionResults: { '000001': bad } }))).toEqual({
      ok: false,
      reason: 'questionResults 000001 第 1 条：缺少字段 outcome 或类型错误',
      code: 'invalid',
      })
  })

  it('元素缺 timestamp → 整文件拒绝', () => {
    const bad = [{ outcome: 'correct' }]
    expect(validateLearningImport(learningFileText({ questionResults: { '000001': bad } }))).toEqual({
      ok: false,
      reason: 'questionResults 000001 第 1 条：缺少字段 timestamp 或类型错误',
      code: 'invalid',
      })
  })

  it('outcome 不在三态枚举（"gave_up"）→ 整文件拒绝', () => {
    const bad = [{ outcome: 'gave_up', timestamp: '2026-08-25T10:00:00.000Z' }]
    expect(validateLearningImport(learningFileText({ questionResults: { '000001': bad } }))).toEqual({
      ok: false,
      reason: 'questionResults 000001 第 1 条：缺少字段 outcome 或类型错误',
      code: 'invalid',
      })
  })

  it('timestamp 非 string（number）→ 整文件拒绝', () => {
    const bad = [{ outcome: 'correct', timestamp: 1724230000000 }]
    expect(validateLearningImport(learningFileText({ questionResults: { '000001': bad } }))).toEqual({
      ok: false,
      reason: 'questionResults 000001 第 1 条：缺少字段 timestamp 或类型错误',
      code: 'invalid',
      })
  })

  it('第 3 条记录非法 → 条号 1-based 为 3', () => {
    const bad = [
      { outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' },
      { outcome: 'wrong', timestamp: '2026-08-24T10:00:00.000Z' },
      { outcome: 'correct' },
    ]
    expect(validateLearningImport(learningFileText({ questionResults: { '000001': bad } }))).toEqual({
      ok: false,
      reason: 'questionResults 000001 第 3 条：缺少字段 timestamp 或类型错误',
      code: 'invalid',
      })
  })

  it('拒绝时本地数据逐字不变（localStorage 快照）', () => {
    localStorage.setItem('sq_questions', JSON.stringify([makeQuestion('000001')]))
    localStorage.setItem('sq_question_results', JSON.stringify({ '000001': resultsOfQuestionA() }))
    const before = {
      questions: localStorage.getItem('sq_questions'),
      results: localStorage.getItem('sq_question_results'),
    }

    const result = validateLearningImport(learningFileText({ questionResults: { '000001': 'not-array' } }))
    expect(result.ok).toBe(false)

    expect(localStorage.getItem('sq_questions')).toBe(before.questions)
    expect(localStorage.getItem('sq_question_results')).toBe(before.results)
  })
})
