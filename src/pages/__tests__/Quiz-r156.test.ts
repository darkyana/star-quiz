/**
 * #156 答题反馈可见性修复：宽档两列选项 + 答题后反馈自动滚入兜底。
 * 两列布局走源码文本锁定（jsdom 无布局引擎，不算真布局）；滚入走 stub 断言
 * 「滚入被调用且目标正确」，不断言滚动量。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Question, QuizSession } from '../../types'
import Quiz from '../Quiz.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const quizVue = readFileSync(resolve(srcDir, 'pages/Quiz.vue'), 'utf-8')
const optionRowVue = readFileSync(resolve(srcDir, 'components/StarOptionRow.vue'), 'utf-8')

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

describe('#156 宽档两列（≥1024 视口）', () => {
  it('样式：宽档媒体查询内 .options 转 grid 两列、列间距沿用 --space-sm，「跳过」整行（grid-column 全跨，#199 组件化后跳过为末位选项行）', () => {
    const at = quizVue.indexOf('@media (min-width: 1024px)')
    expect(at).toBeGreaterThan(-1)
    const mediaBlock = quizVue.slice(at)
    expect(mediaBlock).toMatch(
      /\.options\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, 1fr\);[^}]*gap: var\(--space-sm\)/,
    )
    expect(mediaBlock).toMatch(/\.options > :last-child\s*\{[^}]*grid-column: 1 \/ -1/)
  })

  it('意图不削弱：单列基础布局保留，选项行高仍由触控 md 档 min-height 保证（#199 组件化后读 StarOptionRow 源码）', () => {
    const options = quizVue.match(/\.options\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(options).toContain('display: flex')
    expect(options).toContain('flex-direction: column')
    const option = optionRowVue.match(/\.star-option\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(option).toContain('min-height: var(--touch-md)')
  })

  it('行高/间距不新增硬编码：1024 媒体查询块内无裸 px 声明（层级/间距全走令牌）', () => {
    // 恰好取该媒体查询整块（两层花括号平衡），不扫到文件尾部的其他规则
    const mediaBlock = quizVue.match(/@media \(min-width: 1024px\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/)?.[0] ?? ''
    expect(mediaBlock).toContain('grid-template-columns')
    const bodies = mediaBlock.match(/\{([^{}]*)\}/g) ?? []
    for (const body of bodies) {
      expect(body).not.toMatch(/\d+px/)
    }
  })
})

describe('#156 答题后反馈自动滚入', () => {
  it('判分后 scrollIntoView 被调用且目标为反馈条元素（block: nearest；stub 断言，不断言滚动量）', async () => {
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const calls: Array<{ target: Element; options: unknown }> = []
    const proto = Element.prototype as unknown as Record<string, unknown>
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element, options?: unknown) {
      calls.push({ target: this, options })
    }
    try {
      const wrapper = await mountQuiz()
      expect(calls).toHaveLength(0)
      await wrapper.findAll('.star-option')[2].trigger('click')
      await flushPromises()
      expect(calls.length).toBeGreaterThan(0)
      const last = calls[calls.length - 1]
      expect(last.target).toBe(wrapper.get('.feedback-area').element)
      expect(last.options).toMatchObject({ block: 'nearest' })
    } finally {
      proto.scrollIntoView = original
    }
  })

  it('未作答不触发滚入；reduced-motion 契约在源码层锁定（matchMedia prefers-reduced-motion 分支）', async () => {
    expect(quizVue).toMatch(/prefers-reduced-motion: reduce/)
    expect(quizVue).toMatch(/behavior: reduced \? 'auto' : 'smooth'/)
    seedSession({ questions: makeQuestions(10, 2) })
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const calls: Element[] = []
    const proto = Element.prototype as unknown as Record<string, unknown>
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      calls.push(this)
    }
    try {
      const wrapper = await mountQuiz()
      await flushPromises()
      expect(calls).toHaveLength(0)
      wrapper.unmount()
    } finally {
      proto.scrollIntoView = original
    }
  })
})
