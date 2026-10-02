/**
 * T8 结算页单测（Spec §4 REQ-6，AC6-1 ~ AC6-6、AC6-8 ~ AC6-10 + 守卫 AC3-11）
 * 挂载即结算（幂等）；得星滚动动画以 rAF stub 同步推进后断言最终文本（Spec §4：断言最终状态与最终文本）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { Question, QuizSession } from '../../types'
import Result from '../Result.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import '../../composables/useStarData'
import '../../composables/useLearningData'

function makeQuestions(count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q_${i}`,
    type: 'zh2en',
    prompt: `题目${i}`,
    options: ['A', 'B', 'C', 'D'],
    answerIndex: 0,
    wordId: `w_${i}`,
  }))
}

function seedSession(partial: Partial<QuizSession>, count = 10): void {
  const session: QuizSession = {
    quizId: 'quiz_r',
    status: 'pending',
    questions: makeQuestions(count),
    currentIndex: count,
    answers: makeQuestions(count).map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })),
    correctCount: 0,
    createdAt: 1_000_000,
    ...partial,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
}

function stars(): unknown[] {
  return JSON.parse(localStorage.getItem('sq_stars') as string) ?? []
}

/** 同步推进 rAF：每次回调时间 +100ms，动画 900ms 内收敛到终值 */
function stubRaf(): void {
  let now = 0
  vi.stubGlobal(
    'requestAnimationFrame',
    ((cb: (t: number) => void): number => {
      now += 100
      cb(now)
      return now
    }) as typeof requestAnimationFrame,
  )
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  localStorage.setItem('sq_stars', JSON.stringify([]))
  router.replace('/')
  vi.unstubAllGlobals()
})

describe('AC6-1 / AC6-5 满分 + 得星主视觉', () => {
  it('满分 10/10：满分文案 + 得分角标 + 发光主视觉（#146 动效预算：彩纸移除）+ earn-number +13', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 10, correctCount: 10, earnedStars: 13, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).toContain('满分通关！太棒了')
    expect(text).toContain('得分 10 / 10')
    // #146 动效预算：满分也不再渲染彩纸
    expect(wrapper.find('.confetti').exists()).toBe(false)
    expect(wrapper.get('.earn-number').text()).toBe('+13')
    expect(text).toContain('颗星')
    expect(wrapper.find('.big-star').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('AC6-2 / AC6-3 / AC6-4 分档文案', () => {
  it('AC6-2 8 分：good 档文案，无彩纸', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 8, correctCount: 8, earnedStars: 8, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('[data-page="result"]').text()).toContain('答对了这么多，真厉害')
    expect(wrapper.find('.confetti').exists()).toBe(false)
    expect(wrapper.get('.earn-number').text()).toBe('+8')
    wrapper.unmount()
  })

  it('AC6-3 3 分：practice 档文案', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 3, correctCount: 3, earnedStars: 3, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('[data-page="result"]').text()).toContain('差一点点就满分了，再来一次')
    wrapper.unmount()
  })

  it('AC6-4 0 分：没关系，下次再来 + earn-number +0，不写流水', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 0, correctCount: 0, earnedStars: 0, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).toContain('没关系，下次再来')
    expect(wrapper.get('.earn-number').text()).toBe('+0')
    expect(stars()).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('AC6-6 仅回到首页出口', () => {
  it('仅 1 个按钮且文本"回到首页"，无"再做一次"；点击 → 清会话 + 回首页', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 8, correctCount: 8, earnedStars: 8, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].text()).toBe('回到首页')
    expect(wrapper.get('[data-page="result"]').text()).not.toContain('再做一次')
    await buttons[0].trigger('click')
    await flushPromises()
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(router.currentRoute.value.path).toBe('/')
    wrapper.unmount()
  })
})

describe('AC6-7 / AC6-8 结算入账与幂等展示', () => {
  it('挂载 settleQuiz：首次入账写流水，会话 → settled', async () => {
    stubRaf()
    seedSession({ status: 'pending', score: 7, correctCount: 7, earnedStars: 7 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const entries = stars() as { quizId: string; amount: number }[]
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(7)
    expect((JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession).status).toBe('settled')
    wrapper.unmount()
  })

  it('AC6-8 已入账刷新重进：展示一致且不重复入账', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 8, correctCount: 8, earnedStars: 8, settledAt: 2_000_000 })
    const quizId = (JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession).quizId
    localStorage.setItem(
      'sq_stars',
      JSON.stringify([{ id: 'e1', timestamp: 2_000_000, type: 'earn', amount: 8, source: '答题得星', quizId }]),
    )
    await router.replace('/result')
    const wrapper1 = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text1 = wrapper1.get('[data-page="result"]').text()
    wrapper1.unmount()
    const wrapper2 = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text2 = wrapper2.get('[data-page="result"]').text()
    expect(text2).toContain('答对了这么多，真厉害')
    expect(text2).toContain('得分 8 / 10')
    expect(text2).toContain(text1)
    expect(stars()).toHaveLength(1)
    wrapper2.unmount()
  })
})

describe('AC6-9 / AC6-10 题池不足折算分档', () => {
  it('AC6-9 5/5 全对：满分文案 + earn-number +8 + 两条流水', async () => {
    stubRaf()
    seedSession({ status: 'pending', score: 5, correctCount: 5, earnedStars: 8 }, 5)
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('[data-page="result"]').text()).toContain('满分通关！太棒了')
    expect(wrapper.get('.earn-number').text()).toBe('+8')
    const entries = stars() as { type: string; amount: number; source: string }[]
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: 'earn', amount: 5, source: '答题得星' })
    expect(entries[1]).toMatchObject({ type: 'earn', amount: 3, source: '满分奖励' })
    wrapper.unmount()
  })

  it('AC6-10 6/8：折算 8 分 → good 档 + earn-number +6 + 一条流水', async () => {
    stubRaf()
    seedSession({ status: 'pending', score: 6, correctCount: 6, earnedStars: 6 }, 8)
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('[data-page="result"]').text()).toContain('答对了这么多，真厉害')
    expect(wrapper.get('.earn-number').text()).toBe('+6')
    const entries = stars() as { type: string; amount: number; source: string }[]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'earn', amount: 6, source: '答题得星' })
    wrapper.unmount()
  })
})

describe('AC-R24-10 差一题满分档文案（R24 结算页文案强化）', () => {
  const NEAR_FULL = '就差 1 题就满分啦！满分还有 3 颗奖励星哦！'

  it('AC-R24-10-1 correctCount=9/10 → 出现差一题满分文案', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 9, correctCount: 9, earnedStars: 9, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('[data-page="result"]').text()).toContain(NEAR_FULL)
    expect(wrapper.find('.confetti').exists()).toBe(false)
    wrapper.unmount()
  })

  it('AC-R24-10-2 correctCount=10 → 满分庆祝文案，不出现差一题文案', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 10, correctCount: 10, earnedStars: 13, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).not.toContain(NEAR_FULL)
    expect(text).toContain('满分通关！太棒了')
    wrapper.unmount()
  })

  it('AC-R24-10-2 correctCount=8 → good 档文案，不出现差一题文案', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 8, correctCount: 8, earnedStars: 8, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).not.toContain(NEAR_FULL)
    expect(text).toContain('答对了这么多，真厉害')
    wrapper.unmount()
  })
})

describe('AC3-11 非法直访守卫', () => {
  it('无会话直访 /result → 重定向首页，不写流水', async () => {
    await router.replace('/result')
    mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(stars()).toEqual([])
  })

  it('in_progress 会话直访 /result → 重定向首页，不结算不销毁', async () => {
    seedSession({ status: 'in_progress', currentIndex: 3, answers: [{ questionId: 'q_0', selectedIndex: 0, correct: true }], correctCount: 1 })
    await router.replace('/result')
    mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(stars()).toHaveLength(0)
    expect((JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession).status).toBe('in_progress')
  })
})

describe('#288 无规则惊喜轮结果页：「答对 X/Y 题」+ 零产星', () => {
  const TRIVIA_SCOPE = { kind: 'trivia', category: '我的世界', book: '单词' } as const

  // 惊喜会话题目须为 9 号段 id（readSession 按 bankOf 校验范围，#234 来源即身份）
  function seedTriviaSession(partial: Partial<QuizSession>, count = 10): void {
    const questions: Question[] = Array.from({ length: count }, (_, i) => ({
      id: `9000${String(i + 1).padStart(2, '0')}`,
      type: 'trivia',
      category: '我的世界',
      book: '单词',
      prompt: `惊喜题${i}`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: 0,
    }))
    const session: QuizSession = {
      quizId: 'quiz_r',
      status: 'pending',
      scope: TRIVIA_SCOPE,
      mode: 'fresh',
      questions,
      currentIndex: count,
      answers: questions.map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })),
      correctCount: 0,
      createdAt: 1_000_000,
      ...partial,
    }
    localStorage.setItem('sq_session', JSON.stringify(session))
  }

  it('7/10 pending 挂载结算：good 档文案 + 答对 7 / 10 题，无得星数字，零流水，会话 settled', async () => {
    stubRaf()
    seedTriviaSession({ score: 7, correctCount: 7, earnedStars: 0 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).toContain('答对 7 / 10 题')
    expect(text).toContain('答对了这么多，真厉害')
    expect(text).toContain('得分 7 / 10')
    expect(wrapper.find('.earn-number').exists()).toBe(false)
    expect(wrapper.find('.trivia-correct-line').exists()).toBe(true)
    expect(stars()).toEqual([])
    expect((JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession).status).toBe('settled')
    wrapper.unmount()
  })

  it('10/10 满分档：满分文案但无得星数字、无星光雨，零流水', async () => {
    stubRaf()
    seedTriviaSession({ status: 'settled', score: 10, correctCount: 10, earnedStars: 0, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).toContain('满分通关！太棒了')
    expect(text).toContain('答对 10 / 10 题')
    expect(wrapper.find('.earn-number').exists()).toBe(false)
    expect(wrapper.find('.star-rain').exists()).toBe(false)
    expect(stars()).toEqual([])
    wrapper.unmount()
  })
})

describe('#289 带规则惊喜轮结果页：得星视觉恢复', () => {
  const TRIVIA_SCOPE = { kind: 'trivia', category: '我的世界', book: '单词' } as const
  const RULE = [{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }]

  function seedRuledTriviaSession(partial: Partial<QuizSession>, count = 10): void {
    const questions: Question[] = Array.from({ length: count }, (_, i) => ({
      id: `9000${String(i + 1).padStart(2, '0')}`,
      type: 'trivia',
      category: '我的世界',
      book: '单词',
      prompt: `惊喜题${i}`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: 0,
    }))
    const session: QuizSession = {
      quizId: 'quiz_r289',
      status: 'pending',
      scope: TRIVIA_SCOPE,
      starRule: RULE,
      mode: 'fresh',
      questions,
      currentIndex: count,
      answers: questions.map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })),
      correctCount: 0,
      createdAt: 1_000_000,
      ...partial,
    }
    localStorage.setItem('sq_session', JSON.stringify(session))
  }

  it('满分 10/10 pending 挂载结算：+25 颗星主视觉 + 滚动数字 + 满分星光雨，单条「惊喜答题」流水', async () => {
    stubRaf()
    seedRuledTriviaSession({ score: 10, correctCount: 10, earnedStars: 25 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).toContain('满分通关！太棒了')
    expect(text).toContain('得分 10 / 10')
    expect(wrapper.get('.earn-number').text()).toBe('+25')
    expect(text).toContain('颗星')
    expect(wrapper.find('.trivia-correct-line').exists()).toBe(false)
    expect(wrapper.find('.star-rain').exists()).toBe(true)
    const entries = stars() as { type: string; amount: number; source: string }[]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'earn', amount: 25, source: '惊喜答题：我的世界' })
    wrapper.unmount()
  })

  it('中档 9/10 settled：+5 颗星、差一题档沿用原文案（学科文案不动），无星光雨', async () => {
    stubRaf()
    seedRuledTriviaSession({ status: 'settled', score: 9, correctCount: 9, earnedStars: 5, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(wrapper.get('.earn-number').text()).toBe('+5')
    expect(text).toContain('就差 1 题就满分啦！满分还有 3 颗奖励星哦！')
    expect(wrapper.find('.star-rain').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#289 随票文案修正：无规则惊喜轮 9/10 差一题档改用无星变体（不出现 3 颗奖励星许诺）', async () => {
    stubRaf()
    const questions: Question[] = Array.from({ length: 10 }, (_, i) => ({
      id: `9000${String(i + 1).padStart(2, '0')}`,
      type: 'trivia' as const,
      category: '我的世界',
      book: '单词',
      prompt: `惊喜题${i}`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: 0,
    }))
    localStorage.setItem('sq_session', JSON.stringify({
      quizId: 'quiz_r289b',
      status: 'settled',
      scope: TRIVIA_SCOPE,
      mode: 'fresh',
      questions,
      currentIndex: 10,
      answers: [],
      correctCount: 9,
      score: 9,
      earnedStars: 0,
      createdAt: 1_000_000,
      settledAt: 2_000_000,
    }))
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.get('[data-page="result"]').text()
    expect(text).toContain('就差 1 题就满分啦！再来一次一定行！')
    expect(text).not.toContain('满分还有 3 颗奖励星哦！')
    expect(text).toContain('答对 9 / 10 题')
    wrapper.unmount()
  })
})
