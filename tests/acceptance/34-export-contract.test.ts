/**
 * R36 导出契约重构独立验收（Spec 20260827-v0.10.0-R36 §验收标准，AC-R36-1 ~ AC-R36-7 全 22 条）。
 * 验收视角：从 Spec AC 独立生成 Given-When-Then 行为断言，断言行为结果与 localStorage 值，
 * 不从实现源码反推；文案断言以 Spec §验收标准文案白名单为准（完整文案以 copy.ts 槽位为准）。
 * AC-R36-6-1/6-2/6-3 为 @vue/test-utils 组件 DOM 断言；其余为纯函数 / localStorage 断言；
 * AC-R36-7-1 / 2-2 含源码 grep 零命中断言。
 * 与 developer 内循环单测（importExport / Parent / useExport / types）允许覆盖相同行为。
 */
import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Question, RewardItem, StarEntry, FlaggedState, QuestionResultsState, LearningExport, EconomyExport, ProposalRecord, ActiveRedemption } from '../../src/types'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState, CURRENT_DATA_VERSION } from '../../src/composables/useDataInfra'
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
import { downloadDataExport, downloadLedgerExport } from '../../src/composables/useExport'
import {
  buildLearningExport,
  buildEconomyExport,
  formatExportFilename,
  validateLearningImport,
  validateEconomyImport,
} from '../../src/utils/importExport'
import { copy } from '../../src/copy'

const NOW = '2026-08-27T10:30:00.000Z'

// ===== seed 工具 =====

function makeQuestion(id: string, wordId = id): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId }
}

function numberedQuestions(n: number, start = 1): Question[] {
  return Array.from({ length: n }, (_, i) => makeQuestion(String(start + i).padStart(6, '0'), `w${start + i}`))
}

function makeReward(id: string, name = '奖励', price = 3): RewardItem {
  return { id, name, price }
}

function makeEntry(id: string, amount = 1, type: 'earn' | 'redeem' = 'earn'): StarEntry {
  return { id, timestamp: 1724230000000, type, amount, source: type === 'earn' ? '答题得星' : '兑换：菠萝油' }
}

function makeEntries(n: number): StarEntry[] {
  return Array.from({ length: n }, (_, i) => makeEntry(`s${i + 1}`, (i % 3) + 1))
}

function record(outcome: 'correct' | 'wrong' | 'skipped', timestamp: string): { outcome: 'correct' | 'wrong' | 'skipped'; timestamp: string } {
  return { outcome, timestamp }
}

/** 合法 2.0 学习文件文本（可覆盖字段） */
function learningFileText(opts: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    questionPool: numberedQuestions(2),
    flagged: {},
    questionResults: {},
    ...opts,
  })
}

/** 合法 2.0 经济文件文本（可覆盖字段） */
function economyFileText(opts: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    rewards: [makeReward('r1')],
    proposals: [],
    starLedger: [makeEntry('s1', 7), makeEntry('s2', 2, 'redeem')],
    ...opts,
  })
}

/** localStorage 全键快照（逐键相等断言用） */
function snapshotLocalStorage(): Record<string, string> {
  const snap: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null) snap[key] = localStorage.getItem(key) as string
  }
  return snap
}

function expectLocalStorageEquals(before: Record<string, string>): void {
  const after = snapshotLocalStorage()
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
  for (const [key, value] of Object.entries(before)) {
    expect(localStorage.getItem(key)).toBe(value)
  }
}

// ===== 下载 / 文件读取 stub（jsdom 无真实下载与文件选择） =====

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

async function openModal(wrapper: VueWrapper, title: '数据管理' | '流水管理'): Promise<void> {
  const btn = wrapper.findAll('button').find((b) => b.text() === title)
  expect(btn).toBeDefined()
  await btn!.trigger('click')
}

async function selectFile(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.get('.file-input')
  const file = new File([text], 'import.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  stubFileRead(text)
  await input.trigger('change')
  FileReader.prototype.readAsText = originalReadAsText
  await flushPromises()
}

/** seed 一套全家桶数据（全部 sq_* 业务键有实质内容，供逐键相等断言有区分度） */
function seedAllData(): void {
  writeQuestions(numberedQuestions(3))
  writeRewards([makeReward('r1', '菠萝油', 5), makeReward('r2', '看电视', 10)])
  writeStars(makeEntries(4))
  writeFlagged({ '000001': { flaggedAt: 100 } })
  writeQuestionResults({ '000001': [record('correct', '2026-01-01T00:00:00.000Z')] })
}

let wrapper: VueWrapper | undefined

beforeEach(async () => {
  localStorage.clear()
  initAppState()
  // #172：导入确认前未配对设备自动全量备份会触发下载——统一 stub（真实 anchor click 在 happy-dom 会导航跳页）
  stubDownload()
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

// ===== AC-R36-1 学习文件导出 =====

describe('AC-R36-1 学习文件导出（数据管理入口）', () => {
  it('AC-R36-1-1 题池 5 题（2 红旗 + 3 题答题记录）→ 导出 JSON 含且仅含 5 字段：questionPool / flagged / questionResults 全量（含孤儿不过滤），不含 rewards / proposals / starLedger', async () => {
    const pool = numberedQuestions(5)
    writeQuestions(pool)
    const flagged: FlaggedState = {
      '000001': { flaggedAt: 111 },
      '000003': { flaggedAt: 333 },
    }
    writeFlagged(flagged)
    const results: QuestionResultsState = {
      '000001': [record('correct', '2026-01-01T00:00:00.000Z')],
      '000002': [record('wrong', '2026-01-02T00:00:00.000Z')],
      '000004': [record('skipped', '2026-01-03T00:00:00.000Z')],
      ghost_q: [record('correct', '2026-01-04T00:00:00.000Z')], // 孤儿记录（不在题池）→ 导出侧不过滤
    }
    writeQuestionResults(results)
    const now = new Date(2026, 7, 27, 18, 30, 0)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    stubDownload()
    try {
      wrapper = await mountParentApp()
      await openModal(wrapper, '数据管理')
      await wrapper.get('.btn-export').trigger('click')
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      const parsed = JSON.parse(await readBlobText(capturedBlob!)) as Record<string, unknown>
      expect(Object.keys(parsed).sort()).toEqual(['exportedAt', 'flagged', 'questionPool', 'questionResults', 'version'])
      expect(parsed.version).toBe('3.0')
      expect(parsed.exportedAt).toBe(now.toISOString())
      expect(parsed.questionPool).toEqual(pool.map((q) => ({ ...q, category: '学科', book: '默认' })))
      expect(parsed.flagged).toEqual(Object.fromEntries(Object.entries(flagged).map(([id, f]) => [id, { ...f, childId: 'default' }])))
      expect(parsed.questionResults).toEqual(Object.fromEntries(Object.entries(results).map(([id, rows]) => [id, rows.map((r) => ({ ...r, childId: 'default' }))])))
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC-R36-1-2 题池 0 题 / 红旗空 / 答题记录空 → 文件为空形状 { version "3.0"（#173 升位）, exportedAt, questionPool [], flagged {}, questionResults {} }，导出流程不报错', async () => {
    writeQuestions([]) // 清空内置初始题库
    stubDownload()
    let text = ''
    expect(() => {
      downloadDataExport(new Date(2026, 7, 27, 12, 0, 0))
    }).not.toThrow()
    text = await readBlobText(capturedBlob!)
    expect(JSON.parse(text)).toEqual({
      version: '3.0',
      exportedAt: new Date(2026, 7, 27, 12, 0, 0).toISOString(),
      questionPool: [],
      flagged: {},
      questionResults: {},
    })
  })

  it('AC-R36-1-3 导出文件名为 star-quiz-learning-{YYYYMMDD-HHmmss}.json 格式（自主决策 #2）', () => {
    const now = new Date(2026, 7, 27, 9, 5, 7)
    expect(formatExportFilename('learning', now)).toBe('star-quiz-learning-20260827-090507.json')
    expect(formatExportFilename('learning', now)).toMatch(/^star-quiz-learning-\d{8}-\d{6}\.json$/)
  })
})

// ===== AC-R36-2 经济文件导出 =====

describe('AC-R36-2 经济文件导出（流水管理入口）', () => {
  it('AC-R36-2-1（#75 随动）兑换项 3 项 + 流水 10 条 → 导出 JSON 含且仅含 6 字段：rewards 全量 / proposals（sq_proposals 全量，本用例空态 []）/ starLedger 全量 / activeRedemptions（sq_active_redemptions 全量，本用例空态 []），不含 questionPool / flagged / questionResults', async () => {
    const rewards = [makeReward('r1', '菠萝油', 5), makeReward('r2', '看电视', 10), makeReward('r3', '寿喜锅', 25)]
    const ledger = makeEntries(10)
    writeRewards(rewards)
    writeStars(ledger)
    writeQuestions(numberedQuestions(3))
    const now = new Date(2026, 7, 27, 18, 31, 5)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    stubDownload()
    try {
      wrapper = await mountParentApp()
      await openModal(wrapper, '流水管理')
      await wrapper.get('.btn-export').trigger('click')
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      expect(capturedFilename).toMatch(/^star-quiz-economy-\d{8}-\d{6}\.json$/)
      const parsed = JSON.parse(await readBlobText(capturedBlob!)) as Record<string, unknown>
      expect(Object.keys(parsed).sort()).toEqual(['activeRedemptions', 'exportedAt', 'proposals', 'rewards', 'starLedger', 'version'])
      expect(parsed.version).toBe('2.4')
      expect(parsed.exportedAt).toBe(now.toISOString())
      expect(parsed.rewards).toEqual(rewards)
      expect(parsed.proposals).toEqual([])
      expect(parsed.starLedger).toEqual(ledger.map((s) => ({ ...s, childId: 'default', kind: 'main' })))
      expect(parsed.activeRedemptions).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC-R36-2-2（R32 口径更新；#75 随动第五参）proposals 为第二参数全量透传（不再恒 []，R32 REQ-R32-8-1）、activeRedemptions 为第四参数全量透传（#75），学习导出不含 proposals、学习域源码零 proposals 元素访问（保护边界）', () => {
    const proposals: ProposalRecord[] = [
      {
        id: 'p1',
        name: '公园野餐',
        price: 5,
        status: 'agreed',
        createdAt: 1000,
        updatedAt: 2000,
        description: '',
        parentStatus: 'agreed',
        childStatus: 'agreed',
        initiator: 'parent',
        lastActionBy: 'parent',
        lastActionKind: 'proposed',
      },
    ]
    const redemptions: ActiveRedemption[] = [
      { id: 'ar1', rewardId: 'r1', name: '看电视', emoji: '📺', createdAt: 1000 },
    ]
    expect(buildEconomyExport([], proposals, [], redemptions, NOW).proposals).toEqual(proposals.map((p) => ({ ...p, childId: 'default' })))
    expect(buildEconomyExport([], proposals, [], redemptions, NOW).activeRedemptions).toEqual(redemptions.map((r) => ({ ...r, childId: 'default' })))
    expect(buildEconomyExport([], [], [], [], NOW).proposals).toEqual([])
    expect(buildEconomyExport([], [], [], [], NOW).activeRedemptions).toEqual([])

    // 学习导出（LearningExport '2.0'）不含经济字段 proposals / activeRedemptions（R32 / #75 非目标：学习契约不动）
    const learning = buildLearningExport([], {}, {}, NOW)
    expect('proposals' in learning).toBe(false)
    expect('activeRedemptions' in learning).toBe(false)

    // 源码 grep（收窄到学习域，R32 非目标保护边界）：useLearningData 不触碰 proposals 元素
    const learningDataSource = readFileSync(resolve(process.cwd(), 'src', 'composables', 'useLearningData.ts'), 'utf-8')
    expect(learningDataSource).not.toMatch(/proposals\s*\[/)
    expect(learningDataSource).not.toMatch(/proposals\.(map|forEach|filter|reduce|length|some|every|find|at)\b/)
  })
})

// ===== AC-R36-3 版本白名单与 1.x 断代 =====

describe('AC-R36-3 版本白名单与 1.x 断代', () => {
  it('AC-R36-3-1 学习文件 version 1.0 / 1.1 / 1.2 → 「数据管理」导入均被拒绝、展示「文件版本过旧，请用最新版重新导出」、localStorage 全部键值逐键相等', async () => {
    for (const legacy of ['1.0', '1.1', '1.2']) {
      localStorage.clear()
      initAppState()
      seedAllData()
      const before = snapshotLocalStorage()
      wrapper?.unmount()
      wrapper = await mountParentApp()
      await openModal(wrapper, '数据管理')
      await selectFile(wrapper, learningFileText({ version: legacy }))

      expect(wrapper.find('.confirm-modal').exists(), `version ${legacy} 不进二次确认`).toBe(false)
      const err = wrapper.find('.import-error')
      expect(err.exists(), `version ${legacy} 有错误提示`).toBe(true)
      // #172：「版本不支持」档共用户文案（不再直出内部 reason）
      expect(err.text()).toBe(copy.parent.importFailChecked)
      expectLocalStorageEquals(before)
      wrapper.unmount()
      wrapper = undefined
    }
  })

  it('AC-R36-3-2 经济文件 version "1.0" → 「流水管理」导入被拒绝、同一提示文案、localStorage 全部键值不变', async () => {
    seedAllData()
    const before = snapshotLocalStorage()
    wrapper = await mountParentApp()
    await openModal(wrapper, '流水管理')
    await selectFile(wrapper, economyFileText({ version: '1.0' }))

    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    const err = wrapper.find('.import-error')
    expect(err.exists()).toBe(true)
    // #172：「版本不支持」档共用户文案
    expect(err.text()).toBe(copy.parent.importFailChecked)
    expectLocalStorageEquals(before)
  })

  it('AC-R36-3-3 version "2.0" 且其余字段合法 → 两组校验均通过（版本校验通过即进入字段校验与二次确认流程）', () => {
    const learning = validateLearningImport(learningFileText())
    expect(learning.ok).toBe(true)

    const economy = validateEconomyImport(economyFileText())
    expect(economy.ok).toBe(true)
  })

  it('AC-R36-3-4（R32 口径更新；#75 随动）学习：非 2.0 且非 1.x（2.1 / 2.2 / 3.0 / abc）→ 拒绝「不支持的导出版本」；经济：2.1 / 2.2 合法（R32 REQ-R32-8-2 / #75 扩白名单）、3.0 / abc 拒绝；入口侧 localStorage 零变化', async () => {
    for (const version of ['2.1', '2.2', '4.0', 'abc']) { // #173：学习 3.0 合法（新版），未知版换 4.0
      const learning = validateLearningImport(learningFileText({ version }))
      expect(learning.ok, `学习 ${version}`).toBe(false)
      if (!learning.ok) expect(learning.reason).toContain('不支持的导出版本')
    }

    // R32 / #75 / #173：经济白名单 ['2.0'~'2.3']——2.1 / 2.2 / 2.3 照常导入，学习白名单 ['2.0','3.0']
    const economy21 = validateEconomyImport(economyFileText({ version: '2.1' }))
    expect(economy21.ok, '经济 2.1').toBe(true)
    const economy22 = validateEconomyImport(economyFileText({ version: '2.2', activeRedemptions: [] }))
    const economy23 = validateEconomyImport(economyFileText({ version: '2.3', activeRedemptions: [] }))
    expect(economy23.ok).toBe(true)
    expect(economy22.ok, '经济 2.2').toBe(true)
    for (const version of ['3.0', 'abc']) {
      const economy = validateEconomyImport(economyFileText({ version }))
      expect(economy.ok, `经济 ${version}`).toBe(false)
      if (!economy.ok) expect(economy.reason).toContain('不支持的导出版本')
    }

    // 入口侧行为：数据管理导入 version "4.0" → 现有数据逐键零变化
    seedAllData()
    const before = snapshotLocalStorage()
    wrapper = await mountParentApp()
    await openModal(wrapper, '数据管理')
    await selectFile(wrapper, learningFileText({ version: '4.0' }))
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // #172：「版本不支持」档共用户文案（不再直出内部 reason）
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    expectLocalStorageEquals(before)
  })

  it('AC-R36-3-5 缺 version 字段或非字符串 → 两组导入均拒绝「缺少 version 字段」（自主决策 #4）', () => {
    const noVersion = { exportedAt: NOW, questionPool: [], flagged: {}, questionResults: {} }
    const learning = validateLearningImport(JSON.stringify(noVersion))
    expect(learning.ok).toBe(false)
    if (learning.ok) return
    expect(learning.reason).toContain('缺少 version 字段')

    const economyNoVersion = validateEconomyImport(JSON.stringify({ exportedAt: NOW, rewards: [], proposals: [], starLedger: [] }))
    expect(economyNoVersion.ok).toBe(false)
    if (economyNoVersion.ok) return
    expect(economyNoVersion.reason).toContain('缺少 version 字段')

    for (const bad of [42, null, ['2.0']]) {
      const learningBad = validateLearningImport(learningFileText({ version: bad }))
      expect(learningBad.ok).toBe(false)
      if (learningBad.ok) return
      expect(learningBad.reason).toContain('缺少 version 字段')
    }
  })
})

// ===== AC-R36-4 数据管理导入 = 学习文件 =====

describe('AC-R36-4 数据管理导入 = 学习文件（R21 覆盖 / 追加语义）', () => {
  it('AC-R36-4-1 覆盖：本地兑换项 4 项 + 文件 6 题 / 1 红旗 / 2 题记录（含孤儿）→ 三学习键整体替换（孤儿删除）、sq_rewards 保持 4 项不变', async () => {
    const localRewards = [makeReward('r1'), makeReward('r2'), makeReward('r3'), makeReward('r4')]
    writeRewards(localRewards)
    writeQuestions(numberedQuestions(2, 90))
    const filePool = numberedQuestions(6)
    const fileFlagged: FlaggedState = { '000002': { flaggedAt: 222 } }
    const fileResults: QuestionResultsState = {
      '000001': [record('correct', '2026-01-01T00:00:00.000Z')],
      '000003': [record('wrong', '2026-01-02T00:00:00.000Z')],
      '999999': [record('skipped', '2026-01-03T00:00:00.000Z')], // 孤儿：不在文件题池 → 被删除
    }
    wrapper = await mountParentApp()
    await openModal(wrapper, '数据管理')
    await selectFile(wrapper, learningFileText({ questionPool: filePool, flagged: fileFlagged, questionResults: fileResults }))

    const confirm = wrapper.find('.confirm-modal')
    expect(confirm.exists()).toBe(true)
    await confirm.findAll('.confirm-ok').find((b) => b.text() === '导入并重置')!.trigger('click')

    expect(readQuestions()).toEqual(filePool.map((q) => ({ ...q, difficulty: 3, category: '学科', book: '默认' })))
    expect(readFlagged()).toEqual({ '000002': { flaggedAt: 222, childId: 'default' } })
    expect(readQuestionResults()).toEqual({
      '000001': [{ ...fileResults['000001'][0], childId: 'default' }],
      '000003': [{ ...fileResults['000003'][0], childId: 'default' }],
    })
    // sq_rewards 不被数据管理导入触碰（§D6 有意变更）
    expect(readRewards()).toEqual(localRewards)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC-R36-4-2 追加：本地 3 题（最大序号 000003）+ 文件 2 题 → 本地变 5 题、新题 id 按现有最大序号 +1 连续生成（文件 id 被忽略）、红旗 / 答题记录 / 兑换项均不变', async () => {
    const localPool = numberedQuestions(3)
    writeQuestions(localPool)
    const localFlagged: FlaggedState = { '000001': { flaggedAt: 111 } }
    const localResults: QuestionResultsState = { '000002': [record('correct', '2026-01-01T00:00:00.000Z')] }
    writeFlagged(localFlagged)
    writeQuestionResults(localResults)
    const localRewards = [makeReward('r1')]
    writeRewards(localRewards)
    // 文件 2 题：id 与本地冲突也不参与（追加忽略文件 id；#234 起 9 号段为内置保留段，示例用普通大序号）
    const filePool = [makeQuestion('100001', 'w9a'), makeQuestion('100002', 'w9b')]
    wrapper = await mountParentApp()
    await openModal(wrapper, '数据管理')
    await selectFile(wrapper, learningFileText({ questionPool: filePool }))

    const confirm = wrapper.find('.confirm-modal')
    await confirm.findAll('.confirm-ok').find((b) => b.text() === '导入并追加')!.trigger('click')

    const after = readQuestions()
    expect(after).toHaveLength(5)
    expect(after.slice(0, 3)).toEqual(localPool)
    expect(after[3]).toEqual({ ...filePool[0], id: '000004', difficulty: 3, category: '学科', book: '默认' })
    expect(after[4]).toEqual({ ...filePool[1], id: '000005', difficulty: 3, category: '学科', book: '默认' })
    expect(readFlagged()).toEqual(localFlagged)
    expect(readQuestionResults()).toEqual(localResults)
    expect(readRewards()).toEqual(localRewards)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC-R36-4-3（#173 修订：wordId 可空）缺 wordId → 合法（trivia 口径）；wordId 类型非法 → 整文件拒绝（覆盖 / 追加任一模式：校验先于模式选择）', () => {
    const noWordId = validateLearningImport(learningFileText({ questionPool: [numberedQuestions(1)[0], { ...numberedQuestions(2, 2)[1], wordId: undefined }] }))
    expect(noWordId.ok).toBe(true)
    const bad = validateLearningImport(learningFileText({ questionPool: [numberedQuestions(1)[0], { ...numberedQuestions(2, 2)[1], wordId: 42 as never }] }))
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.reason).toContain('questionPool 第 2 条')
    expect(bad.reason).toContain('wordId')
  })

  it('AC-R36-4-4 questionResults 非对象 / 某题值非数组 / 记录元素缺 outcome → 均整文件拒绝', () => {
    const nonObject = validateLearningImport(learningFileText({ questionResults: 'x' }))
    expect(nonObject.ok).toBe(false)

    const nonArray = validateLearningImport(learningFileText({ questionResults: { '000001': { outcome: 'correct' } } }))
    expect(nonArray.ok).toBe(false)

    const noOutcome = validateLearningImport(learningFileText({ questionResults: { '000001': [{ timestamp: '2026-01-01T00:00:00.000Z' }] } }))
    expect(noOutcome.ok).toBe(false)
  })

  it('AC-R36-4-5 difficulty: 5 → 整文件拒绝；缺 difficulty → 校验通过且物理补 3（覆盖入库即该值）', () => {
    const bad = validateLearningImport(learningFileText({ questionPool: [{ ...numberedQuestions(1)[0], difficulty: 5 as unknown as 1 }] }))
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.reason).toContain('difficulty')

    const ok = validateLearningImport(learningFileText())
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    for (const q of ok.data.questionPool) expect(q.difficulty).toBe(3)
  })

  it('AC-R36-4-6 追加模式下 flagged / questionResults 含非法结构 → 整文件拒绝（文件仍纳入原子校验，自主决策 #6）', () => {
    const badFlagged = validateLearningImport(learningFileText({ flagged: { '000001': { flaggedAt: 'x' as unknown as number } } }))
    expect(badFlagged.ok).toBe(false)

    const badResults = validateLearningImport(learningFileText({ questionResults: 'x' }))
    expect(badResults.ok).toBe(false)
    // 校验失败即无模式可选——「追加」与「覆盖」同一文件同一拒绝结果（#69 起不校验 correct，改用缺 flaggedAt）
    const badFlaggedAgain = validateLearningImport(learningFileText({ flagged: { '000001': { correct: true } } }))
    expect(badFlaggedAgain.ok).toBe(false)
  })
})

// ===== AC-R36-5 流水管理导入 = 经济文件 =====

describe('AC-R36-5 流水管理导入 = 经济文件（覆盖式）', () => {
  it('AC-R36-5-1 本地 2 兑换项 / 8 条流水 + 文件 5 兑换项 / 12 条流水 / proposals [] → sq_rewards 与 sq_stars 整体替换，三学习键不变', async () => {
    writeRewards([makeReward('old1'), makeReward('old2')])
    writeStars(makeEntries(8))
    writeQuestions(numberedQuestions(3))
    const localFlagged: FlaggedState = { '000001': { flaggedAt: 111 } }
    const localResults: QuestionResultsState = { '000001': [record('correct', '2026-01-01T00:00:00.000Z')] }
    writeFlagged(localFlagged)
    writeQuestionResults(localResults)

    const fileRewards = Array.from({ length: 5 }, (_, i) => makeReward(`fr${i + 1}`, `奖励${i + 1}`, i + 2))
    const fileLedger = makeEntries(12)
    wrapper = await mountParentApp()
    await openModal(wrapper, '流水管理')
    await selectFile(wrapper, economyFileText({ rewards: fileRewards, starLedger: fileLedger, proposals: [] }))
    await wrapper.get('.confirm-ok').trigger('click')

    expect(readRewards()).toEqual(fileRewards)
    // #173：2.0 旧文件流水导入补 kind=主星 + childId=默认孩子
    expect(readStars()).toEqual(fileLedger.map((e) => ({ ...e, kind: 'main', childId: 'default' })))
    expect(readQuestions()).toEqual(numberedQuestions(3))
    expect(readFlagged()).toEqual(localFlagged)
    expect(readQuestionResults()).toEqual(localResults)
    expect(wrapper.find('.import-success').text()).toBe('导入成功')
  })

  it('AC-R36-5-2（R32 口径更新）2.1 文件 proposals 为非数组值（对象 / 字符串 / 数字）或字段缺失 → 整文件拒绝（2.0 proposals 无条件兜底 [] 由 35-R32 验收断言）', () => {
    for (const bad of [{}, 'x', 42]) {
      const result = validateEconomyImport(economyFileText({ version: '2.1', proposals: bad }))
      expect(result.ok, `proposals ${JSON.stringify(bad)}`).toBe(false)
      if (result.ok) return
      expect(result.reason).toContain('proposals')
    }
    const { proposals: _omit, ...rest } = JSON.parse(economyFileText({ version: '2.1' })) as Record<string, unknown>
    const missing = validateEconomyImport(JSON.stringify(rest))
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.reason).toContain('proposals')
  })

  it('AC-R36-5-3 starLedger 第 3 条 amount: -1（或 rewards 第 1 条 price: 0）→ 整文件拒绝', () => {
    const badLedger = validateEconomyImport(economyFileText({ starLedger: [makeEntry('s1'), makeEntry('s2'), { ...makeEntry('s3'), amount: -1 }] }))
    expect(badLedger.ok).toBe(false)
    if (badLedger.ok) return
    expect(badLedger.reason).toContain('starLedger 第 3 条')
    expect(badLedger.reason).toContain('amount')

    const badReward = validateEconomyImport(economyFileText({ rewards: [makeReward('r1', '奖励', 0)] }))
    expect(badReward.ok).toBe(false)
    if (badReward.ok) return
    expect(badReward.reason).toContain('rewards 第 1 条')
    expect(badReward.reason).toContain('price')
  })

  it('AC-R36-5-4 流水确认弹窗展示计数「兑换项 M 项 + 流水 K 条」（M = 文件兑换项数、K = 文件流水条数），且无「覆盖 / 追加」模式选择', async () => {
    const fileRewards = [makeReward('fr1'), makeReward('fr2')]
    const fileLedger = makeEntries(3)
    wrapper = await mountParentApp()
    await openModal(wrapper, '流水管理')
    await selectFile(wrapper, economyFileText({ rewards: fileRewards, starLedger: fileLedger }))

    const confirm = wrapper.find('.confirm-modal')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('兑换项 2 项 + 流水 3 条')
    // R32（Spec D6 有意变更 / 自主决策 #6）：confirmEconomyImport 扩三参（M 兑换项 / P 提议 / K 流水）
    expect(confirm.text()).toContain(copy.parent.confirmEconomyImport(2, 0, 3))
    // 流水管理仅覆盖式一路：无覆盖 / 追加选择，确认动作按钮仅一个
    expect(confirm.text()).not.toContain('导入并重置')
    expect(confirm.text()).not.toContain('导入并追加')
    expect(confirm.findAll('.confirm-ok')).toHaveLength(1)
    expect(confirm.get('.confirm-ok').text()).toBe('确认')
  })
})

// ===== AC-R36-6 家长页入口与确认文案 =====

describe('AC-R36-6 家长页入口与确认文案（组件 DOM 断言）', () => {
  it('AC-R36-6-1 「数据管理」「流水管理」两入口按钮均存在，且分别触发学习 / 经济文件的导入流程（入口结构不变）', async () => {
    wrapper = await mountParentApp()
    const buttons = wrapper.findAll('button')
    expect(buttons.find((b) => b.text() === '数据管理')).toBeDefined()
    expect(buttons.find((b) => b.text() === '流水管理')).toBeDefined()

    // 分流正向：学习文件 → 数据管理进二次确认；经济文件 → 流水管理进二次确认（#59：关闭钮选择器迁组件类名）
    await openModal(wrapper, '数据管理')
    await selectFile(wrapper, learningFileText())
    expect(wrapper.find('.confirm-modal').exists()).toBe(true)
    await wrapper.find('.confirm-cancel').trigger('click')
    await wrapper.get('.star-modal__close').trigger('click')

    await openModal(wrapper, '流水管理')
    await selectFile(wrapper, economyFileText())
    expect(wrapper.find('.confirm-modal').exists()).toBe(true)
    await wrapper.find('.confirm-cancel').trigger('click')
    await wrapper.get('.star-modal__close').trigger('click')

    // 分流反向：学习文件在流水管理入口被拒（缺经济字段）；经济文件在数据管理入口被拒（缺学习字段）
    await openModal(wrapper, '流水管理')
    await selectFile(wrapper, learningFileText())
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // #172：分流拒绝为「校验不过」档共用户文案
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
    await wrapper.get('.star-modal__close').trigger('click')

    await openModal(wrapper, '数据管理')
    await selectFile(wrapper, economyFileText())
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    // #172：分流拒绝为「校验不过」档共用户文案
    expect(wrapper.find('.import-error').text()).toBe(copy.parent.importFailChecked)
  })

  it('AC-R36-6-2 学习文件 6 题校验通过 → 数据管理确认弹窗展示「6 题」计数，「覆盖」「追加」两选项均无预选中状态', async () => {
    const before = [numberedQuestions(1, 50)[0]]
    writeQuestions(before)
    wrapper = await mountParentApp()
    await openModal(wrapper, '数据管理')
    await selectFile(wrapper, learningFileText({ questionPool: numberedQuestions(6) }))

    const confirm = wrapper.find('.confirm-modal')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('6 题')
    expect(confirm.text()).toContain(copy.parent.confirmLearningImport(6))
    // 双选项存在：覆盖（导入并重置）/ 追加（导入并追加）
    const okButtons = confirm.findAll('.confirm-ok')
    expect(okButtons).toHaveLength(2)
    expect(okButtons.map((b) => b.text()).sort()).toEqual(['导入并追加', '导入并重置'])
    // 无预选中：无任何选中态标记（radio / checkbox / aria-pressed）
    expect(confirm.find('input[type="radio"]').exists()).toBe(false)
    expect(confirm.find('input[type="checkbox"]').exists()).toBe(false)
    expect(confirm.find('[aria-pressed="true"]').exists()).toBe(false)
    // 弹窗仅展示不自动执行：未点击任何选项前题库无写入
    expect(readQuestions()).toEqual(before)
  })

  it('AC-R36-6-3 导入文件版本校验失败（1.x）→ 页面出现「版本不支持」档共用户文案（#172，以 copy.ts 槽位为准）', async () => {
    wrapper = await mountParentApp()
    await openModal(wrapper, '数据管理')
    await selectFile(wrapper, learningFileText({ version: '1.2' }))
    const err = wrapper.find('.import-error')
    expect(err.exists()).toBe(true)
    expect(err.text()).toBe(copy.parent.importFailChecked)
  })
})

// ===== AC-R36-7 类型重构与数据版本 =====

describe('AC-R36-7 类型重构与数据版本', () => {
  it('AC-R36-7-1 LearningExport / EconomyExport 契约类型已定义（tsc 级），DataExport / LedgerExport 在 src/ 零引用（grep 断言）', () => {
    expectTypeOf<LearningExport['version']>().toEqualTypeOf<'2.0' | '3.0'>()
    expectTypeOf<LearningExport['flagged']>().toEqualTypeOf<FlaggedState>()
    expectTypeOf<LearningExport['questionResults']>().toEqualTypeOf<QuestionResultsState>()
    expectTypeOf<EconomyExport['version']>().toEqualTypeOf<'2.0' | '2.1' | '2.2' | '2.3' | '2.4'>()
    expectTypeOf<EconomyExport['proposals']>().toEqualTypeOf<ProposalRecord[]>()
    expectTypeOf<EconomyExport['starLedger']>().toEqualTypeOf<StarEntry[]>()
    expectTypeOf<EconomyExport['activeRedemptions']>().toEqualTypeOf<ActiveRedemption[]>()

    // grep：src/ 源码（跳过 __tests__）无退役类型独立标识符
    // \b 词边界：downloadDataExport 等含同尾子串的合法函数名不命中
    function collectSrcFiles(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue
          collectSrcFiles(p, out)
        } else if (/\.(ts|vue)$/.test(entry.name)) {
          out.push(p)
        }
      }
      return out
    }
    const files = collectSrcFiles(resolve(process.cwd(), 'src'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      expect(source, file).not.toMatch(/\bDataExport\b/)
      expect(source, file).not.toMatch(/\bLedgerExport\b/)
    }
  })

  it('AC-R36-7-2（R32 口径更新；#69 起 7→8 红旗瘦身迁移）完整走导出 + 导入流程 → sq_data_version 前后相等，无升级备份触发（R32 的 5→6 与 #63 的 6→7 在 useProposals.ts、#69 的 7→8 在 useLearningData.ts）', async () => {
    // R32 起数据版本 6、#63 起 7、#69 起 8（REQ-R32-6-2 + 拍板 2026-08-30）：提议域迁移在 useProposals.ts，学习域红旗瘦身在 useLearningData.ts
    expect(CURRENT_DATA_VERSION).toBe(9)
    const learningDataSource = readFileSync(resolve(process.cwd(), 'src', 'composables', 'useLearningData.ts'), 'utf-8')
    expect(learningDataSource).not.toMatch(/\b5:\s*migrate\w*/)
    expect(learningDataSource).toMatch(/\b7:\s*migrateStripFlaggedCorrect/)
    const proposalsSource = readFileSync(resolve(process.cwd(), 'src', 'composables', 'useProposals.ts'), 'utf-8')
    expect(proposalsSource).toMatch(/registerMigrations\(\{\s*5:\s*migrateInitProposals,\s*6:\s*migrateProposalsLastAction\s*\}\)/)

    // 完整流程：导出（两组）+ 导入（两组确认）→ sq_data_version 不动、无额外备份下载触发
    seedAllData()
    const versionBefore = localStorage.getItem('sq_data_version')
    expect(versionBefore).toBe('9')
    stubDownload()
    wrapper = await mountParentApp()

    await openModal(wrapper, '数据管理')
    await wrapper.get('.btn-export').trigger('click')
    await selectFile(wrapper, learningFileText({ questionPool: numberedQuestions(2) }))
    await wrapper.get('.confirm-ok').trigger('click') // 覆盖（导入并重置）
    await wrapper.get('.star-modal__close').trigger('click')

    await openModal(wrapper, '流水管理')
    await wrapper.get('.btn-export').trigger('click')
    await selectFile(wrapper, economyFileText())
    await wrapper.get('.confirm-ok').trigger('click')
    await wrapper.get('.star-modal__close').trigger('click')

    expect(localStorage.getItem('sq_data_version')).toBe(versionBefore)
    expect(readQuestions()).toEqual(numberedQuestions(2).map((q) => ({ ...q, difficulty: 3, category: '学科', book: '默认' })))
    expect(readRewards()).toEqual([makeReward('r1')])
    expect(readStars()).toEqual([makeEntry('s1', 7), makeEntry('s2', 2, 'redeem')].map((s) => ({ ...s, childId: 'default', kind: 'main' })))
    // 两次显式导出 + #172 两次导入确认前的未配对自动备份（学习 + 经济各一份）= 6；无迁移备份额外触发（版本未递增 → init 相等分支零动作）
    expect(createObjectURLSpy).toHaveBeenCalledTimes(6)
  })
})

// ===== #125（R-P1c）：配对凭据为设备本地键（ADR 0002）——不进学习 / 经济文件导出 =====

describe('#125 配对凭据不进导出（设备本地键，ADR 0002）', () => {
  it('已配对设备导出两组文件：JSON 均无凭据键名与凭据值；导出域源码零凭据键引用', async () => {
    localStorage.setItem(
      'sq_device_credential',
      JSON.stringify({ device_id: 'dev-cred-987654321', secret: 'CRED-SECRET-abcdef0123456789', role: 'parent', name: '家长手机' }),
    )
    seedAllData()
    stubDownload()

    downloadDataExport(new Date(2026, 8, 3, 12, 0, 0))
    const learningText = await readBlobText(capturedBlob!)
    downloadLedgerExport(new Date(2026, 8, 3, 12, 0, 1))
    const economyText = await readBlobText(capturedBlob!)

    for (const text of [learningText, economyText]) {
      expect(text).not.toContain('sq_device_credential')
      expect(text).not.toContain('device_credential')
      expect(text).not.toContain('dev-cred-987654321')
      expect(text).not.toContain('CRED-SECRET-abcdef0123456789')
    }

    // 源码门禁：导出域两文件零凭据键引用（凭据读写唯一出口在 useDeviceCredential.ts）
    const importExportSource = readFileSync(resolve(process.cwd(), 'src', 'utils', 'importExport.ts'), 'utf-8')
    const useExportSource = readFileSync(resolve(process.cwd(), 'src', 'composables', 'useExport.ts'), 'utf-8')
    for (const source of [importExportSource, useExportSource]) {
      expect(source).not.toMatch(/device_credential/)
    }
  })
})
