/**
 * 星星宝藏箱页单测（#295 奖品聚合格子；前身 #73 R-72-1 列表 / #74 R-72-2 核销与放弃）：
 * 聚合展示（同名 N 张 = 1 卡、×N 角标、×1 无角标）/ 日期语义（组内剩余最近一条，人性化相对措辞）/
 * 排序（最近兑换在前）/ 先进先出消耗 / 减到零整格消失 / 无删除路径 / 空态 / 顶栏导航。
 * 数据层直写 localStorage（F5，沿 Redeem / useStarData 测试先例）。
 * CSS 动画不在单测范围（动效归 #297 核验）；行为（数量减一 / 卡消失）在本层覆盖。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { ActiveRedemption, RewardItem } from '../../types'
import Prizes from '../Prizes.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeRewards, balance as getBalance } from '../../composables/useStarData'
import { copy } from '../../copy'

/** 存储模拟：直写 sq_active_redemptions 预置奖品记录 */
function seedRedemptions(records: ActiveRedemption[]): void {
  localStorage.setItem('sq_active_redemptions', JSON.stringify(records))
}

/** N 个日历日前正午（本地时间）：相对日期断言按日历日算，正午锚点避开夏令时偏移 */
function daysAgo(n: number): number {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.getTime()
}

/** 聚合清空动效 0.32s 后才真正删记录（与视觉消失对齐）；等待动效收尾再断言最终态。
 *  400ms = 动效时长 320ms（Prizes.vue PRIZE_LEAVE_MS / CSS --duration-prize-fx）+ 计时裕量 */
async function waitForLeaveAnimation(): Promise<void> {
  await new Promise((r) => setTimeout(r, 400))
}

async function mountPrizes() {
  const wrapper = mount(Prizes, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  router.replace('/prizes')
})

describe('聚合格卡渲染（#295）', () => {
  it('data-page=prizes + 标题「星星宝藏箱」+ 格卡显示 emoji、快照名称、人性化日期', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_pineapple', name: '菠萝油', emoji: '🥐', createdAt: daysAgo(0) },
    ])
    const wrapper = await mountPrizes()
    expect(wrapper.find('[data-page="prizes"]').exists()).toBe(true)
    expect(wrapper.get('.page-title').text()).toBe('星星宝藏箱')
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('🥐')
    expect(cards[0].text()).toContain('菠萝油')
    expect(cards[0].text()).toContain('今天获得')
    expect(wrapper.find('.star-empty-state').exists()).toBe(false)
  })

  it('同名奖品聚为一格：三张「10分钟电视」= 1 张格卡，角标 ×3', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(3) },
      { id: 'r2', rewardId: 'reward_tv_v2', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(2) },
      { id: 'r3', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(1) },
    ])
    const wrapper = await mountPrizes()
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].find('.prize-badge').exists()).toBe(true)
    expect(cards[0].get('.prize-badge').text()).toBe('×3')
  })

  it('同名奖品即使来自不同时期发布的兑换项（rewardId 不同）也聚在同一格', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv_old', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(1) },
      { id: 'r2', rewardId: 'reward_tv_new', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(0) },
    ])
    const wrapper = await mountPrizes()
    expect(wrapper.findAll('.prize-card')).toHaveLength(1)
    expect(wrapper.get('.prize-badge').text()).toBe('×2')
  })

  it('×1 不渲染数量角标；不同名奖品各占一格', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(1) },
      { id: 'r2', rewardId: 'reward_ice', name: '冰淇淋', emoji: '🍦', createdAt: daysAgo(0) },
    ])
    const wrapper = await mountPrizes()
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card.find('.prize-badge').exists()).toBe(false)
    }
  })

  it('格卡日期 = 组内剩余记录中 createdAt 最大一条（人性化相对措辞按日历日）', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(5) },
      { id: 'r2', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(2) },
    ])
    const wrapper = await mountPrizes()
    expect(wrapper.get('.prize-date').text()).toBe('2天前获得')
  })

  it('最近兑换的聚合排在最前（按组内最大 createdAt 降序）', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(4) },
      { id: 'r2', rewardId: 'reward_ice', name: '冰淇淋', emoji: '🍦', createdAt: daysAgo(0) },
      { id: 'r3', rewardId: 'reward_pineapple', name: '菠萝油', emoji: '🥐', createdAt: daysAgo(2) },
    ])
    const wrapper = await mountPrizes()
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(3)
    expect(cards[0].text()).toContain('冰淇淋')
    expect(cards[1].text()).toContain('菠萝油')
    expect(cards[2].text()).toContain('10分钟电视')
  })

  it('快照解耦：兑换项事后改名或删除，已持有格卡展示不变', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_pineapple', name: '菠萝油', emoji: '🥐', createdAt: daysAgo(0) },
    ])
    const renamed: RewardItem[] = [{ id: 'reward_tv', name: '10分钟电视', price: 3 }]
    writeRewards(renamed)
    const wrapper = await mountPrizes()
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('菠萝油')
    expect(cards[0].text()).toContain('🥐')
    expect(cards[0].text()).toContain('今天获得')
  })
})

describe('空态引导', () => {
  it('无奖品：空态文案 + 引导，不渲染格卡（空态块走 StarEmptyState 组件契约，#196）', async () => {
    const wrapper = await mountPrizes()
    expect(wrapper.findAll('.prize-card')).toHaveLength(0)
    expect(wrapper.get('.star-empty-state').text()).toContain('宝藏箱还空着，去兑换一件宝物吧')
  })
})

describe('顶栏导航', () => {
  it('「返回」→ /redeem（入口所在页，沿 StarLog 返回惯例）', async () => {
    const wrapper = await mountPrizes()
    await wrapper.get('.back-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/redeem')
  })
})

// ===== 「用一个」（#74 原核销 → #295 聚合语义）=====

/** 预置星星流水（余额 5：+10 earn / −5 redeem）；用一个全程必须原文不动 */
const STARS_RAW = JSON.stringify([
  { id: 'e1', timestamp: 1_000, type: 'earn', amount: 10, source: '答题得星', quizId: 'q1' },
  { id: 'd1', timestamp: 2_000, type: 'redeem', amount: 5, source: '兑换：菠萝油' },
])

function seedStars(): void {
  localStorage.setItem('sq_stars', STARS_RAW)
}

/** 断言星星余额与流水前后完全不变（不产生任何新流水） */
function expectStarsUntouched(): void {
  expect(localStorage.getItem('sq_stars')).toBe(STARS_RAW)
  expect(getBalance()).toBe(5)
}

describe('「用一个」按钮（#295）', () => {
  it('每张聚合格卡有且只有一个「用一个」按钮；无「不要了」/「放弃」按钮（删除路径已移除）', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(1) },
      { id: 'r2', rewardId: 'reward_ice', name: '冰淇淋', emoji: '🍦', createdAt: daysAgo(0) },
    ])
    const wrapper = await mountPrizes()
    const cards = wrapper.findAll('.prize-card')
    for (const card of cards) {
      expect(card.findAll('button')).toHaveLength(1)
      expect(card.get('.btn-useup').text()).toBe('用一个')
    }
    const allText = wrapper.text()
    expect(allText).not.toContain('不要了')
    expect(allText).not.toContain('放弃')
  })
})

describe('用一个：二次确认（#294 二轮拍板口语版）', () => {
  it('点「用一个」→ 弹窗文案带奖品名与剩余数量（N−1），取消/确认两按钮', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(2) },
      { id: 'r2', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(1) },
    ])
    const wrapper = await mountPrizes()
    await wrapper.get('.btn-useup').trigger('click')
    const modal = wrapper.get('[role="dialog"]')
    expect(modal.text()).toContain(copy.prizes.useUpConfirm('10分钟电视', 1))
    expect(modal.text()).toContain('要用一个「10分钟电视」吗？用掉就少一个咯（还剩 1 个）')
    expect(modal.find('.star-button--standard').exists()).toBe(true)
    expect(modal.find('.star-button--primary').exists()).toBe(true)
  })

  it('取消：弹窗关闭、记录保留、格子不变、无 toast', async () => {
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(1) },
      { id: 'r2', rewardId: 'reward_ice', name: '冰淇淋', emoji: '🍦', createdAt: daysAgo(0) },
    ])
    const wrapper = await mountPrizes()
    await wrapper.get('.btn-useup').trigger('click')
    await wrapper.get('[role="dialog"] .star-button--standard').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.findAll('.prize-card')).toHaveLength(2)
    expect(wrapper.find('.toast').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem('sq_active_redemptions') as string)).toHaveLength(2)
  })
})

describe('确认用一个：先进先出消耗（#295）', () => {
  it('组内多张：消耗 createdAt 最早一张、角标 ×3→×2、格卡日期更新为剩余最近一条；星星不变', async () => {
    seedStars()
    seedRedemptions([
      { id: 'r-old', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(5) },
      { id: 'r-mid', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(4) },
      { id: 'r-new', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(2) },
    ])
    const wrapper = await mountPrizes()
    await wrapper.get('.btn-useup').trigger('click')
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')

    // 先进先出：最早一张（r-old）被消耗，其余保留
    const stored = JSON.parse(localStorage.getItem('sq_active_redemptions') as string) as ActiveRedemption[]
    expect(stored.map((r) => r.id).sort()).toEqual(['r-mid', 'r-new'])
    // 格卡仍在、角标减一、日期 = 剩余最近一条（2 天前）
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(1)
    expect(wrapper.get('.prize-badge').text()).toBe('×2')
    expect(wrapper.get('.prize-date').text()).toBe('2天前获得')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('.toast').text()).toContain(copy.prizes.useUpToast('10分钟电视'))
    expectStarsUntouched()
  })

  it('减到零：整格消失（缩小淡出后移除）、其余格保留、列表回空态导向；星星不变', async () => {
    seedStars()
    seedRedemptions([
      { id: 'r1', rewardId: 'reward_tv', name: '10分钟电视', emoji: '📺', createdAt: daysAgo(1) },
      { id: 'r2', rewardId: 'reward_ice', name: '冰淇淋', emoji: '🍦', createdAt: daysAgo(0) },
    ])
    const wrapper = await mountPrizes()
    const tvCard = wrapper.findAll('.prize-card').find((el) => el.text().includes('10分钟电视'))!
    await tvCard.get('.btn-useup').trigger('click')
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')

    // 电视格进入离场动效（记录暂未删，与视觉消失对齐）
    expect(tvCard.classes()).toContain('prize-card--leave')
    await waitForLeaveAnimation()
    await flushPromises()

    // 动效收尾后：记录删除、电视格消失、冰淇淋格保留
    const stored = JSON.parse(localStorage.getItem('sq_active_redemptions') as string) as ActiveRedemption[]
    expect(stored.map((r) => r.id)).toEqual(['r2'])
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('冰淇淋')
    expect(wrapper.get('.toast').text()).toContain('用掉一个「10分钟电视」！')
    expectStarsUntouched()

    // 再用掉最后一张冰淇淋：宝藏箱回空态
    await cards[0].get('.btn-useup').trigger('click')
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await waitForLeaveAnimation()
    await flushPromises()
    expect(wrapper.findAll('.prize-card')).toHaveLength(0)
    expect(wrapper.get('.star-empty-state').text()).toContain('宝藏箱还空着，去兑换一件宝物吧')
  })
})
