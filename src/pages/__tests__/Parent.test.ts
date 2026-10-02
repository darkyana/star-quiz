/**
 * T5 家长页骨架单测（Spec §4 REQ-1，AC1-4 / AC1-5 / AC1-6）
 * T6 数据管理弹窗（Spec §4 REQ-3，AC3-1 ~ AC3-13）
 * 标题「家长页」保留（routeContract 契约行）；返回孩子端无确认；双入口按钮同 class 同权重（V1）。
 * 导入流程：file input → FileReader（stub）→ validateDataImport → 失败原子拒绝 / 成功二次确认 → 全量覆盖。
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Parent from '../Parent.vue'
import Home from '../Home.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState, readLastExport, writeLastExport } from '../../composables/useDataInfra'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import {
  questions as readQuestions,
  writeQuestions,
  questionResults as readQuestionResults,
  writeQuestionResults,
} from '../../composables/useLearningData'
import {
  rewards as readRewards,
  writeRewards,
  ledger as readStars,
  writeLedger as writeStars,
} from '../../composables/useStarData'
import { proposals as readProposals, writeProposals } from '../../composables/useProposals'
import type { Question, RewardItem, StarEntry, ProposalRecord } from '../../types'

function makeQuestion(id: string): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: id, category: '学科', book: '默认' }
}

function makeReward(id: string, name = '奖励', price = 3): RewardItem {
  return { id, name, price }
}

/** R32 经济文件（EconomyExport 2.1）提议元素：落盘口径 ProposalRecord（12 字段，无派生 publishState） */
function makeProposalRecord(id: string, name = '提议', price = 5): ProposalRecord {
  return {
    id,
    name,
    price,
    status: 'discussing',
    createdAt: 1724230000000,
    updatedAt: 1724230000000,
    description: '说明文字',
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    childId: 'default',
  }
}

/** R36 学习文件（LearningExport 2.0）：version/exportedAt/questionPool/flagged/questionResults；opts.rewards 为多余字段（学习导入忽略） */
function dataFileText(
  opts: { questionPool?: unknown[]; rewards?: unknown[]; version?: unknown; questionResults?: unknown; flagged?: unknown } = {},
): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: '2026-08-27T10:30:00.000Z',
    questionPool: [makeQuestion('q1'), makeQuestion('q2'), makeQuestion('q3')],
    flagged: {},
    questionResults: {},
    ...(opts.questionPool !== undefined ? { questionPool: opts.questionPool } : {}),
    ...(opts.rewards !== undefined ? { rewards: opts.rewards } : {}),
    ...(opts.version !== undefined ? { version: opts.version } : {}),
    ...(opts.questionResults !== undefined ? { questionResults: opts.questionResults } : {}),
    ...(opts.flagged !== undefined ? { flagged: opts.flagged } : {}),
  })
}

/** R36 经济文件（EconomyExport 2.0）：version/exportedAt/rewards/proposals/starLedger */
function ledgerFileText(opts: { starLedger?: unknown[]; version?: unknown; proposals?: unknown } = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: '2026-08-27T10:30:00.000Z',
    rewards: [makeReward('er1', '经济兑换', 4)],
    proposals: [],
    starLedger: [
      { id: 'l1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星' },
      { id: 'l2', timestamp: 1724230000100, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
    ],
    ...(opts.starLedger !== undefined ? { starLedger: opts.starLedger } : {}),
    ...(opts.version !== undefined ? { version: opts.version } : {}),
    ...(opts.proposals !== undefined ? { proposals: opts.proposals } : {}),
  })
}

let createObjectURLSpy: ReturnType<typeof vi.fn> | undefined
let capturedBlob: Blob | null = null
let capturedFilename = ''

// 显式保存原始方法：连续 spyOn 会叠加 mock（后建 spy 的"原值"是前一 mock），
// mockRestore 无法逐层还原，故 afterEach 直接赋回原始引用（防跨测试泄漏）。
const originalReadAsText = FileReader.prototype.readAsText
const originalAnchorClick = HTMLAnchorElement.prototype.click

/** stub FileReader：设置 result 并触发 onload（Spec §4 测试执行环境口径） */
function stubFileRead(text: string): void {
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'result', { value: text, configurable: true })
    this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
  })
}

/** stub FileReader：触发 onerror（文件读取失败，AC3-13） */
function stubFileReadError(): void {
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
  })
}

/** stub 下载：URL.createObjectURL spy + 捕获 a.download（jsdom 无真实下载） */
function stubDownload(): void {
  capturedBlob = null
  capturedFilename = ''
  createObjectURLSpy = vi.fn((b: Blob) => {
    capturedBlob = b
    return 'blob:mock-url'
  })
  vi.stubGlobal('URL', { createObjectURL: createObjectURLSpy, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    capturedFilename = this.download
  })
}

/** jsdom 25 的 Blob 无 .text()，用 FileReader 读取 */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function mountParent(): Promise<VueWrapper> {
  const wrapper = mount(Parent, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

async function openDataModal(wrapper: VueWrapper): Promise<void> {
  const buttons = wrapper.findAll('button')
  const dataBtn = buttons.find((b) => b.text() === '数据管理')
  expect(dataBtn).toBeDefined()
  await dataBtn!.trigger('click')
}

async function openLedgerModal(wrapper: VueWrapper): Promise<void> {
  const buttons = wrapper.findAll('button')
  const ledgerBtn = buttons.find((b) => b.text() === '流水管理')
  expect(ledgerBtn).toBeDefined()
  await ledgerBtn!.trigger('click')
}

async function selectFile(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.get('.file-input')
  const file = new File([text], 'import.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  stubFileRead(text)
  await input.trigger('change')
  // stub 同步触发 onload 后立即还原，防连续 selectFile 的 spy 叠加（mockRestore 无法逐层还原）
  FileReader.prototype.readAsText = originalReadAsText
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  window.location.hash = '#/parent'
  router.replace('/parent')
})

/** R21（D6）：数据确认弹窗确认按钮点击路径 → 点「导入并重置」（覆盖模式 = 既有确认语义） */
async function clickImportOverwrite(wrapper: VueWrapper): Promise<void> {
  const btn = wrapper.findAll('button').find((b) => b.text() === '导入并重置')
  expect(btn).toBeDefined()
  await btn!.trigger('click')
}

/** R21：数据确认弹窗点「导入并追加」（追加模式） */
async function clickImportAppend(wrapper: VueWrapper): Promise<void> {
  const btn = wrapper.findAll('button').find((b) => b.text() === '导入并追加')
  expect(btn).toBeDefined()
  await btn!.trigger('click')
}

/** R21：四数据键快照（AC-R21-1-2/1-3/1-4/2-6 断言口径 = localStorage 原始字符串逐字节比对） */
function snapshotDataKeys(): Record<'questions' | 'rewards' | 'questionResults' | 'flagged', string | null> {
  return {
    questions: localStorage.getItem('sq_questions'),
    rewards: localStorage.getItem('sq_rewards'),
    questionResults: localStorage.getItem('sq_question_results'),
    flagged: localStorage.getItem('sq_flagged'),
  }
}

/** R21：预置四键非空基线（记录 / 红旗形状照数据模型：questionId → {flaggedAt} / 三态+ISO 时间戳） */
function seedDataKeys(): void {
  writeQuestions([makeQuestion('000001')])
  writeRewards([makeReward('old', '旧兑换', 9)])
  localStorage.setItem(
    'sq_question_results',
    JSON.stringify({ '000001': [{ outcome: 'correct', timestamp: '2026-08-20T10:00:00.000Z' }] }),
  )
  localStorage.setItem(
    'sq_flagged',
    JSON.stringify({ '000001': { flaggedAt: '2026-08-20T10:00:00.000Z' } }),
  )
}

afterEach(() => {
  vi.useRealTimers()
  FileReader.prototype.readAsText = originalReadAsText
  HTMLAnchorElement.prototype.click = originalAnchorClick
  vi.unstubAllGlobals()
})

describe('AC1-4 家长页标识与标题', () => {
  it('可见文本「返回」与「家长页」（#38：返回文案全局统一为 copy.back，页面标题契约保留）', async () => {
    const wrapper = await mountParent()
    const text = wrapper.get('[data-page="parent"]').text()
    expect(text).toContain('家长页')
    expect(text).toContain(copy.back)
  })
})

describe('AC1-5 返回孩子端无确认', () => {
  it('点击「返回」（.btn-back-child，StarButtonStandard）→ 路由 / 且无 .confirm-modal 出现', async () => {
    const wrapper = await mountParent()
    await wrapper.get('.btn-back-child').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
  })
})

describe('AC1-6 家长页操作区按钮（#38：StarButtonStandard standard×large 统一，6 按钮同权重；组件库已降级为链接，#136 增出题指令入口，#132 增家庭管理入口，#323 增「给家长的话」归档入口）', () => {
  it('.btn-data-manage 文本「数据管理」、.btn-ledger-manage 文本「流水管理」；均为 star-button--standard × large', async () => {
    const wrapper = await mountParent()
    const buttons = wrapper.findAll('.parent-actions button')
    // #323：5→6（末位新增「给家长的话」同权重主按钮）
    expect(buttons).toHaveLength(6)
    for (const b of buttons) {
      expect(b.classes()).toContain('star-button--standard')
      expect(b.classes()).toContain('star-button--large')
    }
    const dataBtn = buttons.find((b) => b.text() === '数据管理')
    const ledgerBtn = buttons.find((b) => b.text() === '流水管理')
    expect(dataBtn?.classes()).toContain('btn-data-manage')
    expect(ledgerBtn?.classes()).toContain('btn-ledger-manage')
  })
})

describe('AC3 数据管理弹窗（T6，AC3-1 ~ AC3-13）', () => {
  it('AC3-1 弹窗打开与内容：标题/说明/导出/导入/关闭按钮', async () => {
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    // #59：弹窗收编 StarModalStandard，选择器迁到组件类名（断言意图不变）
    const modal = wrapper.get('.star-modal')
    expect(modal.find('.star-modal__title').text()).toBe('数据管理')
    expect(modal.text()).toContain('管理题库和兑换项数据')
    expect(modal.find('.btn-export').text()).toBe('导出')
    expect(modal.find('.btn-import').text()).toBe('导入')
    expect(modal.find('.star-modal__close').attributes('aria-label')).toBe('关闭')
  })

  it('AC3-2 导出：Blob 内容 = LearningExport（R36 2.0）+ 文件名匹配 + writeLastExport', async () => {
    writeQuestions([makeQuestion('q1'), makeQuestion('q2')])
    writeRewards([makeReward('r1', '菠萝油', 5)])
    const now = new Date(2026, 7, 21, 18, 30, 0)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    stubDownload()
    try {
      const wrapper = await mountParent()
      await openDataModal(wrapper)
      await wrapper.get('.btn-export').trigger('click')
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      expect(capturedFilename).toMatch(/^star-quiz-learning-\d{8}-\d{6}\.json$/)
      const text = await readBlobText(capturedBlob!)
      // R36 REQ-R36-1：学习文件五字段，不含 rewards / proposals / starLedger；前缀 star-quiz-learning-（自主决策 #2）
      expect(JSON.parse(text)).toEqual({
        version: '3.0',
        exportedAt: now.toISOString(),
        questionPool: [makeQuestion('q1'), makeQuestion('q2')],
        flagged: {},
        questionResults: {},
      })
      expect(readLastExport()).toBe(now.toISOString())
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC3-3 导入合法：二次确认计数文案（R36「本次导入将写入 3 题」）+ 确认后题库/记录覆盖（D6：sq_rewards 不变）+ 导入成功', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    const confirm = wrapper.find('.confirm-modal')
    expect(confirm.exists()).toBe(true)
    // R36 REQ-R36-6：数据管理确认弹窗展示文件题数计数（格式「N 题」）
    expect(confirm.text()).toContain('本次导入将写入 3 题')
    expect(confirm.find('.confirm-cancel').text()).toBe('取消')
    expect(confirm.text()).toContain('导入并重置')
    expect(confirm.text()).toContain('导入并追加')
    await clickImportOverwrite(wrapper)
    // R24 REQ-R24-1-4：导入时无 difficulty 的题物理补 3（期望值随行为同步）
    expect(readQuestions()).toEqual([
      { ...makeQuestion('q1'), difficulty: 3 },
      { ...makeQuestion('q2'), difficulty: 3 },
      { ...makeQuestion('q3'), difficulty: 3 },
    ])
    // R36（D6 有意变更）：数据管理导入学习文件，sq_rewards 不变
    expect(readRewards()).toEqual([makeReward('old')])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
  })

  it('AC3-4 取消导入：数据不变、无导入成功', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await wrapper.find('.confirm-cancel').trigger('click')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
    expect(wrapper.find('.import-success').exists()).toBe(false)
  })

  it('AC3-5 非法 JSON 原子拒绝：无确认弹窗、.import-error 为「文件坏」档共用户文案、数据不变', async () => {
    const beforeQ = [makeQuestion('old')]
    writeQuestions(beforeQ)
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, '{invalid')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    const err = wrapper.find('.import-error')
    expect(err.exists()).toBe(true)
    // #172 两档文案：非法 JSON = 文件坏档，前三类共用「文件未通过检查，没有写入任何数据」
    expect(err.text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual(beforeQ)
  })

  it('AC3-6 学习文件缺 questionResults 字段原子拒绝（R36：2.0 缺字段即非法）', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    const { questionResults: _omit, ...rest } = JSON.parse(dataFileText())
    await selectFile(wrapper, JSON.stringify(rest))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
  })

  it('AC3-7 1.x 版本断代拒绝：文件版本过旧（R36 REQ-R36-3；#172 归「版本不支持」档共用户文案）', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ version: '1.0' }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual([makeQuestion('old')])
  })

  it('AC3-8 条目非法原子拒绝：questionPool 第 2 条 answerIndex', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    const bad = [makeQuestion('q1'), { ...makeQuestion('q2'), answerIndex: '1' }]
    await selectFile(wrapper, dataFileText({ questionPool: bad }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
  })

  it('AC3-9 成功导入不触碰其他键：sq_stars / sq_session / sq_last_export 均不变', async () => {
    const stars: StarEntry[] = [
      { id: 's1', timestamp: 1, type: 'earn', amount: 3, source: '答题得星' },
      { id: 's2', timestamp: 2, type: 'earn', amount: 2, source: '满分奖励' },
      { id: 's3', timestamp: 3, type: 'redeem', amount: 1, source: '兑换：菠萝油' },
    ]
    writeStars(stars)
    const session = { quizId: 'x', status: 'in_progress' }
    localStorage.setItem('sq_session', JSON.stringify(session))
    writeLastExport('2026-08-21T00:00:00.000Z')
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await clickImportOverwrite(wrapper)
    expect(readStars()).toEqual(stars)
    expect(localStorage.getItem('sq_session')).toBe(JSON.stringify(session))
    // #172 口径变化：导入本身不写 sq_last_export（D6），但未配对设备导入确认前的自动全量备份
    // （本测试环境无 sq_device_credential）是导出动作、按 D6 写入 exportedAt → 值不再是导入前的旧时间戳
    expect(readLastExport()).not.toBe('2026-08-21T00:00:00.000Z')
  })

  it('AC3-10 点击 .star-modal__close 关闭弹窗且数据无变化', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await wrapper.get('.star-modal__close').trigger('click')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC3-11 空数组文件合法：题库清空语义 + 导入成功（R36 D6：sq_rewards 不变）', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [], rewards: [] }))
    await clickImportOverwrite(wrapper)
    expect(readQuestions()).toEqual([])
    expect(readRewards()).toEqual([makeReward('old')])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC3-12 失败后可再次导入恢复：提示区在新导入开始时清除', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, '{invalid')
    expect(wrapper.find('.import-error').exists()).toBe(true)
    await selectFile(wrapper, dataFileText({ questionPool: [makeQuestion('new')], rewards: [makeReward('new')] }))
    await clickImportOverwrite(wrapper)
    expect(readQuestions()).toEqual([{ ...makeQuestion('new'), difficulty: 3 }])
    // R36 D6：数据导入不再改写 sq_rewards，维持导入前值
    expect(readRewards()).toEqual([makeReward('old')])
    expect(wrapper.find('.import-error').exists()).toBe(false)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC3-13 文件读取失败（FileReader onerror）原子拒绝', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    const input = wrapper.get('.file-input')
    const file = new File(['x'], 'import.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    stubFileReadError()
    await input.trigger('change')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // #172：文件读取失败归「文件坏」档共用户文案
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })
})

describe('R27→R36 数据导入 questionResults 覆盖（AC-R27-5-1 / AC-R27-5-2，2.0 化）', () => {
  it("AC-R27-5-1 2.0 文件 questionResults 为空对象 → 导入成功且 sq_question_results 覆盖为 {}", async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    localStorage.setItem(
      'sq_question_results',
      JSON.stringify({ old: [{ outcome: 'correct', timestamp: '2026-08-20T10:00:00.000Z' }] }),
    )
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionResults: {} }))
    await clickImportOverwrite(wrapper)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    expect(localStorage.getItem('sq_question_results')).toBe('{}')
  })

  it("AC-R27-5-2 2.0 文件导入：sq_question_results 全量替换为文件值（题在逐字保留 + 孤儿清理）", async () => {
    const five = [
      { outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' },
      { outcome: 'wrong', timestamp: '2026-08-24T10:00:00.000Z' },
      { outcome: 'skipped', timestamp: '2026-08-23T10:00:00.000Z' },
      { outcome: 'correct', timestamp: '2026-08-22T10:00:00.000Z' },
      { outcome: 'correct', timestamp: '2026-08-21T10:00:00.000Z' },
    ]
    const three = [
      { outcome: 'wrong', timestamp: '2026-08-25T09:00:00.000Z' },
      { outcome: 'wrong', timestamp: '2026-08-24T09:00:00.000Z' },
      { outcome: 'skipped', timestamp: '2026-08-23T09:00:00.000Z' },
    ]
    localStorage.setItem(
      'sq_question_results',
      JSON.stringify({ old: [{ outcome: 'wrong', timestamp: '2026-08-20T09:00:00.000Z' }] }),
    )
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    // dataFileText 题池为 q1/q2/q3：q1 在新题池（保留），orphan 不在（清理）
    await selectFile(wrapper, dataFileText({ questionResults: { q1: five, orphan: three } }))
    await clickImportOverwrite(wrapper)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    const upgraded = five.map((r) => ({ ...r, childId: 'default' }))
    expect(readQuestionResults()).toEqual({ q1: upgraded })
    expect(localStorage.getItem('sq_question_results')).toBe(JSON.stringify({ q1: upgraded }))
  })
})

// R36（REQ-R36-4）：学习文件覆盖模式三键整体替换（含 sq_flagged）；追加模式只动题库
describe('R36 学习文件双模式写入（AC-R36-4-1 / AC-R36-4-2）', () => {
  it('AC-R36-4-1 覆盖：sq_questions / sq_flagged / sq_question_results 整体替换为文件值，sq_rewards 不变', async () => {
    writeQuestions([makeQuestion('000001')])
    writeRewards([makeReward('old')])
    localStorage.setItem(
      'sq_flagged',
      JSON.stringify({ '000001': { flaggedAt: 1724100000000 } }),
    )
    const fileFlagged = { q2: { flaggedAt: 1724200000000 } }
    const fileResults = { q2: [{ outcome: 'wrong', timestamp: '2026-08-26T10:00:00.000Z' }] }
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ flagged: fileFlagged, questionResults: fileResults }))
    await clickImportOverwrite(wrapper)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    // 三键整体替换：flagged 覆盖为文件值（旧红旗清除）
    expect(JSON.parse(localStorage.getItem('sq_flagged')!)).toEqual({ q2: { ...fileFlagged.q2, childId: 'default' } })
    expect(JSON.parse(localStorage.getItem('sq_question_results')!)).toEqual({ q2: fileResults.q2.map((r) => ({ ...r, childId: 'default' })) })
    expect(readQuestions().map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
    expect(readRewards()).toEqual([makeReward('old')])
  })

  it('AC-R36-4-2 追加：只增量追加题库，flagged / questionResults / rewards 均不动', async () => {
    writeQuestions([makeQuestion('000001')])
    writeRewards([makeReward('old')])
    localStorage.setItem(
      'sq_flagged',
      JSON.stringify({ '000001': { flaggedAt: 1724100000000 } }),
    )
    localStorage.setItem(
      'sq_question_results',
      JSON.stringify({ '000001': [{ outcome: 'correct', timestamp: '2026-08-20T10:00:00.000Z' }] }),
    )
    const beforeFlagged = localStorage.getItem('sq_flagged')
    const beforeResults = localStorage.getItem('sq_question_results')
    const fileFlagged = { q2: { flaggedAt: 1724200000000 } }
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ flagged: fileFlagged }))
    await clickImportAppend(wrapper)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    // 追加仅题库：三键逐字节不变
    expect(localStorage.getItem('sq_flagged')).toBe(beforeFlagged)
    expect(localStorage.getItem('sq_question_results')).toBe(beforeResults)
    expect(readRewards()).toEqual([makeReward('old')])
    expect(readQuestions().map((q) => q.id)).toEqual(['000001', '000002', '000003', '000004'])
  })
})

describe('AC4 流水管理弹窗（T7，AC4-1 ~ AC4-9）', () => {
  it('AC4-1 弹窗打开与内容：标题/说明/导出/导入按钮', async () => {
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    // #59：弹窗收编 StarModalStandard，选择器迁到组件类名（断言意图不变）
    const modal = wrapper.get('.star-modal')
    expect(modal.find('.star-modal__title').text()).toBe('流水管理')
    expect(modal.text()).toContain('管理星星收支流水')
    expect(modal.find('.btn-export').text()).toBe('导出')
    expect(modal.find('.btn-import').text()).toBe('导入')
  })

  it('AC4-2 导出：Blob 内容 = EconomyExport（R32 起 2.1，#75 起升 2.2）+ 文件名匹配 + writeLastExport', async () => {
    writeRewards([makeReward('r1', '菠萝油', 5)])
    writeStars([
      { id: 's1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星' },
      { id: 's2', timestamp: 1724230000100, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
    ])
    const now = new Date(2026, 7, 21, 18, 31, 5)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    stubDownload()
    try {
      const wrapper = await mountParent()
      await openLedgerModal(wrapper)
      await wrapper.get('.btn-export').trigger('click')
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      expect(capturedFilename).toMatch(/^star-quiz-economy-\d{8}-\d{6}\.json$/)
      const text = await readBlobText(capturedBlob!)
      // R32 REQ-R32-8-1：经济文件含 rewards + proposals 全量 + starLedger；#75（R-72-3）：version 升 '2.2' 并携带进行中兑换（本用例空态 []），不含学习字段
      expect(JSON.parse(text)).toEqual({
        version: '2.4',
        exportedAt: now.toISOString(),
        rewards: [makeReward('r1', '菠萝油', 5)],
        proposals: [],
        starLedger: [
          { id: 's1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星', childId: 'default', kind: 'main' },
          { id: 's2', timestamp: 1724230000100, type: 'redeem', amount: 2, source: '兑换：菠萝油', childId: 'default', kind: 'main' },
        ],
        activeRedemptions: [],
      })
      expect(readLastExport()).toBe(now.toISOString())
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC4-3 导入合法：二次确认计数文案（R32「兑换项 M 项 + 提议 P 条 + 流水 K 条」）+ 确认后 sq_rewards 与 sq_stars 整体替换 + 导入成功', async () => {
    writeRewards([makeReward('old')])
    writeStars([{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }])
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    const confirm = wrapper.find('.confirm-modal')
    expect(confirm.exists()).toBe(true)
    // R32（Spec D6 有意变更）：流水管理确认弹窗展示「兑换项 M 项 + 流水 K 条 + 提议 P 条」（ledgerFileText = 1 项 + 2 条 + 0 提议）
    expect(confirm.text()).toContain('本次导入将写入兑换项 1 项 + 流水 2 条 + 提议 0 条')
    expect(confirm.find('.confirm-cancel').text()).toBe('取消')
    expect(confirm.find('.confirm-ok').text()).toBe('确认')
    await confirm.find('.confirm-ok').trigger('click')
    // R36 REQ-R36-5：经济文件覆盖式导入——sq_rewards 与 sq_stars 整体替换为文件值
    expect(readRewards()).toEqual([makeReward('er1', '经济兑换', 4)])
    expect(readStars()).toEqual([
      { id: 'l1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星', childId: 'default', kind: 'main' },
      { id: 'l2', timestamp: 1724230000100, type: 'redeem', amount: 2, source: '兑换：菠萝油', childId: 'default', kind: 'main' },
    ])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
  })

  it('AC4-4 取消导入：sq_stars 与导入前深相等、无导入成功', async () => {
    const before: StarEntry[] = [{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }]
    writeStars(before)
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    await wrapper.find('.confirm-cancel').trigger('click')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readStars()).toEqual(before)
    expect(wrapper.find('.import-success').exists()).toBe(false)
  })

  it('AC4-5 条目非法原子拒绝：starLedger 第 1 条 type=ear', async () => {
    writeStars([{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }])
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    const bad = [{ ...ledgerEntry1(), type: 'ear' }]
    await selectFile(wrapper, ledgerFileText({ starLedger: bad }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // #172 两档文案：字段校验不过共用户文案（内部 reason 不再直出）
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
  })

  it('AC4-6 amount 非法原子拒绝：starLedger 第 2 条 amount=-5', async () => {
    writeStars([{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }])
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    const bad = [ledgerEntry1(), { id: 'l2', timestamp: 1724230000100, type: 'redeem', amount: -5, source: '兑换：x' }]
    await selectFile(wrapper, ledgerFileText({ starLedger: bad }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
  })

  it('AC4-7 经济文件导入不触碰学习键：sq_questions / sq_flagged / sq_question_results 与导入前深相等（R36 REQ-R36-5）', async () => {
    const beforeQ = [makeQuestion('keep1'), makeQuestion('keep2')]
    writeQuestions(beforeQ)
    writeRewards([makeReward('keep', '保留', 9)])
    localStorage.setItem('sq_flagged', JSON.stringify({ keep1: { flaggedAt: 1 } }))
    localStorage.setItem('sq_question_results', JSON.stringify({ keep1: [{ outcome: 'correct', timestamp: '2026-08-20T10:00:00.000Z' }] }))
    const beforeFlagged = localStorage.getItem('sq_flagged')
    const beforeResults = localStorage.getItem('sq_question_results')
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    await wrapper.find('.confirm-ok').trigger('click')
    expect(readQuestions()).toEqual(beforeQ)
    // 学习三键不动；sq_rewards 被经济文件整体替换（AC4-3 已断言）
    expect(localStorage.getItem('sq_flagged')).toBe(beforeFlagged)
    expect(localStorage.getItem('sq_question_results')).toBe(beforeResults)
    expect(readRewards()).toEqual([makeReward('er1', '经济兑换', 4)])
  })

  it('AC4-8 导入后余额实时反映（C2）：返回首页 .balance-chip 为 5', async () => {
    const parent = await mountParent()
    await openLedgerModal(parent)
    await selectFile(parent, ledgerFileText())
    await parent.find('.confirm-ok').trigger('click')
    expect(readStars()).toHaveLength(2)
    parent.unmount()

    window.location.hash = '#/'
    router.replace('/')
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(home.get('.balance-chip .star-value').text()).toBe('5')
    home.unmount()
  })

  it('AC4-9 非法 JSON 原子拒绝：不是合法 JSON、数据不变', async () => {
    const before: StarEntry[] = [{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }]
    writeStars(before)
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, '{bad')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // #172：非法 JSON = 文件坏档共用户文案
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readStars()).toEqual(before)
  })
})

// AC-R21-1-1：确认弹窗双模式按钮渲染（正文含题数、两按钮无 disabled / 选中态）
describe('R21 数据导入模式选择交互（AC-R21-1）', () => {
  it('AC-R21-1-1 校验通过后确认弹窗：正文含题数 3，渲染「导入并重置」与「导入并追加」两按钮，均无 disabled / 选中态', async () => {
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    const confirm = wrapper.get('.confirm-modal')
    // AC-R21-1-1：正文文本包含 3（文件 questionPool 含 3 题）
    expect(confirm.text()).toContain('3')
    const overwrite = wrapper.findAll('button').find((b) => b.text() === '导入并重置')
    const append = wrapper.findAll('button').find((b) => b.text() === '导入并追加')
    expect(overwrite).toBeDefined()
    expect(append).toBeDefined()
    // AC-R21-1-1：均无 disabled
    expect(overwrite!.attributes('disabled')).toBeUndefined()
    expect(append!.attributes('disabled')).toBeUndefined()
    // AC-R21-1-1：均无选中态（两按钮 class 完全一致，无一侧多出 active/selected 类）
    expect(overwrite!.classes().sort()).toEqual(append!.classes().sort())
    // #216 三按钮形态纵向满宽堆叠：确认弹窗 actions 容器挂 stacked 类，按钮从上到下 取消 / 导入并重置 / 导入并追加
    const confirmActions = confirm.get('.star-modal__actions')
    expect(confirmActions.classes()).toContain('star-modal__actions--stacked')
    expect(confirmActions.findAll('button').map((b) => b.text())).toEqual(['取消', '导入并重置', '导入并追加'])
  })

  it('#216 数据管理弹窗三按钮（导出 / 导入 / 粘贴导入）同样纵向堆叠', async () => {
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    const actions = wrapper.get('.star-modal .star-modal__actions')
    expect(actions.classes()).toContain('star-modal__actions--stacked')
    expect(actions.findAll('button').map((b) => b.text())).toEqual(['导出', '导入', '粘贴导入'])
  })

  it('AC-R21-1-2 点击确认弹窗遮罩 .star-modal__scrim：弹窗关闭，四数据键与打开前逐字节相同', async () => {
    seedDataKeys()
    const before = snapshotDataKeys()
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await wrapper.get('.confirm-modal .star-modal__scrim').trigger('click')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // AC-R21-1-2：sq_questions / sq_rewards / sq_question_results / sq_flagged 逐字节相同
    expect(snapshotDataKeys()).toEqual(before)
  })

  it('AC-R21-1-3 按下 Escape：弹窗关闭且四数据键均无写入', async () => {
    seedDataKeys()
    const before = snapshotDataKeys()
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // AC-R21-1-3：同 AC-R21-1-2 断言口径
    expect(snapshotDataKeys()).toEqual(before)
  })

  it('AC-R21-1-4 点击「取消」按钮：弹窗关闭且四数据键均无写入', async () => {
    seedDataKeys()
    const before = snapshotDataKeys()
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await wrapper.get('.confirm-modal .confirm-cancel').trigger('click')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // AC-R21-1-4：同 AC-R21-1-2 断言口径
    expect(snapshotDataKeys()).toEqual(before)
  })

  it('AC-R21-1-5 流水确认弹窗维持「取消」+「确认」（无双模式按钮），点「确认」后 sq_stars 被文件流水整体替换', async () => {
    writeStars([{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }])
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    const confirm = wrapper.get('.confirm-modal')
    // AC-R21-1-5：无「导入并重置」/「导入并追加」
    expect(confirm.text()).not.toContain('导入并重置')
    expect(confirm.text()).not.toContain('导入并追加')
    expect(confirm.findAll('button').map((b) => b.text()).sort()).toEqual(['取消', '确认'])
    await confirm.findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    // AC-R21-1-5：现状回归——sq_stars 被文件流水整体替换
    expect(readStars()).toEqual([
      { id: 'l1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星', childId: 'default', kind: 'main' },
      { id: 'l2', timestamp: 1724230000100, type: 'redeem', amount: 2, source: '兑换：菠萝油', childId: 'default', kind: 'main' },
    ])
  })
})

// AC-R21-2 / AC-R21-3-1 / AC-R21-4：追加模式数据语义、覆盖模式维持现状、校验原子性
describe('R21 追加导入数据语义（AC-R21-2 / AC-R21-3-1 / AC-R21-4）', () => {
  it('AC-R21-2-1 追加：existing 2 题逐字段保留在前，文件题重编号 000011/000012 且六字段与文件逐字段相同', async () => {
    const existing = [makeQuestion('000005'), makeQuestion('000010')]
    writeQuestions(existing)
    writeRewards([makeReward('r0')])
    const fileQ1 = {
      id: '000003', type: 'zh2en', prompt: '苹果的英文是？',
      options: ['apple', 'banana', 'pear', 'grape'], answerIndex: 0, wordId: 'apple', difficulty: 1,
    }
    const fileQ2 = {
      id: '000003', type: 'en2zh', prompt: 'banana 是什么水果？',
      options: ['苹果', '香蕉', '梨', '葡萄'], answerIndex: 1, wordId: 'banana', difficulty: 2,
    }
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [fileQ1, fileQ2] }))
    await clickImportAppend(wrapper)
    const qs = readQuestions()
    // AC-R21-2-1：长度 4，前 2 题逐字段与导入前相同（含 id）
    expect(qs).toHaveLength(4)
    expect(qs.slice(0, 2)).toEqual(existing)
    // AC-R21-2-1：后 2 题 id 依次 000011 / 000012
    expect(qs[2]!.id).toBe('000011')
    expect(qs[3]!.id).toBe('000012')
    // AC-R21-2-1：type/prompt/options/answerIndex/wordId/difficulty 与文件中对应题逐字段相同
    expect(qs[2]).toEqual({ ...fileQ1, id: '000011', category: '学科', book: '默认' })
    expect(qs[3]).toEqual({ ...fileQ2, id: '000012', category: '学科', book: '默认' })
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC-R21-2-2 空库追加：文件 3 题 → 长度 3，id 依次 000001/000002/000003', async () => {
    writeQuestions([])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await clickImportAppend(wrapper)
    const qs = readQuestions()
    expect(qs).toHaveLength(3)
    expect(qs.map((q) => q.id)).toEqual(['000001', '000002', '000003'])
  })

  it('AC-R21-2-3 追加：rewards / questionResults / flagged 逐字节不变（R36 D6：追加不动兑换项）', async () => {
    writeQuestions([makeQuestion('000001')])
    writeRewards([makeReward('old', '旧兑换', 9)])
    localStorage.setItem(
      'sq_question_results',
      JSON.stringify({ '000001': [{ outcome: 'correct', timestamp: '2026-08-20T10:00:00.000Z' }] }),
    )
    localStorage.setItem(
      'sq_flagged',
      JSON.stringify({ '000001': { flaggedAt: '2026-08-20T10:00:00.000Z' } }),
    )
    const beforeQR = localStorage.getItem('sq_question_results')
    const beforeFlagged = localStorage.getItem('sq_flagged')
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await clickImportAppend(wrapper)
    // AC-R21-2-3（R36 D6 更新）：追加模式下 sq_rewards 不再被文件替换，维持导入前值
    expect(readRewards()).toEqual([makeReward('old', '旧兑换', 9)])
    // AC-R21-2-3：sq_question_results 与 sq_flagged 与导入前逐字节相同
    expect(localStorage.getItem('sq_question_results')).toBe(beforeQR)
    expect(localStorage.getItem('sq_flagged')).toBe(beforeFlagged)
  })

  it('AC-R21-2-4 追加：文件题缺 difficulty → 追加到题库的该题 difficulty 为 3（校验器物理补 3）', async () => {
    writeQuestions([makeQuestion('000001')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [makeQuestion('q1')] }))
    await clickImportAppend(wrapper)
    // AC-R21-2-4：缺 difficulty 字段的文件题物理补 3 后追加
    expect(readQuestions()[1]).toEqual({ ...makeQuestion('q1'), difficulty: 3, id: '000002' })
  })

  it('AC-R21-2-6 追加溢出（最大数值 id 999999 + 1 题）：整次拒绝、弹窗关闭、「校验不过」档共用户文案、四键无写入', async () => {
    writeQuestions([makeQuestion('999999')])
    writeRewards([makeReward('old')])
    localStorage.setItem(
      'sq_question_results',
      JSON.stringify({ '999999': [{ outcome: 'wrong', timestamp: '2026-08-20T10:00:00.000Z' }] }),
    )
    localStorage.setItem(
      'sq_flagged',
      JSON.stringify({ '999999': { flaggedAt: '2026-08-20T10:00:00.000Z' } }),
    )
    const before = snapshotDataKeys()
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [makeQuestion('q1')], rewards: [makeReward('r1')] }))
    await clickImportAppend(wrapper)
    // AC-R21-2-6：确认弹窗关闭
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // #172 两档文案：追加溢出归「校验不过」档共用户文案（内部「题库编号已满」reason 不再直出）
    const err = wrapper.get('.import-error')
    expect(err.text()).toBe(copy.parent.importFailChecked)
    expect(wrapper.find('.import-success').exists()).toBe(false)
    // AC-R21-2-6：原子——四键均无写入（不部分追加）
    expect(snapshotDataKeys()).toEqual(before)
  })

  it('AC-R21-2-7 追加恰好通过（最大数值 id 999998 + 1 题）：追加成功，新题 id 为 999999', async () => {
    writeQuestions([makeQuestion('999998')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [makeQuestion('q1')], rewards: [makeReward('r1')] }))
    await clickImportAppend(wrapper)
    expect(readQuestions().map((q) => q.id)).toEqual(['999998', '999999'])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC-R21-3-1 覆盖维持现状（R36 更新）：文件题 id 原样不重编号、记录按新题池孤儿清理、rewards 不变、flagged 替换为文件值', async () => {
    writeQuestions([makeQuestion('000001'), makeQuestion('000002')])
    writeRewards([makeReward('old')])
    localStorage.setItem(
      'sq_flagged',
      JSON.stringify({ '000002': { flaggedAt: '2026-08-20T10:00:00.000Z' } }),
    )
    const rec9 = [{ outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' }]
    const rec1 = [{ outcome: 'wrong', timestamp: '2026-08-24T10:00:00.000Z' }]
    const fileQ = {
      id: '000009', type: 'zh2en', prompt: '文件题九',
      options: ['a', 'b', 'c', 'd'], answerIndex: 3, wordId: 'w9', difficulty: 2,
    }
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(
      wrapper,
      dataFileText({
        questionPool: [fileQ],
        questionResults: { '000009': rec9, '000001': rec1 },
        rewards: [makeReward('rNew', '新兑换', 7)],
      }),
    )
    await clickImportOverwrite(wrapper)
    // AC-R21-3-1：sq_questions 仅含文件的 1 题（id '000009' 原样不重编号）
    expect(readQuestions()).toEqual([{ ...fileQ, category: '学科', book: '默认' }])
    // AC-R21-3-1：孤儿清理以新题池为准（现状语义）——文件记录中 id '000001' 的题不在新题池（新题池仅 '000009'），被清理
    // 注：Spec Then 字面「含文件的 2 条」与括号内「孤儿清理以新题池为准」矛盾，按 AC-R21-3 节「维持现状」取括号语义
    const upgraded = rec9.map((r) => ({ ...r, childId: 'default' }))
    expect(readQuestionResults()).toEqual({ '000009': upgraded })
    expect(localStorage.getItem('sq_question_results')).toBe(JSON.stringify({ '000009': upgraded }))
    // AC-R21-3-1（R36 D6 更新）：数据导入不再写 sq_rewards，维持导入前值
    expect(readRewards()).toEqual([makeReward('old')])
    // AC-R21-3-1（R36 REQ-R36-4 更新）：覆盖模式 sq_flagged 整体替换为文件值——文件 flagged 为空 → 旧红旗清除为 {}
    expect(localStorage.getItem('sq_flagged')).toBe('{}')
  })

  it('AC-R21-4-3 文件内 id 重复（两题同 id）：追加成功且追加后题库内 id 无重复', async () => {
    writeQuestions([makeQuestion('000001')])
    const dup1 = { ...makeQuestion('dup'), prompt: '重复题一', wordId: 'w-dup-1', difficulty: 1 }
    const dup2 = { ...makeQuestion('dup'), prompt: '重复题二', wordId: 'w-dup-2', difficulty: 3 }
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [dup1, dup2] }))
    await clickImportAppend(wrapper)
    // AC-R21-4-3：文件内 id 重复不触发拒绝，唯一性由重编号保证
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    const ids = readQuestions().map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['000001', '000002', '000003'])
  })

  it('AC-R21-4-4 文件 questionPool 为空数组：题库长度不变、rewards 维持导入前值（R36 D6）、提示区成功文案', async () => {
    writeQuestions([makeQuestion('000001'), makeQuestion('000002')])
    writeRewards([makeReward('old')])
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [], rewards: [makeReward('rNew', '新兑换', 7)] }))
    await clickImportAppend(wrapper)
    // AC-R21-4-4：sq_questions 长度不变
    expect(readQuestions()).toHaveLength(2)
    // AC-R21-4-4（R36 D6 更新）：sq_rewards 维持导入前值
    expect(readRewards()).toEqual([makeReward('old')])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC-R21-4-1 校验原子拒绝（两模式共用）：文件第 2 题 options 只有 3 项 → 无确认弹窗、数据不变', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const before = localStorage.getItem('sq_questions')
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    const bad = [makeQuestion('q1'), { ...makeQuestion('q2'), options: ['a', 'b', 'c'] }]
    await selectFile(wrapper, dataFileText({ questionPool: bad }))
    // AC-R21-4-1：校验失败显示「校验不过」档共用户文案（#172），确认弹窗不出现
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.get('.import-error').text()).toBe(copy.parent.importFailChecked)
    // AC-R21-4-1：sq_questions 无写入
    expect(localStorage.getItem('sq_questions')).toBe(before)
  })

  it('AC-R21-4-2 校验原子拒绝：文件 version 为 0.9 → 校验失败、确认弹窗不出现', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    const before = localStorage.getItem('sq_questions')
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ version: '0.9' }))
    // AC-R21-4-2：不支持的导出版本 → 确认弹窗不出现（#172「版本不支持」档共用户文案）
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.get('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(localStorage.getItem('sq_questions')).toBe(before)
  })
})

// AC-R21-5 → R36（D6 更新）：旧确认文案槽位废弃；新两组计数文案槽位语义白名单
describe('R21→R36 文案契约（AC-R21-5 / R36 REQ-R36-6）', () => {
  it('AC-R21-5-1（R36 更新）confirmDataMode 已废弃：value 含 [DEPRECATED] 前缀（key 保留不删）', () => {
    expect(typeof copy.parent.confirmDataMode).toBe('function')
    expect(copy.parent.confirmDataMode(40).startsWith('[DEPRECATED]')).toBe(true)
  })

  it('R36 新槽位语义：confirmLearningImport(40) 含 40 与题数；confirmEconomyImport(2, 3, 9) 含兑换项 2 项 + 提议 3 条 + 流水 9 条（R32 扩参）', () => {
    expect(copy.parent.confirmLearningImport(40)).toMatch(/40/)
    expect(copy.parent.confirmLearningImport(40)).toMatch(/题/)
    const eco = copy.parent.confirmEconomyImport(2, 3, 9)
    expect(eco).toMatch(/2\s*项/)
    expect(eco).toMatch(/3\s*条/)
    expect(eco).toMatch(/9\s*条/)
  })

  it('AC-R21-5-2 按钮文案逐字锁定：importOverwrite=「导入并重置」、importAppend=「导入并追加」', () => {
    // AC-R21-5-2：老板拍板，逐字锁定（R36 双模式语义不变）
    expect(copy.parent.importOverwrite).toBe('导入并重置')
    expect(copy.parent.importAppend).toBe('导入并追加')
  })

  it('AC-R21-5-3 confirmData 废弃：value 含 [DEPRECATED] 前缀，Parent.vue 无 confirmData 引用（grep 零命中）', () => {
    // AC-R21-5-3：copy 槽位废弃保留
    expect(copy.parent.confirmData.startsWith('[DEPRECATED]')).toBe(true)
    // AC-R21-5-3：Parent.vue 源码零命中（\b 边界排除合法的 confirmDataMode；jsdom 下 import.meta.url 非 file scheme，用 cwd 拼路径）
    const source = readFileSync(`${process.cwd()}/src/pages/Parent.vue`, 'utf-8')
    expect(/\bconfirmData\b/.test(source)).toBe(false)
  })

  it('R36 旧弹窗文案槽位废弃：confirmLedger 不再被 Parent.vue 引用（grep 零命中）', () => {
    const source = readFileSync(`${process.cwd()}/src/pages/Parent.vue`, 'utf-8')
    expect(/\bconfirmLedger\b/.test(source)).toBe(false)
    expect(/\bconfirmDataMode\b/.test(source)).toBe(false)
  })
})

// R32 T8（REQ-R32-1）：家长页提议板入口按钮——第 3 个按钮 + 路由跳转；C1 组件库入口降级为 config-link 链接（2026-09-03 老板拍板）
describe('AC-R32-1 家长页提议板入口（T8，REQ-R32-1）', () => {
  it('AC-R32-1-1 .parent-actions 共 6 按钮（组件库已降级为链接；#136 增出题指令、#132 增家庭管理、#323 增「给家长的话」）：第 3 位文本 = copy.parent.proposalsEntry；均为 star-button--standard × large（#38 统一，原 parent-action-btn 断言迁移）', async () => {
    const wrapper = await mountParent()
    const buttons = wrapper.findAll('.parent-actions button')
    // #323：5→6（末位新增归档入口，既有位次顺延不变——提议板仍是第 3 位）
    expect(buttons).toHaveLength(6)
    // 第 3 位 = 提议板入口（第 4 位 #136 出题指令、末位 #132 家庭管理）
    expect(buttons[2]!.text()).toBe(copy.parent.proposalsEntry)
    // #38：按钮统一组件（同 variant/size + 各自语义定位 class）
    for (const b of buttons) {
      expect(b.classes()).toContain('star-button--standard')
      expect(b.classes()).toContain('star-button--large')
    }
    expect(buttons[2]!.classes()).toContain('btn-proposals-entry')
  })

  it('AC-R32-1-2 点击第 3 位提议板按钮 → 路由跳转 /proposals', async () => {
    const wrapper = await mountParent()
    const buttons = wrapper.findAll('.parent-actions button')
    expect(buttons[2]!.text()).toBe(copy.parent.proposalsEntry)
    await buttons[2]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals')
  })

  it('C1 组件库入口为 config-link 超链接（位于按钮区之后）：文本 = copy.parent.componentsLibrary，点击 → /components', async () => {
    const wrapper = await mountParent()
    const link = wrapper.get('.parent-main .config-link')
    expect(link.text()).toBe(copy.parent.componentsLibrary)
    // 位于 .parent-actions 之后（DOM 顺序）
    const actions = wrapper.get('.parent-actions').element
    expect(actions.compareDocumentPosition(link.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/components')
  })
})

// #136 家长页「出题指令」入口（parent-actions 第 4 个大按钮，与既有三个同规格；#132 起末位为家庭管理入口）
describe('#136 家长页出题指令入口', () => {
  it('第 4 位按钮文本 = copy.parent.questionPrompt.entryBtn、类 btn-question-prompt、standard × large，点击 → /parent/question-prompt', async () => {
    const wrapper = await mountParent()
    const buttons = wrapper.findAll('.parent-actions button')
    const questionPromptBtn = buttons[3]!
    expect(questionPromptBtn.text()).toBe(copy.parent.questionPrompt.entryBtn)
    expect(questionPromptBtn.classes()).toContain('btn-question-prompt')
    expect(questionPromptBtn.classes()).toContain('star-button--standard')
    expect(questionPromptBtn.classes()).toContain('star-button--large')
    await questionPromptBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent/question-prompt')
  })
})

// #132 家长页「家庭管理」入口：第 5 个大按钮（#323 起非末位，其后为「给家长的话」）跳转 /parent/family；管理区不再内嵌家长页
describe('#132 家长页家庭管理入口', () => {
  it('第 5 位按钮文本 = copy.parent.familyAdminEntry、类 btn-family-admin、standard × large，点击 → /parent/family', async () => {
    const wrapper = await mountParent()
    const buttons = wrapper.findAll('.parent-actions button')
    const last = buttons[4]!
    expect(last.text()).toBe(copy.parent.familyAdminEntry)
    expect(last.classes()).toContain('btn-family-admin')
    expect(last.classes()).toContain('star-button--standard')
    expect(last.classes()).toContain('star-button--large')
    await last.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent/family')
  })

  it('管理区已整段迁出：家长凭据下家长页也不渲染管理区任何段落（device-admin 系零残留）', async () => {
    writeDeviceCredential({ device_id: 'dev-1', secret: 'sec-1', role: 'parent', name: '家长手机' })
    const wrapper = await mountParent()
    expect(wrapper.find('.device-admin').exists()).toBe(false)
    expect(wrapper.find('.device-admin-section').exists()).toBe(false)
    expect(wrapper.find('.admin-confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.family-code-value').exists()).toBe(false)
    wrapper.unmount()
  })
})

// #323 家长页「给家长的话」归档入口：第 6 个（末位）同权重主按钮，带 from=parent 进入归档形态
// （全仓唯一写 from=parent 的地方；新增写该值的入口 = 新增归档入口，必须显式评审）
describe('#323 家长页「给家长的话」入口', () => {
  it('末位（第 6 位）按钮文本 = copy.parent.parentGuideEntry、类 btn-parent-guide、standard × large，点击 → /parent-guide?from=parent', async () => {
    const wrapper = await mountParent()
    const buttons = wrapper.findAll('.parent-actions button')
    const archiveBtn = buttons[5]!
    expect(archiveBtn.text()).toBe(copy.parent.parentGuideEntry)
    expect(archiveBtn.text()).toBe('给家长的话')
    expect(archiveBtn.classes()).toContain('btn-parent-guide')
    expect(archiveBtn.classes()).toContain('star-button--standard')
    expect(archiveBtn.classes()).toContain('star-button--large')
    await archiveBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(router.currentRoute.value.query).toEqual({ from: 'parent' })
  })

  it('位置在既有 5 个功能按钮之后（DOM 末位，既有位次零重排）', async () => {
    const wrapper = await mountParent()
    const buttons = wrapper.findAll('.parent-actions button')
    expect(buttons.map(button => button.text())).toEqual([
      copy.parent.dataManage,
      copy.parent.ledgerManage,
      copy.parent.proposalsEntry,
      copy.parent.questionPrompt.entryBtn,
      copy.parent.familyAdminEntry,
      copy.parent.parentGuideEntry,
    ])
  })
})

// R32 T8（REQ-R32-8-4，T4 遗留接线）：经济文件确认导入后 sq_proposals 覆盖式替换
describe('R32 经济导入 proposals 覆盖（T8，REQ-R32-8-4）', () => {
  it('REQ-R32-8-4 2.1 经济文件确认导入后：sq_proposals 整体替换为文件提议值（本机旧提议消失）', async () => {
    writeProposals([makeProposalRecord('old-1', '旧提议', 9)])
    const fileProposal = makeProposalRecord('file-1', '文件提议', 6)
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText({ version: '2.1', proposals: [fileProposal] }))
    await wrapper.find('.confirm-ok').trigger('click')
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    // 覆盖式：sq_proposals 整体替换为文件值，本机旧提议 old-1 消失
    // #63：导入 backfill 补归因字段（by=initiator / proposed）
    expect(readProposals()).toEqual([{ ...fileProposal, lastActionBy: 'parent', lastActionKind: 'proposed' }])
    expect(readProposals().map((p) => p.id)).not.toContain('old-1')
  })
})

// #38 需求 1：题库情况卡片（question-summary，star-container 承载）——共 X 题恒显示 / 有 X 新题（=0 隐藏）/ 最近答题（无记录隐藏）
describe('AC-#38-1 题库情况卡片显示规则', () => {
  /** timestamp 固定 ISO：2026-08-28 08:00 +08 → 最近答题 8月28日（无前导零） */
  const T = '2026-08-28T00:00:00.000Z'

  it('无答题记录：显示「共 X 题 · 有 X 新题」，无「最近答题」段', async () => {
    writeQuestions([makeQuestion('q1'), makeQuestion('q2'), makeQuestion('q3')])
    writeQuestionResults({})
    const wrapper = await mountParent()
    await flushPromises()
    const text = wrapper.get('.question-summary').text()
    expect(text).toBe('共 3 题 · 有 3 新题')
    expect(text).not.toContain('最近答题')
  })

  it('全部答过（无新题）：显示「共 X 题 · 最近答题 X月X日」，无「有 0 新题」段', async () => {
    writeQuestions([makeQuestion('q1'), makeQuestion('q2')])
    writeQuestionResults({
      q1: [{ outcome: 'correct', timestamp: T }],
      q2: [{ outcome: 'wrong', timestamp: T }],
    })
    const wrapper = await mountParent()
    await flushPromises()
    const text = wrapper.get('.question-summary').text()
    expect(text).toBe('共 2 题 · 最近答题 8月28日')
    expect(text).not.toContain('有 0 新题')
  })

  it('部分新题 + 有最近答题：三组全显示（「·」分隔）', async () => {
    writeQuestions([makeQuestion('q1'), makeQuestion('q2'), makeQuestion('q3')])
    writeQuestionResults({ q1: [{ outcome: 'skipped', timestamp: T }] })
    const wrapper = await mountParent()
    await flushPromises()
    const text = wrapper.get('.question-summary').text()
    expect(text).toBe('共 3 题 · 有 2 新题 · 最近答题 8月28日')
  })

  it('空题库：仅显示「共 0 题」', async () => {
    writeQuestions([])
    writeQuestionResults({})
    const wrapper = await mountParent()
    await flushPromises()
    expect(wrapper.get('.question-summary').text()).toBe('共 0 题')
  })
})

describe('#308 onboarding import feedback', () => {
  it.each(['file', 'paste'])('%s learning import shows beta guidance only after successful confirmation', async source => {
    stubDownload()
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    expect(wrapper.text()).not.toContain(copy.parentGuide.betaMessage)
    if (source === 'file') {
      await selectFile(wrapper, dataFileText())
    } else {
      await wrapper.get('.btn-paste-import').trigger('click')
      await wrapper.get('textarea').setValue(dataFileText())
      await wrapper.get('.btn-paste-parse').trigger('click')
    }
    expect(wrapper.text()).not.toContain(copy.parentGuide.betaMessage)
    await clickImportOverwrite(wrapper)
    expect(wrapper.get('[role="status"]').text()).toContain(copy.parentGuide.importNext)
    expect(wrapper.get('[role="status"]').text()).toContain(copy.parentGuide.betaMessage)
    await wrapper.get('.btn-paste-import').trigger('click')
    expect(wrapper.text()).not.toContain(copy.parentGuide.betaMessage)
    wrapper.unmount()
  })

  it('append success also shows the guidance; cancel and invalid input never show it', async () => {
    stubDownload()
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, 'not JSON')
    expect(wrapper.text()).not.toContain(copy.parentGuide.betaMessage)
    await selectFile(wrapper, dataFileText())
    await wrapper.get('.confirm-cancel').trigger('click')
    expect(wrapper.text()).not.toContain(copy.parentGuide.betaMessage)
    await selectFile(wrapper, dataFileText())
    await clickImportAppend(wrapper)
    expect(wrapper.text()).toContain(copy.parentGuide.betaMessage)
    wrapper.unmount()
  })

  it('paired-parent learning import keeps the existing success feedback without beta guidance', async () => {
    writeDeviceCredential({ device_id: 'device', secret: 'secret', role: 'parent', name: 'device' })
    const wrapper = await mountParent()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await clickImportOverwrite(wrapper)
    expect(wrapper.text()).toContain(copy.parent.importSuccess)
    expect(wrapper.text()).not.toContain(copy.parentGuide.betaMessage)
    wrapper.unmount()
  })

  it('economy import does not show question-bank onboarding guidance', async () => {
    stubDownload()
    const wrapper = await mountParent()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    await wrapper.get('.confirm-ok').trigger('click')
    expect(wrapper.text()).toContain(copy.parent.importSuccess)
    expect(wrapper.text()).not.toContain(copy.parentGuide.betaMessage)
    wrapper.unmount()
  })
})

describe('#311 出题指令 → 导入闭环接住：?import=paste 直达粘贴导入', () => {
  it('带 ?import=paste 进页 → 自动开数据管理弹窗并落在粘贴导入视图（标题/文本域/解析按钮），query 随即清掉', async () => {
    await router.replace('/parent?import=paste')
    const wrapper = await mountParent()
    await flushPromises()
    const modal = wrapper.get('.star-modal')
    expect(modal.find('.star-modal__title').text()).toBe(copy.parent.pasteImportTitle)
    expect(modal.find('textarea.paste-input').exists()).toBe(true)
    expect(modal.find('.btn-paste-parse').text()).toBe(copy.parent.pasteImportParseBtn)
    // 消费后清 query：刷新/返回不再重复直达
    expect(router.currentRoute.value.query.import).toBeUndefined()
    wrapper.unmount()
  })

  it('不带 query 进页 → 弹窗不自动打开（既有行为不变）', async () => {
    const wrapper = await mountParent()
    await flushPromises()
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    wrapper.unmount()
  })
})

function ledgerEntry1(): { id: string; timestamp: number; type: 'earn' | 'redeem'; amount: number; source: string } {
  return { id: 'l1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星' }
}
