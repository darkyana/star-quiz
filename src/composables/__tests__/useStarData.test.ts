/**
 * T4 星星域单测（Spec 20260826-073 T2，REQ-T4-1 / REQ-T4-6 记账行为基线）：
 * 经 useStarData 公开接口 + 存储模拟断言。用例自 useStars.test.ts 迁移（断言保留，
 * 纯函数接口 → 模块公开接口），并扩展：落盘断言、兑换目录标识符校验、快照还原往返。
 * append-only（C1）/ 余额实时求和（C2）/ 逻辑层兜底（C3）/ 来源快照（C4）语义不变。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { StarEntry, RewardItem, ActiveRedemption } from '../../types'
import { earn, redeem, balance, ledger, hasEarned, writeRewards, writeLedger, rewards } from '../useStarData'
import { init } from '../useDataInfra'
import { currentRewards } from '../../data/current-rewards'
import { copy } from '../../copy'

function entry(partial: Partial<StarEntry> & { type: 'earn' | 'redeem'; amount: number }): StarEntry {
  return { id: `id_${Math.random()}`, timestamp: 1_000_000, source: '来源', ...partial }
}

/** 存储模拟：直接落盘 sq_stars，绕过模块接口预置状态 */
function seedStars(entries: StarEntry[]): void {
  localStorage.setItem('sq_stars', JSON.stringify(entries))
}

/** 存储模拟：读回 sq_stars 原始落盘内容 */
function storedStars(): StarEntry[] {
  return JSON.parse(localStorage.getItem('sq_stars') as string) as StarEntry[]
}

/** 存储模拟：读回 sq_active_redemptions 原始落盘内容 */
function storedRedemptions(): ActiveRedemption[] {
  return JSON.parse(localStorage.getItem('sq_active_redemptions') as string) as ActiveRedemption[]
}

const pineapple: RewardItem = { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' }

beforeEach(() => {
  localStorage.clear()
  writeRewards([pineapple])
})

describe('earn 答题入账（AC2-3 ~ AC2-5）', () => {
  it('AC2-3 答对 7 题写一条答题得星流水并落盘', () => {
    earn({ quizId: 'q1', correctCount: 7, totalCount: 10 })
    const entries = ledger()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBeTruthy()
    expect(typeof entries[0].timestamp).toBe('number')
    expect(entries[0].type).toBe('earn')
    expect(entries[0].amount).toBe(7)
    expect(entries[0].source).toBe('答题得星')
    expect(entries[0].quizId).toBe('q1')
    expect(storedStars()).toEqual(entries)
  })

  it('AC2-4 满分追加满分奖励一条（共两条）', () => {
    earn({ quizId: 'q1', correctCount: 10, totalCount: 10 })
    const entries = ledger()
    expect(entries).toHaveLength(2)
    expect(entries[1].type).toBe('earn')
    expect(entries[1].amount).toBe(3)
    expect(entries[1].source).toBe('满分奖励')
    expect(entries[1].quizId).toBe('q1')
    expect(storedStars()).toEqual(entries)
  })

  it('AC2-5 0 分不写流水，账本与存储均为空', () => {
    earn({ quizId: 'q1', correctCount: 0, totalCount: 10 })
    expect(ledger()).toEqual([])
    expect(storedStars()).toEqual([])
  })

  it('非满分但答对数>0 只写一条（correctCount < totalCount）', () => {
    earn({ quizId: 'q1', correctCount: 9, totalCount: 10 })
    const entries = ledger()
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(9)
  })

  it('append-only：既有流水不被改写，新条目追加在尾部', () => {
    const existing: StarEntry[] = [
      entry({ type: 'earn', amount: 3, quizId: 'q0' }),
      entry({ type: 'redeem', amount: 1, source: '兑换：菠萝油' }),
    ]
    seedStars(existing)
    earn({ quizId: 'q1', correctCount: 5, totalCount: 10 })
    const entries = ledger()
    expect(entries).toHaveLength(3)
    expect(entries.slice(0, 2)).toEqual(existing)
    expect(entries[2].quizId).toBe('q1')
  })
})

describe('redeem 兑换扣星（AC2-6 / AC2-7 / AC7-7）', () => {
  it('AC2-6 余额充足兑换成功：写 source 快照流水 + 余额扣减 + 落盘', () => {
    seedStars([entry({ type: 'earn', amount: 10 })])
    const result = redeem(pineapple.id)
    expect(result).toEqual({ ok: true })
    const entries = ledger()
    expect(entries).toHaveLength(2)
    const added = entries[entries.length - 1]
    expect(added.type).toBe('redeem')
    expect(added.amount).toBe(5)
    expect(added.source).toBe('兑换：菠萝油')
    expect(balance()).toBe(5)
    expect(storedStars()).toEqual(entries)
  })

  it('AC2-7 / AC7-7 余额不足逻辑层拒绝：ok=false + reason 且零写入（C3 兜底；R-72-1 两写原子性：券记录同样零写入）', () => {
    seedStars([entry({ type: 'earn', amount: 3 })])
    const before = localStorage.getItem('sq_stars')
    const beforeRedemptions = localStorage.getItem('sq_active_redemptions')
    const result = redeem(pineapple.id)
    expect(result).toEqual({ ok: false, reason: 'insufficient_balance' })
    expect(localStorage.getItem('sq_stars')).toBe(before)
    expect(balance()).toBe(3)
    expect(localStorage.getItem('sq_active_redemptions')).toBe(beforeRedemptions)
  })

  it('余额恰好等于价格可兑换', () => {
    seedStars([entry({ type: 'earn', amount: 5 })])
    expect(redeem(pineapple.id)).toEqual({ ok: true })
    expect(balance()).toBe(0)
  })

  it('兑换目录中不存在的标识符拒绝：ok=false + reason 且零写入（R-72-1 两写原子性：券记录同样零写入）', () => {
    seedStars([entry({ type: 'earn', amount: 10 })])
    const before = localStorage.getItem('sq_stars')
    const beforeRedemptions = localStorage.getItem('sq_active_redemptions')
    expect(redeem('reward_ghost')).toEqual({ ok: false, reason: 'reward_not_found' })
    expect(localStorage.getItem('sq_stars')).toBe(before)
    expect(localStorage.getItem('sq_active_redemptions')).toBe(beforeRedemptions)
  })

  it('兑换目录键缺失时按注册的默认目录（currentRewards）校验价格', () => {
    localStorage.removeItem('sq_rewards')
    seedStars([entry({ type: 'earn', amount: 7 })])
    const result = redeem('reward_pineapple')
    expect(result).toEqual({ ok: true })
    const entries = ledger()
    expect(entries[entries.length - 1].source).toBe('兑换：菠萝油')
    expect(balance()).toBe(2)
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(currentRewards)
  })
})

describe('redeem 两写原子性（#73 R-72-1：扣星流水 + 建券记录收在同一次调用内）', () => {
  it('兑换成功：流水与进行中兑换记录同时落盘（券为兑换项快照）', () => {
    seedStars([entry({ type: 'earn', amount: 10 })])
    expect(redeem(pineapple.id)).toEqual({ ok: true })
    const entries = ledger()
    expect(entries[entries.length - 1]).toMatchObject({ type: 'redeem', amount: 5, source: '兑换：菠萝油' })
    const records = storedRedemptions()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ rewardId: 'reward_pineapple', name: '菠萝油', emoji: '🥐' })
    expect(records[0].id).toBeTruthy()
    expect(typeof records[0].createdAt).toBe('number')
  })

  it('连续兑换两张券：流水两条 + 券记录两条（多张券共存，追加不覆写）', () => {
    const tv: RewardItem = { id: 'reward_tv', name: '10分钟电视', price: 3 }
    writeRewards([tv, pineapple])
    seedStars([entry({ type: 'earn', amount: 10 })])
    expect(redeem(tv.id)).toEqual({ ok: true })
    expect(redeem(pineapple.id)).toEqual({ ok: true })
    expect(storedRedemptions()).toHaveLength(2)
    expect(storedRedemptions()[1].name).toBe('菠萝油')
  })

  it('余额不足：流水与券记录两者都不写（此前键从未初始化时券键保持缺失，不产生孤儿券）', () => {
    seedStars([entry({ type: 'earn', amount: 3 })])
    expect(redeem(pineapple.id)).toEqual({ ok: false, reason: 'insufficient_balance' })
    expect(storedStars()).toHaveLength(1)
    expect(localStorage.getItem('sq_active_redemptions')).toBeNull()
  })
})

describe('balance 余额实时求和（AC2-1 / AC2-2）', () => {
  it('AC2-1 Σearn − Σredeem 实时求和', () => {
    seedStars([
      entry({ type: 'earn', amount: 5 }),
      entry({ type: 'redeem', amount: 2 }),
      entry({ type: 'earn', amount: 3 }),
    ])
    expect(balance()).toBe(6)
  })

  it('AC2-2 空流水余额 0', () => {
    expect(balance()).toBe(0)
  })

  it('入账与兑换后余额实时变化，且不持久化余额键（C2）', () => {
    earn({ quizId: 'q1', correctCount: 7, totalCount: 10 })
    expect(balance()).toBe(7)
    redeem(pineapple.id)
    expect(balance()).toBe(2)
    expect(localStorage.getItem('sq_balance')).toBeNull()
  })
})

describe('hasEarned 幂等判定（REQ-2）', () => {
  it('存在该 quizId 的 earn 流水返回 true', () => {
    seedStars([
      entry({ type: 'earn', amount: 7, quizId: 'q1' }),
      entry({ type: 'redeem', amount: 5, source: '兑换：菠萝油' }),
    ])
    expect(hasEarned('q1')).toBe(true)
  })

  it('无该 quizId 流水或仅 redeem 流水返回 false', () => {
    expect(hasEarned('q1')).toBe(false)
    seedStars([
      entry({ type: 'earn', amount: 7, quizId: 'q_other' }),
      entry({ type: 'redeem', amount: 5, quizId: 'q1' }),
    ])
    expect(hasEarned('q1')).toBe(false)
  })

  it('经 earn 入账后 hasEarned 对该轮为 true，其他轮为 false', () => {
    earn({ quizId: 'q1', correctCount: 7, totalCount: 10 })
    expect(hasEarned('q1')).toBe(true)
    expect(hasEarned('q2')).toBe(false)
  })
})

describe('ledger 流水列表', () => {
  it('返回 sq_stars 全量', () => {
    const seeded: StarEntry[] = [
      entry({ type: 'earn', amount: 7, quizId: 'q1' }),
      entry({ type: 'redeem', amount: 5, source: '兑换：菠萝油' }),
      entry({ type: 'earn', amount: 3, source: '满分奖励', quizId: 'q2' }),
    ]
    seedStars(seeded)
    expect(ledger()).toEqual(seeded)
  })

  it('键缺失时兜底空数组并落盘（星星域默认值注册随迁）', () => {
    expect(ledger()).toEqual([])
    expect(storedStars()).toEqual([])
  })
})

describe('ledger / writeLedger 快照还原往返', () => {
  it('快照后继续记账，writeLedger 恢复到快照时刻的账本与余额', () => {
    earn({ quizId: 'q1', correctCount: 7, totalCount: 10 })
    redeem(pineapple.id)
    const snap = ledger()
    const snapBalance = balance()

    earn({ quizId: 'q2', correctCount: 10, totalCount: 10 })
    expect(balance()).toBe(snapBalance + 13)

    writeLedger(snap)
    expect(ledger()).toEqual(snap)
    expect(storedStars()).toEqual(snap)
    expect(balance()).toBe(snapBalance)
  })

  it('ledger 返回账本独立副本，后续写入不影响已取快照', () => {
    earn({ quizId: 'q1', correctCount: 7, totalCount: 10 })
    const snap = ledger()
    earn({ quizId: 'q2', correctCount: 5, totalCount: 10 })
    expect(snap).toHaveLength(1)
    writeLedger(snap)
    expect(ledger()).toHaveLength(1)
  })
})

describe('StarEntry.source 与 copy.stars 一致性（AC-2.3 / AC-2.4）', () => {
  it('AC-2.3 earn 写入的 source === copy.stars 槽位值', () => {
    earn({ quizId: 'q1', correctCount: 7, totalCount: 10 })
    expect(ledger()[0].source).toBe(copy.stars.quizSource)

    earn({ quizId: 'q2', correctCount: 10, totalCount: 10 })
    expect(ledger()[2].source).toBe(copy.stars.fullMarkSource)
  })

  it('AC-2.3 redeem 写入的 source === copy.stars.redeemSource(name)', () => {
    seedStars([entry({ type: 'earn', amount: 10 })])
    redeem(pineapple.id)
    const entries = ledger()
    expect(entries[entries.length - 1].source).toBe(copy.stars.redeemSource('菠萝油'))
  })

  it('AC-2.4 copy.stars.redeemSource 为函数且返回"兑换：{name}"', () => {
    expect(typeof copy.stars.redeemSource).toBe('function')
    expect(copy.stars.redeemSource('菠萝油')).toBe('兑换：菠萝油')
  })
})

// ===== 自 useAppState.test.ts 迁移（T4 删除该文件，独有断言保留不删）=====
describe('兑换目录初始值与星星域读写回路（AC5-2 ~ AC5-4 / 读写回路）', () => {
  it('AC5-2 首次启动（sq_rewards 不存在）→ init 写入 currentRewards', () => {
    localStorage.removeItem('sq_rewards')
    expect(localStorage.getItem('sq_rewards')).toBeNull()

    init()

    expect(rewards()).toEqual(currentRewards)
  })

  it('AC5-3 升级场景（sq_rewards 已存在自定义值）→ 不被 currentRewards 覆盖', () => {
    const custom: RewardItem[] = [{ id: 'r1', name: '自定义奖励', price: 9 }]
    localStorage.setItem('sq_rewards', JSON.stringify(custom))

    init()

    expect(rewards()).toEqual(custom)
  })

  it('AC5-4 损坏恢复不回归（sq_rewards 非法 JSON）→ 重置为 currentRewards + console.warn 含键名', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      localStorage.setItem('sq_rewards', '{bad json')

      init()

      expect(rewards()).toEqual(currentRewards)
      expect(warnSpy).toHaveBeenCalled()
      expect(String(warnSpy.mock.calls[0][0])).toContain('sq_rewards')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('读函数与写函数覆盖星星域完整读写回路（stars / rewards）', () => {
    const stars: StarEntry[] = [
      { id: 's2', timestamp: 1724140800001, type: 'redeem', amount: 5, source: '兑换：菠萝油' },
    ]
    const rewardsList: RewardItem[] = [{ id: 'r1', name: '测试奖励', price: 3, emoji: '🎁' }]
    writeLedger(stars)
    writeRewards(rewardsList)
    expect(ledger()).toEqual(stars)
    expect(rewards()).toEqual(rewardsList)
    expect(storedStars()).toEqual(stars)
  })
})
