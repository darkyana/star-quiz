/**
 * #69 旗子规则模块单测：toggleFlag 写 { flaggedAt, childId } / 删键返回 false（#173 起条目挂孩子维度）、isFlagged 键存在性。
 * 写入形状的单一来源在 useFlag（Quiz.vue 不再直写）；存储落盘经 useLearningData 读写对。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isFlagged, toggleFlag } from '../useFlag'
import { flagged as readFlagged } from '../useLearningData'

beforeEach(() => {
  localStorage.clear()
})

describe('isFlagged：键存在性（#69）', () => {
  it('键存在 → true；键不存在 → false（「是否标记」= 键存在与否）', () => {
    localStorage.setItem('sq_flagged', JSON.stringify({ q1: { flaggedAt: 1000 } }))
    expect(isFlagged('q1')).toBe(true)
    expect(isFlagged('q2')).toBe(false)
  })

  it('空映射 → 一律 false', () => {
    localStorage.setItem('sq_flagged', JSON.stringify({}))
    expect(isFlagged('q1')).toBe(false)
  })
})

describe('toggleFlag：切换写删（#69）', () => {
  it('未标 → 写 { flaggedAt: Date.now() } 并返回 true', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234)
    expect(toggleFlag('q1')).toBe(true)
    expect(readFlagged()).toEqual({ q1: { flaggedAt: 1_234, childId: 'default' } })
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({ q1: { flaggedAt: 1_234, childId: 'default' } })
    vi.restoreAllMocks()
  })

  it('已标 → 删该键返回 false，不影响其他键', () => {
    localStorage.setItem('sq_flagged', JSON.stringify({ q1: { flaggedAt: 1000 }, q2: { flaggedAt: 2000 } }))
    expect(toggleFlag('q1')).toBe(false)
    expect(readFlagged()).toEqual({ q2: { flaggedAt: 2000 } })
  })

  it('重复标记覆盖：取消后再标 → 只记最近一次 flaggedAt', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    toggleFlag('q1')
    expect(toggleFlag('q1')).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue(9_000)
    expect(toggleFlag('q1')).toBe(true)
    expect(readFlagged()).toEqual({ q1: { flaggedAt: 9_000, childId: 'default' } })
    vi.restoreAllMocks()
  })

  it('切换往返后 isFlagged 与存储一致', () => {
    expect(isFlagged('q1')).toBe(false)
    toggleFlag('q1')
    expect(isFlagged('q1')).toBe(true)
    toggleFlag('q1')
    expect(isFlagged('q1')).toBe(false)
    expect(readFlagged()).toEqual({})
  })
})
