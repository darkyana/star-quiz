/**
 * R3 AC3-1 ~ AC3-13 数据管理弹窗验收（Spec §4 REQ-3 / §3.6 元素契约）。
 * R36（Spec 20260827-v0.10.0 §D6 有意变更）：「数据管理」= 学习文件（题库 + 红旗 + 答题记录，
 * LearningExport '2.0'）——导入不再读写 sq_rewards；确认弹窗计数文案「本次导入将写入 N 题」；
 * 1.x 文件断代拒绝。导出文件名前缀 star-quiz-learning-。
 * 导入 = 原子拒绝（任一非法 → 整文件拒绝、不写数据、不进二次确认）+ 二次确认 + 覆盖/追加双模式（R21）。
 * 文件读取 stub FileReader.readAsText（onload 设置 result / onerror）；下载 spy URL.createObjectURL + a.download。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState, readLastExport, writeLastExport } from '../../src/composables/useDataInfra'
import { copy } from '../../src/copy'
import { questions as readQuestions, writeQuestions } from '../../src/composables/useLearningData'
import {
  rewards as readRewards,
  writeRewards,
  ledger as readStars,
  writeLedger as writeStars,
} from '../../src/composables/useStarData'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
import type { Question, RewardItem, StarEntry } from '../../src/types/index'

function makeQuestion(id: string): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: id, category: '学科', book: '默认' }
}

function makeReward(id: string, name = '奖励', price = 3): RewardItem {
  return { id, name, price }
}

/** 合法 2.0 学习文件文本（默认 3 题 + 空红旗 + 空答题记录；可覆盖字段） */
function dataFileText(opts: { questionPool?: unknown[]; flagged?: unknown; questionResults?: unknown; version?: unknown } = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: '2026-08-21T10:30:00.000Z',
    questionPool: [makeQuestion('q1'), makeQuestion('q2'), makeQuestion('q3')],
    flagged: {},
    questionResults: {},
    ...(opts.questionPool !== undefined ? { questionPool: opts.questionPool } : {}),
    ...(opts.flagged !== undefined ? { flagged: opts.flagged } : {}),
    ...(opts.questionResults !== undefined ? { questionResults: opts.questionResults } : {}),
    ...(opts.version !== undefined ? { version: opts.version } : {}),
  })
}

let createObjectURLSpy: ReturnType<typeof vi.fn> | undefined
let capturedBlob: Blob | null = null
let capturedFilename = ''

// 显式保存原始方法：连续 spyOn 会叠加 mock（后建 spy 的"原值"是前一 mock），mockRestore 无法逐层还原
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

async function mountParentApp(): Promise<VueWrapper> {
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return wrapper
}

async function openDataModal(wrapper: VueWrapper): Promise<void> {
  const buttons = wrapper.findAll('button')
  const dataBtn = buttons.find((b) => b.text() === '数据管理')
  expect(dataBtn).toBeDefined()
  await dataBtn!.trigger('click')
}

async function selectFile(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.get('.file-input')
  const file = new File([text], 'import.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  stubFileRead(text)
  await input.trigger('change')
  // stub 同步触发 onload 后立即还原，防连续 selectFile 的 spy 叠加
  FileReader.prototype.readAsText = originalReadAsText
}

let wrapper: VueWrapper | undefined

beforeEach(async () => {
  localStorage.clear()
  initAppState()
  await router.replace('/parent')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  FileReader.prototype.readAsText = originalReadAsText
  HTMLAnchorElement.prototype.click = originalAnchorClick
  vi.unstubAllGlobals()
})

/** R21（D6）：数据确认弹窗确认按钮点击路径 → 点「导入并重置」（覆盖模式 = 既有确认语义） */
async function clickImportOverwrite(target: VueWrapper): Promise<void> {
  const btn = target.findAll('button').find((b) => b.text() === '导入并重置')
  expect(btn).toBeDefined()
  await btn!.trigger('click')
}

describe('AC3 数据管理弹窗（13 条）', () => {
  it('AC3-1 弹窗打开与内容：标题「数据管理」/ 说明 / 导出导入按钮 / 关闭按钮', async () => {
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    // #59：弹窗收编 StarModalStandard，选择器迁到组件类名（断言意图不变）
    const modal = wrapper.get('.star-modal')
    expect(modal.find('.star-modal__title').text()).toBe('数据管理')
    expect(modal.text()).toContain('管理题库和兑换项数据')
    expect(modal.find('.btn-export').text()).toBe('导出')
    expect(modal.find('.btn-import').text()).toBe('导入')
    expect(modal.find('.star-modal__close').attributes('aria-label')).toBe('关闭')
  })

  it('AC3-2 导出：Blob = LearningExport 深等（不含 rewards）+ 文件名 star-quiz-learning-* + sq_last_export 写入 exportedAt', async () => {
    writeQuestions([makeQuestion('q1'), makeQuestion('q2')])
    writeRewards([makeReward('r1', '菠萝油', 5)])
    const now = new Date(2026, 7, 21, 18, 30, 0)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    stubDownload()
    try {
      wrapper = await mountParentApp()
      await openDataModal(wrapper)
      await wrapper.get('.btn-export').trigger('click')
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      expect(capturedFilename).toMatch(/^star-quiz-learning-\d{8}-\d{6}\.json$/)
      const text = await readBlobText(capturedBlob!)
      // R36 REQ-R36-1：学习文件恰 5 字段（题池 + 红旗 + 答题记录），不含 rewards / proposals / starLedger
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

  it('AC3-3 导入合法：二次确认计数文案「3 题」+ 确认后题库覆盖 + sq_rewards 不变（D6：数据管理导入不碰兑换项）+ 「导入成功」', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    const confirm = wrapper.find('.confirm-modal')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('3 题')
    expect(confirm.text()).toContain(copy.parent.confirmLearningImport(3))
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
    // R36 §D6：数据管理导入不再读写 sq_rewards——本地兑换项保持导入前值
    expect(readRewards()).toEqual([makeReward('old')])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
  })

  it('AC3-4 取消导入：数据与导入前深相等、无「导入成功」', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await wrapper.find('.confirm-cancel').trigger('click')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
    expect(wrapper.find('.import-success').exists()).toBe(false)
  })

  it('AC3-5 非法 JSON 原子拒绝（E2）：无确认弹窗、.import-error 为「文件坏」档共用户文案（#172）、数据不变', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await selectFile(wrapper, '{invalid')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    const err = wrapper.find('.import-error')
    expect(err.exists()).toBe(true)
    // #172 两档文案：文件坏档共用户文案（内部 reason 不再直出）
    expect(err.text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC3-6 缺字段原子拒绝：缺 flagged → .import-error 为「校验不过」档共用户文案（#172）、数据不变（2.0 缺字段即非法）', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    const { flagged: _omit, ...rest } = JSON.parse(dataFileText()) as Record<string, unknown>
    await selectFile(wrapper, JSON.stringify(rest))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC3-7 版本断代原子拒绝：version "1.2" → .import-error 为「版本不支持」档共用户文案（#172）、数据不变', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ version: '1.2' }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC3-8 条目非法原子拒绝：questionPool[1].answerIndex="1" → .import-error 为「校验不过」档共用户文案（#172）、数据不变', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    const bad = [makeQuestion('q1'), { ...makeQuestion('q2'), answerIndex: '1' }]
    await selectFile(wrapper, dataFileText({ questionPool: bad }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC3-9 成功导入不触碰其他键：sq_stars / sq_session / sq_last_export / sq_rewards 均不变', async () => {
    const stars: StarEntry[] = [
      { id: 's1', timestamp: 1, type: 'earn', amount: 3, source: '答题得星' },
      { id: 's2', timestamp: 2, type: 'earn', amount: 2, source: '满分奖励' },
      { id: 's3', timestamp: 3, type: 'redeem', amount: 1, source: '兑换：菠萝油' },
    ]
    writeStars(stars)
    writeRewards([makeReward('keep')])
    const session = { quizId: 'x', status: 'in_progress' }
    localStorage.setItem('sq_session', JSON.stringify(session))
    writeLastExport('2026-08-21T00:00:00.000Z')
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText())
    await clickImportOverwrite(wrapper)
    expect(readStars()).toEqual(stars)
    expect(readRewards()).toEqual([makeReward('keep')])
    expect(localStorage.getItem('sq_session')).toBe(JSON.stringify(session))
    // #172 口径变化：导入本身不写 sq_last_export（D6），但未配对设备导入确认前的自动全量备份
    // 是导出动作、按 D6 写入 exportedAt → 不再是导入前的旧时间戳
    expect(readLastExport()).not.toBe('2026-08-21T00:00:00.000Z')
  })

  it('AC3-10 点击 .star-modal__close 关闭弹窗：弹窗消失、sq_questions / sq_rewards 无变化', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await wrapper.get('.star-modal__close').trigger('click')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC3-11 空数组文件合法：题库清空 + 兑换项不被清空（学习文件不含经济数据）+ 「导入成功」', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await selectFile(wrapper, dataFileText({ questionPool: [] }))
    await clickImportOverwrite(wrapper)
    expect(readQuestions()).toEqual([])
    expect(readRewards()).toEqual([makeReward('old')])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC3-12 失败后可再次导入恢复：提示区在新导入开始时清除，合法文件覆盖成功', async () => {
    writeQuestions([makeQuestion('old')])
    writeRewards([makeReward('old')])
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    await selectFile(wrapper, '{invalid')
    expect(wrapper.find('.import-error').exists()).toBe(true)
    await selectFile(wrapper, dataFileText({ questionPool: [makeQuestion('new')] }))
    await clickImportOverwrite(wrapper)
    expect(readQuestions()).toEqual([{ ...makeQuestion('new'), difficulty: 3 }])
    expect(readRewards()).toEqual([makeReward('old')])
    expect(wrapper.find('.import-error').exists()).toBe(false)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC3-13 文件读取失败（FileReader onerror）原子拒绝：无确认弹窗、.import-error 为「文件坏」档共用户文案（#172）、数据不变', async () => {
    const beforeQ = [makeQuestion('old')]
    const beforeR = [makeReward('old')]
    writeQuestions(beforeQ)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openDataModal(wrapper)
    const input = wrapper.get('.file-input')
    const file = new File(['x'], 'import.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    stubFileReadError()
    await input.trigger('change')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readQuestions()).toEqual(beforeQ)
    expect(readRewards()).toEqual(beforeR)
  })
})
