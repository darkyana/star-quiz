/**
 * T7 放弃答题（Spec 20260824 REQ-R7，AC-R7-1 ~ AC-R7-8）
 * 放弃按钮与重新开始并存；二次确认弹窗（与重新开始互斥）；
 * 确认 → 作废会话 + 跳首页，本轮不获星不写流水；取消 → 零副作用；
 * onUnmounted 的 abandonQuiz 与放弃路径不重复执行（finishing 短路）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { Question, QuizSession } from '../../types'
import Quiz from '../Quiz.vue'
import Result from '../Result.vue'
import Home from '../Home.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import '../../composables/useStarData'
import '../../composables/useLearningData'

const TYPES = ['zh2en', 'en2zh', 'cloze'] as const

function makeQuestions(count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q_${i}`,
    type: TYPES[i % 3],
    prompt: `题目${i}`,
    options: ['A', 'B', 'C', 'D'],
    answerIndex: 0,
    wordId: `w_${i}`,
  }))
}

function seedSession(partial: Partial<QuizSession> = {}): QuizSession {
  const session: QuizSession = {
    quizId: 'quiz_x',
    status: 'in_progress',
    questions: makeQuestions(10),
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
  await router.replace({ path: '/quiz', query: { start: '1' } })
  const wrapper = mount(Quiz, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function storedSession(): QuizSession | null {
  const raw = localStorage.getItem('sq_session')
  return raw === null ? null : (JSON.parse(raw) as QuizSession)
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  localStorage.setItem('sq_stars', JSON.stringify([]))
  router.replace('/')
})

describe('AC-R7-1 放弃按钮与重新开始并存', () => {
  it('顶栏同时存在 .restart-btn（重新开始）与 .abandon-btn（放弃答题，StarButtonStandard standard×small）', async () => {
    seedSession()
    const wrapper = await mountQuiz()
    const restart = wrapper.get('.restart-btn')
    const abandon = wrapper.get('.abandon-btn')
    expect(restart.text()).toBe('重新开始')
    expect(abandon.text()).toContain('放弃')
    expect(abandon.classes()).toContain('star-button--standard')
    expect(abandon.classes()).toContain('star-button--small')
  })
})

describe('AC-R7-2 放弃二次确认弹窗', () => {
  it('点放弃 → 弹 role="dialog" + aria-modal，含确认文案与确认/取消两按钮；未处理前会话未作废', async () => {
    seedSession()
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper.get('.abandon-btn').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.text()).toContain('放弃')
    expect(dialog.get('.star-button--standard').text()).toBe('取消')
    expect(dialog.get('.star-button--primary').text()).toContain('放弃')
    // 未确认：会话仍在且进行中
    const session = storedSession()
    expect(session).not.toBeNull()
    expect(session!.status).toBe('in_progress')
  })
})

describe('AC-R7-3 取消放弃', () => {
  it('取消后会话继续（quizId / currentIndex 不变）、零流水写入、弹窗关闭', async () => {
    const seeded = seedSession({ currentIndex: 1, answers: [{ questionId: 'q_0', selectedIndex: 0, correct: true }], correctCount: 1 })
    const wrapper = await mountQuiz()
    await wrapper.get('.abandon-btn').trigger('click')
    await flushPromises()
    await wrapper.get('[role="dialog"] .star-button--standard').trigger('click')
    await flushPromises()
    const after = storedSession()
    expect(after).not.toBeNull()
    expect(after!.quizId).toBe(seeded.quizId)
    expect(after!.currentIndex).toBe(1)
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual([])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('AC-R7-4 确认放弃', () => {
  it('确认后跳转首页（/）、sq_stars 不变、会话为空', async () => {
    const stars = [{ id: 's1', timestamp: 1, type: 'earn', amount: 3, source: '答题得星' }]
    localStorage.setItem('sq_stars', JSON.stringify(stars))
    seedSession({ currentIndex: 2, answers: [{ questionId: 'q_0', selectedIndex: 0, correct: true }], correctCount: 1 })
    const wrapper = await mountQuiz()
    await wrapper.get('.abandon-btn').trigger('click')
    await flushPromises()
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(stars)
  })
})

describe('AC-R7-5 无重复副作用', () => {
  it('确认放弃后 unmount 不再次作废：sq_session 的 removeItem 恰好执行 1 次（finishing 短路）', async () => {
    seedSession()
    const wrapper = await mountQuiz()
    // jsdom 的 localStorage 实例无法直接 spyOn，挂到 Storage.prototype（属性查找走原型）
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    await wrapper.get('.abandon-btn').trigger('click')
    await flushPromises()
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await flushPromises()
    wrapper.unmount()
    const sessionRemovals = removeSpy.mock.calls.filter(([key]) => key === 'sq_session')
    expect(sessionRemovals).toHaveLength(1)
    removeSpy.mockRestore()
  })
})

describe('AC-R7-7 放弃后首页不自动开新会话', () => {
  it('确认放弃回到首页并挂载 Home 后，sq_session 仍为空', async () => {
    seedSession()
    const wrapper = await mountQuiz()
    await wrapper.get('.abandon-btn').trigger('click')
    await flushPromises()
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await flushPromises()
    wrapper.unmount()
    await router.replace('/')
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(localStorage.getItem('sq_session')).toBeNull()
    home.unmount()
  })
})

describe('AC-R7-6 双弹窗互斥', () => {
  it('同一时刻 role="dialog" 数量 ≤ 1：开重新开始弹窗后点放弃按钮，弹窗切换为放弃且仍只有一个', async () => {
    seedSession()
    const wrapper = await mountQuiz()
    await wrapper.get('.restart-btn').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1)
    expect(wrapper.get('[role="dialog"]').text()).toContain('重新开始本轮测验')

    await wrapper.get('.abandon-btn').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1)
    expect(wrapper.get('[role="dialog"]').text()).not.toContain('重新开始本轮测验')
    expect(wrapper.get('[role="dialog"]').text()).toContain('放弃')

    // 反向：放弃弹窗打开时点重新开始，同样互斥切换
    await wrapper.get('.restart-btn').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1)
    expect(wrapper.get('[role="dialog"]').text()).toContain('重新开始本轮测验')
  })
})

describe('AC-R7-8 结算页无放弃入口', () => {
  it('结算页可见文本不含「放弃」，无 .abandon-btn', async () => {
    seedSession({
      status: 'settled',
      score: 8,
      correctCount: 8,
      earnedStars: 8,
      settledAt: 2_000_000,
    })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('放弃')
    expect(wrapper.find('.abandon-btn').exists()).toBe(false)
    wrapper.unmount()
  })
})
