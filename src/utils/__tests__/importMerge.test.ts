/**
 * R21 追加导入合并纯函数单测（Spec 20260826-R21-追加导入 REQ-R21-2-1/2-2/2-4）
 * 覆盖：重编号顺延 / 空库起始 / 字段原样 / existing 不可变 / 溢出拒绝与恰好通过 / 空 incoming / 脏 id 跳过。
 */
import { describe, it, expect } from 'vitest'
import { mergeAppendQuestions } from '../importMerge'
import type { Question } from '../../types'

function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: 'zh2en',
    prompt: `题目${id}`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 0,
    wordId: `w-${id}`,
    ...overrides,
  }
}

describe('mergeAppendQuestions 重编号顺延', () => {
  it('非空库：新 id = 现有最大数值 id + 1 起顺延，existing 逐字保留在前', () => {
    const existing = [makeQuestion('000005'), makeQuestion('000010')]
    const incoming = [makeQuestion('q1'), makeQuestion('q2')]
    const result = mergeAppendQuestions(existing, incoming)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((q) => q.id)).toEqual(['000005', '000010', '000011', '000012'])
  })

  it('空库：从 000001 起编号', () => {
    const result = mergeAppendQuestions([], [makeQuestion('q1'), makeQuestion('q2')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((q) => q.id)).toEqual(['000001', '000002'])
  })

  it('重编号只改 id：type/prompt/options/answerIndex/wordId/difficulty 原样保留', () => {
    const incoming: Question[] = [
      makeQuestion('q1', {
        type: 'en2zh',
        prompt: 'apple 是什么？',
        options: ['苹果', '香蕉', '梨', '葡萄'],
        answerIndex: 2,
        wordId: 'apple',
        difficulty: 1,
      }),
    ]
    const result = mergeAppendQuestions([makeQuestion('000001')], incoming)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveLength(2)
    const appended = result.data[1]
    expect(appended.id).toBe('000002')
    expect(appended.type).toBe('en2zh')
    expect(appended.prompt).toBe('apple 是什么？')
    expect(appended.options).toEqual(['苹果', '香蕉', '梨', '葡萄'])
    expect(appended.answerIndex).toBe(2)
    expect(appended.wordId).toBe('apple')
    expect(appended.difficulty).toBe(1)
  })

  it('existing 入参数组不可变：返回新数组，原数组内容不变', () => {
    const existing = [makeQuestion('000003')]
    const snapshot = structuredClone(existing)
    const result = mergeAppendQuestions(existing, [makeQuestion('q1')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).not.toBe(existing)
    expect(existing).toEqual(snapshot)
    expect(existing).toHaveLength(1)
  })
})

describe('mergeAppendQuestions id 溢出保护', () => {
  it('现有最大 999999 + 1 题：ok:false，reason 固定文案，整次拒绝', () => {
    const result = mergeAppendQuestions([makeQuestion('999999')], [makeQuestion('q1')])
    expect(result).toEqual({ ok: false, reason: '题库编号已满，无法追加导入' })
  })

  it('恰好通过：现有最大 999998 + 1 题 → 新 id 999999', () => {
    const result = mergeAppendQuestions([makeQuestion('999998')], [makeQuestion('q1')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((q) => q.id)).toEqual(['999998', '999999'])
  })
})

describe('mergeAppendQuestions 边界输入', () => {
  it('incoming 空数组：ok:true 且 data 与 existing 等价（新数组）', () => {
    const existing = [makeQuestion('000001'), makeQuestion('000002')]
    const result = mergeAppendQuestions(existing, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual(existing)
    expect(result.data).not.toBe(existing)
  })

  it('脏 id（非数字）跳过：不参与顺延也不与新 id 撞号', () => {
    const existing = [makeQuestion('000003'), makeQuestion('abc')]
    const result = mergeAppendQuestions(existing, [makeQuestion('q1')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((q) => q.id)).toEqual(['000003', 'abc', '000004'])
  })

  it('全部为脏 id：无可解析 id，从 000001 起', () => {
    const result = mergeAppendQuestions([makeQuestion('abc'), makeQuestion('xyz')], [makeQuestion('q1')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((q) => q.id)).toEqual(['abc', 'xyz', '000001'])
  })
})
