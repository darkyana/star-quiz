// #234 归属单点判定（ADR 0014 来源即身份）：内置题集序号（9 号段 9xxxxx）→ 惊喜题库，
// 其余 → 学科题库；type 从不参与身份。家长导入的 trivia 形式题照归学科题库。
import { describe, expect, it } from 'vitest'
import { bankOf, isBuiltinTriviaId } from '../questionBank'

describe('#234 bankOf 来源即身份（9 号段 → 惊喜题库）', () => {
  it('9 号段序号（900000~999999 的 6 位补零串）归惊喜题库', () => {
    expect(bankOf('900000')).toBe('trivia')
    expect(bankOf('900001')).toBe('trivia')
    expect(bankOf('999999')).toBe('trivia')
  })

  it('学科段（含首号 0 补零、普通 6 位、前导 9 的非 6 位串）归学科题库', () => {
    expect(bankOf('000001')).toBe('subject')
    expect(bankOf('000009')).toBe('subject')
    expect(bankOf('123456')).toBe('subject')
    expect(bankOf('899999')).toBe('subject')
    // 非 6 位形状（契约外脏 id）保守按学科兜底，不冒认惊喜
    expect(bankOf('9')).toBe('subject')
    expect(bankOf('9000010')).toBe('subject')
    expect(bankOf('9abcde')).toBe('subject')
  })

  it('isBuiltinTriviaId 与 bankOf 同判定（导入拒收等场景的谓词形式）', () => {
    expect(isBuiltinTriviaId('900002')).toBe(true)
    expect(isBuiltinTriviaId('000002')).toBe(false)
    expect(isBuiltinTriviaId('90000')).toBe(false)
  })
})
