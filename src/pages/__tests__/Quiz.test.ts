/**
 * T7 答题页单测（Spec §4 REQ-5，AC5-1 ~ AC5-9 + 守卫 AC3-12 / AC3-13）
 * 会话快照直写 localStorage（F5）；路由断言用真实 router。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { Question, QuizSession } from '../../types'
import Quiz from '../Quiz.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import '../../composables/useStarData'
import '../../composables/useLearningData'

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

function storedSession(): QuizSession {
  return JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  router.replace('/')
})

describe('AC5-1 进度文案推进', () => {
  it('第 1 / 10 题 → 作答后第 2 / 10 题', async () => {
    seedSession({ questions: makeQuestions(10) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    expect(wrapper.get('[data-page="quiz"]').text()).toContain('第 1 / 10 题')
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-page="quiz"]').text()).toContain('第 2 / 10 题')
  })
})

describe('AC5-2 题干与选项渲染', () => {
  it('题干文本、题型 chip、4 选项 + 不会按钮', async () => {
    seedSession({ questions: makeQuestions(10) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    const page = wrapper.get('[data-page="quiz"]')
    expect(page.text()).toContain('题目0')
    expect(page.text()).toContain('看中文选英文')
    // 4 选项 + 跳过钮同以 StarOptionRow 渲染（#199 组件契约口径）
    expect(wrapper.findAll('.star-option')).toHaveLength(5)
    expect(wrapper.get('.options > :last-child').text()).toBe('不会')
  })

  it('三种题型 chip 文案映射', async () => {
    seedSession({
      questions: [
        { id: 'a', type: 'zh2en', prompt: 'a', options: ['A', 'B', 'C', 'D'], answerIndex: 0, wordId: 'w' },
        { id: 'b', type: 'en2zh', prompt: 'b', options: ['A', 'B', 'C', 'D'], answerIndex: 0, wordId: 'w' },
        { id: 'c', type: 'cloze', prompt: 'c', options: ['A', 'B', 'C', 'D'], answerIndex: 0, wordId: 'w' },
      ],
    })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    expect(wrapper.get('.star-chip').text()).toBe('看中文选英文')
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper.get('.next-btn').trigger('click')
    await flushPromises()
    expect(wrapper.get('.star-chip').text()).toBe('看英文选中文')
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper.get('.next-btn').trigger('click')
    await flushPromises()
    expect(wrapper.get('.star-chip').text()).toBe('挖空选词')
  })
})

describe('AC5-3 / AC5-4 / AC5-5 判分三态', () => {
  it('AC5-3 答对：选项 .correct + 文案 + 下一题 + 其余锁定', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[2].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.star-option')[2].classes()).toContain('star-option--correct')
    expect(wrapper.get('[data-page="quiz"]').text()).toContain('答对了！')
    expect(wrapper.get('.next-btn').text()).toBe('下一题')
    for (const [i, opt] of wrapper.findAll('.star-option').entries()) {
      if (i !== 2) expect((opt.element as HTMLButtonElement).disabled).toBe(true)
    }
    expect((wrapper.get('.options > :last-child').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('AC5-4 答错：所选 .wrong + 正确项 .reveal + 文案', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.star-option')[0].classes()).toContain('star-option--wrong')
    expect(wrapper.findAll('.star-option')[2].classes()).toContain('star-option--reveal')
    expect(wrapper.get('[data-page="quiz"]').text()).toContain('正确答案是这个')
    expect(wrapper.get('.next-btn').text()).toBe('下一题')
  })

  it('AC5-5 不会：无 .wrong + 正确项 .reveal + 鼓励文案', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.get('.options > :last-child').trigger('click')
    await flushPromises()
    for (const opt of wrapper.findAll('.star-option')) {
      expect(opt.classes()).not.toContain('star-option--wrong')
    }
    expect(wrapper.findAll('.star-option')[2].classes()).toContain('star-option--reveal')
    expect(wrapper.get('[data-page="quiz"]').text()).toContain('记住它，下次就会了')
    expect(wrapper.get('.next-btn').text()).toBe('下一题')
  })
})

describe('AC5-6 锁定不可改选', () => {
  it('作答后再点选项，会话 answers 不变', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[2].trigger('click')
    await flushPromises()
    const before = storedSession()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await wrapper.get('.options > :last-child').trigger('click')
    await flushPromises()
    const after = storedSession()
    expect(after.answers).toEqual(before.answers)
    expect(after.correctCount).toBe(before.correctCount)
  })
})

describe('AC5-7 下一题与查看结果', () => {
  it('末题作答后按钮为"查看结果"，点击转 pending 并跳 /result', async () => {
    seedSession({
      questions: makeQuestions(10),
      currentIndex: 9,
      answers: makeQuestions(9).map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })),
      correctCount: 9,
    })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    expect(wrapper.get('.next-btn').text()).toBe('查看结果')
    await wrapper.get('.next-btn').trigger('click')
    await flushPromises()
    expect(storedSession().status).toBe('pending')
    expect(router.currentRoute.value.path).toBe('/result')
  })
})

describe('AC5-8 重新开始二次确认', () => {
  it('点重新开始 → 弹窗文案 + 两按钮；确认 → 新 quizId 从第 1 题开始', async () => {
    seedSession({ questions: makeQuestions(10) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper.get('.restart-btn').trigger('click')
    await flushPromises()
    const modal = wrapper.get('[role="dialog"]')
    expect(modal.text()).toContain('重新开始本轮测验？已答题目不计星。')
    expect(modal.text()).toContain('取消')
    expect(modal.text()).toContain('重新开始')
    const oldId = storedSession().quizId
    await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
    await flushPromises()
    const next = storedSession()
    expect(next.quizId).not.toBe(oldId)
    expect(next.currentIndex).toBe(0)
    expect(next.answers).toEqual([])
    expect(wrapper.get('[data-page="quiz"]').text()).toContain('第 1 / 10 题')
  })

  it('弹窗点取消：会话 quizId 与进度不变', async () => {
    seedSession({ questions: makeQuestions(10) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper.get('.restart-btn').trigger('click')
    await flushPromises()
    const before = storedSession()
    await wrapper.get('[role="dialog"] .star-button--standard').trigger('click')
    await flushPromises()
    const after = storedSession()
    expect(after.quizId).toBe(before.quizId)
    expect(after.currentIndex).toBe(before.currentIndex)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('AC5-9 无返回按钮', () => {
  it('顶栏与主区均无"返回"按钮或返回链接', async () => {
    seedSession({ questions: makeQuestions(10) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    for (const el of wrapper.findAll('button, a')) {
      expect(el.text()).not.toContain('返回')
    }
    expect(wrapper.find('a[href*="back"]').exists()).toBe(false)
  })
})

describe('守卫：AC3-12 / AC3-13', () => {
  it('AC3-12 直访 #/quiz（无 start=1）→ 残留会话作废重抽新会话，不结算', async () => {
    const old = seedSession({ questions: makeQuestions(10), currentIndex: 3, answers: [{ questionId: 'q_0', selectedIndex: 0, correct: true }], correctCount: 1 })
    localStorage.setItem('sq_stars', JSON.stringify([]))
    await router.replace('/quiz')
    const wrapper = await mountQuiz()
    const next = storedSession()
    expect(next.quizId).not.toBe(old.quizId)
    expect(next.currentIndex).toBe(0)
    expect(next.answers).toEqual([])
    expect(next.status).toBe('in_progress')
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual([])
    wrapper.unmount()
  })

  it('AC3-12 题池空直访 #/quiz → 重定向首页', async () => {
    localStorage.setItem('sq_questions', JSON.stringify([]))
    seedSession({ questions: makeQuestions(10) })
    await router.replace('/quiz')
    await mountQuiz()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('AC3-13 直访 #/quiz?start=1 且无会话 → 重定向首页，不自动开新会话', async () => {
    localStorage.setItem('sq_stars', JSON.stringify([]))
    await router.replace({ path: '/quiz', query: { start: '1' } })
    await mountQuiz()
    expect(router.currentRoute.value.path).toBe('/')
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual([])
  })

  it('离开答题页（unmount）作废会话；正常查看结果后离开不删会话', async () => {
    seedSession({ questions: makeQuestions(10) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    wrapper.unmount()
    expect(localStorage.getItem('sq_session')).toBeNull()

    // 正常流程：查看结果 → pending，unmount 不删
    seedSession({ questions: makeQuestions(10), currentIndex: 9, answers: makeQuestions(9).map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })), correctCount: 9 })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper2 = await mountQuiz()
    await wrapper2.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper2.get('.next-btn').trigger('click')
    await flushPromises()
    wrapper2.unmount()
    expect(storedSession().status).toBe('pending')
  })
})
