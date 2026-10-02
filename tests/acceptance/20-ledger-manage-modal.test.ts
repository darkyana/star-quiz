/**
 * R3 AC4-1 ~ AC4-9 流水管理弹窗验收（Spec §4 REQ-4 / §3.6 元素契约）。
 * R36（Spec 20260827-v0.10.0 §D6 有意变更）：「流水管理」= 经济文件（兑换项 + proposals 空位 +
 * 星星流水，EconomyExport '2.0'）——导入同时覆盖 sq_rewards 与 sq_stars（学习键不动）；
 * 二次确认计数文案「本次导入将写入兑换项 M 项 + 流水 K 条」；1.x 文件断代拒绝。
 * 导出文件名前缀 star-quiz-economy-。导入后余额按 C2 实时求和自动反映（无余额字段）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState, readLastExport } from '../../src/composables/useDataInfra'
import {
  questions as readQuestions,
  writeQuestions,
  flagged as readFlagged,
  writeFlagged,
  questionResults as readQuestionResults,
  writeQuestionResults,
} from '../../src/composables/useLearningData'
import {
  rewards as readRewards,
  writeRewards,
  ledger as readStars,
  writeLedger as writeStars,
} from '../../src/composables/useStarData'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
import { copy } from '../../src/copy'
import type { Question, RewardItem, StarEntry } from '../../src/types/index'

function makeQuestion(id: string): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: id }
}

function makeReward(id: string, name = '奖励', price = 3): RewardItem {
  return { id, name, price }
}

function ledgerEntry1(): StarEntry {
  return { id: 'l1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星', childId: 'default', kind: 'main' }
}

function ledgerEntry2(): StarEntry {
  return { id: 'l2', timestamp: 1724230000100, type: 'redeem', amount: 2, source: '兑换：菠萝油', childId: 'default', kind: 'main' }
}

/** 合法 2.0 经济文件文本（默认 2 兑换项 + proposals 空位 + 2 条流水：earn 7 + redeem 2；可覆盖字段） */
function ledgerFileText(opts: { starLedger?: unknown[]; rewards?: unknown[]; proposals?: unknown; version?: unknown } = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: '2026-08-21T10:30:00.000Z',
    rewards: [makeReward('r1'), makeReward('r2')],
    proposals: [],
    starLedger: [ledgerEntry1(), ledgerEntry2()],
    ...(opts.starLedger !== undefined ? { starLedger: opts.starLedger } : {}),
    ...(opts.rewards !== undefined ? { rewards: opts.rewards } : {}),
    ...(opts.proposals !== undefined ? { proposals: opts.proposals } : {}),
    ...(opts.version !== undefined ? { version: opts.version } : {}),
  })
}

let createObjectURLSpy: ReturnType<typeof vi.fn> | undefined
let capturedBlob: Blob | null = null
let capturedFilename = ''

const originalReadAsText = FileReader.prototype.readAsText
const originalAnchorClick = HTMLAnchorElement.prototype.click

function stubFileRead(text: string): void {
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'result', { value: text, configurable: true })
    this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
  })
}

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

describe('AC4 流水管理弹窗（9 条）', () => {
  it('AC4-1 弹窗打开与内容：标题「流水管理」/ 说明 / 导出导入按钮', async () => {
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    // #59：弹窗收编 StarModalStandard，选择器迁到组件类名（断言意图不变）
    const modal = wrapper.get('.star-modal')
    expect(modal.find('.star-modal__title').text()).toBe('流水管理')
    expect(modal.text()).toContain('管理星星收支流水')
    expect(modal.find('.btn-export').text()).toBe('导出')
    expect(modal.find('.btn-import').text()).toBe('导入')
  })

  it('AC4-2 导出：Blob = EconomyExport 深等（rewards + proposals [] + starLedger + activeRedemptions []）+ 文件名 star-quiz-economy-* + sq_last_export 写入 exportedAt', async () => {
    writeStars([ledgerEntry1(), ledgerEntry2()])
    const now = new Date(2026, 7, 21, 18, 31, 5)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    stubDownload()
    try {
      wrapper = await mountParentApp()
      await openLedgerModal(wrapper)
      await wrapper.get('.btn-export').trigger('click')
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      expect(capturedFilename).toMatch(/^star-quiz-economy-\d{8}-\d{6}\.json$/)
      const text = await readBlobText(capturedBlob!)
      // R36 REQ-R36-2：经济文件恰 6 字段（rewards 全量 + proposals + starLedger 全量 + activeRedemptions），不含学习字段；
      // R32（REQ-R32-8-1）起 version '2.1'，#75（R-72-3）升 '2.2' 并携带进行中兑换（本用例空态 []）
      expect(JSON.parse(text)).toEqual({
        version: '2.4',
        exportedAt: now.toISOString(),
        rewards: readRewards(),
        proposals: [],
        starLedger: [ledgerEntry1(), ledgerEntry2()],
        activeRedemptions: [],
      })
      expect(readLastExport()).toBe(now.toISOString())
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC4-3 导入合法：二次确认计数文案「兑换项 2 项 + 流水 2 条」+ 确认后覆盖 sq_rewards 与 sq_stars + 「导入成功」（AC-R36-5-1 同链路）', async () => {
    writeStars([{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }])
    writeRewards([makeReward('old')])
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    const confirm = wrapper.find('.confirm-modal')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('兑换项 2 项 + 流水 2 条')
    // R32（Spec D6 有意变更 / 自主决策 #6）：confirmEconomyImport 扩三参（M 兑换项 / P 提议 / K 流水）
    expect(confirm.text()).toContain(copy.parent.confirmEconomyImport(2, 0, 2))
    expect(confirm.find('.confirm-cancel').text()).toBe('取消')
    expect(confirm.find('.confirm-ok').text()).toBe('确认')
    await confirm.find('.confirm-ok').trigger('click')
    // R36 §D6：流水管理导入 = 经济文件——sq_rewards 与 sq_stars 均整体替换为文件值
    expect(readRewards()).toEqual([makeReward('r1'), makeReward('r2')])
    expect(readStars()).toEqual([ledgerEntry1(), ledgerEntry2()])
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
  })

  it('AC4-4 取消导入：sq_stars / sq_rewards 与导入前深相等、无「导入成功」', async () => {
    const before: StarEntry[] = [{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }]
    const beforeR = [makeReward('old')]
    writeStars(before)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    await wrapper.find('.confirm-cancel').trigger('click')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readStars()).toEqual(before)
    expect(readRewards()).toEqual(beforeR)
    expect(wrapper.find('.import-success').exists()).toBe(false)
  })

  it('AC4-5 条目非法原子拒绝：starLedger[0].type="ear" → .import-error 为「校验不过」档共用户文案（#172）、数据不变', async () => {
    const before: StarEntry[] = [{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }]
    const beforeR = [makeReward('old')]
    writeStars(before)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    const bad = [{ ...ledgerEntry1(), type: 'ear' }]
    await selectFile(wrapper, ledgerFileText({ starLedger: bad }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readStars()).toEqual(before)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC4-6 amount 非法原子拒绝：starLedger[1].amount=-5 → .import-error 为「校验不过」档共用户文案（#172）、数据不变', async () => {
    const before: StarEntry[] = [{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }]
    const beforeR = [makeReward('old')]
    writeStars(before)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    const bad = [ledgerEntry1(), { ...ledgerEntry2(), amount: -5 }]
    await selectFile(wrapper, ledgerFileText({ starLedger: bad }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readStars()).toEqual(before)
    expect(readRewards()).toEqual(beforeR)
  })

  it('AC4-7 流水导入不触碰学习键：sq_questions / sq_flagged / sq_question_results 不变（sq_rewards 按文件覆盖）', async () => {
    const beforeQ = [makeQuestion('keep1'), makeQuestion('keep2')]
    const beforeFlagged = { keep1: { flaggedAt: 111 } }
    const beforeResults = { keep1: [{ outcome: 'correct', timestamp: '2026-01-01T00:00:00.000Z' }] }
    writeQuestions(beforeQ)
    writeFlagged(beforeFlagged)
    writeQuestionResults(beforeResults)
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText())
    await wrapper.find('.confirm-ok').trigger('click')
    expect(readQuestions()).toEqual(beforeQ)
    expect(readFlagged()).toEqual(beforeFlagged)
    expect(readQuestionResults()).toEqual(beforeResults)
    // R36：sq_rewards 属经济文件管辖，随导入替换为文件值
    expect(readRewards()).toEqual([makeReward('r1'), makeReward('r2')])
  })

  it('AC4-8 导入后余额实时反映（C2）：返回首页 .balance-chip 数字为 5（Σearn − Σredeem = 7 − 2）', async () => {
    // Given: sq_stars = []（initAppState 初始值）、首页余额 0
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, ledgerFileText()) // earn 7 + redeem 2
    await wrapper.find('.confirm-ok').trigger('click')
    expect(readStars()).toHaveLength(2)
    // When: 返回首页（同一 App 挂载，router-view 切换）
    await router.replace('/')
    await flushPromises()
    const starValue = wrapper.get('.balance-chip .star-value')
    expect(starValue.text()).toBe('5')
  })

  it('AC4-9 非法 JSON 原子拒绝：.import-error 为「文件坏」档共用户文案（#172）、数据不变', async () => {
    const before: StarEntry[] = [{ id: 'old', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }]
    const beforeR = [makeReward('old')]
    writeStars(before)
    writeRewards(beforeR)
    wrapper = await mountParentApp()
    await openLedgerModal(wrapper)
    await selectFile(wrapper, '{bad')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(readStars()).toEqual(before)
    expect(readRewards()).toEqual(beforeR)
  })
})
