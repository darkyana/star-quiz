/**
 * R3 AC5-1 ~ AC5-6 兑换项外置文件驱动（Spec §4 REQ-5 / §6 D5）
 * currentRewards 与既有内联 DEFAULT_REWARDS 逐字段一致；首次启动写入默认值、
 * 升级（键已存在）不覆盖、损坏恢复（E1）不回归；useAppState 不再内联默认兑换项（防双份漂移）。
 */
import { describe, it, expect, vi, expectTypeOf, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RewardItem } from '../../src/types/index'
import { currentRewards } from '../../src/data/current-rewards'
import { init as initAppState } from '../../src/composables/useDataInfra'
import { rewards as readRewards } from '../../src/composables/useStarData'
import '../../src/composables/useLearningData'

const REWARDS_KEY = 'sq_rewards'

/** §2 REQ-5 钉死的三项默认值（Spec 原文，逐字段） */
const EXPECTED: RewardItem[] = [
  { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
  { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
  { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' },
]

beforeEach(() => {
  localStorage.clear()
})

describe('AC5-1 currentRewards 内容', () => {
  it('长度 3 且逐项深等于 Spec 默认值（含 emoji）', () => {
    expect(currentRewards).toHaveLength(3)
    expect(currentRewards).toEqual(EXPECTED)
  })
})

describe('AC5-2 ~ AC5-4 initAppState 行为', () => {
  it('AC5-2 首次启动（sq_rewards 键不存在）→ 写入 currentRewards', () => {
    expect(localStorage.getItem(REWARDS_KEY)).toBeNull()
    initAppState()
    expect(readRewards()).toEqual(currentRewards)
  })

  it('AC5-3 升级场景（v0.2.0 已存在自定义值）→ 不覆盖', () => {
    const custom: RewardItem[] = [{ id: 'r1', name: '自定义奖励', price: 9 }]
    localStorage.setItem(REWARDS_KEY, JSON.stringify(custom))
    initAppState()
    expect(readRewards()).toEqual(custom)
  })

  it('AC5-4 损坏恢复不回归（E1）：JSON 解析失败 → 重置为 currentRewards + console.warn 含键名', () => {
    localStorage.setItem(REWARDS_KEY, '{bad json')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      initAppState()
      expect(readRewards()).toEqual(currentRewards)
      const warns = warnSpy.mock.calls.map((c) => String(c[0]))
      expect(warns.some((m) => m.includes('sq_rewards'))).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('AC5-5 数据模型复用（RewardItem 字段契约不变，tsc 级断言）', () => {
  it('RewardItem 字段契约锁定且 currentRewards 类型为 RewardItem[]', () => {
    expectTypeOf<RewardItem['id']>().toEqualTypeOf<string>()
    expectTypeOf<RewardItem['name']>().toEqualTypeOf<string>()
    expectTypeOf<RewardItem['price']>().toEqualTypeOf<number>()
    expectTypeOf<RewardItem['emoji']>().toEqualTypeOf<string | undefined>()
    const typed: RewardItem[] = currentRewards // 编译期赋值断言
    expect(typed).toEqual(EXPECTED)
  })
})

describe('AC5-6 默认兑换项不内联（源码文本断言；T4-T2 起初始值所有方为 useStarData）', () => {
  it('useStarData.ts 不含 DEFAULT_REWARDS 常量定义，且 sq_rewards 初始值引用 currentRewards', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/composables/useStarData.ts'), 'utf-8')
    expect(src).not.toContain('DEFAULT_REWARDS')
    expect(src).toContain('currentRewards')
    // 防误写：初始值来源必须指向外置文件而非内联字面量数组
    expect(src).toMatch(/import\s*\{[^}]*currentRewards[^}]*\}\s*from\s*['"]\.\.\/data\/current-rewards['"]/)
  })
})
