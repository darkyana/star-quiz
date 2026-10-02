/**
 * v0.6.0 AC-R7 放弃答题验收（Spec 20260824 §验收标准 AC-R7-1 ~ R7-8）
 * 「放弃答题」按钮 + 二次确认弹窗（对齐既有 modal 模式）+ 确认后作废会话跳首页（零写入）；
 * 与「重新开始」弹窗互斥；结算页单出口公理回归。
 * 会话由测试按 QuizSession 契约构造，渲染路径统一走 #/quiz?start=1。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import { ledger as readStars } from '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
import { readSession } from '../../src/composables/useQuiz'
import type { Question, QuizAnswer, QuizSession, StarEntry } from '../../src/types/index'

const KEY = 'sq_session'

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
    quizId: 'r7-session-001',
    status: 'in_progress',
    questions: uniformQuestions(10),
    currentIndex: 4,
    answers: answersFor(4, 4),
    correctCount: 4,
    createdAt: 1,
    ...partial,
  }
}

function pendingSession(): QuizSession {
  return {
    // #181 空题快照不再是可结算会话；单出口断言使用真实有效的 3/10 轮。
    quizId: 'r7-result-001', status: 'pending', questions: uniformQuestions(10), currentIndex: 10,
    answers: answersFor(10, 3), correctCount: 3, score: 3, earnedStars: 3, createdAt: 1,
  }
}

function earnEntry(id: string, amount = 1): StarEntry {
  return { id, timestamp: 1724230000000, type: 'earn', amount, source: '答题得星' }
}

function seedBase(stars: StarEntry[] = []): void {
  localStorage.setItem('sq_questions', JSON.stringify(uniformQuestions(10)))
  localStorage.setItem('sq_stars', JSON.stringify(stars))
  localStorage.setItem('sq_rewards', JSON.stringify([
    { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
    { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
  ]))
  localStorage.setItem('sq_last_export', JSON.stringify(''))
}

function seedSession(session: QuizSession): void {
  localStorage.setItem(KEY, JSON.stringify(session))
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

/** 挂载答题页（有效会话 + start=1 正常进入） */
async function mountQuiz(session: QuizSession, mountFn = (): Promise<VueWrapper> => mountApp()): Promise<void> {
  seedSession(session)
  wrapper = await mountFn()
  await go('#/quiz?start=1')
}

/** 打开「放弃答题」确认弹窗 */
async function openAbandonModal(): Promise<void> {
  await wrapper!.get('.abandon-btn').trigger('click')
  await settle()
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('AC-R7 放弃答题', () => {
  it('AC-R7-1 有效会话：「重新开始」与「放弃答题」两个按钮同时可见', async () => {
    await mountQuiz(makeSession())
    const abandon = wrapper.get('.abandon-btn')
    const restart = wrapper.get('.restart-btn')
    expect(abandon.text()).toContain('放弃答题')
    expect(restart.text()).toContain('重新开始')
  })

  it('AC-R7-2 点击「放弃答题」：弹 role="dialog" 含确认 / 取消两个动作按钮；弹窗未处理前会话未作废', async () => {
    await mountQuiz(makeSession())
    await openAbandonModal()
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.find('.star-button--standard').exists()).toBe(true)
    expect(dialog.find('.star-button--primary').exists()).toBe(true)
    // 未处理前：当前题索引不变、sq_session 仍在
    const sess = readSession()
    expect(sess).not.toBeNull()
    expect(sess!.currentIndex).toBe(4)
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('AC-R7-3 弹窗点取消：弹窗关闭、会话继续（当前题不变）、sq_stars 条数不变', async () => {
    seedBase([earnEntry('e1')])
    await mountQuiz(makeSession())
    await openAbandonModal()
    await wrapper.get('[role="dialog"] .star-button--standard').trigger('click')
    await settle()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(readSession()!.currentIndex).toBe(4)
    expect(readStars()).toHaveLength(1)
  })

  it('AC-R7-4 弹窗点确认：路由跳转 /，sq_stars 与点击前完全一致（本轮零写入），会话读取为空', async () => {
    const stars = [earnEntry('e1'), earnEntry('e2')]
    seedBase(stars)
    await mountQuiz(makeSession())
    await openAbandonModal()
    const before = JSON.stringify(readStars())
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    await settle()
    expect(JSON.stringify(readStars())).toBe(before)
    expect(readStars()).toHaveLength(2)
    expect(readSession()).toBeNull()
  })

  it('AC-R7-5 确认放弃跳首页（触发组件卸载与 onUnmounted 作废逻辑）：无重复副作用、无运行时错误', async () => {
    const stars = [earnEntry('e1')]
    seedBase(stars)
    const errors: unknown[] = []
    seedSession(makeSession())
    window.location.hash = '#/'
    await settle()
    wrapper = mount(App, {
      global: { plugins: [router], config: { errorHandler: (err: unknown) => { errors.push(err) } } },
    })
    await router.isReady()
    await flushPromises()
    await go('#/quiz?start=1')
    await openAbandonModal()
    const before = JSON.stringify(readStars())
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    await settle()
    expect(errors).toEqual([]) // 无运行时错误抛出
    expect(JSON.stringify(readStars())).toBe(before) // 无重复副作用（零写入）
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
  })

  it('AC-R7-6 确认放弃后首页不自动开新会话；既有「重新开始」路径回归：重抽题组、停留答题页继续作答', async () => {
    seedBase([earnEntry('e1')])
    await mountQuiz(makeSession())
    await openAbandonModal()
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    await settle()
    // 首页初始态：不自动开启新答题会话
    expect(readSession()).toBeNull()
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('第 1 / 10 题')

    // 既有「重新开始」回归：同一挂载内重新进入答题页（新会话 → 重新开始 → 重抽题组、留在答题页）
    const oldQuizId = 'r7-restart-old'
    seedSession(makeSession({ quizId: oldQuizId }))
    await go('#/quiz?start=1')
    await wrapper.get('.restart-btn').trigger('click')
    await settle()
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await settle()
    const restarted = readSession()
    expect(restarted!.quizId).not.toBe(oldQuizId)
    expect(restarted!.currentIndex).toBe(0)
    expect(restarted!.answers).toHaveLength(0)
    expect(router.currentRoute.value.path).toBe('/quiz') // 停留答题页
    expect(wrapper.text()).toContain('第 1 / 10 题')
  })

  it('AC-R7-7 放弃弹窗打开后再点「重新开始」：DOM 中 role="dialog" 元素数量为 1（两弹窗互斥）', async () => {
    await mountQuiz(makeSession())
    await openAbandonModal()
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1)
    await wrapper.get('.restart-btn').trigger('click')
    await settle()
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1)
  })

  it('AC-R7-8 结算页不出现「放弃答题」入口，页面出口仍仅有「回到首页」（单出口公理回归）', async () => {
    seedBase([])
    wrapper = await mountApp()
    seedSession(pendingSession())
    await go('#/result')
    const page = wrapper.get('[data-page="result"]')
    expect(page.text()).not.toContain('放弃答题')
    const buttons = page.findAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].text()).toBe('回到首页')
  })
})
