/**
 * #103 出题模式框架独立验收（票内 Agent Brief 第 1 / 4 / 5 条 + 入口按 #108 定稿 D）：
 * - 模式框架：默认 normal / sq_quiz_mode 持久化 / 损坏回退 / 切换只影响下一轮
 * - 入口 DOM（#152 G3 三分段直显切换器）：tagline 不渲染、三模式分段直显（点选即切换写键）、
 *   选中态星光金（aria-checked + is-active）、无提示行、双按钮零改动、题池空入口常显
 * - 分派：startQuiz 按当前模式选引擎（会话 mode 快照）；新模式轮排除红旗题、普通模式照常出现
 * - 写回矩阵：新模式轮 星星照发 / 逐题记录照写 / 熟练度不写 / 近期词窗口照写 / 中途放弃沿用现语义
 * - 普通模式零改动：既有引擎路径回归（会话 mode = normal）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import type { Question, QuestionResult, QuizSession, StarEntry } from '../../src/types/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import { recentWords, writeQuestions, writeFlagged, writeQuestionResults } from '../../src/composables/useLearningData'
import { writeLedger } from '../../src/composables/useStarData'
import { startQuiz, settleQuiz, abandonQuiz } from '../../src/composables/useQuiz'
import {
  readQuizMode,
  writeQuizMode,
  QUIZ_MODE_KEY,
  QUIZ_MODE_META,
  isQuizMode,
} from '../../src/composables/useQuizMode'
import { componentRegistry } from '../../src/components/registry'

const MODE_KEY = QUIZ_MODE_KEY

function makePool(count: number, prefix = 'q'): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${String(i).padStart(3, '0')}`,
    type: 'zh2en',
    prompt: `题目${i}`,
    options: ['a', 'b', 'c', 'd'] as [string, string, string, string],
    answerIndex: 0,
    wordId: `${prefix}_w${i}`,
  }))
}

/** index 0 = 最新 */
function records(outcomes: Array<'correct' | 'wrong' | 'skipped'>): QuestionResult[] {
  return outcomes.map((outcome) => ({ outcome, timestamp: '2026-09-01T00:00:00.000Z' }))
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

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

// ===== 模式框架（Brief 第 1 条）=====

describe('模式框架：默认 / 持久化 / 损坏回退', () => {
  it('键缺失 → 默认 normal（且不主动落盘）', () => {
    expect(readQuizMode()).toBe('normal')
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })

  it('writeQuizMode 持久化 JSON，readQuizMode 读回；三值往返', () => {
    for (const mode of ['normal', 'fresh', 'wrong'] as const) {
      writeQuizMode(mode)
      expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify(mode))
      expect(readQuizMode()).toBe(mode)
    }
  })

  it('非法值 / 损坏 JSON → 回退 normal（损坏键被移除）', () => {
    localStorage.setItem(MODE_KEY, JSON.stringify('hardcore'))
    expect(readQuizMode()).toBe('normal')
    localStorage.setItem(MODE_KEY, '{invalid json')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readQuizMode()).toBe('normal')
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes(MODE_KEY))).toBe(true)
    warnSpy.mockRestore()
  })

  it('isQuizMode 守卫：三真值收，其余拒', () => {
    for (const v of ['normal', 'fresh', 'wrong']) expect(isQuizMode(v)).toBe(true)
    for (const v of ['NORMAL', 'hardcore', '', null, undefined, 1]) expect(isQuizMode(v)).toBe(false)
  })

  it('QUIZ_MODE_META：三模式名 / 一句话 / 图标 path 齐（组一直白系定稿文案）', () => {
    expect(QUIZ_MODE_META.map((m) => m.key)).toEqual(['normal', 'fresh', 'wrong'])
    expect(QUIZ_MODE_META.map((m) => m.name)).toEqual(['普通模式', '新题优先', '错题优先'])
    expect(QUIZ_MODE_META.map((m) => m.desc)).toEqual([
      '和平时一样，星星来出题',
      '没做过的题先出场',
      '做错的题再来一次',
    ])
    for (const m of QUIZ_MODE_META) expect(m.icon.length).toBeGreaterThan(0)
  })
})

// ===== 入口 UI（#152 G3 三分段直显切换器）=====

describe('首页入口（#152 G3）：tagline 移除 + 三分段直显切换器 + 双按钮零改动', () => {
  it('tagline「今天来攒几颗星？」不再渲染；分段直显三模式、默认「普通」段选中（aria-checked）', async () => {
    wrapper = await mountApp()
    const text = wrapper.get('[data-page="home"]').text()
    expect(text).not.toContain('今天来攒几颗星？')
    const entry = wrapper.get('.star-mode-entry')
    expect(entry.text()).toContain('出题方式')
    expect(entry.text()).toContain('普通')
    expect(entry.text()).toContain('新题优先')
    expect(entry.text()).toContain('错题优先')
    // radiogroup / radio + aria-checked（r2 原型可达性口径保持）；默认仅普通段选中
    expect(entry.get('[role="radiogroup"]').exists()).toBe(true)
    const pills = entry.findAll('.star-mode-entry__pill')
    expect(pills).toHaveLength(3)
    expect(pills.map((p) => p.attributes('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(pills[0].classes()).toContain('is-active')
  })

  it('无提示行：「换好啦」「本轮按」不出现（D 定稿取消，分段形态沿用）', async () => {
    wrapper = await mountApp()
    const text = wrapper.get('[data-page="home"]').text()
    expect(text).not.toContain('换好啦')
    expect(text).not.toContain('本轮按')
  })

  it('双按钮零改动：开始答题（primary）与兑换星星（standard）仍在，题池空时开始答题禁用', async () => {
    wrapper = await mountApp()
    const buttons = wrapper.findAll('.star-button')
    expect(buttons.map((b) => b.text())).toContain('开始答题')
    expect(buttons.map((b) => b.text())).toContain('兑换星星')
  })

  it('点选即切换：点「新题优先」段 → 选中态即时转移 + sq_quiz_mode 落盘 + 重挂载保持上次选择', async () => {
    wrapper = await mountApp()
    const pills = wrapper.findAll('.star-mode-entry__pill')
    await pills[1].trigger('click')
    await flushPromises()

    // 选中态转移：aria-checked 唯一 + is-active 类跟随
    expect(pills.map((p) => p.attributes('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(pills[1].classes()).toContain('is-active')
    expect(pills[0].classes()).not.toContain('is-active')
    // 切换语义：写 sq_quiz_mode、只影响下一轮（Home watch 落盘）
    expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify('fresh'))

    // 刷新语义：重挂载后仍选中上次选择（持久化生效）
    wrapper.unmount()
    wrapper = await mountApp()
    const nextPills = wrapper.findAll('.star-mode-entry__pill')
    expect(nextPills.map((p) => p.attributes('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(nextPills[1].classes()).toContain('is-active')

    // 切回普通：再点普通段，键同步回写（点选即切换的双向语义）
    await nextPills[0].trigger('click')
    await flushPromises()
    expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify('normal'))
  })

  it('题池空：入口常显可切（可用量禁用检查归 #109；分段不受题池影响）', async () => {
    writeQuestions([])
    wrapper = await mountApp()
    const pills = wrapper.findAll('.star-mode-entry__pill')
    for (const p of pills) expect(p.attributes('disabled')).toBeUndefined()
    await pills[2].trigger('click')
    await flushPromises()
    expect(pills[2].attributes('aria-checked')).toBe('true')
    expect(localStorage.getItem(MODE_KEY)).toBe(JSON.stringify('wrong'))
  })

  it('组件卡三处同步：registry 含 star-mode-entry 条目（本体 + registry + 展示页经 registry 渲染）', () => {
    const entry = componentRegistry.find((e) => e.key === 'star-mode-entry')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('出题方式入口')
    expect(entry!.showcase.map((c) => c.props.modelValue)).toEqual(['normal', 'fresh', 'wrong'])
    // #152 G3：分段短名（探针分段文案「普通 / 新题优先 / 错题优先」）
    expect(QUIZ_MODE_META.map((m) => m.shortName ?? m.name)).toEqual(['普通', '新题优先', '错题优先'])
  })
})

// ===== 分派与红旗（Brief 第 1 / 4 条）=====

describe('startQuiz 模式分派 + 红旗排除', () => {
  it('默认 normal：会话 mode 快照 = normal，走既有难度分层引擎（10 题）', () => {
    const session = startQuiz()
    expect(session).not.toBeNull()
    expect(session!.mode).toBe('normal')
    expect(session!.questions).toHaveLength(10)
  })

  it('fresh：新题块在前；会话 mode = fresh', () => {
    const pool = makePool(14)
    writeQuestions(pool)
    // 前 5 题已答过，后 9 题为新题 → 前 9 位均为新题
    const answeredIds = new Set(pool.slice(0, 5).map((q) => q.id))
    writeQuestionResults(
      Object.fromEntries(pool.slice(0, 5).map((q) => [q.id, records(['wrong'])])),
    )
    writeQuizMode('fresh')

    const session = startQuiz()!
    expect(session.mode).toBe('fresh')
    expect(session.questions).toHaveLength(10)
    for (const q of session.questions.slice(0, 9)) expect(answeredIds.has(q.id)).toBe(false)
  })

  it('wrong：错题块在前；会话 mode = wrong', () => {
    const pool = makePool(14)
    writeQuestions(pool)
    // 前 4 题为错题，其余为新题
    writeQuestionResults(
      Object.fromEntries(pool.slice(0, 4).map((q) => [q.id, records(['wrong'])])),
    )
    writeQuizMode('wrong')

    const session = startQuiz()!
    expect(session.mode).toBe('wrong')
    const head = new Set(session.questions.slice(0, 4).map((q) => q.id))
    expect(head).toEqual(new Set(pool.slice(0, 4).map((q) => q.id)))
  })

  it('新模式轮排除红旗题；普通模式照常出现（池恰 10 → 全量）', () => {
    const pool = makePool(10)
    writeQuestions(pool)
    writeFlagged({ q_000: { flaggedAt: 1 } })

    writeQuizMode('fresh')
    const freshSession = startQuiz()!
    expect(freshSession.questions.map((q) => q.id)).not.toContain('q_000')

    writeQuizMode('wrong')
    writeQuestionResults({ q_000: records(['wrong']), q_001: records(['wrong']) })
    const wrongSession = startQuiz()!
    expect(wrongSession.questions.map((q) => q.id)).not.toContain('q_000')
    expect(wrongSession.questions.slice(0, 2).map((q) => q.id)).toContain('q_001')

    writeQuizMode('normal')
    const normalSession = startQuiz()!
    expect(normalSession.questions.map((q) => q.id)).toContain('q_000')
  })

  it('切换只影响下一轮：进行中会话的题组不随模式切换变化', () => {
    const pool = makePool(14)
    writeQuestions(pool)
    const session1 = startQuiz()!
    const idsBefore = session1.questions.map((q) => q.id).join(',')
    writeQuizMode('wrong')
    // 进行中的会话快照不变（sq_session 未被重写）
    const stored = JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession
    expect(stored.questions.map((q) => q.id).join(',')).toBe(idsBefore)
    expect(stored.mode).toBe('normal')
  })
})

// ===== 写回矩阵（Brief 第 5 条）=====

/** 造一轮待结算会话（mode 可三选）：10 题、答对 6 / 答错 2 / 跳过 2（全作答） */
function seedPendingModeSession(mode: QuizMode, prefix = 'm'): QuizSession {
  const questions = makePool(10, prefix)
  const answers = questions.map((q, i) => ({
    questionId: q.id,
    selectedIndex: i < 6 ? 0 : i < 8 ? 1 : null,
    correct: i < 6,
  }))
  const session: QuizSession = {
    quizId: `quiz_mode_${mode}`,
    status: 'pending',
    mode,
    questions,
    currentIndex: 10,
    answers,
    correctCount: 6,
    score: 6,
    earnedStars: 6,
    createdAt: 1_000_000,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
  return session
}

describe('写回矩阵：新模式轮结算', () => {
  it('星星照发（答对 6 → 1 条 earn 6）；逐题记录照写（三态）；熟练度不写；近期词窗口照写', () => {
    const session = seedPendingModeSession('fresh')
    writeLedger([])

    expect(settleQuiz()).toBe('settled')

    // 星星流水：答对 6 星（非满分，无奖励 3）
    const stars = JSON.parse(localStorage.getItem('sq_stars') as string) as StarEntry[]
    expect(stars).toHaveLength(1)
    expect(stars[0]).toMatchObject({ type: 'earn', amount: 6, quizId: session.quizId })

    // 逐题记录：6 correct / 2 wrong / 2 skipped
    const results = JSON.parse(localStorage.getItem('sq_question_results') as string)
    for (let i = 0; i < 10; i++) {
      const expected = i < 6 ? 'correct' : i < 8 ? 'wrong' : 'skipped'
      expect(results[session.questions[i].id][0].outcome).toBe(expected)
    }

    // 熟练度不写：保持初始 { level: 1, lastRoundCorrect: null }
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })

    // #173 近期已测词改清单：本轮全部词记录一次，按本轮顺序前置。
    const recent = recentWords()
    expect(recent).toEqual(session.questions.map((q) => q.wordId))
  })

  it('wrong 模式同矩阵；二次结算幂等（熟练度仍不被写）', () => {
    const session = seedPendingModeSession('wrong', 'w')
    writeLedger([])

    expect(settleQuiz()).toBe('settled')
    expect(settleQuiz()).toBe('idempotent')
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    const stars = JSON.parse(localStorage.getItem('sq_stars') as string) as StarEntry[]
    expect(stars).toHaveLength(1)
    expect(stars[0]).toMatchObject({ type: 'earn', amount: 6, quizId: session.quizId })
  })

  it('对照：普通模式轮结算熟练度照写（既有语义不变）', () => {
    const session = seedPendingModeSession('normal', 'n')
    writeLedger([])

    expect(settleQuiz()).toBe('settled')
    // 答对 6（6~8 不变档）→ level 不变 1，lastRoundCorrect = 6
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 1, lastRoundCorrect: 6, childId: 'default' })
  })

  it('中途放弃（新模式轮）：已作答题写逐题记录，星星与轮间统计（含熟练度与词窗口）不写', () => {
    const questions = makePool(10, 'ab')
    const session: QuizSession = {
      quizId: 'quiz_mode_abandon',
      status: 'in_progress',
      mode: 'wrong',
      questions,
      currentIndex: 3,
      answers: questions.slice(0, 3).map((q, i) => ({ questionId: q.id, selectedIndex: i === 0 ? 0 : 1, correct: i === 0 })),
      correctCount: 1,
      createdAt: 1_000_000,
    }
    localStorage.setItem('sq_session', JSON.stringify(session))
    writeLedger([])

    abandonQuiz()

    const results = JSON.parse(localStorage.getItem('sq_question_results') as string)
    expect(Object.keys(results)).toHaveLength(3)
    expect(results[questions[0].id][0].outcome).toBe('correct')
    expect(results[questions[1].id][0].outcome).toBe('wrong')
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual([])
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual([])
  })
})
