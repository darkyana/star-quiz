/**
 * AC5-1 ~ AC5-9 答题页 + AC3-12 / AC3-13 直访守卫（Spec §4 REQ-5 / §3.4）
 * Given 会话由测试按 §3.2 QuizSession 契约构造（选项乱序快照即测试给定状态），
 * 渲染路径统一走 #/quiz?start=1（正常进入，§3.4 状态机）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import type { Question, QuizAnswer, QuizSession } from '../../src/types/index'

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

function seedPool(n: number): void {
  localStorage.setItem(Q_KEY, JSON.stringify(n === 0 ? [] : uniformQuestions(n)))
}

function seedBase(stars = [] as unknown[]): void {
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

describe('AC5 答题页（9 条）', () => {
  it('AC5-1 进度文案推进：第 1 / 10 题 → 作答后 第 2 / 10 题', async () => {
    seedPool(10)
    localStorage.setItem(KEY, JSON.stringify(makeSession()))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    expect(wrapper.text()).toContain('第 1 / 10 题')
    await wrapper.findAll('.star-option')[2].trigger('click')
    await settle()
    await wrapper.find('.star-button--primary.next-btn').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('第 2 / 10 题')
  })

  it('AC5-2 题干与选项渲染：火车 + 看中文选英文 chip + 4 选项 + 不会', async () => {
    seedPool(10)
    const questions = uniformQuestions(10)
    questions[0] = {
      id: 'sample_001',
      type: 'zh2en',
      prompt: '火车',
      options: ['train', 'ferry', 'beach', 'plane'],
      answerIndex: 0,
      wordId: 'train',
    }
    localStorage.setItem(KEY, JSON.stringify(makeSession({ questions })))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    expect(wrapper.text()).toContain('火车')
    expect(wrapper.text()).toContain('看中文选英文')
    // 4 选项 + 跳过钮同以 StarOptionRow 渲染（#199 组件契约口径）
    expect(wrapper.findAll('.star-option')).toHaveLength(5)
    const skip = wrapper.find('.options > :last-child')
    expect(skip.exists()).toBe(true)
    expect(skip.text()).toBe('不会')
  })

  it('AC5-3 答对反馈：correct + 答对了！ + 下一题 + 其余锁定', async () => {
    seedPool(10)
    localStorage.setItem(KEY, JSON.stringify(makeSession()))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await wrapper.findAll('.star-option')[2].trigger('click')
    await settle()
    expect(wrapper.findAll('.star-option')[2].classes()).toContain('star-option--correct')
    expect(wrapper.text()).toContain('答对了！')
    const nextBtn = wrapper.find('.star-button--primary.next-btn')
    expect(nextBtn.exists()).toBe(true)
    expect(nextBtn.text()).toBe('下一题')
    for (const idx of [0, 1, 3]) {
      expect(wrapper.findAll('.star-option')[idx].attributes('disabled')).toBeDefined()
    }
    expect(wrapper.find('.options > :last-child').attributes('disabled')).toBeDefined()
  })

  it('AC5-4 答错反馈：wrong + reveal + 正确答案是这个', async () => {
    seedPool(10)
    localStorage.setItem(KEY, JSON.stringify(makeSession()))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await wrapper.findAll('.star-option')[0].trigger('click')
    await settle()
    expect(wrapper.findAll('.star-option')[0].classes()).toContain('star-option--wrong')
    expect(wrapper.findAll('.star-option')[2].classes()).toContain('star-option--reveal')
    expect(wrapper.text()).toContain('正确答案是这个')
    expect(wrapper.find('.star-button--primary.next-btn').exists()).toBe(true)
  })

  it('AC5-5 不会反馈：无 wrong + reveal + 记住它，下次就会了', async () => {
    seedPool(10)
    localStorage.setItem(KEY, JSON.stringify(makeSession()))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await wrapper.find('.options > :last-child').trigger('click')
    await settle()
    expect(wrapper.findAll('.star-option--wrong')).toHaveLength(0)
    expect(wrapper.findAll('.star-option')[2].classes()).toContain('star-option--reveal')
    expect(wrapper.text()).toContain('记住它，下次就会了')
    expect(wrapper.find('.star-button--primary.next-btn').exists()).toBe(true)
  })

  it('AC5-6 锁定不可改：作答后再点其他选项 answers 不变', async () => {
    seedPool(10)
    localStorage.setItem(KEY, JSON.stringify(makeSession()))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await wrapper.findAll('.star-option')[2].trigger('click')
    await settle()
    const before = JSON.stringify(readSess().answers)
    await wrapper.findAll('.star-option')[0].trigger('click')
    await settle()
    expect(JSON.stringify(readSess().answers)).toBe(before)
  })

  it('AC5-7 最后一题按钮变查看结果 → 转 pending 跳 result', async () => {
    seedPool(10)
    localStorage.setItem(
      KEY,
      JSON.stringify(makeSession({ currentIndex: 9, answers: answersFor(9, 9), correctCount: 9 })),
    )
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await wrapper.findAll('.star-option')[2].trigger('click')
    await settle()
    const nextBtn = wrapper.find('.star-button--primary.next-btn')
    expect(nextBtn.text()).toBe('查看结果')
    await nextBtn.trigger('click')
    // finishQuiz 同步写回 pending（结算页挂载后才会 settle 为 settled，此处先断言 pending 转换）
    expect(readSess().status).toBe('pending')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/result'))
  })

  it('AC5-8 重新开始二次确认：确认重抽新卷、取消继续原卷', async () => {
    seedPool(10)
    localStorage.setItem(
      KEY,
      JSON.stringify(makeSession({ currentIndex: 3, answers: answersFor(3, 3), correctCount: 3 })),
    )
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    const oldQuizId = readSess().quizId

    const topRestart = wrapper.findAll('button').find((b) => b.text().trim() === '重新开始')
    expect(topRestart).toBeDefined()
    await topRestart!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('重新开始本轮测验？已答题目不计星。')
    const cancelBtn = wrapper.findAll('button').find((b) => b.text().trim() === '取消')
    const confirmRestart = wrapper
      .findAll('button')
      .find((b) => b.text().trim() === '重新开始' && b.element !== topRestart!.element)
    expect(cancelBtn).toBeDefined()
    expect(confirmRestart).toBeDefined()

    await confirmRestart!.trigger('click')
    await settle()
    const restarted = readSess()
    expect(restarted.quizId).not.toBe(oldQuizId)
    expect(restarted.currentIndex).toBe(0)
    expect(restarted.answers).toHaveLength(0)
    expect(wrapper.text()).toContain('第 1 / 10 题')

    // 再次打开弹窗并取消 → 继续原卷
    await wrapper.findAll('button').find((b) => b.text().trim() === '重新开始')!.trigger('click')
    await settle()
    await wrapper.findAll('button').find((b) => b.text().trim() === '取消')!.trigger('click')
    await settle()
    const afterCancel = readSess()
    expect(afterCancel.quizId).toBe(restarted.quizId)
    expect(afterCancel.currentIndex).toBe(restarted.currentIndex)
  })

  it('AC5-9 无返回按钮：顶栏与主区无"返回"按钮或返回链接', async () => {
    seedPool(10)
    localStorage.setItem(KEY, JSON.stringify(makeSession()))
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    for (const el of wrapper.findAll('button, a')) {
      expect(el.text()).not.toContain('返回')
    }
    expect(wrapper.find('a[href="#/"]').exists()).toBe(false)
  })
})

describe('AC3 直访守卫（§3.4 非法路径）', () => {
  it('AC3-12 直访 #/quiz（无 start=1）：残留会话作废重抽，题池空重定向首页', async () => {
    seedPool(10)
    seedBase()
    localStorage.setItem(
      KEY,
      JSON.stringify(makeSession({ quizId: 'old-quiz', currentIndex: 3, answers: answersFor(3, 3), correctCount: 3 })),
    )
    wrapper = await mountApp()
    await go('#/quiz')
    const newSess = readSess()
    expect(newSess.quizId).not.toBe('old-quiz')
    expect(newSess.status).toBe('in_progress')
    expect(newSess.currentIndex).toBe(0)
    expect(newSess.answers).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(STARS_KEY) as string)).toEqual([])

    // 题池空：重定向首页（先离开当前 #/quiz 再直访，确保导航触发）
    localStorage.setItem(Q_KEY, JSON.stringify([]))
    localStorage.removeItem(KEY)
    await go('#/')
    await go('#/quiz')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
  })

  it('AC3-13 直访 #/quiz?start=1 且无会话：重定向首页，不开新会话、不写流水', async () => {
    seedPool(10)
    seedBase()
    wrapper = await mountApp()
    await go('#/quiz?start=1')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(STARS_KEY) as string)).toEqual([])
  })
})
