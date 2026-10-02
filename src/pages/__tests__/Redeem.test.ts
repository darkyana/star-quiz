/**
 * T9 兑换页单测（Spec §4 REQ-7，AC7-1 ~ AC7-6、AC7-8、AC7-9；AC7-7 逻辑层兜底已由 useStars 单测覆盖）
 * 数据层直写 localStorage（F5）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { RewardItem, StarEntry } from '../../types'
import Redeem from '../Redeem.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import '../../composables/useStarData'
import '../../composables/useLearningData'

function seedStars(entries: StarEntry[]): void {
  localStorage.setItem('sq_stars', JSON.stringify(entries))
}

function stars(): StarEntry[] {
  return JSON.parse(localStorage.getItem('sq_stars') as string) as StarEntry[]
}

async function mountRedeem() {
  const wrapper = mount(Redeem, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  router.replace('/redeem')
})

describe('AC7-1 列表渲染', () => {
  it('每项可见名称、价格、星形币与"兑换"按钮（#202 奖品行 = StarRewardItem 组件契约）；菠萝油 5', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const items = wrapper.findAll('.star-reward-item')
    expect(items).toHaveLength(3)
    const pineapple = items.find((el) => el.text().includes('菠萝油'))
    expect(pineapple).toBeTruthy()
    // #146 星形币承担视觉（#202 价签星 = StarGlyph sm 归组件）；#299 起各兑换项显示自己的 emoji（🥐）
    expect(pineapple!.find('.star-reward-price .star-glyph--sm').exists()).toBe(true)
    expect(pineapple!.get('.star-reward-emoji').text()).toBe('🥐')
    expect(pineapple!.text()).toContain('5')
    expect(pineapple!.text()).toContain('兑换')
  })
})

describe('AC7-2 / AC7-3 二次确认弹窗', () => {
  it('AC7-2 点兑换 → 弹窗文案"用 5 颗星兑换「菠萝油」？兑换后剩余 5 颗" + 两按钮', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const pineappleBtn = wrapper
      .findAll('.star-reward-item')
      .find((el) => el.text().includes('菠萝油'))!
      .get('.star-reward-redeem')
    await pineappleBtn.trigger('click')
    await flushPromises()
    const modal = wrapper.get('[role="dialog"]')
    expect(modal.text()).toContain('用 5 颗星兑换「菠萝油」？兑换后剩余 5 颗')
    expect(modal.text()).toContain('取消')
    expect(modal.text()).toContain('确认')
  })

  it('AC7-3 取消：弹窗关闭、不扣星、余额不变', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const before = stars().length
    await wrapper.findAll('.star-reward-item')[0].get('.star-reward-redeem').trigger('click')
    await flushPromises()
    await wrapper.get('[role="dialog"] .star-button--standard').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(stars()).toHaveLength(before)
    expect(wrapper.get('.balance-chip').text()).toContain('10')
  })
})

describe('AC7-4 / AC7-5 确认兑换', () => {
  it('AC7-4 确认：写 redeem 流水 + toast + 余额更新为 5', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const before = stars().length
    await wrapper.findAll('.star-reward-item')[0].get('.star-reward-redeem').trigger('click')
    await flushPromises()
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await flushPromises()
    expect(stars()).toHaveLength(before + 1)
    const added = stars()[stars().length - 1]
    expect(added).toMatchObject({ type: 'redeem', amount: 5, source: '兑换：菠萝油' })
    // R-72-1（#73）→ #106：toast 告知宝物已放进「星星宝藏箱」
    expect(wrapper.get('.toast').text()).toContain('兑换成功！宝物已放进星星宝藏箱')
    expect(wrapper.get('.balance-chip').text()).toContain('5')
  })

  it('AC7-5 余额恰好等于价格：兑换成功，余额显示 0', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 5, source: '答题得星' }])
    const wrapper = await mountRedeem()
    await wrapper.findAll('.star-reward-item')[0].get('.star-reward-redeem').trigger('click')
    await flushPromises()
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await flushPromises()
    expect(stars()[stars().length - 1]).toMatchObject({ type: 'redeem', amount: 5 })
    expect(wrapper.get('.balance-chip').text()).toContain('0')
  })
})

describe('AC7-6 余额不足置灰 + 还差 X 颗', () => {
  it('余额 3、寿喜锅 25：.is-locked + 兑换按钮 disabled + "还差 22 颗"（#202 锁态 = 组件契约）', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 3, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const sukiyaki = wrapper.findAll('.star-reward-item').find((el) => el.text().includes('寿喜锅'))!
    expect(sukiyaki.classes()).toContain('is-locked')
    expect((sukiyaki.get('.star-reward-redeem').element as HTMLButtonElement).disabled).toBe(true)
    expect(sukiyaki.text()).toContain('还差 22 颗')
  })
})

describe('AC7-8 空态引导', () => {
  it('sq_rewards 为空：无 .star-reward-item + 空态文案', async () => {
    localStorage.setItem('sq_rewards', JSON.stringify([]))
    const wrapper = await mountRedeem()
    expect(wrapper.findAll('.star-reward-item')).toHaveLength(0)
    expect(wrapper.get('[data-page="redeem"]').text()).toContain('还没有可兑换的奖品，快去答题攒星星吧')
  })
})

describe('AC7-9 底部入口与返回', () => {
  it('"星星记事本"入口 → /star-log；顶栏"返回" → /', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星' }])
    const wrapper = await mountRedeem()
    expect(wrapper.get('[data-page="redeem"]').text()).toContain('星星记事本')
    await wrapper.get('.ledger-link').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/star-log')
    await router.replace('/redeem')
    const wrapper2 = await mountRedeem()
    await wrapper2.get('.back-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('R-72-1（#73）/#106「星星宝藏箱」入口常驻底部链接区（三钮并列）→ /prizes', async () => {
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星' }])
    const wrapper = await mountRedeem()
    expect(wrapper.get('[data-page="redeem"]').text()).toContain('星星宝藏箱')
    expect(wrapper.findAll('.page-links .prizes-link')).toHaveLength(1)
    await wrapper.get('.prizes-link').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/prizes')
  })
})

// ===== #92 R-兑换页价格升序展示（展示层派生，sq_rewards 落盘不变）=====

describe('#92 兑换页价格升序', () => {
  /** 存储乱序、价格交错的兑换目录（含两个同价 15 项，存储序：电影乙在前） */
  const SHUFFLED: RewardItem[] = [
    { id: 'r_sukiyaki', name: '寿喜锅', price: 25, emoji: '🍲' },
    { id: 'r_movie_b', name: '电影乙', price: 15 },
    { id: 'r_candy', name: '棒棒糖', price: 8 },
    { id: 'r_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
    { id: 'r_movie_a', name: '电影甲', price: 15 },
  ]

  function seedRewards(list: RewardItem[]): void {
    localStorage.setItem('sq_rewards', JSON.stringify(list))
  }

  function cardNames(wrapper: Awaited<ReturnType<typeof mountRedeem>>): string[] {
    return wrapper.findAll('.star-reward-item').map((el) => el.get('.star-reward-name').text())
  }

  it('#92-1 列表按价格升序渲染：第一项是全场最低（菠萝油 5），最后一项是最高（寿喜锅 25）', async () => {
    seedRewards(SHUFFLED)
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 50, source: '答题得星' }])
    const wrapper = await mountRedeem()
    expect(cardNames(wrapper)).toEqual(['菠萝油', '棒棒糖', '电影乙', '电影甲', '寿喜锅'])
  })

  it('#92-2 同价兑换项保持存储顺序（稳定排序）：两个 15 沿存储序电影乙前、电影甲后', async () => {
    seedRewards([
      { id: 'r_movie_b', name: '电影乙', price: 15 },
      { id: 'r_pineapple', name: '菠萝油', price: 5 },
      { id: 'r_movie_a', name: '电影甲', price: 15 },
    ])
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 50, source: '答题得星' }])
    const wrapper = await mountRedeem()
    expect(cardNames(wrapper)).toEqual(['菠萝油', '电影乙', '电影甲'])
  })

  it('#92-3 排序仅展示层：挂载渲染后 sq_rewards 存储原文逐字节不变（内容与顺序）', async () => {
    seedRewards(SHUFFLED)
    const raw = localStorage.getItem('sq_rewards')
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 50, source: '答题得星' }])
    const wrapper = await mountRedeem()
    expect(wrapper.findAll('.star-reward-item')).toHaveLength(5)
    expect(localStorage.getItem('sq_rewards')).toBe(raw)
  })

  it('#92-4 余额不足置灰态排序后仍绑定正确的兑换项：locked 卡的「还差 X 颗」与该卡价格一一对应', async () => {
    seedRewards(SHUFFLED)
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 8, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const items = wrapper.findAll('.star-reward-item')
    expect(cardNames(wrapper)).toEqual(['菠萝油', '棒棒糖', '电影乙', '电影甲', '寿喜锅'])
    // 菠萝油 5 / 棒棒糖 8（余额恰好）：可兑，不置灰
    expect(items[0].classes()).not.toContain('is-locked')
    expect(items[1].classes()).not.toContain('is-locked')
    // 两个 15：locked + 还差 7 颗
    for (const idx of [2, 3]) {
      expect(items[idx].classes()).toContain('is-locked')
      expect(items[idx].text()).toContain('还差 7 颗')
    }
    // 寿喜锅 25：locked + 按钮 disabled + 还差 17 颗
    expect(items[4].classes()).toContain('is-locked')
    expect((items[4].get('.star-reward-redeem').element as HTMLButtonElement).disabled).toBe(true)
    expect(items[4].text()).toContain('还差 17 颗')
  })

  it('#92-5 单项列表行为不变：单条兑换项照常渲染一张卡（名称 + 价格 + 兑换按钮）', async () => {
    seedRewards([{ id: 'r_only', name: '独苗奖品', price: 7 }])
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const items = wrapper.findAll('.star-reward-item')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('独苗奖品')
    expect(items[0].text()).toContain('7')
    expect(items[0].find('.star-reward-redeem').exists()).toBe(true)
  })
})

// ===== #299 兑换页各兑换项显示自己的 emoji（无 emoji 兜底 🎁，兜底留页面）=====

describe('#299 兑换项图标', () => {
  it('各兑换项显示自己的 emoji；无 emoji 兑换项兜底 🎁（落盘不落键、仅展示兜底）', async () => {
    localStorage.setItem(
      'sq_rewards',
      JSON.stringify([
        { id: 'r_ice', name: '冰淇淋', price: 3, emoji: '🍦' },
        { id: 'r_plain', name: '神秘奖品', price: 5 },
      ] satisfies RewardItem[]),
    )
    seedStars([{ id: 'e1', timestamp: 1, type: 'earn', amount: 50, source: '答题得星' }])
    const wrapper = await mountRedeem()
    const items = wrapper.findAll('.star-reward-item')
    expect(items[0].get('.star-reward-emoji').text()).toBe('🍦')
    expect(items[1].get('.star-reward-emoji').text()).toBe('🎁')
    // 兜底仅展示层：无 emoji 项落盘原文不落键
    const stored = JSON.parse(localStorage.getItem('sq_rewards') as string) as RewardItem[]
    expect('emoji' in stored[1]).toBe(false)
  })
})
