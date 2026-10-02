/**
 * 提议板流程验收（#95 归并：原 35-R32 提议空间 / 36-R33 控时发布 / 37-R34 孩子端提议板 三份逐票验收）
 * 验收视角：从 Spec AC 独立生成 Given-When-Then 行为断言（渲染文本 / DOM 元素 / localStorage 落盘值 /
 * 路由跳转与 meta.view / 文件 grep），不从实现源码反推；文案断言一律引用 copy 槽位值。
 * 时钟注入：涉时间戳断言的用例走 vi.setSystemTime 固定系统时间，不依赖真实系统时间（发布窗口已随 #265 删除）。
 * 迁移备份：vi.mock useExport（本文件断言触发次数的组沿原 35-R32 口径；剪环后备份注册上移组合根，
 * 测试扮演 main.ts 注册一次，与生产同构）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProposalRecord, RewardItem, StarEntry, Question } from '../../src/types'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState, registerMigrationBackup } from '../../src/composables/useDataInfra'
import {
  proposals as readProposals,
  writeProposals,
  create as createProposal,
  update as updateProposal,
  setAgreed,
  voidProposal,
  publish,
} from '../../src/composables/useProposals'
import {
  rewards as readRewards,
  writeRewards,
  redeem,
  ledger as readStars,
  writeLedger as writeStars,
} from '../../src/composables/useStarData'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
import { buildEconomyExport, validateEconomyImport, validateLearningImport } from '../../src/utils/importExport'
import { deriveState, onContentChange, canPublish } from '../../src/utils/proposalState'
import { copy } from '../../src/copy'
import {
  downloadDataExport,
  downloadLedgerExport,
  runMigrationBackup,
} from '../../src/composables/useExport'

// AC-R32-9：迁移备份下载动作计数（mock 空实现——相关组只断言触发次数，不断言备份内容）。
// 剪环后备份注册上移组合根：测试扮演 main.ts 注册一次（与生产同构，架构评审 20260829）
vi.mock('../../src/composables/useExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/composables/useExport')>()
  const downloadDataExport = vi.fn()
  const downloadLedgerExport = vi.fn()
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
registerMigrationBackup(runMigrationBackup)

const mockedDownloadData = vi.mocked(downloadDataExport)
const mockedDownloadLedger = vi.mocked(downloadLedgerExport)

const NOW = '2026-08-27T10:30:00.000Z'
const PROPOSALS_KEY = 'sq_proposals'
/** Spec 文案白名单（简报锁定文本，AC-R33-8/9 断言基准） */

// ===== seed 工具 =====

function makeProposal(id: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  const ts = 1000
  return {
    id,
    name: `提议${id}`,
    price: 5,
    status: 'discussing',
    createdAt: ts,
    updatedAt: ts,
    description: '',
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

function makeReward(id: string, name = '奖励', price = 3): RewardItem {
  return { id, name, price }
}

function makeEntry(id: string, amount = 1, type: 'earn' | 'redeem' = 'earn'): StarEntry {
  return { id, timestamp: 1724230000000, type, amount, source: type === 'earn' ? '答题得星' : '兑换：菠萝油' }
}

function makeQuestion(id: string): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: id }
}

/** localStorage 全键快照（原子拒绝零变更断言用） */
function snapshotLocalStorage(): Record<string, string> {
  const snap: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null) snap[key] = localStorage.getItem(key) as string
  }
  return snap
}

/** 合法 2.1 经济文件文本（默认 2 兑换项 + 1 条 discussing 提议 + 2 条流水；可覆盖字段） */
function economy21FileText(opts: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.1',
    exportedAt: NOW,
    rewards: [makeReward('fr1'), makeReward('fr2')],
    proposals: [makeProposal('fp1')],
    starLedger: [makeEntry('fs1', 7), makeEntry('fs2', 2, 'redeem')],
    ...opts,
  })
}

/** 合法 2.0 经济文件文本（R36 导出产物形态：proposals 空位） */
function economy20FileText(opts: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    rewards: [makeReward('fr1')],
    proposals: [],
    starLedger: [makeEntry('fs1', 7)],
    ...opts,
  })
}

/** 合法 2.0 学习文件文本 */
function learning20FileText(opts: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    questionPool: [makeQuestion('fq1')],
    flagged: {},
    questionResults: {},
    ...opts,
  })
}

// ===== 文件读取 stub（jsdom 无真实文件选择） =====

const originalReadAsText = FileReader.prototype.readAsText

function stubFileRead(text: string): void {
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'result', { value: text, configurable: true })
    this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
  })
}

async function selectFile(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.get('.file-input')
  const file = new File([text], 'import.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  stubFileRead(text)
  await input.trigger('change')
  FileReader.prototype.readAsText = originalReadAsText
}

async function openLedgerModal(wrapper: VueWrapper): Promise<void> {
  const ledgerBtn = wrapper.findAll('button').find((b) => b.text() === '流水管理')
  expect(ledgerBtn).toBeDefined()
  await ledgerBtn!.trigger('click')
}

// ===== 挂载 helper =====

let wrapper: VueWrapper | undefined

async function mountApp(path: string): Promise<VueWrapper> {
  // 卸载旧实例 + 先重置到无关路由：目标路由组件全新挂载（视角按路由 meta 重新判定）
  wrapper?.unmount()
  await router.replace('/')
  const w = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await router.replace(path)
  await flushPromises()
  wrapper = w
  return w
}

/** 按精确文本找按钮并点击（导航 / 表单 / 卡片操作通用，原 37-R34） */
async function clickButton(w: VueWrapper, text: string): Promise<void> {
  const btn = w.findAll('button').find((b) => b.text().trim() === text)
  expect(btn, `按钮「${text}」存在`).toBeDefined()
  await btn!.trigger('click')
  await flushPromises()
}

/** 按精确文本找入口交互元素（button 或路由 <a>；兑换页底部入口用，原 37-R34） */
function findEntry(w: VueWrapper, text: string): HTMLElement {
  const interactive = [...w.element.querySelectorAll('button, a')].filter(
    (el) => (el.textContent ?? '').trim() === text,
  )
  if (interactive.length > 0) return interactive[0] as HTMLElement
  const leaf = [...w.element.querySelectorAll('*')].find(
    (el) => (el.textContent ?? '').trim() === text && el.children.length === 0,
  )
  expect(leaf, `入口「${text}」存在`).toBeDefined()
  return leaf as HTMLElement
}

/** 断言当前路由属孩子端提议板路由组（路径前缀 + meta.view，原 37-R34） */
function expectChildRoute(suffix: string): void {
  expect(router.currentRoute.value.path).toBe(`/child/proposals${suffix}`)
  expect(router.currentRoute.value.path).not.toBe(`/proposals${suffix}`) // 与家长端 URL 区分
  expect(router.currentRoute.value.meta.view).toBe('child') // 视角不丢失
}

/** ProposalRecord 落盘字段集（AC-R34-5-4；#63 后含最后动作归因两字段——属提议自身状态而非修改记录；
 *  #299 emoji 可选——存量无键记录经表单修订未改选默认时不落 emoji 键（零物理补键），本组种子无键 → 不含该键） */
const PROPOSAL_RECORD_FIELDS = [
  'childStatus',
  'createdAt',
  'description',
  'id',
  'initiator',
  'lastActionBy',
  'lastActionKind',
  'name',
  'parentStatus',
  'price',
  'status',
  'updatedAt',
]

beforeEach(() => {
  localStorage.clear()
  initAppState()
  // #172：导入确认前未配对设备自动全量备份会触发下载——统一 stub（真实 anchor click 在 happy-dom 会导航跳页）
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers() // 还原真实时钟，防污染后续用例
  FileReader.prototype.readAsText = originalReadAsText
  vi.restoreAllMocks()
})


// ############################################################################
// 以下为原 35-R32 提议空间验收（AC-R32-1 ~ AC-R32-11）
// ############################################################################

// ===== AC-R32-1 家长页入口 =====

describe('AC-R32-1 家长页入口（组件 DOM 断言）', () => {
  it('AC-R32-1-1 .parent-actions 内共 6 个按钮（组件库已降级为 config-link 链接；#136 增出题指令、#132 增家庭管理、#323 增「给家长的话」归档入口）：第 3 位文本 = copy.parent.proposalsEntry；前两个管理按钮 classList 完全一致（既有断言不回归）', async () => {
    wrapper = await mountApp('/parent')
    const buttons = wrapper.get('.parent-actions').findAll('button')
    // #323：5→6（末位新增「给家长的话」，提议板仍是第 3 位、位次零重排）
    expect(buttons).toHaveLength(6)
    expect(buttons[2].text()).toBe(copy.parent.proposalsEntry)
    // D-38 既有契约升级（#38）：按钮统一 StarButtonStandard standard×large（同权重），各自保留语义定位 class
    for (const b of buttons) {
      const cls = b.attributes('class') ?? ''
      expect(cls).toContain('star-button--standard')
      expect(cls).toContain('star-button--large')
    }
    // 组件库入口（2026-09-03 老板拍板）：不再是按钮，为 config-link 超链接且位于按钮区之后
    const link = wrapper.get('.parent-main .config-link')
    expect(link.text()).toBe(copy.parent.componentsLibrary)
    expect(wrapper.get('.parent-actions').element.compareDocumentPosition(link.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('AC-R32-1-2 点击末位按钮 → 路由跳转 /proposals 且 Proposals 页面组件被渲染', async () => {
    wrapper = await mountApp('/parent')
    await wrapper.get('.parent-actions').findAll('button')[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals')
    expect(wrapper.find('[data-page="proposals"]').exists()).toBe(true)
  })
})

// ===== AC-R32-2 列表页分组与卡片 =====

describe('AC-R32-2 列表页分组与卡片', () => {
  it('AC-R32-2-1 4 条提议（沟通中 A < 已达成一致 B < 已发布 C < 已作废 D）→ 已发布 C 不显示（R34 显示前过滤），恰好显示沟通中 + 已达成一致 + 已作废三条：非作废组在前（B → A），作废组整体最后（D）', async () => {
    writeProposals([
      makeProposal('A', { status: 'discussing', createdAt: 1000 }),
      makeProposal('B', { status: 'agreed', createdAt: 2000 }),
      makeProposal('C', { status: 'published', createdAt: 3000 }),
      makeProposal('D', { status: 'voided', createdAt: 4000 }),
    ])
    wrapper = await mountApp('/proposals')
    const ids = wrapper.findAll('.proposal-card').map((c) => c.attributes('data-proposal-id'))
    expect(ids).toEqual(['B', 'A', 'D'])
    expect(wrapper.find('[data-proposal-id="C"]').exists()).toBe(false)
  })

  it('AC-R32-2-2 卡片要素（#63 双阵营卡）：名称文本 + 消耗文本（priceLabel 槽位，前缀★装饰）+ 阵营状态文案（campState 槽位）+ 操作区元素；卡片文本不含 description', async () => {
    writeProposals([makeProposal('p1', { name: '公园野餐', price: 5, description: '周六去公园野餐垫子' })])
    wrapper = await mountApp('/proposals')
    const card = wrapper.get('.proposal-card')
    expect(card.find('.proposal-name').text()).toBe('公园野餐')
    expect(card.find('.proposal-price').text()).toContain(copy.proposals.priceLabel(5))
    // 阵营状态文案（双侧同规则，缺归因字段兜底 by=initiator/proposed）：默认种子（家长发起已同意/孩子未同意，无 lastAction）
    expect(card.text()).toContain(copy.proposals.campStateProposed) // 家长侧（发起人兜底）
    expect(card.text()).toContain(copy.proposals.campStateNotAgreed) // 孩子侧
    expect(card.find('.card-actions').exists()).toBe(true)
    expect(card.text()).not.toContain('周六去公园野餐垫子')
  })

  it('AC-R32-2-3 空列表 → 显示 copy.proposals.emptyState 且「新建提议」按钮存在可点击（空态块走 StarEmptyState 组件契约，#196）', async () => {
    wrapper = await mountApp('/proposals')
    expect(wrapper.get('.star-empty-state').text()).toBe(copy.proposals.emptyState)
    const createBtn = wrapper.get('.create-btn')
    expect(createBtn.text()).toBe(copy.proposals.createProposal)
    await createBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/new')
  })

  it('AC-R32-2-4 discussing 卡片操作区含表态钮（#63 单钮：文案随状态翻转）与「改提议」，不含「代孩子同意」开关元素（R34 移除）与「发布兑换项」按钮；voided 卡片不含表态与发布按钮', async () => {
    writeProposals([
      makeProposal('p1', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'notAgreed' }),
      makeProposal('p2', { status: 'voided' }),
    ])
    wrapper = await mountApp('/proposals')
    const discussing = wrapper.get('[data-proposal-id="p1"]')
    expect(discussing.get('.stance-btn').text()).toBe(copy.proposals.agreeBtn)
    expect(discussing.text()).toContain(copy.proposals.changeBtn)
    expect(discussing.find('.child-agree-toggle').exists()).toBe(false)
    expect(discussing.find('.publish-btn').exists()).toBe(false)
    const voided = wrapper.get('[data-proposal-id="p2"]')
    expect(voided.find('.stance-btn').exists()).toBe(false)
    expect(voided.find('.publish-btn').exists()).toBe(false)
  })
})

// ===== AC-R32-3 新建 / 编辑表单 =====

describe('AC-R32-3 新建 / 编辑表单（页面链路）', () => {
  it('AC-R32-3-1 新建：名称「公园野餐」/ 消耗 5 / 说明「周六去」保存 → sq_proposals 追加 1 条（initiator=parent、parentStatus=agreed、childStatus=notAgreed、status=discussing、createdAt=updatedAt=写入时刻）；返回列表可见新卡片', async () => {
    const T = new Date(2026, 7, 27, 10, 0, 0).getTime()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    try {
      wrapper = await mountApp('/proposals')
      await wrapper.get('.create-btn').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/proposals/new')
      await wrapper.get('.form-name-input').setValue('公园野餐')
      await wrapper.get('.form-price-input').setValue('5')
      await wrapper.get('.form-desc-input').setValue('周六去')
      await wrapper.get('.form-save-btn').trigger('click')
      await flushPromises()

      const list = readProposals()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({
        name: '公园野餐',
        price: 5,
        description: '周六去',
        initiator: 'parent',
        parentStatus: 'agreed',
        childStatus: 'notAgreed',
        status: 'discussing',
      })
      expect(list[0].createdAt).toBe(T)
      expect(list[0].updatedAt).toBe(T)
      // 返回列表可见新卡片
      expect(router.currentRoute.value.path).toBe('/proposals')
      expect(wrapper.find('[data-page="proposals"]').exists()).toBe(true)
      expect(wrapper.get('.proposal-name').text()).toBe('公园野餐')
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC-R32-3-2 编辑已达成一致提议名称保存 → childStatus 重置 notAgreed、parentStatus 不变 agreed、status 回 discussing、updatedAt 刷新；列表该卡片「发布兑换项」按钮消失', async () => {
    const T1 = new Date(2026, 7, 27, 10, 0, 0).getTime()
    writeProposals([makeProposal('p1', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed', createdAt: T1, updatedAt: T1 })])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T1 + 60_000)
    try {
      wrapper = await mountApp(`/proposals/p1/edit`)
      await wrapper.get('.form-name-input').setValue('看电影')
      await wrapper.get('.form-save-btn').trigger('click')
      await flushPromises()

      const updated = readProposals()[0]
      expect(updated.name).toBe('看电影')
      expect(updated.childStatus).toBe('notAgreed') // 对方（孩子）重置
      expect(updated.parentStatus).toBe('agreed') // 改动方（家长）自动同意新版本（2026-08-30 拍板；本例原本已同意）
      expect(updated.status).toBe('discussing')
      expect(updated.updatedAt).toBe(T1 + 60_000) // 刷新

      expect(router.currentRoute.value.path).toBe('/proposals')
      const card = wrapper.get('[data-proposal-id="p1"]')
      expect(card.find('.publish-btn').exists()).toBe(false)
      // #63 双阵营卡：孩子同意被重置 → 无「已谈成」标识；家长侧自动同意新版本 →「已修改提议」、孩子侧「还在考虑」
      expect(card.text()).not.toContain(copy.proposals.campStateDone)
      expect(card.text()).toContain(copy.proposals.campStateChanged)
      expect(card.text()).toContain(copy.proposals.campStateNotAgreed)
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC-R32-3-3 名称留空 / 消耗 0 / -1 / 2.5 / 非数字 → 保存被拒、显示 copy.proposals.form.validationHint、sq_proposals 条数不变', async () => {
    wrapper = await mountApp('/proposals/new')
    const nameInput = wrapper.get('.form-name-input')
    const priceInput = wrapper.get('.form-price-input')
    const invalidCases: Array<{ name: string; price: string }> = [
      { name: '', price: '5' },
      { name: '公园野餐', price: '0' },
      { name: '公园野餐', price: '-1' },
      { name: '公园野餐', price: '2.5' },
      { name: '公园野餐', price: 'abc' },
    ]
    for (const c of invalidCases) {
      await nameInput.setValue(c.name)
      await priceInput.setValue(c.price)
      await wrapper.get('.form-save-btn').trigger('click')
      await flushPromises()
      expect(wrapper.get('.form-validation-hint').text(), `name=${c.name} price=${c.price}`).toBe(copy.proposals.form.validationHint)
      expect(router.currentRoute.value.path).toBe('/proposals/new')
      expect(readProposals()).toHaveLength(0)
    }
  })

  it('AC-R32-3-4 published 与 voided 提议均无编辑入口：published 列表卡片不显示（R34 已发布过滤），voided 卡片无编辑按钮；编辑路由路径下表单不渲染（零写入路径不存在）', async () => {
    writeProposals([
      makeProposal('pub', { status: 'published' }),
      makeProposal('void', { status: 'voided' }),
    ])
    wrapper = await mountApp('/proposals')
    // published：显示前过滤，卡片本身不存在（无编辑入口的更强形态）
    expect(wrapper.find('[data-proposal-id="pub"]').exists()).toBe(false)
    expect(wrapper.get('[data-proposal-id="void"]').text()).not.toContain(copy.proposals.editBtn)
    for (const id of ['pub', 'void']) {
      // 终态提议的编辑路由：表单不渲染（ProposalEdit onMounted 拒绝终态与不存在目标）
      wrapper?.unmount()
      wrapper = await mountApp(`/proposals/${id}/edit`)
      expect(wrapper.find('[data-page="proposal-edit"]').exists()).toBe(true)
      expect(wrapper.find('.proposal-form').exists()).toBe(false)
    }
  })
})

// ===== AC-R32-4 详情页 =====

describe('AC-R32-4 详情页', () => {
  it('AC-R32-4-1 discussing 提议详情页含：名称 / 消耗 / 说明全文 / 创建时间（分钟级无秒）/ 最后变更时间 / 发起人「家长」/ 家长与孩子状态 / 整体状态 / 「作废」按钮', async () => {
    const created = new Date(2026, 7, 27, 10, 30, 45).getTime()
    const updated = new Date(2026, 7, 27, 11, 5, 10).getTime()
    writeProposals([
      makeProposal('p1', {
        name: '公园野餐',
        price: 5,
        description: '周六去公园，带野餐垫和三明治',
        status: 'discussing',
        createdAt: created,
        updatedAt: updated,
      }),
    ])
    wrapper = await mountApp('/proposals/p1')
    const text = wrapper.get('.detail-main').text()
    expect(text).toContain('公园野餐')
    expect(text).toContain(copy.proposals.priceLabel(5))
    expect(text).toContain('周六去公园，带野餐垫和三明治')
    // 分钟级格式（YYYY-MM-DD HH:mm，本地时区），截断不显示秒
    expect(text).toContain('2026-08-27 10:30')
    expect(text).toContain('2026-08-27 11:05')
    expect(text).not.toContain('10:30:45')
    expect(text).not.toContain('11:05:10')
    // R34 非目标（简报 4.3.10）：发起人行移除，详情不显示 initiator（槽位 initiatorLabel 已废弃，按字面词断言）
    expect(text).not.toContain('发起人')
    expect(text).toContain(copy.proposals.agreementValue.agreed) // 家长状态（发起人自动同意）
    expect(text).toContain(copy.proposals.agreementValue.notAgreed) // 孩子状态
    expect(text).toContain(copy.proposals.statusBadge.discussing) // 整体状态
    expect(wrapper.findAll('button').some((b) => b.text() === copy.proposals.voidBtn)).toBe(true)
  })

  it('AC-R32-4-2 published 提议详情页无「作废」按钮、无家长 / 孩子状态展示（终态 N/A）；voided 详情页同样无作废按钮', async () => {
    writeProposals([
      makeProposal('pub', { status: 'published' }),
      makeProposal('void', { status: 'voided' }),
    ])
    wrapper = await mountApp('/proposals/pub')
    expect(wrapper.findAll('button').some((b) => b.text() === copy.proposals.voidBtn)).toBe(false)
    const pubText = wrapper.get('.detail-main').text()
    expect(pubText).not.toContain(copy.proposals.detail.parentStatusLabel)
    expect(pubText).not.toContain(copy.proposals.detail.childStatusLabel)

    // voided 详情页：重新挂载（避免同组件路由复用），同样无作废按钮
    wrapper.unmount()
    wrapper = await mountApp('/proposals/void')
    expect(wrapper.findAll('button').some((b) => b.text() === copy.proposals.voidBtn)).toBe(false)
  })
})

// ===== AC-R32-5 双按钮表态（R34 双端改造同步：setAgreed 各控各，代孩子同意开关移除） =====

describe('AC-R32-5 双按钮表态（页面链路，家长视角控 parentStatus）', () => {
  it('AC-R32-5-1 discussing（家长 notAgreed / 孩子 agreed）家长视角点表态钮「同意」→ parentStatus=agreed、childStatus 不变（各控各）、status=agreed、出现「已谈成」标识与「发布兑换项」按钮；「代孩子同意」开关元素不存在', async () => {
    writeProposals([makeProposal('p1', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'agreed' })])
    vi.setSystemTime(new Date(2026, 7, 27, 20, 30, 0))
    wrapper = await mountApp('/proposals')
    expect(wrapper.find('.child-agree-toggle').exists()).toBe(false)
    await wrapper.get('[data-proposal-id="p1"] .stance-btn').trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(p.parentStatus).toBe('agreed')
    expect(p.childStatus).toBe('agreed') // 家长按钮不碰孩子开关
    expect(p.status).toBe('agreed')
    const card = wrapper.get('[data-proposal-id="p1"]')
    expect(card.text()).toContain(copy.proposals.campStateDone)
    expect(card.find('.publish-btn').exists()).toBe(true)
  })

  it('AC-R32-5-2 agreed 提议家长视角点表态钮「再想想」→ parentStatus=notAgreed、childStatus 不变 agreed、status=discussing、「发布兑换项」按钮消失（自由双向切换）', async () => {
    writeProposals([makeProposal('p1', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })])
    vi.setSystemTime(new Date(2026, 7, 27, 20, 30, 0))
    wrapper = await mountApp('/proposals')
    const card = wrapper.get('[data-proposal-id="p1"]')
    expect(card.find('.publish-btn').exists()).toBe(true)
    expect(card.get('.stance-btn').text()).toBe(copy.proposals.rethinkBtn)
    await card.get('.stance-btn').trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(p.parentStatus).toBe('notAgreed')
    expect(p.childStatus).toBe('agreed') // 家长按钮不碰孩子开关
    expect(p.status).toBe('discussing')
    expect(wrapper.get('[data-proposal-id="p1"]').find('.publish-btn').exists()).toBe(false)
  })
})

// ===== AC-R32-6 状态机纯函数全矩阵 =====

// 注：本组与 src/utils/__tests__/proposalState.test.ts 覆盖相同行为（developer T1 内循环），
// 验收侧保留全矩阵断言以保证 AC-R32-6-1~5 逐条可追溯。

describe('AC-R32-6 状态机纯函数全矩阵', () => {
  const base = { name: 'x', price: 5, description: '', createdAt: 1, updatedAt: 1, initiator: 'parent' as const }

  it('AC-R32-6-1 任一方 notAgreed 三种组合 → { status: discussing, publishState: blocked }', () => {
    const combos: Array<{ parentStatus: 'agreed' | 'notAgreed'; childStatus: 'agreed' | 'notAgreed' }> = [
      { parentStatus: 'notAgreed', childStatus: 'notAgreed' },
      { parentStatus: 'agreed', childStatus: 'notAgreed' },
      { parentStatus: 'notAgreed', childStatus: 'agreed' },
    ]
    for (const c of combos) {
      expect(deriveState({ ...base, ...c, status: 'discussing' })).toEqual({ status: 'discussing', publishState: 'blocked' })
    }
  })

  it('AC-R32-6-2 双方 agreed → { status: agreed, publishState: ready }', () => {
    expect(deriveState({ ...base, parentStatus: 'agreed', childStatus: 'agreed', status: 'agreed' })).toEqual({
      status: 'agreed',
      publishState: 'ready',
    })
  })

  it('AC-R32-6-3 终态（published / voided）→ { status: 同终态值, publishState: none }', () => {
    expect(deriveState({ ...base, parentStatus: 'agreed', childStatus: 'agreed', status: 'published' })).toEqual({
      status: 'published',
      publishState: 'none',
    })
    expect(deriveState({ ...base, parentStatus: 'agreed', childStatus: 'notAgreed', status: 'voided' })).toEqual({
      status: 'voided',
      publishState: 'none',
    })
  })

  it('AC-R32-6-4 onContentChange（2026-08-30 拍板修订）：家长改动 → 家长自动同意新版本、孩子重置；孩子改动 → 孩子自动同意、家长重置', () => {
    const bothAgreed = { ...base, parentStatus: 'agreed' as const, childStatus: 'agreed' as const, status: 'agreed' as const }
    const byParent = onContentChange(bothAgreed, 'parent')
    expect(byParent.parentStatus).toBe('agreed')
    expect(byParent.childStatus).toBe('notAgreed')
    expect(byParent.status).toBe('discussing')
    const byChild = onContentChange(bothAgreed, 'child')
    expect(byChild.parentStatus).toBe('notAgreed')
    expect(byChild.childStatus).toBe('agreed')
    expect(byChild.status).toBe('discussing')
    // 改动方原本未同意 → 自动同意新版本（家长修订孩子的新提议场景）
    const parentNotYet = { ...base, parentStatus: 'notAgreed' as const, childStatus: 'agreed' as const }
    const flipped = onContentChange(parentNotYet, 'parent')
    expect(flipped.parentStatus).toBe('agreed')
    expect(flipped.childStatus).toBe('notAgreed')
    // 返回新对象不修改入参
    expect(bothAgreed.childStatus).toBe('agreed')
  })

  it('AC-R32-6-5 canPublish：双方 agreed 非终态 → true；任一方 notAgreed / published / voided → false', () => {
    expect(canPublish({ ...base, parentStatus: 'agreed', childStatus: 'agreed', status: 'agreed' })).toBe(true)
    expect(canPublish({ ...base, parentStatus: 'agreed', childStatus: 'notAgreed', status: 'discussing' })).toBe(false)
    expect(canPublish({ ...base, parentStatus: 'notAgreed', childStatus: 'agreed', status: 'discussing' })).toBe(false)
    expect(canPublish({ ...base, parentStatus: 'agreed', childStatus: 'agreed', status: 'published' })).toBe(false)
    expect(canPublish({ ...base, parentStatus: 'agreed', childStatus: 'agreed', status: 'voided' })).toBe(false)
  })
})

// ===== AC-R32-7 发布成兑换项 =====

describe('AC-R32-7 发布成兑换项', () => {
  // 注入固定系统时刻使时间戳断言可预期（#265 后发布门禁与时间无关）
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('AC-R32-7-1 rewards 3 项 + agreed 提议 → 点卡片「发布兑换项」→ rewards 变 4 项（末尾追加 { name, price, emoji }（#299 发布携带提议 emoji）、新 id 不撞提议与既有）、提议 published、卡片从列表消失（R34 已发布显示前过滤）', async () => {
    writeRewards([makeReward('r1'), makeReward('r2'), makeReward('r3')])
    writeProposals([makeProposal('p1', { name: '公园野餐', price: 5, emoji: '🧺', status: 'agreed', childStatus: 'agreed' })])
    wrapper = await mountApp('/proposals')
    await wrapper.get('[data-proposal-id="p1"] .publish-btn').trigger('click')
    await flushPromises()

    const rewards = readRewards()
    expect(rewards).toHaveLength(4)
    expect(rewards[3]).toEqual({ id: rewards[3].id, name: '公园野餐', price: 5, emoji: '🧺' })
    expect(rewards[3].id).not.toBe('p1') // 新 id ≠ 提议 id
    expect(new Set(rewards.map((r) => r.id)).size).toBe(4) // 新 id ≠ 既有 3 项任一 id
    expect(readProposals()[0].status).toBe('published')

    // 发布后提议已发布：列表显示前过滤，卡片整体不渲染（发布按钮与开关消失的更强形态）
    expect(wrapper.find('[data-proposal-id="p1"]').exists()).toBe(false)
  })

  it('AC-R32-7-6（#299）端到端演示：两条不同 emoji 的提议各自发布 → 兑换页各兑换项显示自己的 emoji → 各自兑换 → 星星宝藏箱聚合格卡两格图标不同', async () => {
    writeRewards([])
    writeProposals([
      makeProposal('p1', { name: '冰淇淋', price: 3, emoji: '🍦', status: 'agreed', childStatus: 'agreed' }),
      makeProposal('p2', { name: '篮球时间', price: 5, emoji: '🏀', status: 'agreed', childStatus: 'agreed' }),
    ])
    expect(publish('p1')).toEqual({ ok: true })
    expect(publish('p2')).toEqual({ ok: true })

    // 发布产物：兑换目录末尾追加两项，各自携带提议选定的 emoji
    const rewards = readRewards()
    expect(rewards.map((r) => [r.name, r.emoji])).toEqual([
      ['冰淇淋', '🍦'],
      ['篮球时间', '🏀'],
    ])

    // 兑换页：各兑换项显示自己的图标（不同名两卡，价格升序 3 → 5）
    writeStars([makeEntry('s1', 50)])
    wrapper = await mountApp('/redeem')
    const rewardItems = wrapper.findAll('.star-reward-item')
    expect(rewardItems).toHaveLength(2)
    expect(rewardItems[0].get('.star-reward-emoji').text()).toBe('🍦')
    expect(rewardItems[1].get('.star-reward-emoji').text()).toBe('🏀')

    // 各自兑换：快照继承兑换项 emoji
    expect(redeem(rewards[0].id).ok).toBe(true)
    expect(redeem(rewards[1].id).ok).toBe(true)

    // 星星宝藏箱：聚合格卡两格各自 emoji、互不相同
    wrapper = await mountApp('/prizes')
    const cards = wrapper.findAll('.prize-card')
    expect(cards).toHaveLength(2)
    const emojis = cards.map((c) => c.get('.prize-emoji').text())
    expect(emojis).toEqual(['🍦', '🏀'])
    expect(new Set(emojis).size).toBe(2)
  })

  it('AC-R32-7-2 rewards 已含同名项 → 发布同名提议仍追加成功：两条同名、id 互不相同（同名允许）', () => {
    writeRewards([makeReward('r1', '公园野餐', 5)])
    writeProposals([makeProposal('p1', { name: '公园野餐', price: 5, status: 'agreed', childStatus: 'agreed' })])

    const result = publish('p1')

    expect(result).toEqual({ ok: true })
    const rewards = readRewards()
    expect(rewards).toHaveLength(2)
    expect(rewards.every((r) => r.name === '公园野餐')).toBe(true)
    expect(rewards[0].id).not.toBe(rewards[1].id)
    expect(readProposals()[0].status).toBe('published')
  })

  it('AC-R32-7-3 发布仅追加第 4 项：既有 3 项逐字段不变；sq_stars 无任何写入', () => {
    const existing = [makeReward('r1', '菠萝油', 5), makeReward('r2', '看电视', 10), makeReward('r3', '寿喜锅', 25)]
    writeRewards(existing)
    writeStars([makeEntry('s1', 7)])
    const starsBefore = localStorage.getItem('sq_stars')
    writeProposals([makeProposal('p1', { status: 'agreed', childStatus: 'agreed' })])

    publish('p1')

    const rewards = readRewards()
    expect(rewards.slice(0, 3)).toEqual(existing) // 追加不覆写
    expect(rewards).toHaveLength(4)
    expect(localStorage.getItem('sq_stars')).toBe(starsBefore) // 发布不写流水
  })

  it('AC-R32-7-4 注入「拒绝」校验函数的 publish（校验 seam，REQ-R32-7-4 预留）→ 发布被拒、rewards 与提议状态零变更', () => {
    writeRewards([makeReward('r1')])
    writeProposals([makeProposal('p1', { status: 'agreed', childStatus: 'agreed' })])
    const rewardsBefore = localStorage.getItem('sq_rewards')
    const proposalsBefore = localStorage.getItem(PROPOSALS_KEY)

    const result = publish('p1', { validate: () => false })

    expect(result).toEqual({ ok: false, reason: 'rejected' })
    expect(localStorage.getItem('sq_rewards')).toBe(rewardsBefore)
    expect(localStorage.getItem(PROPOSALS_KEY)).toBe(proposalsBefore)
  })

  it('AC-R32-7-5 published 提议在列表无任何入口（R34 已发布显示前过滤，卡片不渲染）；详情页无「发布」「作废」「编辑」入口（终态不可撤销，二次发布路径不存在）', async () => {
    writeProposals([makeProposal('p1', { status: 'published' })])
    wrapper = await mountApp('/proposals')
    expect(wrapper.find('[data-proposal-id="p1"]').exists()).toBe(false)

    await router.replace('/proposals/p1')
    await flushPromises()
    const detailText = wrapper.get('.detail-main').text()
    for (const label of [copy.proposals.publishBtn, copy.proposals.voidBtn, copy.proposals.editBtn, copy.proposals.childAgreeToggle]) {
      expect(detailText, label).not.toContain(label)
    }
    // 数据层：终态二次发布路径不存在（not_publishable）
    expect(publish('p1')).toEqual({ ok: false, reason: 'not_publishable' })
  })
})

// ===== AC-R32-8 作废终态 =====

describe('AC-R32-8 作废终态', () => {
  it('AC-R32-8-1 discussing 提议详情页点「作废」并在二次确认弹窗点确认 → status=voided；列表中卡片移入作废组排最后；卡片无开关与发布按钮', async () => {
    writeProposals([
      makeProposal('p1', { status: 'discussing', createdAt: 1000 }),
      makeProposal('p2', { status: 'agreed', childStatus: 'agreed', createdAt: 2000 }),
    ])
    wrapper = await mountApp('/proposals/p1')
    await wrapper.findAll('button').find((b) => b.text() === copy.proposals.voidBtn)!.trigger('click')
    await flushPromises()
    // 二次确认弹窗（StarModalStandard）：文案 = voidConfirm 槽位，确认按钮 = copy.parent.confirm
    const modal = wrapper.get('.star-modal')
    expect(modal.text()).toContain(copy.proposals.voidConfirm('提议p1'))
    await modal.findAll('button').find((b) => b.text() === copy.parent.confirm)!.trigger('click')
    await flushPromises()

    expect(readProposals().find((p) => p.id === 'p1')?.status).toBe('voided')
    // 列表：非作废在前，作废卡片排最后
    await router.replace('/proposals')
    await flushPromises()
    expect(wrapper.findAll('.proposal-card').map((c) => c.attributes('data-proposal-id'))).toEqual(['p2', 'p1'])
    const voidedCard = wrapper.get('[data-proposal-id="p1"]')
    expect(voidedCard.find('.agree-btn').exists()).toBe(false)
    expect(voidedCard.find('.publish-btn').exists()).toBe(false)
  })

  it('AC-R32-8-2 agreed 提议作废同样成功；published 提议作废入口不存在（终态操作收敛口径，自主决策 #4）', async () => {
    writeProposals([
      makeProposal('agreed1', { status: 'agreed', childStatus: 'agreed' }),
      makeProposal('pub', { status: 'published' }),
    ])
    // agreed：详情页作废链路
    wrapper = await mountApp('/proposals/agreed1')
    await wrapper.findAll('button').find((b) => b.text() === copy.proposals.voidBtn)!.trigger('click')
    await wrapper.get('.star-modal').findAll('button').find((b) => b.text() === copy.parent.confirm)!.trigger('click')
    await flushPromises()
    expect(readProposals().find((p) => p.id === 'agreed1')?.status).toBe('voided')

    // published：作废入口不存在（重新挂载详情页，避免同组件路由复用）
    wrapper.unmount()
    wrapper = await mountApp('/proposals/pub')
    expect(wrapper.findAll('button').some((b) => b.text() === copy.proposals.voidBtn)).toBe(false)
    // 数据层同样拒绝终态作废
    expect(voidProposal('pub')).toBe(false)
  })

  it('AC-R32-8-3 voided 提议无「恢复」入口、status 无任何回到非终态的路径（作废不可恢复）', async () => {
    writeProposals([makeProposal('p1', { status: 'voided' })])
    wrapper = await mountApp('/proposals/p1')
    // 详情页无任何操作按钮（编辑 / 作废 / 恢复均无）
    expect(wrapper.find('.detail-actions').exists()).toBe(false)
    // 列表卡片无任何操作按钮 / 开关（仅查看详情；代孩子同意开关已随 R34 移除）
    await router.replace('/proposals')
    await flushPromises()
    const card = wrapper.get('[data-proposal-id="p1"]')
    expect(card.find('.agree-btn').exists()).toBe(false)
    expect(card.find('.publish-btn').exists()).toBe(false)
    // 数据层：全部写操作对终态零变更
    const before = localStorage.getItem(PROPOSALS_KEY)
    expect(voidProposal('p1')).toBe(false)
    expect(setAgreed('p1', 'parent', true)).toBe(false)
    expect(updateProposal('p1', { name: '改名', price: 5, description: '' })).toBe(false)
    expect(publish('p1')).toEqual({ ok: false, reason: 'not_publishable' })
    expect(localStorage.getItem(PROPOSALS_KEY)).toBe(before)
  })
})
describe('AC-R32-9 数据版本 5→6 迁移 + 自动备份', () => {
  beforeEach(() => {
    mockedDownloadData.mockClear()
    mockedDownloadLedger.mockClear()
  })

  /** 版本 5 老用户真实数据（questions N=2 / stars M=2 / rewards K=2），无 sq_proposals 键 */
  function seedVersion5Data(): Record<string, string> {
    localStorage.clear()
    localStorage.setItem('sq_data_version', '5')
    localStorage.setItem('sq_questions', JSON.stringify([makeQuestion('q1'), makeQuestion('q2')]))
    localStorage.setItem('sq_stars', JSON.stringify([makeEntry('s1', 7), makeEntry('s2', 2, 'redeem')]))
    localStorage.setItem('sq_rewards', JSON.stringify([makeReward('r1'), makeReward('r2')]))
    return snapshotLocalStorage()
  }

  it('AC-R32-9-1 版本 "5" + 既有三键真实数据 + 无 sq_proposals → init() 触发经济 + 学习两个备份下载各 1 次、sq_proposals 写 []、版本 "6"、既有三键逐字不变', () => {
    const before = seedVersion5Data()

    initAppState()

    expect(mockedDownloadData).toHaveBeenCalledTimes(1)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(PROPOSALS_KEY)).toBe('[]')
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    for (const [key, value] of Object.entries(before)) {
      if (key === 'sq_data_version') continue
      if (key === 'sq_questions') {
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual(JSON.parse(value).map((q: Question) => ({ ...q, category: '学科', book: '默认' })))
      } else if (key === 'sq_stars') {
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual(JSON.parse(value).map((s: StarEntry) => ({ ...s, childId: 'default', kind: 'main' })))
      } else {
        expect(localStorage.getItem(key), key).toBe(value)
      }
    }
  })

  it('AC-R32-9-2 全新环境（无任何既有数据键）→ init() 写当前版本 + sq_proposals []，备份动作零调用', () => {
    localStorage.clear()

    initAppState()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem(PROPOSALS_KEY) as string)).toEqual([])
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
  })

  it('AC-R32-9-3 已是当前版本 8 且已有提议数据（含归因字段）→ 再次 init() 幂等：提议数据不变、备份零调用、版本仍 "8"（#69 起终值）', () => {
    localStorage.clear()
    initAppState()
    const seeded = [
      { ...makeProposal('p1'), lastActionBy: 'parent' as const, lastActionKind: 'proposed' as const },
      { ...makeProposal('p2', { status: 'voided' }), lastActionBy: 'parent' as const, lastActionKind: 'proposed' as const },
    ]
    writeProposals(seeded)
    const before = localStorage.getItem(PROPOSALS_KEY)

    initAppState()

    expect(localStorage.getItem(PROPOSALS_KEY)).toBe(before)
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('AC-R32-9-4 sq_proposals 存储为损坏 JSON → 读取兜底重置 [] 且不崩溃（沿既有损坏恢复机制）', () => {
    localStorage.setItem(PROPOSALS_KEY, '{broken json')

    let result: ProposalRecord[] | undefined
    expect(() => {
      result = readProposals()
    }).not.toThrow()
    expect(result).toEqual([])
    expect(localStorage.getItem(PROPOSALS_KEY)).toBe('[]')
  })
})

// ===== AC-R32-10 经济文件 2.1 导出 =====

describe('AC-R32-10 经济文件 2.1 导出（纯函数）', () => {
  it('AC-R32-10-1 rewards 2 项 + proposals 3 条（discussing / agreed / voided 各一）+ stars 3 条 → version "2.2"（R32 起 2.1，#75 随动升 2.2）、三组全量真实数据（含终态提议、落盘字段齐备且不含派生 publishState）', () => {
    const rewards = [makeReward('r1', '菠萝油', 5), makeReward('r2', '看电视', 10)]
    const proposals = [
      makeProposal('p1', { status: 'discussing', description: '周六去' }),
      makeProposal('p2', { status: 'agreed', childStatus: 'agreed' }),
      makeProposal('p3', { status: 'voided' }),
    ]
    const starLedger = [makeEntry('s1', 7), makeEntry('s2', 2, 'redeem'), makeEntry('s3', 1)]
    writeRewards(rewards)
    writeProposals(proposals)
    writeStars(starLedger)

    const exported = buildEconomyExport(rewards, proposals, starLedger, [], NOW)

    expect(exported.version).toBe('2.4')
    expect(exported.exportedAt).toBe(NOW)
    expect(exported.rewards).toEqual(rewards)
    expect(exported.starLedger).toEqual(starLedger.map((s) => ({ ...s, childId: 'default', kind: 'main' })))
    expect(exported.activeRedemptions).toEqual([])
    // proposals 3 条全量真实数据（与 localStorage 深等，含终态提议）
    expect(exported.proposals).toEqual(proposals.map((p) => ({ ...p, childId: 'default' })))
    // 落盘口径 ProposalRecord：12 字段齐备（#63 起含最后动作归因两字段，#66 起必填）、不含运行时派生字段 publishState
    const expectedFields = ['childId', 'childStatus', 'createdAt', 'description', 'id', 'initiator', 'lastActionBy', 'lastActionKind', 'name', 'parentStatus', 'price', 'status', 'updatedAt']
    for (const p of exported.proposals) {
      expect(Object.keys(p).sort()).toEqual(expectedFields)
      expect('publishState' in p).toBe(false)
    }
  })
})

// ===== AC-R32-11 经济文件导入兼容矩阵 =====

describe('AC-R32-11 经济文件导入兼容矩阵', () => {
  it('AC-R32-11-1 2.0 文件（proposals: []，R36 导出产物）→ validateEconomyImport ok:true 且 proposals=[]；确认导入后本机 sq_proposals 被覆盖为 []（页面链路）', async () => {
    writeProposals([makeProposal('local1'), makeProposal('local2')])
    const text = economy20FileText()
    const validated = validateEconomyImport(text)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.data.proposals).toEqual([])

    wrapper = await mountApp('/parent')
    await openLedgerModal(wrapper)
    await selectFile(wrapper, text)
    await wrapper.get('.confirm-modal .confirm-ok').trigger('click')
    await flushPromises()
    expect(readProposals()).toEqual([])
  })

  it('AC-R32-11-2 2.0 文件 proposals 字段缺失 → ok:true 且 proposals 兜底 []（2.0 兜底，忽略文件值）', () => {
    const { proposals: _omit, ...rest } = JSON.parse(economy20FileText()) as Record<string, unknown>
    const result = validateEconomyImport(JSON.stringify(rest))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.proposals).toEqual([])
  })

  it('AC-R32-11-3 本机 2 条提议 + 2.1 文件 1 条合法提议 → 确认导入（覆盖式）→ sq_proposals 整体替换为文件 1 条；sq_rewards / sq_stars 同步按文件覆盖（页面链路）', async () => {
    writeProposals([makeProposal('local1'), makeProposal('local2')])
    writeRewards([makeReward('r1', '本机项', 9)])
    writeStars([makeEntry('local-s1', 5)])
    wrapper = await mountApp('/parent')
    await openLedgerModal(wrapper)
    await selectFile(wrapper, economy21FileText())
    await wrapper.get('.confirm-modal .confirm-ok').trigger('click')
    await flushPromises()

    // #63：导入 backfill 补归因字段（by=initiator / proposed），故期望值为原提议 + 两字段
    expect(readProposals()).toEqual([{ ...makeProposal('fp1'), lastActionBy: 'parent', lastActionKind: 'proposed', childId: 'default' }])
    expect(readRewards()).toEqual([makeReward('fr1'), makeReward('fr2')])
    expect(readStars()).toEqual([makeEntry('fs1', 7), makeEntry('fs2', 2, 'redeem')].map((s) => ({ ...s, childId: 'default', kind: 'main' })))
  })

  it('AC-R32-11-4 2.1 文件 proposals 含缺字段（无 status）或类型错（price 为字符串）的提议 → ok:false 整文件原子拒绝，本机 rewards / proposals / stars 全部零变更', async () => {
    for (const badProposal of [
      (() => {
        const { status: _s, ...rest } = makeProposal('fp1')
        return rest
      })(),
      { ...makeProposal('fp1'), price: '5' },
    ]) {
      localStorage.clear()
      initAppState()
      writeRewards([makeReward('r1')])
      writeProposals([makeProposal('local1')])
      writeStars([makeEntry('s1', 3)])
      const before = snapshotLocalStorage()

      const result = validateEconomyImport(economy21FileText({ proposals: [badProposal] }))
      expect(result.ok, JSON.stringify(badProposal)).toBe(false)

      // 页面链路：选文件后不进二次确认、全部键零变更
      wrapper?.unmount()
      wrapper = await mountApp('/parent')
      await openLedgerModal(wrapper)
      await selectFile(wrapper, economy21FileText({ proposals: [badProposal] }))
      expect(wrapper.find('.confirm-modal').exists()).toBe(false)
      expect(wrapper.find('.import-error').exists()).toBe(true)
      for (const [key, value] of Object.entries(before)) {
        expect(localStorage.getItem(key), key).toBe(value)
      }
    }
  })

  it('AC-R32-11-5 version "1.2" 经济文件 → ok:false 且 reason = copy.parent.importVersionTooOld；"1.0" / "1.1" 同样拒绝', () => {
    for (const legacy of ['1.2', '1.0', '1.1']) {
      const result = validateEconomyImport(economy20FileText({ version: legacy }))
      expect(result.ok, legacy).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe(copy.parent.importVersionTooOld)
    }
  })

  it('AC-R32-11-6 version "9.9" 经济文件 → ok:false（不支持的导出版本）', () => {
    const result = validateEconomyImport(economy20FileText({ version: '9.9' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('不支持的导出版本')
  })

  it('AC-R32-11-7 学习文件 2.0 照常 ok:true（回归）；伪造 version "2.1" 学习文件 → ok:false（学习白名单仍仅 2.0）', () => {
    expect(validateLearningImport(learning20FileText()).ok).toBe(true)
    const forged = validateLearningImport(learning20FileText({ version: '2.1' }))
    expect(forged.ok).toBe(false)
    if (!forged.ok) expect(forged.reason).toContain('不支持的导出版本')
  })
})


// ############################################################################
// 以下为原 36-R33 控时发布验收（AC-R33-1 ~ AC-R33-11）
// ############################################################################

// ===== #265 删发布窗口后验收：发布门禁 = 发布门槛，任意时刻可发布 =====

describe('#265 发布门禁 = 发布门槛（原 AC-R33-5~9 口径改写：任意时刻可发布、零窗口 UI）', () => {
  it('已达成一致的提议 + 任意本地时刻（原窗口外 22:00）→ publish 返回 { ok: true }，按 R32 既有发布语义落数据：sq_rewards 末尾追加新兑换项、提议置 published、sq_stars 零写入', () => {
    writeRewards([makeReward('r1', '菠萝油', 5)])
    writeStars([makeEntry('s1', 7)])
    const starsBefore = localStorage.getItem('sq_stars')
    writeProposals([makeProposal('p1', { name: '公园野餐', price: 5, status: 'agreed', childStatus: 'agreed' })])
    vi.setSystemTime(new Date(2026, 7, 27, 22, 0, 0))

    const result = publish('p1')

    expect(result).toEqual({ ok: true })
    const rewards = readRewards()
    expect(rewards).toHaveLength(2)
    expect(rewards[1]).toMatchObject({ name: '公园野餐', price: 5 })
    expect(rewards[1].id).not.toBe('p1') // 新 id 不撞提议 id
    expect(readProposals()[0].status).toBe('published')
    expect(localStorage.getItem('sq_stars')).toBe(starsBefore) // 发布不写星星流水
  })

  it('两条已达成一致的提议 → 连续 publish 两次均成功（不限时刻、不限次数）', () => {
    writeRewards([makeReward('r1')])
    writeProposals([
      makeProposal('p1', { status: 'agreed', childStatus: 'agreed' }),
      makeProposal('p2', { status: 'agreed', childStatus: 'agreed' }),
    ])

    expect(publish('p1')).toEqual({ ok: true })
    expect(publish('p2')).toEqual({ ok: true })

    expect(readRewards()).toHaveLength(3)
    expect(readProposals().every((p) => p.status === 'published')).toBe(true)
  })

  it('任一方未同意 → publish 返回 { ok: false, reason: "not_publishable" }，localStorage 零写入（拒绝口径不变）', () => {
    writeRewards([makeReward('r1', '菠萝油', 5), makeReward('r2', '看电视', 10)])
    writeProposals([makeProposal('p1', { status: 'discussing' })])
    const before = snapshotLocalStorage()

    const result = publish('p1')

    expect(result).toEqual({ ok: false, reason: 'not_publishable' })
    expect(readProposals()[0].status).toBe('discussing')
    expect(snapshotLocalStorage()).toEqual(before)
  })

  it('挂载提议板（本地 22:00，原窗口外）→ 已达成一致提议的发布按钮出现且无 disabled；列表上方窗口说明行不复存在', async () => {
    writeProposals([makeProposal('p1', { status: 'agreed', childStatus: 'agreed' })])
    vi.setSystemTime(new Date(2026, 7, 27, 22, 0, 0))

    wrapper = await mountApp('/proposals')

    const publishBtn = wrapper.get('[data-proposal-id="p1"] .publish-btn')
    expect(publishBtn.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.window-note').exists()).toBe(false)
    expect(wrapper.get('[data-proposal-id="p1"]').text()).toContain(copy.proposals.campStateDone)
  })
})

// ===== 四类提议操作不受任何时段限制（原 AC-R33-10 口径，#265 后无时段概念） =====

describe('四类提议操作不受任何时段限制（组件链路）', () => {
  it('新建提议：列表页「新建提议」入口无 disabled → 表单保存 → sq_proposals 追加 1 条（status=discussing、initiator=parent、家长已同意孩子未同意，R32 语义）', async () => {
    wrapper = await mountApp('/proposals')

    const createBtn = wrapper.get('.create-btn')
    expect(createBtn.attributes('disabled')).toBeUndefined()
    await createBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/new')

    await wrapper.get('.form-name-input').setValue('看一场电影')
    await wrapper.get('.form-price-input').setValue('8')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const list = readProposals()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      name: '看一场电影',
      price: 8,
      status: 'discussing',
      initiator: 'parent',
      parentStatus: 'agreed',
      childStatus: 'notAgreed',
    })
  })

  it('修订提议：详情页编辑入口无 disabled → 改名保存 → name 更新、孩子同意重置、整体回沟通中（R32 语义）', async () => {
    writeProposals([makeProposal('p1', { name: '公园野餐', status: 'agreed', childStatus: 'agreed' })])
    wrapper = await mountApp('/proposals/p1')

    const editBtn = wrapper.get('.detail-actions').findAll('button').find((b) => b.text() === copy.proposals.editBtn)
    expect(editBtn).toBeDefined()
    expect(editBtn!.attributes('disabled')).toBeUndefined()
    await editBtn!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/p1/edit')

    await wrapper.get('.form-name-input').setValue('看电影')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const updated = readProposals()[0]
    expect(updated.name).toBe('看电影')
    expect(updated.childStatus).toBe('notAgreed') // 修订重置另一方（孩子）同意
    expect(updated.status).toBe('discussing')
  })

  it('作废提议：详情页作废入口无 disabled → 二次确认 → status=voided（R32 语义）', async () => {
    writeProposals([makeProposal('p1', { status: 'discussing' })])
    wrapper = await mountApp('/proposals/p1')

    const voidBtn = wrapper.get('.void-btn')
    expect(voidBtn.attributes('disabled')).toBeUndefined()
    await voidBtn.trigger('click')
    await flushPromises()

    const modal = wrapper.get('.star-modal')
    await modal.findAll('button').find((b) => b.text() === copy.parent.confirm)!.trigger('click')
    await flushPromises()

    expect(readProposals()[0].status).toBe('voided')
  })

  it('确定提议：列表卡片表态钮无 disabled → 点击（文案「同意」）→ parentStatus=agreed、status=agreed（R32 语义经 #63 单钮翻转同步）', async () => {
    writeProposals([makeProposal('p1', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'agreed' })])
    wrapper = await mountApp('/proposals')

    const stanceBtn = wrapper.get('[data-proposal-id="p1"] .stance-btn')
    expect(stanceBtn.attributes('disabled')).toBeUndefined()
    expect(stanceBtn.text()).toBe(copy.proposals.agreeBtn)
    await stanceBtn.trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(p.parentStatus).toBe('agreed')
    expect(p.status).toBe('agreed')
  })
})

// ############################################################################
// 以下为原 37-R34 孩子端提议板验收（AC-R34-1 ~ AC-R34-9）
// ############################################################################

// ===== AC-R34-1 孩子端入口与视角路由 =====

describe('AC-R34-1 孩子端入口与视角路由', () => {
  it('AC-R34-1-1 兑换页底部入口区：「提议板」入口存在，与「星星记事本」入口位于同一并列容器、标签与 class 集合完全一致（同款样式复用）', async () => {
    wrapper = await mountApp('/redeem')
    const proposalEntry = findEntry(wrapper, copy.redeem.proposalsEntry)
    const ledgerEntry = findEntry(wrapper, copy.redeem.ledgerLink)
    expect(proposalEntry.parentElement).not.toBeNull()
    expect(proposalEntry.parentElement).toBe(ledgerEntry.parentElement) // 并列容器
    expect(proposalEntry.tagName).toBe(ledgerEntry.tagName) // 同标签
    expect(proposalEntry.classList.length).toBe(ledgerEntry.classList.length)
    for (const cls of Array.from(ledgerEntry.classList)) {
      expect(proposalEntry.classList.contains(cls), `提议板入口含 class ${cls}`).toBe(true)
    }
  })

  it('AC-R34-1-2 点击「提议板」入口 → 路由跳转 /child/proposals（URL 与家长端 /proposals 区分、meta.view=child），列表卡片操作区不含发布按钮（孩子视角渲染生效）', async () => {
    writeProposals([makeProposal('p-a', { status: 'discussing' })])
    wrapper = await mountApp('/redeem')
    await findEntry(wrapper, copy.redeem.proposalsEntry).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await flushPromises()
    expectChildRoute('')
    // 孩子视角列表加载：卡片存在且无发布按钮
    expect(wrapper!.find('[data-proposal-id="p-a"]').exists()).toBe(true)
    expect(wrapper!.findAll('.publish-btn')).toHaveLength(0)
  })

  it('AC-R34-1-3 孩子视角列表页点导航返回 → 路由回 /redeem', async () => {
    writeProposals([makeProposal('p-a')])
    wrapper = await mountApp('/child/proposals')
    await clickButton(wrapper, copy.back)
    expect(router.currentRoute.value.path).toBe('/redeem')
  })

  it('AC-R34-1-4 孩子视角依次进入新建、编辑、详情页 → 三页路由均属孩子端路由组（/child/proposals 前缀 + meta.view=child，视角不丢失；#63 后列表无详情钮，详情页直达路由校验）', async () => {
    writeProposals([makeProposal('p-a', { status: 'discussing' })])
    wrapper = await mountApp('/child/proposals')

    // 列表 → 新建
    await clickButton(wrapper, copy.proposals.childView.createProposal)
    expectChildRoute('/new')

    // 回列表 →「改提议」直接进编辑（#63 后卡上编辑入口）
    await router.replace('/child/proposals')
    await flushPromises()
    await clickButton(wrapper, copy.proposals.changeBtn)
    expectChildRoute('/p-a/edit')

    // 详情页路由组仍属孩子端（直达校验，视角不丢）
    await router.replace('/child/proposals/p-a')
    await flushPromises()
    expectChildRoute('/p-a')

    // 详情 → 编辑（详情页「编辑」入口）
    await clickButton(wrapper, copy.proposals.editBtn)
    expectChildRoute('/p-a/edit')
  })
})

// ===== AC-R34-2 列表页视角渲染 =====

describe('AC-R34-2 列表页视角渲染', () => {
  it('AC-R34-2-1 孩子视角 discussing 卡片：操作区含表态钮（本方未点头 → 文案 =「同意」槽位）与「我要改改」，不含发布按钮、不含作废入口（#63 双阵营卡）', async () => {
    writeProposals([makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'notAgreed' })])
    wrapper = await mountApp('/child/proposals')
    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.find('.card-actions').exists()).toBe(true)
    expect(card.get('.stance-btn').text()).toBe(copy.proposals.agreeBtn)
    expect(card.text()).toContain(copy.proposals.changeBtn)
    expect(card.find('.publish-btn').exists()).toBe(false)
    expect(card.find('.void-btn').exists()).toBe(false)
    expect(card.text()).not.toContain(copy.proposals.voidBtn)
  })

  it('AC-R34-2-2 家长视角 discussing 卡片：含表态钮与「改提议」，不存在「代孩子同意」开关元素与文案', async () => {
    writeProposals([makeProposal('p-a', { status: 'discussing' })])
    wrapper = await mountApp('/proposals')
    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.find('.stance-btn').exists()).toBe(true)
    // child-agree-toggle 元素不存在已由 AC-R32-2-4 同条件断言（去重，#95）
    expect(card.text()).not.toContain(copy.proposals.childAgreeToggle)
  })

  it('AC-R34-2-3 家长视角 agreed 提议（时钟注入 20:30）：卡片含发布按钮（publishGate）与表态钮，右上角「已谈成」标识', async () => {
    writeProposals([
      makeProposal('p-a', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
    ])
    vi.setSystemTime(new Date(2026, 7, 27, 20, 30, 0))
    wrapper = await mountApp('/proposals')
    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.find('.publish-btn').exists()).toBe(true)
    expect(card.find('.stance-btn').exists()).toBe(true)
    expect(card.text()).toContain(copy.proposals.campStateDone)
  })

  it('AC-R34-2-4 parentStatus=notAgreed / childStatus=agreed（各控各，#63 载体＝表态钮文案随本方状态翻转）：孩子视角显示「再想想」、家长视角显示「同意」', async () => {
    writeProposals([
      makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'agreed' }),
    ])

    wrapper = await mountApp('/child/proposals')
    const childCard = wrapper.get('[data-proposal-id="p-a"]')
    expect(childCard.get('.stance-btn').text()).toBe(copy.proposals.rethinkBtn)

    wrapper = await mountApp('/proposals')
    const parentCard = wrapper.get('[data-proposal-id="p-a"]')
    expect(parentCard.get('.stance-btn').text()).toBe(copy.proposals.agreeBtn)
  })

  it('AC-R34-2-5 sq_proposals 为空数组 + 孩子视角进入列表 → 渲染孩子空态文案与新建入口', async () => {
    writeProposals([])
    wrapper = await mountApp('/child/proposals')
    expect(wrapper.text()).toContain(copy.proposals.childView.emptyState)
    const createBtn = wrapper.findAll('button').find(
      (b) => b.text() === copy.proposals.childView.createProposal,
    )
    expect(createBtn).toBeDefined()
  })
})

// ===== AC-R34-3 孩子新建提议 =====

describe('AC-R34-3 新建提议（页面链路）', () => {
  it('AC-R34-3-1 孩子视角新建：名称「乐高」/ 消耗 5 / 说明「想要很久了」提交 → 新增 initiator=child、childStatus=agreed、parentStatus=notAgreed、status=discussing、name=乐高、price=5', async () => {
    wrapper = await mountApp('/child/proposals')
    await clickButton(wrapper, copy.proposals.childView.createProposal)
    expectChildRoute('/new')
    await wrapper.get('.form-name-input').setValue('乐高')
    await wrapper.get('.form-price-input').setValue('5')
    await wrapper.get('.form-desc-input').setValue('想要很久了')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const list = readProposals()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      name: '乐高',
      price: 5,
      description: '想要很久了',
      initiator: 'child',
      childStatus: 'agreed',
      parentStatus: 'notAgreed',
      status: 'discussing',
    })
  })

  it('AC-R34-3-3 孩子视角新建价格填 0 提交 → 校验提示（copy 槽位）、提交被拒、sq_proposals 记录数不变（沿用 R32 校验）', async () => {
    wrapper = await mountApp('/child/proposals')
    await clickButton(wrapper, copy.proposals.childView.createProposal)
    await wrapper.get('.form-name-input').setValue('乐高')
    await wrapper.get('.form-price-input').setValue('0')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    expect(wrapper.get('.form-validation-hint').text()).toBe(copy.proposals.form.validationHint)
    expect(router.currentRoute.value.path).toBe('/child/proposals/new')
    expect(readProposals()).toHaveLength(0)
  })
})

// ===== AC-R34-4 双端表态 =====

describe('AC-R34-4 双端表态（各控各）', () => {
  it('AC-R34-4-1 双方 notAgreed 提议，孩子点表态钮（文案「同意」）→ childStatus=agreed、parentStatus 仍 notAgreed、status 仍 discussing', async () => {
    writeProposals([
      makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'notAgreed' }),
    ])
    wrapper = await mountApp('/child/proposals')
    expect(wrapper.get('[data-proposal-id="p-a"] .stance-btn').text()).toBe(copy.proposals.agreeBtn)
    await wrapper.get('[data-proposal-id="p-a"] .stance-btn').trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(p.childStatus).toBe('agreed')
    expect(p.parentStatus).toBe('notAgreed')
    expect(p.status).toBe('discussing')
  })

  it('AC-R34-4-2 childStatus=agreed 提议，孩子点表态钮（文案已翻转为「再想想」）→ childStatus 回到 notAgreed（双向可切换）', async () => {
    writeProposals([
      makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'agreed' }),
    ])
    wrapper = await mountApp('/child/proposals')
    expect(wrapper.get('[data-proposal-id="p-a"] .stance-btn').text()).toBe(copy.proposals.rethinkBtn)
    await wrapper.get('[data-proposal-id="p-a"] .stance-btn').trigger('click')
    await flushPromises()

    expect(readProposals()[0].childStatus).toBe('notAgreed')
  })

  it('AC-R34-4-3 双方 notAgreed 提议，家长点表态钮（文案「同意」）→ parentStatus=agreed、childStatus 保持 notAgreed', async () => {
    writeProposals([
      makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'notAgreed' }),
    ])
    wrapper = await mountApp('/proposals')
    await wrapper.get('[data-proposal-id="p-a"] .stance-btn').trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(p.parentStatus).toBe('agreed')
    expect(p.childStatus).toBe('notAgreed')
    expect(p.status).toBe('discussing')
  })

  it('AC-R34-4-4 双方 notAgreed 提议，家长与孩子先后表态「同意」（setAgreed 双端）→ status 推导为 agreed（状态机零改动复用）', () => {
    writeProposals([
      makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'notAgreed' }),
    ])
    expect(setAgreed('p-a', 'parent', true)).toBe(true)
    expect(setAgreed('p-a', 'child', true)).toBe(true)

    const p = readProposals()[0]
    expect(p.parentStatus).toBe('agreed')
    expect(p.childStatus).toBe('agreed')
    expect(p.status).toBe('agreed')
  })

  it('AC-R34-4-5 status=voided 提议：家长 / 孩子双端列表卡片均不含表态钮；家长端留「查看详情」、孩子端无任何按钮（Spec #61 终稿 R10/R11）', async () => {
    writeProposals([makeProposal('p-a', { status: 'voided' })])

    wrapper = await mountApp('/proposals')
    const parentCard = wrapper.get('[data-proposal-id="p-a"]')
    expect(parentCard.find('.stance-btn').exists()).toBe(false)
    expect(parentCard.find('.camp-sides').exists()).toBe(false)
    expect(parentCard.text()).toContain(copy.proposals.viewDetail)

    wrapper = await mountApp('/child/proposals')
    const childCard = wrapper.get('[data-proposal-id="p-a"]')
    expect(childCard.find('.stance-btn').exists()).toBe(false)
    expect(childCard.find('button').exists()).toBe(false)
    expect(childCard.text()).toContain(copy.proposals.statusBadge.voided)
  })

  it('AC-R34-4-6 归并文件（原 35-R32）的 AC-R32-5-1/5-2 断言已同步为 setAgreed 双按钮各控各语义（grep：含 setAgreed/各控各、无旧双按钮 API 拼串；「测试通过」由全量运行承载）', () => {
    const r32 = readFileSync(resolve(process.cwd(), 'tests', 'acceptance', 'proposals.test.ts'), 'utf-8')
    expect(r32.includes('setAgreed')).toBe(true)
    expect(r32.includes('各控各')).toBe(true)
    // 旧双按钮 API 名拼串构造，避免守卫自身命中（#95 归并后 grep 目标即本文件）
    const forbidden = ['setChild', 'Agreed'].join('')
    expect(r32.includes(forbidden)).toBe(false)
  })
})

// ===== AC-R34-5 修订 =====

describe('AC-R34-5 修订（对方重置、自身自动同意新版本；2026-08-30 拍板修订）', () => {
  /** 双方 agreed、名为「旧名」的提议（修订用初始态） */
  function seedAgreedProposal(initiator: 'parent' | 'child'): void {
    writeProposals([
      makeProposal('p-a', {
        name: '旧名',
        status: 'agreed',
        parentStatus: 'agreed',
        childStatus: 'agreed',
        initiator,
      }),
    ])
  }

  it('AC-R34-5-1 孩子修订 name=新名 提交 → name=新名、parentStatus=notAgreed（对方重置）、childStatus=agreed（自身自动同意新版本，本例原本已同意）、status=discussing', async () => {
    seedAgreedProposal('child')
    wrapper = await mountApp('/child/proposals/p-a/edit')
    await wrapper.get('.form-name-input').setValue('新名')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(p.name).toBe('新名')
    expect(p.parentStatus).toBe('notAgreed')
    expect(p.childStatus).toBe('agreed')
    expect(p.status).toBe('discussing')
  })

  it('AC-R34-5-2b 孩子新建提议（家长未同意）→ 家长「我要改改」提交 → parentStatus 自动 agreed（修改即认同新版本，无需再点同意）、childStatus 重置 notAgreed（2026-08-30 老板报障场景）', async () => {
    // 孩子新建：initiator=child、childStatus=agreed、parentStatus=notAgreed
    writeProposals([makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'agreed', initiator: 'child' })])
    wrapper = await mountApp('/proposals/p-a/edit')
    await wrapper.get('.form-name-input').setValue('家长改过的名字')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(p.name).toBe('家长改过的名字')
    expect(p.parentStatus).toBe('agreed') // 修改即认同，不再停在「再想想」
    expect(p.childStatus).toBe('notAgreed') // 孩子对新版本重新表态
    expect(p.status).toBe('discussing')

    // 列表表态钮文案随新状态翻转：家长侧显示「再想想」（可收回）
    wrapper = await mountApp('/proposals')
    expect(wrapper.get('[data-proposal-id="p-a"] .stance-btn').text()).toBe(copy.proposals.rethinkBtn)
  })

  it('AC-R34-5-3 status=voided 提议：家长 / 孩子双端详情页均不出现「编辑」入口', async () => {
    writeProposals([makeProposal('p-a', { status: 'voided' })])
    for (const path of ['/proposals/p-a', '/child/proposals/p-a']) {
      wrapper = await mountApp(path)
      expect(
        wrapper.findAll('button').some((b) => b.text() === copy.proposals.editBtn),
        path,
      ).toBe(false)
    }
  })

  it('AC-R34-5-4 任一次修订后读取记录 → 字段集合仍为 ProposalRecord 落盘全集（#299 emoji 可选：种子无键且未改选默认 → 不落 emoji 键，零物理补键；不含修改记录字段、不含最后修改人字段）', async () => {
    seedAgreedProposal('child')
    wrapper = await mountApp('/child/proposals/p-a/edit')
    await wrapper.get('.form-name-input').setValue('新名')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const p = readProposals()[0]
    expect(Object.keys(p).sort()).toEqual(PROPOSAL_RECORD_FIELDS)
  })
})

// ===== AC-R34-6 详情页视角渲染 =====

describe('AC-R34-6 详情页视角渲染', () => {
  it('AC-R34-6-1 孩子视角 discussing 详情页：含「编辑」入口，不含作废入口', async () => {
    writeProposals([makeProposal('p-a', { status: 'discussing' })])
    wrapper = await mountApp('/child/proposals/p-a')
    expect(
      wrapper.findAll('button').some((b) => b.text() === copy.proposals.editBtn),
    ).toBe(true)
    expect(
      wrapper.findAll('button').some((b) => b.text() === copy.proposals.voidBtn),
    ).toBe(false)
    expect(wrapper.text()).not.toContain(copy.proposals.voidBtn)
  })

  it('AC-R34-6-2 家长视角同一 discussing 详情页：含「编辑」入口与作废入口（R32 现状不变）', async () => {
    writeProposals([makeProposal('p-a', { status: 'discussing' })])
    wrapper = await mountApp('/proposals/p-a')
    expect(
      wrapper.findAll('button').some((b) => b.text() === copy.proposals.editBtn),
    ).toBe(true)
    expect(
      wrapper.findAll('button').some((b) => b.text() === copy.proposals.voidBtn),
    ).toBe(true)
  })
})

// ===== AC-R34-7 显示范围：已发布不显示 =====

describe('AC-R34-7 显示范围（已发布不显示）', () => {
  /** 四态基线：discussing / agreed / published / voided 各一条，createdAt 递增 */
  function seedFourStatuses(): void {
    writeProposals([
      makeProposal('A', { status: 'discussing', createdAt: 1000, updatedAt: 1000 }),
      makeProposal('B', {
        status: 'agreed',
        parentStatus: 'agreed',
        childStatus: 'agreed',
        createdAt: 2000,
        updatedAt: 2000,
      }),
      makeProposal('C', { status: 'published', createdAt: 3000, updatedAt: 3000 }),
      makeProposal('D', { status: 'voided', createdAt: 4000, updatedAt: 4000 }),
    ])
  }

  it('AC-R34-7-2 孩子视角列表：同一数据 → 同样显示 3 张卡片，published 不出现', async () => {
    seedFourStatuses()
    wrapper = await mountApp('/child/proposals')
    expect(wrapper.findAll('.proposal-card')).toHaveLength(3)
    expect(wrapper.find('[data-proposal-id="C"]').exists()).toBe(false)
  })

  it('AC-R34-7-3 discussing 最早 / agreed 居中 / voided 最新（另有 published 最新被过滤）→ 双端列表顺序均为 agreed、discussing、voided（非作废在前组内倒序、已作废最后）', async () => {
    writeProposals([
      makeProposal('A', { status: 'discussing', createdAt: 1000, updatedAt: 1000 }),
      makeProposal('B', {
        status: 'agreed',
        parentStatus: 'agreed',
        childStatus: 'agreed',
        createdAt: 2000,
        updatedAt: 2000,
      }),
      makeProposal('D', { status: 'voided', createdAt: 3000, updatedAt: 3000 }),
      makeProposal('C', { status: 'published', createdAt: 4000, updatedAt: 4000 }),
    ])
    for (const path of ['/proposals', '/child/proposals']) {
      wrapper = await mountApp(path)
      expect(
        wrapper.findAll('.proposal-card').map((c) => c.attributes('data-proposal-id')),
        path,
      ).toEqual(['B', 'A', 'D'])
    }
  })

  it('AC-R34-7-4 归并文件（原 35-R32）的 AC-R32-2-1 断言已同步为「已发布提议不显示」语义（grep 新语义标记；「测试通过」由全量运行承载）', () => {
    const r32 = readFileSync(resolve(process.cwd(), 'tests', 'acceptance', 'proposals.test.ts'), 'utf-8')
    expect(r32.includes('已发布 C 不显示')).toBe(true)
  })
})

// ===== AC-R34-8 发布与作废家长专属 =====

describe('AC-R34-8 发布与作废家长专属', () => {
  it('AC-R34-8-1 孩子视角三页面（列表 / 新建 / 编辑 / 详情）：发布按钮与作废入口零出现（家长端同数据会显示发布按钮）', async () => {
    vi.setSystemTime(new Date(2026, 7, 27, 20, 30, 0))
    writeProposals([
      makeProposal('p-agreed', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
      makeProposal('p-talk', { status: 'discussing' }),
    ])
    for (const path of [
      '/child/proposals', // 列表（含 agreed 卡片：若视角泄漏会出发布按钮）
      '/child/proposals/new', // 新建
      '/child/proposals/p-talk/edit', // 编辑
      '/child/proposals/p-talk', // 详情
    ]) {
      wrapper = await mountApp(path)
      expect(wrapper.findAll('.publish-btn'), path).toHaveLength(0)
      expect(wrapper.text(), path).not.toContain(copy.proposals.publishBtn)
      expect(wrapper.text(), path).not.toContain(copy.proposals.voidBtn)
    }
  })

  it('AC-R34-8-3 useProposals.ts 的 publish / voidProposal 导出签名未被意外改动（grep 签名原文；publish 签名随发布门禁收口 / #265 窗口删除演进）', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src', 'composables', 'useProposals.ts'),
      'utf-8',
    )
    expect(source).toContain(
      ['export function publish(', '  id: string,', '  opts: { validate?: PublishValidator } = {},', '): PublishResult'].join('\n'),
    )
    expect(source).toContain('export function voidProposal(id: string): boolean')
  })
})

// ===== AC-R34-9 文案槽位 =====

describe('AC-R34-9 文案槽位', () => {
  it('AC-R34-9-1 copy.ts 本迭代新增槽位（提议板入口、同意、再想想、孩子视角页面文案）各 key 存在且 value 已定稿（不以 "[TBD]" 开头）', () => {
    const slots: string[] = [
      copy.redeem.proposalsEntry,
      copy.proposals.agreeBtn,
      copy.proposals.rethinkBtn,
      copy.proposals.childView.pageTitle,
      copy.proposals.childView.createProposal,
      copy.proposals.childView.emptyState,
      copy.proposals.childView.form.pageTitle,
      copy.proposals.childView.form.saveBtn,
      copy.proposals.childView.detail.pageTitle,
    ]
    expect(slots).toHaveLength(9)
    for (const value of slots) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
      expect(value.startsWith('[TBD]'), JSON.stringify(value)).toBe(false)
    }
    // #38（2026-08-29 老板拍板）：返回文案收敛为顶层 copy.back，childView.back 已 [DEPRECATED] 不参与定稿断言
    expect(copy.back).toBe('返回')
  })

  it('AC-R34-9-2 孩子视角列表页表态钮渲染文本与 copy 槽位值完全一致（本方未点头 →「同意」；组件零硬编码文案）', async () => {
    writeProposals([makeProposal('p-a', { status: 'discussing', parentStatus: 'notAgreed', childStatus: 'notAgreed' })])
    wrapper = await mountApp('/child/proposals')
    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.get('.stance-btn').text()).toBe(copy.proposals.agreeBtn)
  })
})
