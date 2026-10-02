/**
 * R27 逐题答题记录独立验收（Spec 20260825-v0.7.2-R27 §验收标准，AC-R27-1 ~ AC-R27-5）。
 * 验收视角：从 Spec AC 独立生成，断言行为结果与 localStorage 值，不从实现源码反推；
 * 与 developer 内循环单测（useQuiz-r27 / useAppState-flagged / importExport-question-results）
 * 允许覆盖相同行为。AC-R27-6-1 / 6-2 由全量回归承载（npm test 全量运行即验证），不在此重复。
 *
 * 断言口径裁决（AC-R27-5-1 括注「flagged 按文件覆盖」）：
 * REQ-R27-5-1 与 v2 简报决策链 ⑧ 的「全量覆盖」仅指 sq_question_results；flagged 沿用 R25
 * 兼容模式 = 校验层数据包语义（文件值/缺省兜底 {}），落库侧既有行为 = 导入不触碰 sq_flagged
 * （Parent.vue confirmImport 自 R3 起只覆盖题池/兑换项）。本文件按「既有导入行为不变」断言。
 *
 * R36 更新（Spec 20260827-v0.10.0 §D6 有意变更）：导出契约升级 2.0 两组（AC-R27-4-1/4-2/7-8
 * 版本与形状断言同步）；1.x 文件断代——AC-R27-5-1 重构为「1.1 拒绝 + 版本过旧提示 + 数据零变化」
 * （AC-R36-3-1 同款）；AC-R27-5-2/5-3 导入载体改 2.0 学习文件。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type {
  LearningExport,
  Question,
  QuestionResult,
  QuestionResultsState,
  QuizSession,
  StarEntry,
} from '../../src/types'
import App from '../../src/App.vue'
import { copy } from '../../src/copy'
import router from '../../src/router/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import {
  writeQuestions,
  writeFlagged,
  questionResults as readQuestionResults,
  writeQuestionResults,
} from '../../src/composables/useLearningData'
import {
  writeRewards,
  writeLedger as writeStars,
} from '../../src/composables/useStarData'
import '../../src/composables/useStarData'
import { settleQuiz, abandonQuiz } from '../../src/composables/useQuiz'
import { downloadDataExport, downloadLedgerExport, runMigrationBackup } from '../../src/composables/useExport'
import { registerMigrationBackup } from '../../src/composables/useDataInfra'

// 迁移备份 spy（AC-R27-3-3/4）：包装真实实现——计数可断言，导出内容断言（AC-R27-4/7-8）照常走真实下载。
// 剪环后备份注册上移组合根：测试扮演 main.ts 注册一次（与生产同构，架构评审 20260829）
vi.mock('../../src/composables/useExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/composables/useExport')>()
  const downloadDataExport = vi.fn(actual.downloadDataExport)
  const downloadLedgerExport = vi.fn(actual.downloadLedgerExport)
  return {
    downloadDataExport,
    downloadLedgerExport,
    // #172 导入前自动备份（未配对设备）：透传真实实现（分流与回环由 useExport 专项测试覆盖）
    autoBackupBeforeImport: actual.autoBackupBeforeImport,
    runMigrationBackup: () => {
      try {
        downloadDataExport()
      } catch {
        // 备份失败不阻断迁移（与生产语义一致）
      }
      try {
        downloadLedgerExport()
      } catch {
        // 同上
      }
    },
  }
})
const mockedDownloadData = vi.mocked(downloadDataExport)
const mockedDownloadLedger = vi.mocked(downloadLedgerExport)
registerMigrationBackup(runMigrationBackup)

const RESULTS_KEY = 'sq_question_results'
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// ===== seed 工具 =====

function makePool(count: number, idOffset = 0): Question[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + idOffset
    return {
      id: `q_${String(n).padStart(3, '0')}`,
      type: 'zh2en',
      prompt: `word_${n}`,
      options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`],
      answerIndex: n % 4,
      wordId: `w_${n}`,
    }
  })
}

function seedSession(partial: Partial<QuizSession> = {}): QuizSession {
  const session: QuizSession = {
    quizId: 'quiz_r27_acceptance',
    status: 'in_progress',
    questions: makePool(10),
    currentIndex: 0,
    answers: [],
    correctCount: 0,
    createdAt: 1_000_000,
    ...partial,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
  return session
}

function readResults(): QuestionResultsState {
  const raw = localStorage.getItem(RESULTS_KEY)
  return raw === null ? {} : (JSON.parse(raw) as QuestionResultsState)
}

/** 断言：一轮全部记录时间戳均为合法 ISO 8601 且同轮全部相同 */
function expectSharedIsoTimestamp(timestamps: string[]): void {
  expect(timestamps).not.toHaveLength(0)
  for (const t of timestamps) expect(t).toMatch(ISO_RE)
  expect(new Set(timestamps).size).toBe(1)
}

function resultRecords(n: number, outcome: QuestionResult['outcome']): QuestionResult[] {
  return Array.from({ length: n }, (_, i) => ({ outcome, timestamp: `2026-01-0${(i % 9) + 1}T00:00:0${i}.000Z` }))
}

const threeStars: StarEntry[] = [
  { id: 'e1', timestamp: 100, type: 'earn', amount: 3, source: '答题得星', quizId: 'quiz-1' },
  { id: 'e2', timestamp: 200, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
  { id: 'e3', timestamp: 300, type: 'earn', amount: 1, source: '答题得星', quizId: 'quiz-3' },
]

/** 预置一套版本 4 用户数据（除 sq_question_results / sq_data_version 外 7 键就位），返回迁移前 7 键 JSON 快照 */
function seedVersion4Data(): Record<string, string> {
  const questions = Array.from({ length: 4 }, (_, i) => ({
    id: String(i + 1).padStart(6, '0'),
    type: 'zh2en',
    prompt: `第 ${i + 1} 题`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: i % 4,
    wordId: `w${i}`,
    difficulty: (i % 3 + 1) as 1 | 2 | 3,
  }))
  const seven: Record<string, string> = {
    sq_questions: JSON.stringify(questions),
    sq_stars: JSON.stringify(threeStars),
    sq_rewards: JSON.stringify([{ id: 'r1', name: '菠萝油', price: 5 }]),
    sq_last_export: JSON.stringify('2026-01-01T00:00:00.000Z'),
    sq_proficiency: JSON.stringify({ level: 2, lastRoundCorrect: 6 }),
    sq_recent_words: JSON.stringify({ seq: 4, words: { apple: 4 } }),
    sq_flagged: JSON.stringify({ '000001': { flaggedAt: 1000 } }),
  }
  localStorage.setItem('sq_data_version', '4')
  for (const [key, value] of Object.entries(seven)) localStorage.setItem(key, value)
  return seven
}

/** 旧七键经过 8→9：只改约定形状，原有业务值逐项保留。 */
function expectVersion9Data(before: Record<string, string>): void {
  expect(JSON.parse(localStorage.getItem('sq_questions')!)).toEqual(
    JSON.parse(before.sq_questions).map((q: Question) => ({ ...q, category: '学科', book: '默认' })),
  )
  expect(JSON.parse(localStorage.getItem('sq_stars')!)).toEqual(threeStars.map((s) => ({ ...s, childId: 'default', kind: 'main' })))
  expect(localStorage.getItem('sq_rewards')).toBe(before.sq_rewards)
  expect(localStorage.getItem('sq_proficiency')).toBeNull()
  expect(JSON.parse(localStorage.getItem('sq_morale')!)).toEqual({ level: 2, lastRoundCorrect: 6, childId: 'default' })
  expect(JSON.parse(localStorage.getItem('sq_recent_words')!)).toEqual(['apple'])
  expect(JSON.parse(localStorage.getItem('sq_flagged')!)).toEqual({ '000001': { flaggedAt: 1000, childId: 'default' } })
}

// ===== 下载 / 文件读取 stub（jsdom 无真实下载与文件选择） =====

let capturedBlob: Blob | null = null
const originalReadAsText = FileReader.prototype.readAsText
const originalAnchorClick = HTMLAnchorElement.prototype.click

function stubDownload(): void {
  capturedBlob = null
  const createObjectURL = vi.fn((b: Blob) => {
    capturedBlob = b
    return 'blob:mock-url'
  })
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
}

/** jsdom 的 Blob 无 .text()，用 FileReader 读取 */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

function stubFileRead(text: string): void {
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'result', { value: text, configurable: true })
    this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
  })
}

async function mountParentApp(): Promise<VueWrapper> {
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return wrapper
}

async function openDataModal(wrapper: VueWrapper): Promise<void> {
  const dataBtn = wrapper.findAll('button').find((b) => b.text() === '数据管理')
  expect(dataBtn).toBeDefined()
  await dataBtn!.trigger('click')
  await flushPromises()
}

/** 走完整家长导入链路：file input → FileReader → 校验 → 二次确认 → 全量覆盖 */
async function importDataFile(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.get('.file-input')
  const file = new File([text], 'import.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  stubFileRead(text)
  await input.trigger('change')
  FileReader.prototype.readAsText = originalReadAsText
  await wrapper.get('.confirm-ok').trigger('click')
  await flushPromises()
}

// ===== 全局清理 =====

beforeEach(() => {
  // #172：导入确认前未配对设备自动全量备份会触发下载——统一 stub（真实 anchor click 在 happy-dom 会导航跳页）
  stubDownload()
  localStorage.clear()
  mockedDownloadData.mockClear()
  mockedDownloadLedger.mockClear()
})

afterEach(() => {
  FileReader.prototype.readAsText = originalReadAsText
  HTMLAnchorElement.prototype.click = originalAnchorClick
  vi.unstubAllGlobals()
})

// ===== AC-R27-1 新数据键与类型 =====

describe('AC-R27-1 新数据键与类型', () => {
  it('AC-R27-1-1 全新安装（无任何 sq_* 键）initAppState() → sq_question_results 初始化为 "{}"', () => {
    expect(Object.keys(localStorage).filter((k) => k.startsWith('sq_'))).toHaveLength(0)

    initAppState()

    expect(localStorage.getItem(RESULTS_KEY)).toBe('{}')
  })

  it('AC-R27-1-2 版本 "5" + sq_question_results 为非法 JSON → 重置 "{}"、执行不抛错、console.warn 含键名', () => {
    localStorage.setItem('sq_data_version', '5')
    localStorage.setItem(RESULTS_KEY, '{invalid json')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => initAppState()).not.toThrow()

    expect(localStorage.getItem(RESULTS_KEY)).toBe('{}')
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes(RESULTS_KEY))).toBe(true)
    warnSpy.mockRestore()
  })
})

// ===== AC-R27-2 结算 + 放弃写入 =====

describe('AC-R27-2 结算 + 放弃写入', () => {
  it('AC-R27-2-1 pending 会话 5 对 / 3 错 / 2 不会 → settled：三态各 1 条且同轮共享合法 ISO 时间戳', () => {
    const questions = makePool(10)
    const answers = [
      ...questions.slice(0, 5).map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })),
      ...questions.slice(5, 8).map((q) => ({ questionId: q.id, selectedIndex: 1, correct: false })),
      ...questions.slice(8).map((q) => ({ questionId: q.id, selectedIndex: null, correct: false })),
    ]
    seedSession({ status: 'pending', score: 5, earnedStars: 5, currentIndex: 10, answers, correctCount: 5 })
    localStorage.setItem('sq_stars', '[]')

    expect(settleQuiz()).toBe('settled')

    const state = readResults()
    for (const q of questions.slice(0, 5)) expect(state[q.id][0].outcome).toBe('correct')
    for (const q of questions.slice(5, 8)) expect(state[q.id][0].outcome).toBe('wrong')
    for (const q of questions.slice(8)) expect(state[q.id][0].outcome).toBe('skipped')
    for (const q of questions) expect(state[q.id]).toHaveLength(1)
    expectSharedIsoTimestamp(questions.flatMap((q) => state[q.id].map((r) => r.timestamp)))
  })

  it('AC-R27-2-2 answers 仅含 10 题中的 6 题 → 仅这 6 个 questionId 产生记录，其余 4 个无记录', () => {
    const questions = makePool(10)
    const answers = questions
      .slice(0, 6)
      .map((q, i) => ({ questionId: q.id, selectedIndex: i % 2 === 0 ? 0 : 1, correct: i % 2 === 0 }))
    seedSession({ status: 'pending', score: 3, earnedStars: 3, currentIndex: 6, answers, correctCount: 3 })
    localStorage.setItem('sq_stars', '[]')

    expect(settleQuiz()).toBe('settled')

    const state = readResults()
    expect(Object.keys(state)).toHaveLength(6)
    for (const q of questions.slice(0, 6)) expect(state[q.id]).toHaveLength(1)
    for (const q of questions.slice(6)) expect(state[q.id]).toBeUndefined()
  })

  it('AC-R27-2-3 in_progress 已答 5 题（2 对 / 2 错 / 1 不会）abandonQuiz → 已作答题写入、未作答无记录、sq_session 删除、sq_stars 不变、随后 settleQuiz 返回 redirect', () => {
    const questions = makePool(10)
    const answers = [
      { questionId: questions[0].id, selectedIndex: 0, correct: true },
      { questionId: questions[1].id, selectedIndex: 2, correct: true },
      { questionId: questions[2].id, selectedIndex: 1, correct: false },
      { questionId: questions[3].id, selectedIndex: 3, correct: false },
      { questionId: questions[4].id, selectedIndex: null, correct: false },
    ]
    seedSession({ currentIndex: 5, answers, correctCount: 2 })
    localStorage.setItem('sq_stars', JSON.stringify(threeStars))
    const starsBefore = localStorage.getItem('sq_stars')

    abandonQuiz()

    const state = readResults()
    expect(state[questions[0].id][0].outcome).toBe('correct')
    expect(state[questions[1].id][0].outcome).toBe('correct')
    expect(state[questions[2].id][0].outcome).toBe('wrong')
    expect(state[questions[3].id][0].outcome).toBe('wrong')
    expect(state[questions[4].id][0].outcome).toBe('skipped')
    for (const q of questions.slice(0, 5)) expect(state[q.id]).toHaveLength(1)
    for (const q of questions.slice(5)) expect(state[q.id]).toBeUndefined()
    expectSharedIsoTimestamp(questions.slice(0, 5).flatMap((q) => state[q.id].map((r) => r.timestamp)))
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(localStorage.getItem('sq_stars')).toBe(starsBefore)
    expect(settleQuiz()).toBe('redirect')
  })

  it('AC-R27-2-4 无 sq_session（或 in_progress）settleQuiz → 返回 redirect 且 sq_question_results 不变', () => {
    const preset: QuestionResultsState = { q_000: [{ outcome: 'correct', timestamp: '2026-01-01T00:00:00.000Z' }] }
    localStorage.setItem(RESULTS_KEY, JSON.stringify(preset))

    expect(settleQuiz()).toBe('redirect')
    expect(localStorage.getItem(RESULTS_KEY)).toBe(JSON.stringify(preset))

    seedSession({ status: 'in_progress' })
    expect(settleQuiz()).toBe('redirect')
    expect(localStorage.getItem(RESULTS_KEY)).toBe(JSON.stringify(preset))
  })

  it('AC-R27-2-5 首次 settled 后再次 settleQuiz → 返回 idempotent 且本轮每题记录数与首次结算后相等（不二次追加）', () => {
    const questions = makePool(10)
    const answers = questions.map((q, i) => ({ questionId: q.id, selectedIndex: i < 7 ? 0 : null, correct: i < 7 }))
    seedSession({ status: 'pending', score: 7, earnedStars: 7, currentIndex: 10, answers, correctCount: 7 })
    localStorage.setItem('sq_stars', '[]')

    expect(settleQuiz()).toBe('settled')
    const afterFirst = localStorage.getItem(RESULTS_KEY)
    for (const q of questions) expect(readResults()[q.id]).toHaveLength(1)

    expect(settleQuiz()).toBe('idempotent')
    expect(localStorage.getItem(RESULTS_KEY)).toBe(afterFirst)
  })

  it('AC-R27-2-6 已有 5 条记录（t1 最旧在 index 4 … t5 最新在 index 0）写入 t6 → 仍 5 条：index 0 = t6、t1 丢弃、t2~t5 依次位于 index 1~4', () => {
    const t = (n: number) => `2026-01-01T00:00:0${n}.000Z`
    const history = [t(5), t(4), t(3), t(2), t(1)] // index 0 = t5 最新 … index 4 = t1 最旧
    localStorage.setItem(
      RESULTS_KEY,
      JSON.stringify({
        q_000: history.map((timestamp, i) => ({ outcome: i % 2 === 0 ? 'correct' : 'wrong', timestamp })),
      }),
    )
    const questions = makePool(10)
    const answers = questions.map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true }))
    seedSession({ status: 'pending', score: 10, earnedStars: 13, currentIndex: 10, answers, correctCount: 10 })
    localStorage.setItem('sq_stars', '[]')

    settleQuiz()

    const records = readResults().q_000
    expect(records).toHaveLength(5)
    expect(records[0].timestamp).toMatch(ISO_RE)
    expect(history).not.toContain(records[0].timestamp) // t6 为新时刻
    expect(records.slice(1).map((r) => r.timestamp)).toEqual([t(5), t(4), t(3), t(2)])
  })

  it('AC-R27-2-7 无记录的题结算写入 1 条 → questionId 键被创建、数组长度 1、新记录位于 index 0', () => {
    expect(localStorage.getItem(RESULTS_KEY)).toBeNull()
    const questions = makePool(10)
    const answers = questions.map((q, i) => ({ questionId: q.id, selectedIndex: i === 0 ? 1 : 0, correct: i !== 0 }))
    seedSession({ status: 'pending', score: 9, earnedStars: 9, currentIndex: 10, answers, correctCount: 9 })
    localStorage.setItem('sq_stars', '[]')

    settleQuiz()

    const records = readResults()[questions[0].id]
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({ outcome: 'wrong', timestamp: expect.stringMatching(ISO_RE), childId: 'default' })
  })

  it('AC-R27-2-8 abandonQuiz 已执行一次后再调 → sq_question_results 与首次放弃后逐字相等（不重复追加）', () => {
    const questions = makePool(10)
    const answers = questions
      .slice(0, 3)
      .map((q, i) => ({ questionId: q.id, selectedIndex: i === 0 ? null : 0, correct: i !== 0 }))
    seedSession({ currentIndex: 3, answers, correctCount: 2 })

    abandonQuiz()
    const afterFirst = localStorage.getItem(RESULTS_KEY)
    expect(Object.keys(readResults())).toHaveLength(3)

    abandonQuiz()

    expect(localStorage.getItem(RESULTS_KEY)).toBe(afterFirst)
    expect(localStorage.getItem('sq_session')).toBeNull()
  })
})

// ===== AC-R27-3 数据版本迁移 4 → 5 =====

describe('AC-R27-3 数据版本迁移 4 → 5', () => {
  it('AC-R27-3-1 版本 "4" + 既有 7 键数据 → sq_question_results 为 {}、版本变 "8"（#69 起迁移链终值，链上 7→8 红旗瘦身）、7 键 JSON 逐键相等', () => {
    const before = seedVersion4Data()

    initAppState()

    expect(localStorage.getItem(RESULTS_KEY)).toBe('{}')
    expect(localStorage.getItem('sq_proposals')).toBe('[]')
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    // #176（happy-dom 起 URL.createObjectURL 可用）：迁移备份导出真实成功，
    // 按 D6 契约（任一导出成功 → 写 exportedAt）刷新 sq_last_export 为新 ISO；
    // 其余 6 键仍逐字不动（jsdom 时代备份静默失败才呈现 7 键全不动）。
    expectVersion9Data(before)
    expect(JSON.parse(localStorage.getItem('sq_last_export') as string)).toMatch(ISO_RE)
  })

  it('AC-R27-3-2 版本 "4" + sq_question_results 已存在（迁移中断重跑）→ 预置记录原样保留、版本写到位', () => {
    seedVersion4Data()
    const preset: QuestionResultsState = {
      '000001': [{ outcome: 'wrong', timestamp: '2026-01-01T00:00:00.000Z' }],
    }
    localStorage.setItem(RESULTS_KEY, JSON.stringify(preset))

    initAppState()

    expect(JSON.parse(localStorage.getItem(RESULTS_KEY)!)).toEqual({ '000001': preset['000001'].map((r) => ({ ...r, childId: 'default' })) })
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('AC-R27-3-3 版本 "4" → 版本号写入前 downloadDataExport 与 downloadLedgerExport 各被调用 1 次（备份先于迁移落盘）', () => {
    stubDownload()
    seedVersion4Data()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    initAppState()

    expect(mockedDownloadData).toHaveBeenCalledTimes(1)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(1)
    const versionWriteIdx = setItemSpy.mock.calls.findIndex(
      ([k, v]) => k === 'sq_data_version' && v === '9',
    )
    expect(versionWriteIdx).toBeGreaterThanOrEqual(0)
    const versionOrder = setItemSpy.mock.invocationCallOrder[versionWriteIdx]
    expect(mockedDownloadData.mock.invocationCallOrder[0]).toBeLessThan(versionOrder)
    expect(mockedDownloadLedger.mock.invocationCallOrder[0]).toBeLessThan(versionOrder)
    setItemSpy.mockRestore()
  })

  it('AC-R27-3-4 全新安装 → sq_data_version 直接写当前版本，两个备份导出均未被调用', () => {
    stubDownload()

    initAppState()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
  })

  it('AC-R27-3-5 版本 "5" 但 sq_question_results 缺失 → 兜底补 {}，其余键逐字不动（版本 "5" 属旧版本，链上补齐后续迁移）', () => {
    const before = seedVersion4Data()
    localStorage.setItem('sq_data_version', '5')
    localStorage.removeItem(RESULTS_KEY) // 版本 5 但新键缺失

    initAppState()

    expect(localStorage.getItem(RESULTS_KEY)).toBe('{}')
    expect(localStorage.getItem('sq_proposals')).toBe('[]')
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    // 同 AC-R27-3-1：sq_last_export 由备份导出按 D6 契约刷新（#176 happy-dom），其余 6 键逐字不动。
    expectVersion9Data(before)
    expect(JSON.parse(localStorage.getItem('sq_last_export') as string)).toMatch(ISO_RE)
  })
})

// ===== AC-R27-4 导出扩展 =====

describe('AC-R27-4 导出扩展', () => {
  it('AC-R27-4-1 数据包导出（家长页导出按钮同源函数）：2 题共 8 条记录 → version "2.0"（R36 学习文件）且 questionResults 与 localStorage 当前值逐字相等', async () => {
    writeQuestions(makePool(2))
    writeRewards([{ id: 'r1', name: '菠萝油', price: 5 }])
    const results: QuestionResultsState = { qA: resultRecords(5, 'correct'), qB: resultRecords(3, 'wrong') }
    writeQuestionResults(results)
    stubDownload()

    downloadDataExport(new Date(2026, 7, 25, 12, 0, 0))

    const exported = JSON.parse(await readBlobText(capturedBlob!)) as LearningExport
    expect(exported.version).toBe('3.0')
    expect(exported.questionResults).toEqual({
      qA: results.qA.map((r) => ({ ...r, childId: 'default' })),
      qB: results.qB.map((r) => ({ ...r, childId: 'default' })),
    })
    expect(localStorage.getItem(RESULTS_KEY)).toBe(JSON.stringify(results))
    expect(Object.values(exported.questionResults).reduce((n, arr) => n + arr.length, 0)).toBe(8)
    // R36 REQ-R36-1：学习文件不含经济字段
    expect('rewards' in exported).toBe(false)
    expect('proposals' in exported).toBe(false)
  })

  it('AC-R27-4-2 流水包导出（R36 经济文件）：version "2.2"（R32 REQ-R32-8-1 起 2.1，#75 R-72-3 升 2.2）+ proposals = sq_proposals 全量（本用例空态 []）且 JSON 中无 questionResults / 学习字段', async () => {
    writeStars(threeStars)
    stubDownload()

    downloadLedgerExport(new Date(2026, 7, 25, 12, 0, 0))

    const exported = JSON.parse(await readBlobText(capturedBlob!)) as Record<string, unknown>
    expect(exported.version).toBe('2.4')
    expect(exported.proposals).toEqual([])
    expect(exported.activeRedemptions).toEqual([])
    expect('questionResults' in exported).toBe(false)
    expect('questionPool' in exported).toBe(false)
  })
})

// ===== AC-R27-5 导入兼容与覆盖（家长页完整导入链路） =====

/** 合法 2.0 学习文件文本（R36：LearningExport——题池 + 红旗 + 答题记录；默认可覆盖字段） */
function dataFileText(opts: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: '2026-08-25T00:00:00.000Z',
    questionPool: [
      { id: '000001', type: 'zh2en', prompt: '苹果', options: ['apple', 'banana', 'cat', 'dog'], answerIndex: 0, wordId: 'apple' },
      { id: '000002', type: 'en2zh', prompt: 'cat', options: ['猫', '狗', '鸟', '鱼'], answerIndex: 0, wordId: 'cat' },
    ],
    flagged: {},
    questionResults: {},
    ...opts,
  })
}

describe('AC-R27-5 导入兼容与覆盖', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('AC-R27-5-1（R36 断代更新，AC-R36-3-1 同款）version "1.1" 旧文件 → 导入被拒绝、提示「文件版本过旧，请用最新版重新导出」、全部数据键逐字不变', async () => {
    initAppState()
    writeQuestions(makePool(1, 50))
    writeRewards([{ id: 'old', name: '旧奖励', price: 1 }])
    writeQuestionResults({ local_q: [{ outcome: 'correct', timestamp: '2026-01-01T00:00:00.000Z' }] })
    writeFlagged({ '000001': { flaggedAt: 111 } })
    writeStars(threeStars)
    const before: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) before[key] = localStorage.getItem(key) as string
    }
    await router.replace('/parent')
    wrapper = await mountParentApp()
    await openDataModal(wrapper)

    const input = wrapper.get('.file-input')
    const file = new File([dataFileText({ version: '1.1' })], 'old.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    stubFileRead(dataFileText({ version: '1.1' }))
    await input.trigger('change')
    FileReader.prototype.readAsText = originalReadAsText
    await flushPromises()

    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    const err = wrapper.find('.import-error')
    expect(err.exists()).toBe(true)
    // #172：「版本不支持」档共用户文案
    expect(err.text()).toBe(copy.parent.importFailChecked)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) expect(localStorage.getItem(key)).toBe(before[key])
    }
    for (const key of Object.keys(before)) expect(localStorage.getItem(key)).toBe(before[key])
  })

  it('AC-R27-5-2 version "1.2" 文件：题 A（在新题池，5 条）保留逐字、孤儿题 B（不在新题池，3 条）被清理', async () => {
    initAppState()
    const fileResults: QuestionResultsState = {
      '000001': resultRecords(5, 'correct'),
      '999999': resultRecords(3, 'wrong'),
    }
    await router.replace('/parent')
    wrapper = await mountParentApp()
    await openDataModal(wrapper)

    await importDataFile(wrapper, dataFileText({ questionResults: fileResults }))

    const after = readQuestionResults()
    expect(Object.keys(after)).toEqual(['000001'])
    const upgraded = fileResults['000001'].map((r) => ({ ...r, childId: 'default' }))
    expect(after['000001']).toEqual(upgraded)
    expect(JSON.stringify(after['000001'])).toBe(JSON.stringify(upgraded))
  })

  it('AC-R27-5-3 version "1.2" 文件 questionResults 类型非法（某题值非数组对象）→ 整文件拒绝、本地全部数据逐字不变', async () => {
    initAppState()
    writeQuestions(makePool(1, 60))
    writeRewards([{ id: 'keep', name: '保留奖励', price: 2 }])
    writeQuestionResults({ keep_q: [{ outcome: 'skipped', timestamp: '2026-02-01T00:00:00.000Z' }] })
    writeFlagged({ '000001': { flaggedAt: 333 } })
    writeStars(threeStars)
    const before: Record<string, string> = {}
    for (const key of ['sq_questions', 'sq_rewards', RESULTS_KEY, 'sq_flagged', 'sq_stars']) {
      before[key] = localStorage.getItem(key) as string
    }
    await router.replace('/parent')
    wrapper = await mountParentApp()
    await openDataModal(wrapper)

    const input = wrapper.get('.file-input')
    const file = new File([dataFileText({ questionResults: { '000001': { outcome: 'correct' } } })], 'bad.json', {
      type: 'application/json',
    })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    stubFileRead(dataFileText({ questionResults: { '000001': { outcome: 'correct' } } }))
    await input.trigger('change')
    FileReader.prototype.readAsText = originalReadAsText
    await flushPromises()

    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    const err = wrapper.find('.import-error')
    expect(err.exists()).toBe(true)
    // #172：「校验不过」档共用户文案
    expect(err.text()).toBe(copy.parent.importFailChecked)
    for (const [key, value] of Object.entries(before)) {
      expect(localStorage.getItem(key)).toBe(value)
    }
  })
})
