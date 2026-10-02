/**
 * 进行中兑换域单测（#73 R-72-1 建档 / #74 使用）：经模块公开接口
 * （list / create / complete）+ 存储模拟断言，
 * 沿 useStarData 单测先例（原始 localStorage 读写预置/断言，不测内部私有）。
 * abandon（放弃）已随 #293 删除路径裁撤移除，对应用例不再保留。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ActiveRedemption, RewardItem } from '../../types'
import { list, create, complete } from '../useActiveRedemptions'
import { init } from '../useDataInfra'

const KEY = 'sq_active_redemptions'

/** 存储模拟：读回 sq_active_redemptions 原始落盘内容 */
function stored(): ActiveRedemption[] {
  return JSON.parse(localStorage.getItem(KEY) as string) as ActiveRedemption[]
}

const pineapple: RewardItem = { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' }

beforeEach(() => {
  localStorage.clear()
})

describe('list 券记录读取', () => {
  it('老用户零迁移：新 key 初始为空数组（既有键一字不动）', () => {
    const starsBefore = localStorage.getItem('sq_stars')
    const rewardsBefore = localStorage.getItem('sq_rewards')
    expect(list()).toEqual([])
    expect(stored()).toEqual([])
    expect(localStorage.getItem('sq_stars')).toBe(starsBefore)
    expect(localStorage.getItem('sq_rewards')).toBe(rewardsBefore)
  })

  it('init 初始化后仍为空数组（新 key 纳入注册初始值，不触发数据版本迁移）', () => {
    init()
    expect(list()).toEqual([])
    expect(stored()).toEqual([])
  })

  it('返回 sq_active_redemptions 全量（多条共存，不限数量）', () => {
    const seeded: ActiveRedemption[] = [
      { id: 'r1', rewardId: 'reward_a', name: '10分钟电视', emoji: '📺', createdAt: 1_000 },
      { id: 'r2', rewardId: 'reward_b', name: '冰淇淋', emoji: '🍦', createdAt: 2_000 },
    ]
    localStorage.setItem(KEY, JSON.stringify(seeded))
    expect(list()).toEqual(seeded)
  })
})

describe('create 建档快照（供 redeem 调用）', () => {
  it('写入快照记录：id 非空 + rewardId + name/emoji 快照 + createdAt 时间戳', () => {
    const record = create(pineapple)
    expect(record.rewardId).toBe('reward_pineapple')
    expect(record.name).toBe('菠萝油')
    expect(record.emoji).toBe('🥐')
    expect(record.id).toBeTruthy()
    expect(typeof record.createdAt).toBe('number')
    expect(stored()).toEqual([record])
  })

  it('emoji 缺省的兑换项兜底快照 🎁（同兑换页展示兜底）', () => {
    const noEmoji: RewardItem = { id: 'reward_plain', name: '神秘奖品', price: 3 }
    expect(create(noEmoji).emoji).toBe('🎁')
  })

  it('追加不覆写：既有券记录保留，新券追加在尾部', () => {
    const existing: ActiveRedemption[] = [
      { id: 'r1', rewardId: 'reward_a', name: '10分钟电视', emoji: '📺', createdAt: 1_000 },
    ]
    localStorage.setItem(KEY, JSON.stringify(existing))
    const record = create(pineapple)
    expect(stored()).toEqual([...existing, record])
  })
})

const seededThree: ActiveRedemption[] = [
  { id: 'r1', rewardId: 'reward_a', name: '10分钟电视', emoji: '📺', createdAt: 1_000 },
  { id: 'r2', rewardId: 'reward_b', name: '冰淇淋', emoji: '🍦', createdAt: 2_000 },
  { id: 'r3', rewardId: 'reward_c', name: '菠萝油', emoji: '🥐', createdAt: 3_000 },
]

describe('complete 核销（#74 R-72-2）', () => {
  it('按 id 删除对应券记录，其余记录原样保留（顺序不变）', () => {
    localStorage.setItem(KEY, JSON.stringify(seededThree))
    complete('r2')
    expect(stored()).toEqual([seededThree[0], seededThree[2]])
    expect(list()).toHaveLength(2)
  })

  it('无效 id 零写入：存储原文逐字不动（无任何 setItem 调用）', () => {
    localStorage.setItem(KEY, JSON.stringify(seededThree))
    const raw = localStorage.getItem(KEY)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    complete('no-such-id')
    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
    expect(localStorage.getItem(KEY)).toBe(raw)
  })

  it('核销后星星账本零变动：sq_stars 原文逐字不动', () => {
    const starsRaw = JSON.stringify([
      { id: 'e1', timestamp: 1_000, type: 'earn', amount: 10, source: '答题得星', quizId: 'q1' },
      { id: 'd1', timestamp: 2_000, type: 'redeem', amount: 5, source: '兑换：冰淇淋' },
    ])
    localStorage.setItem('sq_stars', starsRaw)
    localStorage.setItem(KEY, JSON.stringify(seededThree))
    complete('r1')
    expect(localStorage.getItem('sq_stars')).toBe(starsRaw)
  })
})
