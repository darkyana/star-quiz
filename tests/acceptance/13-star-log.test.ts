/**
 * AC8-1 / AC8-2 / AC8-7 星星记事本 + AC3-9 完整闭环端到端（Spec §4 REQ-8 / REQ-3）
 * AC3-9 用例 1（§12.2）：答题 → 结算 → 兑换 → 记事本，流水与余额一致性全链路验收。
 * 文案断言用 §0.1 白名单精确串（"−{N}" 负号用 U+2212）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import type { Question, QuizSession, StarEntry } from '../../src/types/index'

const KEY = 'sq_session'
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

function readStars(): StarEntry[] {
  return JSON.parse(localStorage.getItem(STARS_KEY) as string)
}

function seed(stars: StarEntry[], pool = uniformQuestions(10)): void {
  localStorage.clear()
  localStorage.setItem(Q_KEY, JSON.stringify(pool))
  localStorage.setItem(STARS_KEY, JSON.stringify(stars))
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
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('AC8 星星记事本', () => {
  it('AC8-1 倒序展示：timestamp 降序（首行最新）', async () => {
    seed([
      { id: 's1', timestamp: 100, type: 'earn', amount: 1, source: '来源甲' },
      { id: 's2', timestamp: 200, type: 'earn', amount: 1, source: '来源乙' },
      { id: 's3', timestamp: 300, type: 'earn', amount: 1, source: '来源丙' },
    ])
    wrapper = await mountApp()
    await go('#/star-log')
    const rows = wrapper.findAll('.ledger-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('来源丙')
    expect(rows[1].text()).toContain('来源乙')
    expect(rows[2].text()).toContain('来源甲')
  })

  it('AC8-2 获得 / 兑换标识：+5 与 −2（U+2212）及来源文本', async () => {
    seed([
      { id: 's1', timestamp: Date.now() - 1_000, type: 'earn', amount: 5, source: '答题得星' },
      { id: 's2', timestamp: Date.now(), type: 'redeem', amount: 2, source: '兑换：菠萝油' },
    ])
    wrapper = await mountApp()
    await go('#/star-log')
    const text = wrapper.text()
    expect(text).toContain('+5')
    expect(text).toContain('−2')
    expect(text).toContain('答题得星')
    expect(text).toContain('兑换：菠萝油')
  })

  it('AC8-7 空状态与顶栏 chip：空流水提示 + 0；有流水显示 5', async () => {
    seed([])
    wrapper = await mountApp()
    await go('#/star-log')
    expect(wrapper.text()).toContain('还没有记录，快去答题攒星星吧')
    expect(wrapper.find('.balance-chip').text()).toContain('0')

    wrapper.unmount()
    seed([{ id: 's1', timestamp: 1, type: 'earn', amount: 5, source: '答题得星' }])
    wrapper = await mountApp()
    await go('#/star-log')
    expect(wrapper.find('.balance-chip').text()).toContain('5')
  })
})

describe('AC3-9 完整闭环端到端', () => {
  it('答题(7对3错) → 结算 → 兑换菠萝油(5) → 记事本流水一致，首页余额 2', async () => {
    seed([])
    wrapper = await mountApp()
    await go('#/')

    // 1) 首页点"开始答题"
    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('开始答题'))
    expect(startBtn).toBeDefined()
    await startBtn!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/quiz'))

    // 2) 答 10 题：7 对 3 错（正确项以会话内乱序后 answerIndex 为准）
    for (let i = 0; i < 10; i++) {
      const sess = JSON.parse(localStorage.getItem(KEY) as string) as QuizSession
      const ai = sess.questions[sess.currentIndex].answerIndex
      const target = i < 7 ? ai : (ai + 1) % 4
      await wrapper.findAll('.star-option')[target].trigger('click')
      await settle()
      await wrapper.find('.star-button--primary.next-btn').trigger('click')
      await settle()
    }

    // 3) 结算页：入账 1 条（答题得星 7）
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/result'))
    let stars = readStars()
    expect(stars).toHaveLength(1)
    expect(stars[0]).toMatchObject({ type: 'earn', amount: 7, source: '答题得星' })
    expect(stars[0].quizId).toBeTruthy()

    // 4) 回到首页 → 余额 7
    await wrapper.findAll('button').find((b) => b.text().includes('回到首页'))!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    expect(wrapper.find('.balance-chip').text()).toContain('7')

    // 5) 兑换星星 → 兑换页 → 菠萝油（5 星）确认
    await wrapper.findAll('button').find((b) => b.text().includes('兑换星星'))!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/redeem'))
    const pine = wrapper.findAll('.star-reward-item').find((it) => it.text().includes('菠萝油'))
    expect(pine).toBeDefined()
    await pine!.find('.star-reward-redeem').trigger('click')
    await settle()
    await wrapper.findAll('button').find((b) => b.text().trim() === '确认')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('兑换成功！宝物已放进星星宝藏箱')

    // 6) 星星记事本 → 首行为 redeem 行（倒序最新在前）
    const leaf = [...wrapper.element.querySelectorAll('*')].find(
      (el) => (el.textContent ?? '').trim() === '星星记事本',
    )
    expect(leaf).toBeDefined()
    leaf!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/star-log'))
    const rows = wrapper.findAll('.ledger-row')
    expect(rows[0].text()).toContain('−5')
    expect(rows[0].text()).toContain('兑换：菠萝油')

    // 7) 最终流水断言：2 条，顺序 earn → redeem
    stars = readStars()
    expect(stars).toHaveLength(2)
    expect(stars[0]).toMatchObject({ type: 'earn', amount: 7, source: '答题得星' })
    expect(stars[0].quizId).toBeTruthy()
    expect(stars[1]).toMatchObject({ type: 'redeem', amount: 5, source: '兑换：菠萝油' })

    // 8) 首页余额 = 7 − 5 = 2
    await go('#/')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    expect(wrapper.find('.balance-chip').text()).toContain('2')
  })
})
