/**
 * AC4-1 ~ AC4-7 首页功能化（Spec §4 REQ-4）
 * Given-When-Then 全部来自 Spec §4；元素标识见 §3.5（.balance-chip / 页脚 .config-link）。
 * C3Re1 起首页无星星按钮（手势删除，家长入口 = 页脚「配置」链接）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import { writeDeviceCredential } from '../../src/composables/useDeviceCredential'
import { markParentGuideNotificationRead } from '../../src/composables/useParentGuideReadLedger'
import { parentGuideNotifications } from '../../src/data/parent-guide-notifications'
import type { Question, StarEntry } from '../../src/types/index'

const Q_KEY = 'sq_questions'
const STARS_KEY = 'sq_stars'
const REWARDS_KEY = 'sq_rewards'
const LAST_KEY = 'sq_last_export'

const DEFAULT_REWARDS = [
  { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
  { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
  { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' },
]

function uniformQuestions(n: number): Question[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    type: 'zh2en' as const,
    prompt: `题目${i + 1}`,
    options: ['a', 'b', 'c', 'd'] as [string, string, string, string],
    answerIndex: 2,
    wordId: `w${i + 1}`,
  }))
}

function seed(overrides: { questions?: Question[]; stars?: StarEntry[] } = {}): void {
  localStorage.clear()
  localStorage.setItem(Q_KEY, JSON.stringify(overrides.questions ?? uniformQuestions(10)))
  localStorage.setItem(STARS_KEY, JSON.stringify(overrides.stars ?? []))
  localStorage.setItem(REWARDS_KEY, JSON.stringify(DEFAULT_REWARDS))
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

let wrapper: VueWrapper | undefined

beforeEach(() => {
  seed()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('AC4 首页功能化（7 条）', () => {
  it('AC4-1 余额 0 展示：.balance-chip 数字为 "0"', async () => {
    seed({ stars: [] })
    wrapper = await mountApp()
    const chip = wrapper.find('.balance-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('0')
  })

  it('AC4-2 余额非 0 展示：数字为 "5"', async () => {
    seed({ stars: [{ id: 's1', timestamp: 1, type: 'earn', amount: 5, source: '答题得星' }] })
    wrapper = await mountApp()
    expect(wrapper.find('.balance-chip').text()).toContain('5')
  })

  it('AC4-3 出题方式分段切换器与双按钮同时可见（#152 G3 三分段直显；tagline 引导语文案移除）', async () => {
    wrapper = await mountApp()
    const text = wrapper.text()
    expect(text).not.toContain('今天来攒几颗星？')
    expect(text).toContain('出题方式')
    // 三分段直显（探针分段文案），默认普通段选中
    expect(text).toContain('普通')
    expect(text).toContain('新题优先')
    expect(text).toContain('错题优先')
    const pills = wrapper.findAll('.star-mode-entry__pill')
    expect(pills).toHaveLength(3)
    expect(pills[0].attributes('aria-checked')).toBe('true')
    expect(text).toContain('开始答题')
    expect(text).toContain('兑换星星')
  })

  it('AC4-4 开始答题：跳转 #/quiz?start=1 且创建会话', async () => {
    wrapper = await mountApp()
    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('开始答题'))
    expect(startBtn).toBeDefined()
    await startBtn!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/quiz'))
    expect(router.currentRoute.value.query.start).toBe('1')
    const sess = JSON.parse(localStorage.getItem('sq_session') as string)
    expect(sess.status).toBe('in_progress')
  })

  it('AC4-5 题池空：开始答题 disabled + 提示文案', async () => {
    seed({ questions: [] })
    wrapper = await mountApp()
    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('开始答题'))
    expect(startBtn).toBeDefined()
    expect(startBtn!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('还没有题目哦，等爸爸妈妈加好题目就可以开始了')
  })

  it('AC4-6 兑换星星：跳转 #/redeem', async () => {
    wrapper = await mountApp()
    const redeemBtn = wrapper.findAll('button').find((b) => b.text().includes('兑换星星'))
    expect(redeemBtn).toBeDefined()
    await redeemBtn!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/redeem'))
  })

  it('AC4-7 / #308 配置链接与家长说明入口并存；不恢复星星手势按钮', async () => {
    wrapper = await mountApp()
    // 版本号 + 配置链接（产品负责人 2026-08-21：Safari PWA 手势被系统占用，加显式入口）
    const footer = wrapper.get('.app-footer')
    expect(footer.text()).toContain('V0.14.0')
    const configLinks = wrapper.findAll('a[href="#/parent"]')
    expect(configLinks.length).toBe(1)
    expect(configLinks[0].text()).toBe('配置')
    // #308 deliberately introduces an informational parent sticker, not a settings menu.
    // #322 通知角标（修订 #316「所有设备可见」口径）：该断言成立前提 = 存在未读家长通知（默认已读账为空 → 全未读）；
    // 未读清零 / 孩子设备的等价断言见下方 #322 describe（口径修订留痕，勿删）。
    expect(wrapper.findAll('button, a').filter(el => el.text().includes('家长')).map(el => el.text())).toEqual(['家长请看'])
    for (const el of wrapper.findAll('[aria-label], [class]')) {
      const label = el.attributes('aria-label') ?? ''
      const cls = el.attributes('class') ?? ''
      expect(`${label} ${cls}`).not.toMatch(/设置|齿轮|菜单/)
    }
    // C3Re1：首页不再有星星按钮（手势删除，家长入口 = footer 配置链接）
    expect(wrapper.find('button[aria-label="星星"]').exists()).toBe(false)
  })

  it('AC4-7 点击页脚「配置」链接 → #/parent（Safari 手势被系统占用时的显式入口）', async () => {
    wrapper = await mountApp()
    const configLink = wrapper.get('.app-footer a[href="#/parent"]')
    await configLink.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/parent'))
  })
})

// #322 家长请看 = 通知角标验收（修订 #316「入口对所有设备可见」口径，spec #319 故事 39）：
// 孩子设备（已入队）不显示这枚贴纸是设计决定而非回归 bug，勿修回 #316。
describe('#322 通知角标：未读驱动显隐 + 孩子设备不显示', () => {
  it('有未读 → 贴纸在；未读清零（全部知道了，写 parent-guide:<id> 已读账）→ 贴纸从首页消失', async () => {
    wrapper = await mountApp()
    expect(wrapper.find('.parent-sticker').exists()).toBe(true)
    for (const notification of parentGuideNotifications) markParentGuideNotificationRead(notification.id)
    await flushPromises()
    expect(wrapper.find('.parent-sticker').exists()).toBe(false)
  })

  it('孩子设备（child + 已入队 joined）首页无贴纸；待批准设备照常显示', async () => {
    initAppState()
    writeDeviceCredential({ device_id: 'd-child', secret: 's', role: 'child', name: '孩子平板' }, 'active')
    wrapper = await mountApp()
    expect(wrapper.find('.parent-sticker').exists()).toBe(false)
    wrapper?.unmount()
    wrapper = undefined
    // 待批准（pending → unjoined）child 设备照常显示（与今天一致）
    localStorage.clear()
    seed()
    initAppState()
    writeDeviceCredential({ device_id: 'd-wait', secret: 's', role: 'child', name: '孩子平板' }, 'pending')
    wrapper = await mountApp()
    expect(wrapper.find('.parent-sticker').exists()).toBe(true)
  })

  it('首页无未读数、红点或数字角标（有未读时也只有整枚贴纸）', async () => {
    wrapper = await mountApp()
    const sticker = wrapper.get('.parent-sticker')
    expect(sticker.text()).toBe('家长请看')
    expect(wrapper.find('.parent-sticker .badge, .parent-sticker .dot, .parent-sticker [data-count]').exists()).toBe(false)
    expect(sticker.text()).not.toMatch(/\d/)
  })
})
