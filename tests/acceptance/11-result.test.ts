/**
 * AC6-1 ~ AC6-10 结算页（Spec §4 REQ-6）
 * Given 会话按 §3.2 QuizSession 契约构造；结算行为经真实组件挂载触发（挂载时 settleQuiz）。
 * 动画为展示层（§4 测试环境声明），断言以最终文本与 DOM class 为准。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import type { Question, QuizAnswer, QuizSession, StarEntry } from '../../src/types/index'

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

function answersFor(n: number, correctCount: number): QuizAnswer[] {
  return Array.from({ length: n }, (_, i) => ({
    questionId: `q${i + 1}`,
    selectedIndex: i < correctCount ? 2 : 0,
    correct: i < correctCount,
  }))
}

function makeSession(partial: Partial<QuizSession> = {}): QuizSession {
  return {
    quizId: 'quiz-uuid-001',
    status: 'in_progress',
    questions: uniformQuestions(10),
    currentIndex: 0,
    answers: [],
    correctCount: 0,
    createdAt: 1,
    ...partial,
  }
}

function readSess(): QuizSession {
  return JSON.parse(localStorage.getItem(KEY) as string)
}

function readStars(): StarEntry[] {
  return JSON.parse(localStorage.getItem(STARS_KEY) as string)
}

function seedBase(stars: StarEntry[]): void {
  localStorage.setItem(STARS_KEY, JSON.stringify(stars))
  localStorage.setItem(REWARDS_KEY, JSON.stringify(DEFAULT_REWARDS))
  localStorage.setItem(LAST_KEY, JSON.stringify(''))
  localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
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

/** 得星数字 0 → N 滚动动画为展示层（Spec §4：断言以最终文本为准），轮询等待收敛到目标值 */
async function expectEarn(w: VueWrapper, expected: string): Promise<void> {
  await vi.waitFor(() => expect(w.find('.earn-number').text()).toBe(expected), { timeout: 3000, interval: 50 })
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('AC6 结算页（10 条）', () => {
  it('AC6-1 满分文案 + 得星主视觉 + 满分星光雨（#153：金星下落一次性庆祝，原零彩纸防回潮改写）', async () => {
    const sess = makeSession({ status: 'settled', quizId: 'q1', score: 10, earnedStars: 13, settledAt: 1 })
    seedBase([
      { id: 's1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星', quizId: 'q1' },
      { id: 's2', timestamp: 2, type: 'earn', amount: 3, source: '满分奖励', quizId: 'q1' },
    ])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    expect(wrapper.text()).toContain('满分通关！太棒了')
    expect(wrapper.text()).toContain('得分 10 / 10')
    // 星光雨形态：覆盖层存在 + 星形 10 颗（8–14 量级）
    const rain = wrapper.find('.star-rain')
    expect(rain.exists()).toBe(true)
    expect(rain.findAll('svg')).toHaveLength(10)
    await expectEarn(wrapper, '+13')
    expect(wrapper.text()).toContain('颗星')
    // 一次性约 3s 自清：星光雨层到点移除
    await vi.waitFor(() => expect(wrapper.find('.star-rain').exists()).toBe(false), { timeout: 4500 })
  })

  it('AC6-2 7–9 分文案：good 档（#153 非满分档零庆祝动效：无星光雨）', async () => {
    const sess = makeSession({ status: 'settled', quizId: 'q1', score: 8, earnedStars: 8, settledAt: 1 })
    seedBase([{ id: 's1', timestamp: 1, type: 'earn', amount: 8, source: '答题得星', quizId: 'q1' }])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    expect(wrapper.text()).toContain('答对了这么多，真厉害')
    expect(wrapper.find('.star-rain').exists()).toBe(false)
  })

  it('AC6-3 1–6 分文案：practice 档（#153 非满分档零庆祝动效：无星光雨）', async () => {
    const sess = makeSession({ status: 'settled', quizId: 'q1', score: 3, earnedStars: 3, settledAt: 1 })
    seedBase([{ id: 's1', timestamp: 1, type: 'earn', amount: 3, source: '答题得星', quizId: 'q1' }])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    expect(wrapper.text()).toContain('差一点点就满分了，再来一次')
    expect(wrapper.find('.star-rain').exists()).toBe(false)
  })

  it('AC6-4 0 分文案：没关系，下次再来 + "+0"', async () => {
    const sess = makeSession({ status: 'settled', quizId: 'q1', score: 0, earnedStars: 0, settledAt: 1 })
    seedBase([])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    expect(wrapper.text()).toContain('没关系，下次再来')
    await expectEarn(wrapper, '+0')
  })

  it('AC6-5 得星主视觉 + 大星星 svg', async () => {
    const sess = makeSession({ status: 'settled', quizId: 'q1', score: 10, earnedStars: 13, settledAt: 1 })
    seedBase([
      { id: 's1', timestamp: 1, type: 'earn', amount: 10, source: '答题得星', quizId: 'q1' },
      { id: 's2', timestamp: 2, type: 'earn', amount: 3, source: '满分奖励', quizId: 'q1' },
    ])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    await expectEarn(wrapper, '+13')
    const big = wrapper.find('.big-star')
    expect(big.exists()).toBe(true)
    expect(big.find('svg').exists() || big.element.tagName.toLowerCase() === 'svg').toBe(true)
  })

  it('AC6-6 仅回到首页出口：唯一按钮 + 点击清会话回首页', async () => {
    const sess = makeSession({ status: 'settled', quizId: 'q1', score: 7, earnedStars: 7, settledAt: 1 })
    seedBase([{ id: 's1', timestamp: 1, type: 'earn', amount: 7, source: '答题得星', quizId: 'q1' }])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].text()).toBe('回到首页')
    expect(wrapper.text()).not.toContain('再做一次')
    await buttons[0].trigger('click')
    await settle()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('AC6-7 满分两条流水：答题得星 10 + 满分奖励 3', async () => {
    const sess = makeSession({
      status: 'pending',
      quizId: 'q1',
      score: 10,
      earnedStars: 13,
      correctCount: 10,
      currentIndex: 10,
      answers: answersFor(10, 10),
    })
    seedBase([])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    const stars = readStars()
    expect(stars).toHaveLength(2)
    expect(stars[0]).toMatchObject({ type: 'earn', amount: 10, source: '答题得星', quizId: 'q1' })
    expect(stars[1]).toMatchObject({ type: 'earn', amount: 3, source: '满分奖励', quizId: 'q1' })
    expect(readSess().status).toBe('settled')
  })

  it('AC6-8 刷新幂等：重新挂载展示一致，不重复入账', async () => {
    const sess = makeSession({ status: 'settled', quizId: 'q1', score: 7, earnedStars: 7, settledAt: 1 })
    seedBase([{ id: 's1', timestamp: 1, type: 'earn', amount: 7, source: '答题得星', quizId: 'q1' }])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/result')
    const texts = ['得分 7 / 10', '答对了这么多，真厉害']
    for (const t of texts) expect(wrapper.text()).toContain(t)
    await expectEarn(wrapper, '+7')

    wrapper.unmount()
    wrapper = await mountApp()
    await go('#/result')
    for (const t of texts) expect(wrapper.text()).toContain(t)
    await expectEarn(wrapper, '+7')
    expect(readStars()).toHaveLength(1)
  })

  it('AC6-9 题池不足满分折算：5/5 满分文案 + "+8" + 两条流水', async () => {
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
    const sess = makeSession({
      questions: uniformQuestions(5),
      currentIndex: 4,
      answers: answersFor(4, 4),
      correctCount: 4,
    })
    seedBase([])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await wrapper.findAll('.star-option')[2].trigger('click')
    await settle()
    const nextBtn = wrapper.find('.star-button--primary.next-btn')
    expect(nextBtn.text()).toBe('查看结果')
    await nextBtn.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/result'))
    await settle()
    expect(wrapper.text()).toContain('满分通关！太棒了')
    await expectEarn(wrapper, '+8')
    const stars = readStars()
    expect(stars).toHaveLength(2)
    expect(stars[0]).toMatchObject({ type: 'earn', amount: 5, source: '答题得星' })
    expect(stars[1]).toMatchObject({ type: 'earn', amount: 3, source: '满分奖励' })
  })

  it('AC6-10 题池不足折算非满分档：6/8 折算 8 分 → good 档 + "+6" + 单条流水', async () => {
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
    const sess = makeSession({
      questions: uniformQuestions(8),
      currentIndex: 7,
      answers: answersFor(7, 5),
      correctCount: 5,
    })
    seedBase([])
    localStorage.setItem(KEY, JSON.stringify(sess))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await wrapper.findAll('.star-option')[2].trigger('click')
    await settle()
    await wrapper.find('.star-button--primary.next-btn').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/result'))
    await settle()
    expect(wrapper.text()).toContain('答对了这么多，真厉害')
    await expectEarn(wrapper, '+6')
    const stars = readStars()
    expect(stars).toHaveLength(1)
    expect(stars[0]).toMatchObject({ type: 'earn', amount: 6, source: '答题得星' })
  })
})
