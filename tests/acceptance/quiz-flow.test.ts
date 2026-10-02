/**
 * 答题流程验收（#95 归并：原 27-r23 / 28-r24 / 29-r25 三份逐票验收）
 * 覆盖：内置题库语义与同词多题 / 新引擎抽题与同轮硬去重 / 合批迁移→抽题→作答→结算写回全链路 /
 * 红旗旗钮动画 class 与判分零耦合 / 版本号断言清零 grep。
 * 各组保留原 Spec AC 编号注释；断言口径与裁决定见各组原文件头（沿 git 历史可溯）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type {
  Question,
  RewardItem,
  StarEntry,
  MoraleState,
  RecentWords,
  QuizSession,
} from '../../src/types/index'
import { currentQuestionBank } from '../../src/data/current-questions'
import { init as initAppState } from '../../src/composables/useDataInfra'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
// R32：5→6 迁移与 sq_proposals 初始值注册在 useProposals 模块加载时发生（合批断言迁移链终态需其注册）
import '../../src/composables/useProposals'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz } from '../../src/composables/useQuiz'
import { mulberry32 } from '../../src/utils/quizEngine'
import { recentWords, flagged as readFlagged } from '../../src/composables/useLearningData'
import Quiz from '../../src/pages/Quiz.vue'
import { router } from '../../src/router'
import { copy } from '../../src/copy'

// 剪环后备份注册上移组合根 main.ts（架构评审 20260829）：本文件模块图不加载 useExport，
// init() 不再触发下载备份，无需 mock；备份行为断言见 useDataInfra-migrations.test / question-results 验收

beforeEach(() => {
  localStorage.clear()
})

// ############################################################################
// 以下为原 28-r24 验收（AC-R24-1-4 / AC-R24-7-1 / AC-R24-11-2）
// ############################################################################


describe('AC-R24-1-4 内置题库缺省难度语义（不物理标注）', () => {
  it('内置 20 题每题均无 difficulty 自有字段（缺省语义 3）', () => {
    expect(currentQuestionBank.questions).toHaveLength(20)
    for (const q of currentQuestionBank.questions) {
      expect(Object.prototype.hasOwnProperty.call(q, 'difficulty')).toBe(false)
    }
  })
})

describe('AC-R24-7-1 同轮硬去重（startQuiz 集成形态，真实内置题库 20 题 18 词）', () => {
  it('startQuiz + 答满 10 题：本轮 wordId 互不相同，escalator / journey 至多各出现 1 次', () => {
    // Given：内置题库本身就是同词多题池（escalator ×2、journey ×2 + 14 个单题词 = 18 词）
    const wordIdCount = new Map<string, number>()
    for (const q of currentQuestionBank.questions) {
      expect(q.wordId).toBeDefined() // 内置学科题仍全部有词归属。
      wordIdCount.set(q.wordId!, (wordIdCount.get(q.wordId!) ?? 0) + 1)
    }
    expect(wordIdCount.get('escalator')).toBe(2)
    expect(wordIdCount.get('journey')).toBe(2)
    expect(wordIdCount.size).toBe(18)

    const proficiency: MoraleState = { level: 3, lastRoundCorrect: null }
    const recentWords: RecentWords = []
    localStorage.setItem('sq_questions', JSON.stringify(currentQuestionBank.questions))
    localStorage.setItem('sq_morale', JSON.stringify(proficiency))
    localStorage.setItem('sq_recent_words', JSON.stringify(recentWords))

    // When：开局并答满 10 题（逐题作答走完整会话链路）
    const session = startQuiz(mulberry32(42))
    expect(session).not.toBeNull()
    if (!session) return
    expect(session.questions).toHaveLength(10)
    for (const q of session.questions) answerQuiz(q.answerIndex)
    finishQuiz()

    // Then：本轮 10 题 wordId 互不相同
    const wordIds = session.questions.map((q) => q.wordId)
    expect(new Set(wordIds).size).toBe(10)
    expect(wordIds.filter((w) => w === 'escalator').length).toBeLessThanOrEqual(1)
    expect(wordIds.filter((w) => w === 'journey').length).toBeLessThanOrEqual(1)
  })
})

// ===== AC-R24-11-1 第三处（版本更新记录文档）已随归档退役（见文件头），无对应断言 =====

describe('AC-R24-11-2 旧版本号断言清零（grep 断言）', () => {
  // 拼接构造旧版本号字面量，避免守卫自身命中
  const legacyVersion = ['V0', '6.0'].join('')

  function collectFiles(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        out.push(...collectFiles(full))
      } else if (name.endsWith('.ts') || name.endsWith('.vue')) {
        out.push(full)
      }
    }
    return out
  }

  it('src/ 与 tests/ 全部 .ts/.vue 文件零命中旧版本号', () => {
    const files = [
      ...collectFiles(resolve(process.cwd(), 'src')),
      ...collectFiles(resolve(process.cwd(), 'tests')),
    ]
    expect(files.length).toBeGreaterThan(50)
    const offenders = files.filter((f) => readFileSync(f, 'utf-8').includes(legacyVersion))
    expect(offenders).toEqual([])
  })
})

// ############################################################################
// 以下为原 27-r23 验收（AC-R23-5-1 后半句 / AC-R23-6-1 否定半句 + 合批全链路）
// 注：原 AC-R23-1-2（内置题库 20 题 + escalator/journey ×2）与 AC-R24-1-4 / AC-R24-7-1 完全重复，已去重删除（#95）
// ############################################################################


describe('AC-R23-5-1 后半句：既有断言值已同步 000001（grep 断言）', () => {
  const files = [
    'src/data/__tests__/current-questions.test.ts',
    'src/composables/__tests__/useDataInfra-recovery.test.ts',
    'src/composables/__tests__/useDataInfra.test.ts',
  ]
  it.each(files)('%s 含断言值 000001', (rel) => {
    const source = readFileSync(resolve(process.cwd(), rel), 'utf-8')
    expect(source).toContain("'000001'")
  })
})

describe('AC-R23-6-1 否定半句：Question 注释不含旧 id 格式字样', () => {
  it('types/index.ts 全文不含 "{wordId}_{序号}" 字样', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/types/index.ts'), 'utf-8')
    expect(source).not.toContain('{wordId}_{序号}')
  })
})
// ===== 合批全链路：v0.6.0 老用户数据一次性升到 v0.7.0（R23 迁移链 × R24 引擎 × R24 结算写回）=====

/** v0.6.0 用户真实数据形态：旧 id = `{wordId}_{3位序号}`，题目内容与内置题库一一对应 */
function legacyBank(): Question[] {
  return currentQuestionBank.questions.map((q, i) => ({
    ...q,
    id: `${q.wordId}_${String(i + 1).padStart(3, '0')}`,
  }))
}

function legacyStars(): StarEntry[] {
  return [
    { id: 's1', timestamp: 1724140800000, type: 'earn', amount: 6, source: '答题得星' },
    { id: 's2', timestamp: 1724140900000, type: 'redeem', amount: 5, source: '兑换：小奖' },
  ]
}

function legacyRewards(): RewardItem[] {
  return [
    { id: 'reward_1', name: '小奖', price: 5 },
    { id: 'reward_2', name: '中奖', price: 10 },
    { id: 'reward_3', name: '大奖', price: 20 },
  ]
}

describe('合批全链路 localStorage 场景（AC-R23-2 组 × AC-R24-4/5/8 组串测）', () => {
  it('版本 "1" 老数据 → initAppState 迁移 → startQuiz 抽满 → 答对 9 结算 → 全部新键写回正确', () => {
    // Given：v0.6.0 老用户（旧 id、无 difficulty、无两新键）
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_questions', JSON.stringify(legacyBank()))
    localStorage.setItem('sq_stars', JSON.stringify(legacyStars()))
    localStorage.setItem('sq_rewards', JSON.stringify(legacyRewards()))

    // When ①：启动迁移
    initAppState()

    // Then ①：迁移终态（id 重编号 + difficulty 物理补 3 + 两新键 + sq_flagged 初始化 + 版本 "5" + 旧数据不动）
    const questions = JSON.parse(localStorage.getItem('sq_questions') as string) as Question[]
    expect(questions).toHaveLength(20)
    questions.forEach((q, i) => {
      expect(q.id).toBe(String(i + 1).padStart(6, '0'))
      expect(q.difficulty).toBe(3)
    })
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(legacyStars().map((s) => ({ ...s, childId: 'default', kind: 'main' })))
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(legacyRewards())
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({
      level: 1,
      lastRoundCorrect: null,
      childId: 'default',
    })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual([])
    // R25 REQ-R25-7：迁移链 3→4 初始化 sq_flagged；R27 REQ-R27-3：迁移链 4→5 初始化 sq_question_results；
    // R32 REQ-R32-6-2：迁移链 5→6 初始化 sq_proposals；#63：6→7 提议归因字段；#69：7→8 红旗瘦身，迁移终值 "8"
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({})
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)).toEqual([])
    expect(localStorage.getItem('sq_data_version')).toBe('9')

    // When ②：新引擎抽题（首局 level 1；迁移后全题 difficulty 3 → 缺省退化场景仍可抽满）
    const session = startQuiz(mulberry32(7))
    expect(session).not.toBeNull()
    if (!session) return
    expect(session.questions).toHaveLength(10)
    const wordIds = session.questions.map((q) => q.wordId)
    expect(new Set(wordIds).size).toBe(10) // 同词去重：escalator / journey 至多各 1
    expect(wordIds.filter((w) => w === 'escalator').length).toBeLessThanOrEqual(1)
    expect(wordIds.filter((w) => w === 'journey').length).toBeLessThanOrEqual(1)

    // When ③：答对 9 题、第 10 题答错 → 结算
    session.questions.forEach((q, i) => {
      answerQuiz(i < 9 ? q.answerIndex : (q.answerIndex + 1) % q.options.length)
    })
    finishQuiz()
    expect(settleQuiz()).toBe('settled')

    // Then ③：轮间写回（升档 level 1→2、lastRoundCorrect 9、词窗口 seq+1、星星流水追加 9）
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({
      level: 2,
      lastRoundCorrect: 9,
      childId: 'default',
    })
    const recent = recentWords()
    expect(recent).toEqual(wordIds)

    const stars = JSON.parse(localStorage.getItem('sq_stars') as string) as {
      type: string
      amount: number
    }[]
    expect(stars).toHaveLength(3) // 2 条旧流水 append-only 保留 + 1 条新 earn
    expect(stars.slice(0, 2)).toEqual(legacyStars().map((s) => ({ ...s, childId: 'default', kind: 'main' })))
    expect(stars[2]).toMatchObject({ type: 'earn', amount: 9 })
  })

// ############################################################################
// 以下为原 29-r25 验收（AC-R25-1/2 升旗动画 class / AC-R25-17 copy 槽位接线 / AC-R25-11 旗钮不影响判分得星）
// 槽位文案值断言已收拢 src/__tests__/copy.test.ts（quiz.flag describe），此处保留组件接线断言（#95 去重）
// ############################################################################

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

function seedSession(): void {
  const session: QuizSession = {
    quizId: `quiz_${Math.random().toString(36).slice(2)}`,
    status: 'in_progress',
    questions: makeQuestions(10),
    currentIndex: 0,
    answers: [],
    correctCount: 0,
    createdAt: 1_000_000,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
}

async function openQuiz(): Promise<VueWrapper> {
  await router.replace({ path: '/quiz', query: { start: '1' } })
  const wrapper = mount(Quiz, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}


describe('AC-R25-1 / AC-R25-2 升旗动画 CSS class 可断言半边', () => {
  beforeEach(() => {
    localStorage.clear()
    initAppState()
  })

  it('未标点击 → 挂 hoist 动画 class；再点取消 → hoist 与 flagged class 均移除（取消不播动画）', async () => {
    seedSession()
    const wrapper = await openQuiz()
    const btn = wrapper.get('.flag-btn')
    expect(btn.classes()).not.toContain('flagged')
    expect(btn.classes()).not.toContain('hoist')

    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).toContain('flagged')
    expect(btn.classes()).toContain('hoist')

    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).not.toContain('flagged')
    expect(btn.classes()).not.toContain('hoist')
    wrapper.unmount()
  })
})
describe('AC-R25-17 copy.quiz.flag 槽位接线（文案白名单）', () => {
  beforeEach(() => {
    localStorage.clear()
    initAppState()
  })

  it('copy 槽位文案 =「标记这道题」/「取消标记这道题」，旗钮 aria-label 两态取自 copy 槽位', async () => {
    expect(copy.quiz.flag.btnAriaLabel).toBe('标记这道题')
    expect(copy.quiz.flag.btnAriaLabelActive).toBe('取消标记这道题')

    seedSession()
    const wrapper = await openQuiz()
    const btn = wrapper.get('.flag-btn')
    expect(btn.attributes('aria-label')).toBe(copy.quiz.flag.btnAriaLabel)
    await btn.trigger('click')
    await flushPromises()
    expect(btn.attributes('aria-label')).toBe(copy.quiz.flag.btnAriaLabelActive)
    wrapper.unmount()
  })
})
/**
 * AC-R25-11 全链路：旗钮不影响答题进度 / 判分 / 得星。
 * 同一份 10 题题卷跑两轮满分局——一轮标记第 1 题（答前标记），一轮不标记；
 * 两轮 score / earnedStars / 星星流水完全一致 = 旗钮与得星逻辑零耦合。
 */
async function runPerfectRound(markFlag: boolean): Promise<{
  session: QuizSession
  stars: StarEntry[]
}> {
  localStorage.clear()
  initAppState()
  seedSession()
  const wrapper = await openQuiz()
  if (markFlag) {
    await wrapper.get('.flag-btn').trigger('click')
    await flushPromises()
  }
  for (let i = 0; i < 10; i++) {
    await wrapper.findAll('.star-option')[0].trigger('click')
    await flushPromises()
    await wrapper.get('.next-btn').trigger('click')
    await flushPromises()
  }
  const session = JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession
  expect(settleQuiz()).toBe('settled')
  const stars = JSON.parse(localStorage.getItem('sq_stars') as string) as StarEntry[]
  wrapper.unmount()
  return { session, stars }
}

describe('AC-R25-11 旗钮不影响判分得星（满分局对照）', () => {
  beforeEach(() => {
    localStorage.clear()
    initAppState()
  })

  it('标记局 vs 无标局：score 10 / earnedStars 13 / 流水 [10+3] 完全一致；标记键独立留存（#69：仅 flaggedAt）', async () => {
    const flagged = await runPerfectRound(true)

    // 判分与得星不受旗钮影响（REQ-R25-9：旗钮纯标记，不挂钩星星）
    // session 快照取自 finishQuiz 之后、settleQuiz 之前（status=pending，score/earnedStars 已写入）
    expect(flagged.session.status).toBe('pending')
    expect(flagged.session.score).toBe(10)
    expect(flagged.session.earnedStars).toBe(13) // 答对 10 + 满分奖励 3
    expect(flagged.stars.map((s) => [s.type, s.amount])).toEqual([
      ['earn', 10], // 答题得星
      ['earn', 3], // 满分奖励
    ])
    // 标记键留存（#69 数据规则修订：条目只记 flaggedAt，答题不补写 correct）
    expect(readFlagged().q_0).toEqual({ flaggedAt: expect.any(Number), childId: 'default' })

    const plain = await runPerfectRound(false)
    expect(plain.session.score).toBe(flagged.session.score)
    expect(plain.session.earnedStars).toBe(flagged.session.earnedStars)
    expect(plain.stars.map((s) => [s.type, s.amount])).toEqual(
      flagged.stars.map((s) => [s.type, s.amount]),
    )
    expect(readFlagged()).toEqual({})
  })
})
})
