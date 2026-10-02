/**
 * #77 超能力奖励 grant 单测（REQ-77-4-3）：合法落账（earn 流水 +「特别奖励：」source 前缀同源 copy +
 * 余额实时累计）、非法拦截（星数 0/100/负数/非整数、空原因）零写入。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { init as initAppState } from '../useDataInfra'
import '../useProposals'
import {
  grant,
  ledger as readLedger,
  writeLedger,
  balance,
} from '../useStarData'
import { copy } from '../../copy'

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

describe('#77 grant 合法落账（AC5）', () => {
  it('合法提交：向 sq_stars 末尾追加一条 earn——amount / source=「特别奖励：{原因}」（copy 同源）、id 与 timestamp 为 number、余额累计', () => {
    writeLedger([{ id: 's1', timestamp: 1724140800000, type: 'earn', amount: 2, source: copy.stars.quizSource }])
    const before = Date.now()

    expect(grant({ amount: 5, reason: '主动练琴半小时' })).toBe(true)

    const entries = readLedger()
    expect(entries).toHaveLength(2)
    expect(entries[0].id).toBe('s1') // 既有条目不动，末尾追加
    const granted = entries[1]
    expect(granted).toMatchObject({
      type: 'earn',
      amount: 5,
      source: copy.superPower.rewardSource('主动练琴半小时'),
    })
    expect(granted.source).toBe('特别奖励：主动练琴半小时') // D5 定稿前缀
    expect(granted.quizId).toBeUndefined() // 非答题得星
    expect(typeof granted.id).toBe('string')
    expect(typeof granted.timestamp).toBe('number')
    expect(granted.timestamp).toBeGreaterThanOrEqual(before)
    expect(balance()).toBe(7) // 余额实时求和累计（C2）
  })

  it('边界值 1 与 99 均合法', () => {
    expect(grant({ amount: 1, reason: '帮做家务' })).toBe(true)
    expect(grant({ amount: 99, reason: '期末进步大' })).toBe(true)
    expect(readLedger()).toHaveLength(2)
  })

  it('reason 前后空白 trim 后落账', () => {
    expect(grant({ amount: 3, reason: '  主动看书  ' })).toBe(true)
    expect(readLedger()[0].source).toBe('特别奖励：主动看书')
  })
})

describe('#77 grant 非法拦截（AC5：零写入）', () => {
  it.each([0, 100, -1, 1.5, Number.NaN])('星数 %s → false 且 sq_stars 零写入', (amount) => {
    expect(grant({ amount, reason: '原因' })).toBe(false)
    expect(readLedger()).toEqual([])
    expect(localStorage.getItem('sq_stars')).toBe('[]')
  })

  it.each(['', '   '])('原因 %j → false 且 sq_stars 零写入', (reason) => {
    expect(grant({ amount: 5, reason })).toBe(false)
    expect(readLedger()).toEqual([])
  })
})
