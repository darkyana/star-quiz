/**
 * AC7-1 ~ AC7-9 兑换页（Spec §4 REQ-7）
 * Given 兑换项按 R1 契约 3 项（菠萝油 5 / 看 10 分钟电视 15 / 去吃寿喜锅 25）。
 * AC7-7 逻辑层兜底按 AC 原文不经 UI 直接调用 redeemReward（spec 指定函数名）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import type { ProposalRecord, RewardItem, StarEntry } from '../../src/types/index'
import { redeemReward } from '../../src/composables/useStarData'
import { publish } from '../../src/composables/useProposals'

const STARS_KEY = 'sq_stars'
const REWARDS_KEY = 'sq_rewards'
const Q_KEY = 'sq_questions'
const LAST_KEY = 'sq_last_export'

const DEFAULT_REWARDS = [
  { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
  { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
  { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' },
]

function earn(amount: number): StarEntry {
  return { id: `e${Math.random()}`, timestamp: 1, type: 'earn', amount, source: '答题得星' }
}

function readStars(): StarEntry[] {
  return JSON.parse(localStorage.getItem(STARS_KEY) as string)
}

function seed(stars: StarEntry[], rewards = DEFAULT_REWARDS): void {
  localStorage.clear()
  localStorage.setItem(STARS_KEY, JSON.stringify(stars))
  localStorage.setItem(REWARDS_KEY, JSON.stringify(rewards))
  localStorage.setItem(Q_KEY, JSON.stringify([]))
  localStorage.setItem(LAST_KEY, JSON.stringify(''))
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
}

async function mountApp(): Promise<VueWrapper> {
  window.location.hash = '#/'
  await settle()
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return wrapper
}

async function go(hash: string): Promise<void> {
  window.location.hash = hash
  await settle()
}

function chipText(w: VueWrapper): string {
  return w.find('.balance-chip').text()
}

function findCard(w: VueWrapper, name: string): VueWrapper {
  const card = w.findAll('.star-reward-item').find((it) => it.text().includes(name))
  expect(card).toBeDefined()
  return card!
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('AC7 兑换页（9 条）', () => {
  it('AC7-1 列表渲染：3 项均含名称 / 价格 / 星形币 / 兑换按钮（#146 图标方块移除，emoji 不再渲染）', async () => {
    seed([earn(10)])
    wrapper = await mountApp()
    await go('#/redeem')
    const items = wrapper.findAll('.star-reward-item')
    expect(items).toHaveLength(3)
    for (const r of DEFAULT_REWARDS) {
      const card = findCard(wrapper, r.name)
      expect(card.text(), `${r.name} 名称可见`).toContain(r.name)
      expect(card.text()).toContain(String(r.price))
      // #146 星形币承担视觉：价格行含 coin-star 平星 SVG；emoji 图标不再渲染
      expect(card.find('.star-reward-price .star-glyph--sm').exists()).toBe(true)
      expect(card.find('.reward-emoji').exists()).toBe(false)
      expect(card.find('.star-reward-redeem').exists()).toBe(true)
    }
    const pine = findCard(wrapper, '菠萝油')
    expect(pine.text()).toContain('5')
  })

  it('AC7-2 二次确认文案：用 5 颗星兑换「菠萝油」？兑换后剩余 5 颗', async () => {
    seed([earn(10)])
    wrapper = await mountApp()
    await go('#/redeem')
    await findCard(wrapper, '菠萝油').find('.star-reward-redeem').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('用 5 颗星兑换「菠萝油」？兑换后剩余 5 颗')
    const buttons = wrapper.findAll('button')
    expect(buttons.some((b) => b.text().trim() === '取消')).toBe(true)
    expect(buttons.some((b) => b.text().trim() === '确认')).toBe(true)
  })

  it('AC7-3 取消不扣星：弹窗关闭、流水不变、余额不变', async () => {
    seed([earn(10)])
    wrapper = await mountApp()
    await go('#/redeem')
    const beforeLen = readStars().length
    await findCard(wrapper, '菠萝油').find('.star-reward-redeem').trigger('click')
    await settle()
    await wrapper.findAll('button').find((b) => b.text().trim() === '取消')!.trigger('click')
    await settle()
    expect(wrapper.text()).not.toContain('兑换后剩余')
    expect(readStars()).toHaveLength(beforeLen)
    expect(chipText(wrapper)).toContain('10')
  })

  it('AC7-4 确认扣星写流水 + 成功提示 + 余额更新', async () => {
    seed([earn(10)])
    wrapper = await mountApp()
    await go('#/redeem')
    const beforeLen = readStars().length
    await findCard(wrapper, '菠萝油').find('.star-reward-redeem').trigger('click')
    await settle()
    await wrapper.findAll('button').find((b) => b.text().trim() === '确认')!.trigger('click')
    await settle()
    const stars = readStars()
    expect(stars).toHaveLength(beforeLen + 1)
    expect(stars[stars.length - 1]).toMatchObject({ type: 'redeem', amount: 5, source: '兑换：菠萝油' })
    expect(wrapper.text()).toContain('兑换成功！宝物已放进星星宝藏箱')
    expect(chipText(wrapper)).toContain('5')
  })

  it('AC7-5 余额恰好等于价格：兑换后余额 0', async () => {
    seed([earn(5)])
    wrapper = await mountApp()
    await go('#/redeem')
    await findCard(wrapper, '菠萝油').find('.star-reward-redeem').trigger('click')
    await settle()
    await wrapper.findAll('button').find((b) => b.text().trim() === '确认')!.trigger('click')
    await settle()
    expect(readStars()[readStars().length - 1]).toMatchObject({ type: 'redeem', amount: 5, source: '兑换：菠萝油' })
    expect(chipText(wrapper)).toContain('0')
  })

  it('AC7-6 余额不足置灰 + 还差 X 颗', async () => {
    seed([earn(3)])
    wrapper = await mountApp()
    await go('#/redeem')
    const card = findCard(wrapper, '寿喜锅')
    expect(card.classes()).toContain('is-locked')
    const btn = card.find('.star-reward-redeem')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(card.text()).toContain('还差 22 颗')
  })

  it('AC7-7 逻辑层兜底（C3）：余额 3 兑换 25 直调被拒、流水不变', () => {
    const entries = [earn(3)]
    const before = JSON.parse(JSON.stringify(entries))
    const reward = { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' }
    const got = redeemReward(entries, reward)
    expect(got.ok).toBe(false)
    expect((got as { ok: false; entries: StarEntry[] }).entries).toEqual(before)
  })

  it('AC7-8 空态引导：无兑换项时显示授权文案', async () => {
    seed([earn(10)], [])
    wrapper = await mountApp()
    await go('#/redeem')
    expect(wrapper.findAll('.star-reward-item')).toHaveLength(0)
    expect(wrapper.text()).toContain('还没有可兑换的奖品，快去答题攒星星吧')
  })

  it('AC7-9 底部入口 + 顶栏返回', async () => {
    seed([earn(10)])
    wrapper = await mountApp()
    await go('#/redeem')
    expect(wrapper.text()).toContain('星星记事本')
    const leaf = [...wrapper.element.querySelectorAll('*')].find(
      (el) => (el.textContent ?? '').trim() === '星星记事本',
    )
    expect(leaf).toBeDefined()
    leaf!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/star-log'))

    // 记事本顶栏返回 → /redeem
    await wrapper.findAll('button').find((b) => b.text().trim() === '返回')!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/redeem'))
    // 兑换页顶栏返回 → /
    const back = wrapper.findAll('button').find((b) => b.text().trim() === '返回')
    expect(back).toBeDefined()
    await back!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
  })
})

// ===== #92 R-兑换页价格升序（发布后落位 + 存储不变量）=====

describe('#92 兑换页价格升序（发布后落位）', () => {
  it('AC-92-3 窗口内发布价 10 的新提议 → 进入兑换页：新项落在菠萝油 5 与电视 15 之间；sq_rewards 落盘仍为末尾追加顺序（逐字节原样）', async () => {
    seed([earn(10)])
    const proposal: ProposalRecord = {
      id: 'p_new',
      name: '新发布奖品',
      price: 10,
      status: 'agreed',
      createdAt: 1,
      updatedAt: 1,
      description: '',
      parentStatus: 'agreed',
      childStatus: 'agreed',
      initiator: 'parent',
      lastActionBy: 'parent',
      lastActionKind: 'proposed',
    }
    localStorage.setItem('sq_proposals', JSON.stringify([proposal]))
    // 窗口内时刻注入（本地 20:30），发布链路真实走 publish
    expect(publish('p_new', { now: new Date(2026, 7, 30, 20, 30, 0) })).toEqual({ ok: true })
    // 落盘仍是末尾追加（存储顺序不变量）
    const storedRaw = localStorage.getItem(REWARDS_KEY) as string
    const stored = JSON.parse(storedRaw) as RewardItem[]
    expect(stored.map((r) => r.name)).toEqual(['菠萝油', '看 10 分钟电视', '去吃寿喜锅', '新发布奖品'])

    wrapper = await mountApp()
    await go('#/redeem')
    const names = wrapper.findAll('.star-reward-item').map((el) => el.get('.star-reward-name').text())
    expect(names).toEqual(['菠萝油', '新发布奖品', '看 10 分钟电视', '去吃寿喜锅'])
    // 渲染归渲染：存储原文逐字节不变
    expect(localStorage.getItem(REWARDS_KEY)).toBe(storedRaw)
  })
})
