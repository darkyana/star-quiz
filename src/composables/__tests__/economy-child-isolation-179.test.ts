import { beforeEach, describe, expect, it } from 'vitest'
import * as stars from '../useStarData'
import * as vouchers from '../useActiveRedemptions'
import * as board from '../useProposals'
import type { StarEntry } from '../../types'

beforeEach(() => localStorage.clear())

describe('#179 默认孩子经济业务隔离', () => {
  it.each(['publish', 'delete'] as const)('默认孩子提议经协商到 %s，其他孩子同 id 行全程保留', (ending) => {
    const own = board.create({ name: '自己的宝藏', price: 5, description: '' })
    const sibling = { ...own, childId: 'sibling', name: '兄弟的宝藏' }
    board.writeProposals([sibling, own])
    expect(board.setAgreed(own.id, 'child', true)).toBe(true)
    expect(board.proposals()[0].childStatus).toBe('agreed')
    expect(board.proposals('sibling')).toEqual([sibling])
    if (ending === 'publish') {
      expect(board.publish(own.id)).toEqual({ ok: true })
      expect(board.proposals()[0].status).toBe('published')
      expect(stars.rewards().at(-1)?.name).toBe('自己的宝藏')
    } else {
      expect(board.voidProposal(own.id)).toBe(true)
      expect(board.proposals()[0].status).toBe('voided')
      expect(board.proposals('sibling')).toEqual([sibling])
      expect(board.deleteProposal(own.id)).toBe(true)
      expect(board.proposals()).toEqual([])
    }
    expect(board.proposals('sibling')).toEqual([sibling])
  })
  it('新建与修订提议定位默认孩子同 id，不覆盖其他孩子内容或列表', () => {
    const own = board.create({ name: '自己的宝藏', price: 5, description: '说明' })
    const sibling = { ...own, childId: 'sibling', name: '兄弟的宝藏' }
    board.writeProposals([sibling, own])
    expect(board.update(own.id, { name: '修订', price: 6, description: '新说明' })).toBe(true)
    expect(board.proposals()).toEqual([expect.objectContaining({ name: '修订', childId: 'default' })])
    expect(board.proposals('sibling')).toEqual([sibling])
    board.create({ name: '新的宝藏', price: 7, description: '' })
    expect(board.allProposals()).toHaveLength(3)
    expect(board.allProposals()[0]).toEqual(sibling)
  })
  // #293 删除路径裁撤后仅剩 complete（使用）一条删除动作，孩子隔离口径不变
  it('complete 只移除默认孩子同 id 券，其他孩子独占 id 不能操作', () => {
    const sibling = { id: 'same', childId: 'sibling', rewardId: 'r', name: '宝藏', emoji: '🎁', createdAt: 1 }
    const siblingOnly = { ...sibling, id: 'only' }
    const legacy = { id: 'legacy', rewardId: 'r', name: '旧券', emoji: '🎁', createdAt: 1 }
    vouchers.writeRecords([sibling, { ...sibling, childId: 'default' }, siblingOnly, legacy])
    vouchers.complete('same')
    vouchers.complete('only')
    expect(vouchers.list()).toEqual([legacy])
    expect(vouchers.list('sibling')).toEqual([sibling, siblingOnly])
    vouchers.complete('legacy')
    expect(vouchers.allRecords()).toEqual([sibling, siblingOnly])
  })
  it('奖励与兑换只花默认孩子余额，追加不丢其他孩子流水和券', () => {
    const sibling: StarEntry = { id: 's', childId: 'sibling', kind: 'game', timestamp: 1, type: 'earn', amount: 100, source: '奖励' }
    stars.writeLedger([sibling, { ...sibling, id: 'd', childId: 'default', amount: 3 }])
    const siblingVoucher = { id: 'v', childId: 'sibling', rewardId: 'r', name: '宝藏', emoji: '🎁', createdAt: 1 }
    vouchers.writeRecords([siblingVoucher])
    stars.writeRewards([{ id: 'r', name: '宝藏', price: 5 }])
    expect(stars.redeem('r')).toEqual({ ok: false, reason: 'insufficient_balance' })
    expect(stars.grant({ amount: 2, reason: '努力' })).toBe(true)
    expect(stars.allLedger()[0]).toEqual(sibling)
    expect(stars.redeem('r')).toEqual({ ok: true })
    expect(stars.balance()).toBe(0) // 默认孩子 game 星仍沿原有求和规则。
    expect(stars.allLedger()[0]).toEqual(sibling)
    expect(stars.allLedger()).toHaveLength(4)
    expect(vouchers.list()).toHaveLength(1)
    expect(vouchers.list()[0].childId).toBe('default')
    expect(vouchers.list('sibling')).toEqual([siblingVoucher])
    expect(vouchers.allRecords()).toHaveLength(2)
  })
  it('其他孩子同轮入账不阻止默认孩子得星，余额不借用其他孩子且全量流水保留', () => {
    const sibling: StarEntry = { id: 'same', childId: 'sibling', kind: 'interest', timestamp: 1, type: 'earn', amount: 100, source: '答题得星', quizId: 'quiz' }
    const legacy: StarEntry = { id: 'legacy', timestamp: 1, type: 'earn', amount: 2, source: '旧流水' }
    stars.writeLedger([sibling, legacy])
    expect(stars.hasEarned('quiz')).toBe(false)
    expect(stars.computeBalance([sibling, legacy])).toBe(2)
    expect(stars.hasQuizEarned([sibling], 'quiz')).toBe(false)
    stars.earn({ quizId: 'quiz', correctCount: 2, totalCount: 3 })
    stars.earn({ quizId: 'quiz', correctCount: 2, totalCount: 3 })
    expect(stars.balance()).toBe(4)
    expect(stars.ledger()).toHaveLength(2)
    expect(stars.ledger('sibling')).toEqual([sibling])
    expect(stars.allLedger()).toHaveLength(3)
    expect(stars.allLedger()[0]).toEqual(sibling)
  })
})
