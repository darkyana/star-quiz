/**
 * AC3-1 ~ AC3-8 / AC3-10 / AC3-11 答题会话状态机（Spec §4 REQ-3 / §3.4）
 * 状态机函数名与行为全部来自 Spec §2 REQ-3 与 §3.4 转换表；
 * AC3-10/AC3-11 走真实组件 + 路由（挂载 App 断言守卫），AC3-1~8 直调状态机函数并断言 localStorage 与返回。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import type { Question, QuizAnswer, QuizSession } from '../../src/types/index'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz, abandonQuiz } from '../../src/composables/useQuiz'
import { mulberry32 } from '../../src/utils/quizEngine'

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

function seedBase(): void {
  localStorage.setItem(STARS_KEY, JSON.stringify([]))
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

describe('AC3 答题会话状态机（函数级，8 条）', () => {
  it('AC3-1 开始答题生成会话：in_progress / quizId 非空 / 10 题 / currentIndex 0', () => {
    seedBase()
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
    const sess = startQuiz()
    expect(sess).not.toBeNull()
    const stored = readSess()
    expect(stored.status).toBe('in_progress')
    expect(typeof stored.quizId).toBe('string')
    expect(stored.quizId.length).toBeGreaterThan(0)
    expect(stored.questions).toHaveLength(10)
    expect(stored.currentIndex).toBe(0)
    expect(stored.answers).toEqual([])
    expect(stored.correctCount).toBe(0)
  })

  it('AC3-2 题池空：startQuiz 返回 null 且不创建会话', () => {
    seedBase()
    localStorage.setItem(Q_KEY, JSON.stringify([]))
    expect(startQuiz()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('AC3-3 两次开始重新抽题：quizId 不同且（id 顺序或选项顺序）至少一处不同', () => {
    seedBase()
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
    const a = startQuiz(mulberry32(42))
    const b = startQuiz(mulberry32(43))
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.quizId).not.toBe(b!.quizId)
    const idsSame = a!.questions.every((q, i) => q.id === b!.questions[i].id)
    const optsDiffer = a!.questions.some(
      (q, i) => q.options.some((o, j) => o !== b!.questions[i].options[j]),
    )
    expect(idsSame && !optsDiffer).toBe(false)
  })

  it('AC3-4 作答进度更新：answerQuiz(2) 后 currentIndex/answers/correctCount 正确', () => {
    seedBase()
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
    localStorage.setItem(KEY, JSON.stringify(makeSession()))
    answerQuiz(2)
    const sess = readSess()
    expect(sess.currentIndex).toBe(1)
    expect(sess.answers).toHaveLength(1)
    expect(sess.answers[0]).toEqual({ questionId: 'q1', selectedIndex: 2, correct: true })
    expect(sess.correctCount).toBe(1)
  })

  it('AC3-5 答完转 pending：score 7 / earnedStars 7', () => {
    seedBase()
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
    localStorage.setItem(
      KEY,
      JSON.stringify(makeSession({ currentIndex: 10, answers: answersFor(10, 7), correctCount: 7 })),
    )
    finishQuiz()
    const sess = readSess()
    expect(sess.status).toBe('pending')
    expect(sess.score).toBe(7)
    expect(sess.earnedStars).toBe(7)
  })

  it('AC3-6 结算首次入账：写 1 条 earn 7（quizId=q1）且会话转 settled', () => {
    seedBase()
    localStorage.setItem(
      KEY,
      JSON.stringify(
        makeSession({
          quizId: 'q1',
          status: 'pending',
          score: 7,
          earnedStars: 7,
          currentIndex: 10,
          answers: answersFor(10, 7),
          correctCount: 7,
        }),
      ),
    )
    settleQuiz()
    const stars = JSON.parse(localStorage.getItem(STARS_KEY) as string)
    expect(stars).toHaveLength(1)
    expect(stars[0].quizId).toBe('q1')
    expect(stars[0].amount).toBe(7)
    expect(readSess().status).toBe('settled')
  })

  it('AC3-7 结算幂等：已入账 quizId 再次结算不重复入账', () => {
    seedBase()
    localStorage.setItem(STARS_KEY, JSON.stringify([{ id: 's1', timestamp: 1, type: 'earn', amount: 7, source: '答题得星', quizId: 'q1' }]))
    localStorage.setItem(
      KEY,
      JSON.stringify(makeSession({ quizId: 'q1', status: 'settled', score: 7, earnedStars: 7, settledAt: 1 })),
    )
    settleQuiz()
    const stars = JSON.parse(localStorage.getItem(STARS_KEY) as string)
    expect(stars).toHaveLength(1)
    expect(readSess().status).toBe('settled')
  })

  it('AC3-8 中途离开作废：abandonQuiz 删会话、不写流水', () => {
    seedBase()
    localStorage.setItem(KEY, JSON.stringify(makeSession({ currentIndex: 3, answers: answersFor(3, 3), correctCount: 3 })))
    abandonQuiz()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(STARS_KEY) as string)).toEqual([])
  })
})

describe('AC3 会话损坏恢复 + 非法直访守卫（页面级，2 条）', () => {
  it('AC3-10 sq_session 损坏恢复：不崩溃、清除损坏值、warn 含键名与原因、可重新开始', async () => {
    seedBase()
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))
    localStorage.setItem(KEY, '{invalid json')
    const originalWarn = console.warn
    const warnSpy = vi.fn()
    console.warn = warnSpy
    try {
      wrapper = await mountApp()
      expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
      const startBtn = wrapper.findAll('button').find((b) => b.text().includes('开始答题'))
      expect(startBtn).toBeDefined()
      await startBtn!.trigger('click')
      await settle()
      const sess = readSess()
      expect(sess.status).toBe('in_progress')
      expect(sess.quizId.length).toBeGreaterThan(0)
      const raw = localStorage.getItem(KEY)
      expect(raw).not.toBe('{invalid json')
      expect(JSON.parse(raw as string)).not.toBeNull()
      const messages = warnSpy.mock.calls.map((c) => String(c[0]))
      expect(messages.some((m) => m.includes('sq_session') && m.includes('JSON'))).toBe(true)
    } finally {
      console.warn = originalWarn
    }
  })

  it('AC3-11 非法直访 #/result：无会话 / in_progress 均重定向首页且不写流水', async () => {
    seedBase()
    localStorage.setItem(Q_KEY, JSON.stringify(uniformQuestions(10)))

    // 无会话直访
    wrapper = await mountApp()
    await go('#/result')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    expect(JSON.parse(localStorage.getItem(STARS_KEY) as string)).toEqual([])

    // in_progress 会话直访：重定向、不结算不销毁
    localStorage.setItem(
      KEY,
      JSON.stringify(makeSession({ currentIndex: 3, answers: answersFor(3, 3), correctCount: 3 })),
    )
    await go('#/result')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    expect(JSON.parse(localStorage.getItem(STARS_KEY) as string)).toEqual([])
    const sess = readSess()
    expect(sess.status).toBe('in_progress')
    expect(sess.answers).toHaveLength(3)
  })
})
