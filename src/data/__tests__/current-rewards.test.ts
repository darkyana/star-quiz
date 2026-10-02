/**
 * T3 兑换项外置文件单测（Spec §4 REQ-5，AC5-1 / AC5-5 / AC5-6）
 * currentRewards 与 Spec AC5-1 逐字段一致；初始值所有方（T4-T2 起为 useStarData）不再内联 DEFAULT_REWARDS（防双份默认值漂移）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { RewardItem } from '../../types'
import { currentRewards } from '../current-rewards'

describe('AC5-1 currentRewards 内容（Spec §3.4 逐字段）', () => {
  it('长度为 3 且逐项深等于 Spec 值', () => {
    expect(currentRewards).toHaveLength(3)
    expect(currentRewards).toEqual([
      { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
      { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
      { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' },
    ])
  })
})

describe('AC5-5 数据模型复用', () => {
  it('currentRewards 类型为 RewardItem[]（类型断言）', () => {
    const rewards: RewardItem[] = currentRewards
    expect(rewards).toHaveLength(3)
    expect(rewards[0].id).toBe('reward_pineapple')
  })
})

describe('AC5-6 默认兑换项不内联（源码文本断言，防双份默认值漂移；T4-T2 起初始值所有方为 useStarData）', () => {
  const srcDataDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  it('useStarData.ts 不含 DEFAULT_REWARDS 常量定义，且 sq_rewards 初始值引用 currentRewards', () => {
    const starData = readFileSync(resolve(srcDataDir, '../composables/useStarData.ts'), 'utf-8')
    expect(starData).not.toMatch(/const DEFAULT_REWARDS/)
    expect(starData).toMatch(/currentRewards/)
  })
})
