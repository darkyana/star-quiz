/**
 * R15 亮色主题「晴空剧场」DOM 断言（T5 Quiz 三态 / T6 Result / T8 StarLog）
 * 对应 AC-R15-3-2/3-3/3-4/3-5/3-6。文案断言以 copy.ts 为准（不新增组件内硬编码文案）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { Question, QuizSession, StarEntry } from '../../types'
import Quiz from '../Quiz.vue'
import Result from '../Result.vue'
import StarLog from '../StarLog.vue'
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

beforeEach(() => {
  localStorage.clear()
  initAppState()
  router.replace('/')
})

describe('T5 AC-R15-3-2/3-3/3-4 Quiz 三态 + 反馈（DOM）', () => {
  it('AC-R15-3-2 未作答：4 选项与「不会」全部可用（无 disabled / 无 locked 类）', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    // 4 选项 + 跳过钮同以 StarOptionRow 渲染（#199 组件契约口径）
    expect(wrapper.findAll('.star-option')).toHaveLength(5)
    for (const opt of wrapper.findAll('.star-option')) {
      expect((opt.element as HTMLButtonElement).disabled).toBe(false)
      expect(opt.classes()).not.toContain('locked')
    }
    const skip = wrapper.get('.options > :last-child')
    expect((skip.element as HTMLButtonElement).disabled).toBe(false)
    expect(skip.classes()).not.toContain('locked')
  })

  it('AC-R15-3-3 答对：选中 .correct、其余 3 选项与「不会」disabled、feedback 含内联 SVG 图标', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[2].trigger('click')
    await flushPromises()
    const options = wrapper.findAll('.star-option')
    expect(options[2].classes()).toContain('star-option--correct')
    for (const [i, opt] of options.entries()) {
      if (i !== 2) expect((opt.element as HTMLButtonElement).disabled).toBe(true)
    }
    expect((wrapper.get('.options > :last-child').element as HTMLButtonElement).disabled).toBe(true)
    const fbBar = wrapper.get('.star-feedback-bar')
    const icon = fbBar.find('svg')
    expect(icon.exists()).toBe(true)
    expect(icon.attributes('aria-hidden')).toBe('true')
  })

  it('AC-R15-3-4 答错：选中 .wrong、正确项 .reveal、其余 disabled、feedback 图标存在', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    const options = wrapper.findAll('.star-option')
    expect(options[0].classes()).toContain('star-option--wrong')
    expect(options[2].classes()).toContain('star-option--reveal')
    for (const [i, opt] of options.entries()) {
      if (i !== 0 && i !== 2) expect((opt.element as HTMLButtonElement).disabled).toBe(true)
    }
    expect(wrapper.get('.star-feedback-bar').find('svg').exists()).toBe(true)
  })

  it('AC-R15-3-4 不会：正确项 .reveal、「不会」disabled、feedback 图标存在', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = await mountQuiz()
    await wrapper.get('.options > :last-child').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.star-option')[2].classes()).toContain('star-option--reveal')
    expect((wrapper.get('.options > :last-child').element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.get('.star-feedback-bar').find('svg').exists()).toBe(true)
  })
})

describe('T6 AC-R15-3-5 Result 得星主视觉同构（DOM）', () => {
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

  it('.earn-visual 内存在星形 SVG（fill var(--color-star)）+ 数字 + 单位文本', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 10, correctCount: 10, earnedStars: 13, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const visual = wrapper.get('.earn-visual')
    const star = visual.find('svg path')
    expect(star.exists()).toBe(true)
    expect(star.attributes('fill')).toBe('var(--color-star)')
    // #146 补一轮：圆润发光星 = fill 与 stroke 同色（加粗圆角 join 出圆润轮廓，无可见描边）
    expect(star.attributes('stroke')).toBe('var(--color-star)')
    expect(star.attributes('stroke-width')).toBe('3')
    expect(visual.text()).toContain('+13')
    expect(visual.text()).toContain('颗星')
    wrapper.unmount()
  })
})

describe('T8 AC-R15-3-6 StarLog grid 四列 + 印章（DOM）', () => {
  function seedStars(entries: StarEntry[]): void {
    localStorage.setItem('sq_stars', JSON.stringify(entries))
  }

  it('每行含印章容器、来源、时间、数量，印章内符号 SVG 存在', async () => {
    const now = Date.now()
    seedStars([
      { id: 't1', timestamp: now - 300_000, type: 'earn', amount: 5, source: '答题得星' },
      { id: 't2', timestamp: now - 200_000, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
    ])
    await router.replace('/star-log')
    const wrapper = mount(StarLog, { global: { plugins: [router] } })
    await flushPromises()
    const rows = wrapper.findAll('.ledger-row')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.find('.stamp').exists()).toBe(true)
      expect(row.find('.row-source').exists()).toBe(true)
      expect(row.find('.log-time').exists()).toBe(true)
      expect(row.find('.row-amount').exists()).toBe(true)
    }
    expect(rows[0].find('.stamp svg').exists()).toBe(true)
    expect(rows[1].find('.stamp svg').exists()).toBe(true)
    wrapper.unmount()
  })
})
