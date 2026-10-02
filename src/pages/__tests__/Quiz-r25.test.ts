/**
 * T5 红旗旗钮交互逻辑单测（Spec 20260825-v0.7.1-R25 REQ-R25-1/3/4/9；#69 数据规则修订：条目只记 flaggedAt，correct 已废止）
 * 两态切换 / 初态（已标・未标）/ 标记恰写 { flaggedAt, childId }（#173 起条目挂孩子维度）/ 答题不碰旗子数据 / 取消删除键 /
 * 重复标记覆盖 / 作答后仍可标记 / 不影响答题判分（AC-R25 文案白名单 = copy.ts）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { Question, QuizSession } from '../../types'
import Quiz from '../Quiz.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { flagged as readFlagged, writeFlagged } from '../../composables/useLearningData'
import '../../composables/useStarData'

const TYPES = ['zh2en', 'en2zh', 'cloze'] as const

function makeQuestions(count: number, answerIndex = 0): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q_${i}`,
    type: TYPES[i % 3],
    prompt: `题目${i}`,
    options: ['A', 'B', 'C', 'D'],
    answerIndex,
    wordId: `w_${i}`,
  }))
}

function seedSession(partial: Partial<QuizSession> = {}, count = 10): QuizSession {
  const session: QuizSession = {
    quizId: 'quiz_x',
    status: 'in_progress',
    questions: makeQuestions(count),
    currentIndex: 0,
    answers: [],
    correctCount: 0,
    createdAt: 1_000_000,
    ...partial,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
  return session
}

async function mountQuiz() {
  const wrapper = mount(Quiz, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

async function openQuiz() {
  await router.replace({ path: '/quiz', query: { start: '1' } })
  return mountQuiz()
}

function storedSession(): QuizSession {
  return JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  router.replace('/')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('旗钮两态切换（REQ-R25-1）', () => {
  it('未标 → 点击标记 → 再点取消：aria-pressed / aria-label 随两态切换', async () => {
    seedSession()
    const wrapper = await openQuiz()
    const btn = wrapper.get('.flag-btn')
    expect(btn.attributes('aria-pressed')).toBe('false')
    expect(btn.attributes('aria-label')).toBe('标记这道题')
    expect(btn.classes()).not.toContain('flagged')

    await btn.trigger('click')
    await flushPromises()
    expect(btn.attributes('aria-pressed')).toBe('true')
    expect(btn.attributes('aria-label')).toBe('取消标记这道题')
    expect(btn.classes()).toContain('flagged')

    await btn.trigger('click')
    await flushPromises()
    expect(btn.attributes('aria-pressed')).toBe('false')
    expect(btn.attributes('aria-label')).toBe('标记这道题')
  })

  it('旗钮在题干卡内、不进顶栏（C3Re1 起 StarNavBar 槽位）', async () => {
    seedSession()
    const wrapper = await openQuiz()
    const card = wrapper.get('.question-card')
    expect(card.find('.flag-btn').exists()).toBe(true)
    const navbar = wrapper.get('.star-nav-bar')
    expect(navbar.find('.flag-btn').exists()).toBe(false)
  })
})

describe('旗钮初态（REQ-R25-3）', () => {
  it('sq_flagged 已存该 questionId → 初态已标红态（不重写 flaggedAt）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000)
    seedSession()
    writeFlagged({ q_0: { flaggedAt: 1_111 } })
    vi.spyOn(Date, 'now').mockReturnValue(9_999)
    const wrapper = await openQuiz()
    const btn = wrapper.get('.flag-btn')
    expect(btn.attributes('aria-pressed')).toBe('true')
    expect(btn.classes()).toContain('flagged')
    // 初态只读不写：flaggedAt 保持原值
    expect(readFlagged().q_0).toEqual({ flaggedAt: 1_111 })
  })

  it('sq_flagged 无该 questionId（含存其他题）→ 初态未标', async () => {
    seedSession()
    writeFlagged({ q_9: { flaggedAt: 1_111 } })
    const wrapper = await openQuiz()
    const btn = wrapper.get('.flag-btn')
    expect(btn.attributes('aria-pressed')).toBe('false')
    expect(btn.classes()).not.toContain('flagged')
  })

  it('下一题切题后旗钮初态随新题刷新', async () => {
    seedSession({ questions: makeQuestions(10) })
    const wrapper = await openQuiz()
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper.get('.next-btn').trigger('click')
    await flushPromises()
    const btn = wrapper.get('.flag-btn')
    expect(btn.attributes('aria-pressed')).toBe('false')
    expect(readFlagged().q_0).toBeTruthy()
  })
})

describe('数据形状与答题隔离（#69：REQ-R25-4 新口径，correct 已废止）', () => {
  it('标记恰写 { flaggedAt }（无 correct 字段）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234)
    seedSession({ questions: makeQuestions(10, 0) })
    const wrapper = await openQuiz()
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    expect(readFlagged().q_0).toEqual({ flaggedAt: 1_234, childId: 'default' })
  })

  it('未作答标记 → 作答后条目保持 { flaggedAt } 不变（答题动作不碰旗子数据，原 REQ-R25-5 补写已废止）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    seedSession({ questions: makeQuestions(10, 0) })
    const wrapper = await openQuiz()
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    expect(readFlagged().q_0).toEqual({ flaggedAt: 1_000, childId: 'default' })

    vi.spyOn(Date, 'now').mockReturnValue(8_000)
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    expect(readFlagged().q_0).toEqual({ flaggedAt: 1_000, childId: 'default' })
  })

  it('标记后选「不会」→ 条目同样保持不变', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    seedSession({ questions: makeQuestions(10, 2) })
    const wrapper = await openQuiz()
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    await wrapper.get('.options > :last-child').trigger('click')
    await flushPromises()
    expect(readFlagged().q_0).toEqual({ flaggedAt: 2_000, childId: 'default' })
  })
})

describe('取消与覆盖（REQ-R25-4）', () => {
  it('取消标记删除该 questionId 键，不影响其他键', async () => {
    seedSession()
    writeFlagged({
      q_0: { flaggedAt: 1_111 },
      q_9: { flaggedAt: 2_222 },
    })
    const wrapper = await openQuiz()
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    expect(readFlagged()).toEqual({ q_9: { flaggedAt: 2_222 } })
  })

  it('重复标记覆盖：只记最近一次的 flaggedAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    seedSession({ questions: makeQuestions(10, 0) })
    const wrapper = await openQuiz()
    // 第一次标记（未作答）→ 取消 → 作答 → 再标记
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    expect(readFlagged().q_0).toBeUndefined()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    vi.spyOn(Date, 'now').mockReturnValue(7_777)
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    expect(readFlagged().q_0).toEqual({ flaggedAt: 7_777, childId: 'default' })
  })
})

describe('作答后仍可标记（自主决策 #2 / REQ-R25-1）', () => {
  it('作答后旗钮不禁用，点击仍写入 sq_flagged', async () => {
    seedSession({ questions: makeQuestions(10, 0) })
    const wrapper = await openQuiz()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    const btn = wrapper.get('.flag-btn')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    await btn.trigger('click')
    await flushPromises()
    expect(readFlagged().q_0).toEqual({ flaggedAt: expect.any(Number), childId: 'default' })
  })
})

describe('旗钮不影响答题判分（REQ-R25-9）', () => {
  it('标记不改变会话；标记后作答 answers/correctCount 正常推进', async () => {
    seedSession({ questions: makeQuestions(10, 0) })
    const wrapper = await openQuiz()
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
    expect(storedSession().answers).toEqual([])
    expect(storedSession().correctCount).toBe(0)

    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    const after = storedSession()
    expect(after.answers).toHaveLength(1)
    expect(after.answers[0]).toEqual({ questionId: 'q_0', selectedIndex: 0, correct: true })
    expect(after.correctCount).toBe(1)
  })
})
