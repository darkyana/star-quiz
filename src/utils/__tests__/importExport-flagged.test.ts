/**
 * R36 学习文件红旗（flagged）校验单测（Spec 20260827-v0.10.0-R36 REQ-R36-4「红旗结构」原子校验；
 * #69 老板拍板修订：条目只校验 { flaggedAt: number }，correct 已废止）。
 * 2.0 契约：flagged 必须为对象且每条目含 flaggedAt 数字；缺 correct 的新备份通过；
 * 含 correct 的旧备份照常通过（向后兼容，不做未知字段校验）；缺 flaggedAt / 结构非法 → 整文件拒绝。
 */
import { describe, it, expect } from 'vitest'
import type { Question, FlaggedState } from '../../types'
import { buildLearningExport, validateLearningImport } from '../importExport'

const NOW = '2026-08-27T10:30:00.000Z'

function makeQuestion(id: string): Question {
  return {
    id,
    type: 'zh2en',
    prompt: '火车',
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 0,
    wordId: 'train',
    difficulty: 3,
  }
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

describe('R36 buildLearningExport flagged 完整映射', () => {
  it('flagged 多键映射完整进入导出对象，version "3.0"（#173 升位）', () => {
    const flagged: FlaggedState = {
      '000001': { flaggedAt: 1000 },
      '000002': { flaggedAt: 2000 },
    }

    const result = buildLearningExport([makeQuestion('000001')], flagged, {}, NOW)

    expect(result.version).toBe('3.0')
    expect(result.flagged).toEqual({ '000001': { flaggedAt: 1000, childId: 'default' }, '000002': { flaggedAt: 2000, childId: 'default' } })
  })

  it('flagged 为空对象时导出空映射（无红旗）', () => {
    const result = buildLearningExport([makeQuestion('000001')], {}, {}, NOW)
    expect(result.version).toBe('3.0')
    expect(result.flagged).toEqual({})
  })
})

describe('R36 validateLearningImport flagged 原子校验（REQ-R36-4；#69 修订口径）', () => {
  it('合法 flagged 多键（仅 flaggedAt）→ ok=true 且 data.flagged 与文件值一致 + #173 补 childId', () => {
    const flagged = {
      '000001': { flaggedAt: 1000 },
      '000002': { flaggedAt: 2000 },
    }
    const result = validateLearningImport(learningFileText({ flagged }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.flagged).toEqual({
        '000001': { flaggedAt: 1000, childId: 'default' },
        '000002': { flaggedAt: 2000, childId: 'default' },
      })
    }
  })

  it('向后兼容：含 correct 的旧备份条目照常通过（#69：不做未知字段校验）', () => {
    const legacy = {
      '000001': { flaggedAt: 1000, correct: true },
      '000002': { flaggedAt: 2000, correct: null },
    }
    const result = validateLearningImport(learningFileText({ flagged: legacy }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      // #69 未知字段不校验照常通过；#173 2.0 文件条目补 childId
      expect(result.data.flagged).toEqual({
        '000001': { flaggedAt: 1000, correct: true, childId: 'default' },
        '000002': { flaggedAt: 2000, correct: null, childId: 'default' },
      })
    }
  })

  it('flagged 整体非对象（数组 / 字符串）→ 拒绝「flagged 必须是对象」', () => {
    expect(validateLearningImport(learningFileText({ flagged: [] }))).toEqual({
      ok: false,
      reason: 'flagged 必须是对象',
      code: 'invalid',
      })
    expect(validateLearningImport(learningFileText({ flagged: 'x' }))).toEqual({
      ok: false,
      reason: 'flagged 必须是对象',
      code: 'invalid',
      })
  })

  it('条目缺 flaggedAt / flaggedAt 非 number → 拒绝精确 reason', () => {
    expect(validateLearningImport(learningFileText({ flagged: { '000001': {} } }))).toEqual({
      ok: false,
      reason: 'flagged 000001：缺少字段 flaggedAt 或类型错误',
      code: 'invalid',
      })
    expect(validateLearningImport(learningFileText({ flagged: { '000001': { flaggedAt: '1000' } } }))).toEqual({
      ok: false,
      reason: 'flagged 000001：缺少字段 flaggedAt 或类型错误',
      code: 'invalid',
      })
  })

  it('条目本身非对象 → 拒绝精确 reason', () => {
    expect(validateLearningImport(learningFileText({ flagged: { '000001': 'oops' } }))).toEqual({
      ok: false,
      reason: 'flagged 000001：缺少字段 flaggedAt 或类型错误',
      code: 'invalid',
      })
  })

  it('拒绝时本地数据逐字不变（localStorage 快照）', () => {
    localStorage.setItem('sq_flagged', JSON.stringify({ '000001': { flaggedAt: 1 } }))
    const before = localStorage.getItem('sq_flagged')
    const result = validateLearningImport(learningFileText({ flagged: { '000001': { flaggedAt: 'x' } } }))
    expect(result.ok).toBe(false)
    expect(localStorage.getItem('sq_flagged')).toBe(before)
  })
})
