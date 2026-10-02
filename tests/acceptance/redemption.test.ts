/**
 * R-72-4 独立验收收口（#76；Spec 见 #72 评论「进行中兑换（我的奖品）与孩子自助核销」）。
 * #295 奖品聚合格子落地后语义更新：/prizes 以聚合格卡呈现（同名 N 张 = 1 卡、×N 角标、×1 无角标），
 * 「用完了/核销」→「用一个」（先进先出消耗），「放弃/删除」路径彻底移除（孩子端无删除入口）。
 * 验收视角：挂载 App+router 走完整用户旅程——兑换→星星宝藏箱查看→用一个；经济文件导出→导入往返。
 * 断言行为结果与 localStorage 值，不从实现源码反推；文案断言一律引用 copy 槽位值（槽位是唯一文案事实源）。
 * 断言载体口径（票 AC 未指定可观测载体处）：
 * - 「星星逐字不变」= localStorage sq_stars 原文字符串逐字相等（同时覆盖余额与流水不变）；
 * - 「格卡展示不变」= 格卡 DOM 文本含快照名称/emoji（兑换项删除后 sq_active_redemptions 原文不动）；
 * - 「整格消失」= 确认后清空动效 0.32s 才删记录（与视觉消失对齐），等待动效收尾后再断言最终态；
 * - CONTEXT.md 术语登记（票 AC 第 5 条）= 文件内容 grep 式断言（先例 37 AC-R34-4-6 源码 grep）。
 * 时钟注入：兑换日期类断言走 vi.useFakeTimers({ toFake: ['Date'] }) 固定系统时间（先例 34/37），
 * 不 fake setTimeout（toast 2400ms 与清空动效 320ms 计时走真实时钟，不阻塞断言）。
 * 组织方式沿先例 12（兑换全路径）/ 34（导出导入往返 stub）/ 37（孩子端验收文件）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type { StarEntry, RewardItem } from '../../src/types'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import { writeRewards, writeLedger as writeStars, ledger as readStars, redeem } from '../../src/composables/useStarData'
import { list as readActiveRedemptions } from '../../src/composables/useActiveRedemptions'
import { copy } from '../../src/copy'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const NOW = '2026-08-30T10:00:00.000Z'

// ===== seed 工具 =====

const DEFAULT_REWARDS: RewardItem[] = [
  { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
  { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
  { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' },
]

function earn(amount: number): StarEntry {
  return { id: `e${Math.random()}`, timestamp: 1, type: 'earn', amount, source: '答题得星' }
}

/** 兑换项建档不走 UI（Spec Testing Decisions：模块公开函数直调；核销/放弃/导出导入用例的铺垫） */
function seedRedeemed(rewardId: string): void {
  writeStars([earn(50)])
  writeRewards(DEFAULT_REWARDS)
  const result = redeem(rewardId)
  expect(result.ok, `兑换 ${rewardId} 成功建档`).toBe(true)
}

/** sq_rewards 原始读取（快照隔离用例：断言兑换项确已清空） */
function readRewardsRaw(): RewardItem[] {
  return JSON.parse(localStorage.getItem('sq_rewards') as string)
}

// ===== 挂载 helper（先例 37）=====

let wrapper: VueWrapper | undefined

async function mountApp(path: string): Promise<VueWrapper> {
  // 卸载旧实例 + 先重置到无关路由：目标路由组件全新挂载
  wrapper?.unmount()
  wrapper = undefined
  await router.replace('/')
  const w = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await router.replace(path)
  await flushPromises()
  wrapper = w
  return w
}

/** 按精确文本找按钮并点击（确认弹窗 / 操作钮通用） */
async function clickText(w: VueWrapper, text: string): Promise<void> {
  const btn = w.findAll('button').find((b) => b.text().trim() === text)
  expect(btn, `按钮「${text}」存在`).toBeDefined()
  await btn!.trigger('click')
  await flushPromises()
}

/** 等待聚合清空动效收尾（同形helper 与 src/pages/__tests__/Prizes.test.ts 各自文件级维护，
 *  不跨层新建共享模块）：400ms = 动效时长 320ms（Prizes.vue PRIZE_LEAVE_MS / CSS --duration-prize-fx）+ 计时裕量 */
async function waitForLeaveAnimation(): Promise<void> {
  await new Promise((r) => setTimeout(r, 400))
}

/** 按精确文本找入口交互元素（button 或路由 <a>；兑换页底部入口用，先例 37） */
function findEntry(w: VueWrapper, text: string): HTMLElement {
  const interactive = [...w.element.querySelectorAll('button, a')].filter(
    (el) => (el.textContent ?? '').trim() === text,
  )
  expect(interactive[0], `入口「${text}」存在`).toBeDefined()
  return interactive[0] as HTMLElement
}

function findRewardCard(w: VueWrapper, name: string): VueWrapper {
  const card = w.findAll('.star-reward-item').find((c) => c.text().includes(name))
  expect(card, `兑换项「${name}」卡片`).toBeDefined()
  return card!
}

// ===== 下载 / 文件读取 stub（jsdom 无真实下载与文件选择，先例 34）=====

let createObjectURLSpy: ReturnType<typeof vi.fn> | undefined
let capturedBlob: Blob | null = null

const originalReadAsText = FileReader.prototype.readAsText
const originalAnchorClick = HTMLAnchorElement.prototype.click

function stubDownload(): void {
  capturedBlob = null
  createObjectURLSpy = vi.fn((b: Blob) => {
    capturedBlob = b
    return 'blob:mock-url'
  })
  vi.stubGlobal('URL', { createObjectURL: createObjectURLSpy, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    // 仅拦截下载动作，无需记录文件名（本文件不断言文件名）
  })
}

/** jsdom 25 的 Blob 无 .text()，用 FileReader 读取 */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const reader = new FileReader()
    reader.onload = () => resolveP(String(reader.result))
    reader.onerror = () => rejectP(reader.error)
    reader.readAsText(blob)
  })
}

async function openLedgerModal(w: VueWrapper): Promise<void> {
  const btn = w.findAll('button').find((b) => b.text() === '流水管理')
  expect(btn, '「流水管理」入口存在').toBeDefined()
  await btn!.trigger('click')
  await flushPromises()
}

async function selectFile(w: VueWrapper, text: string): Promise<void> {
  const input = w.get('.file-input')
  const file = new File([text], 'import.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'result', { value: text, configurable: true })
    this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
  })
  await input.trigger('change')
  FileReader.prototype.readAsText = originalReadAsText
  await flushPromises()
}

beforeEach(() => {
  // #172：导入确认前未配对设备自动全量备份会触发下载——统一 stub（真实 anchor click 在 happy-dom 会导航跳页）
  stubDownload()
  localStorage.clear()
  initAppState()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  FileReader.prototype.readAsText = originalReadAsText
  HTMLAnchorElement.prototype.click = originalAnchorClick
  vi.unstubAllGlobals()
})

// ===== AC-R72-4-1 兑换→入口→查看→用一个（星星账本零变动；#295 聚合语义）=====

describe('AC-R72-4-1 兑换→星星宝藏箱查看→用一个全路径', () => {
  it('AC-R72-4-1-1 兑换成功（余额扣减 + toast 指向宝藏箱）→兑换页出现「星星宝藏箱」入口→进入 /prizes 看到聚合格卡快照（名称/emoji/相对日期，×1 无角标）→「用一个」二次确认→确认→整格消失 + 用掉 toast，sq_stars 从兑换完成起全程逐字不变', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 30, 10, 0, 0)) // 2026-08-30 本地时间
    writeStars([earn(10)])
    writeRewards(DEFAULT_REWARDS)
    wrapper = await mountApp('/redeem')

    // 兑换全路径：兑换 → 二次确认 → 确认
    await findRewardCard(wrapper, '菠萝油').find('.star-reward-redeem').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(copy.redeem.confirmText(5, '菠萝油', 5))
    await clickText(wrapper, copy.redeem.confirm)

    // 兑换成功：toast 指向「星星宝藏箱」+ 余额扣减（10 − 5 = 5）
    expect(wrapper.text()).toContain(copy.redeem.toast)
    expect(wrapper.get('.balance-chip').text()).toContain('5')
    // 星星账本快照：从此刻起到用一个完成逐字不变（覆盖余额与流水）
    const starsSnapshot = localStorage.getItem('sq_stars')
    expect(readStars()).toHaveLength(2) // earn + redeem 各一条

    // 兑换页「星星宝藏箱」入口 → /prizes
    findEntry(wrapper, copy.prizes.entry).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/prizes')

    // 聚合格卡快照：名称 / emoji / 人性化相对日期（时钟注入 → 兑换在今天 = 日历日差 0）
    const card = wrapper.get('.prize-card')
    expect(card.text()).toContain('菠萝油')
    expect(card.text()).toContain('🥐')
    expect(card.find('.prize-badge').exists()).toBe(false) // ×1 无角标
    expect(card.get('.prize-date').text()).toBe(copy.prizes.redeemedAt(0, '8月30日'))

    // 「用一个」→ 二次确认（剩余数量 N−1 = 0）→ 确认
    await card.get('.btn-useup').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(copy.prizes.useUpConfirm('菠萝油', 0))
    await clickText(wrapper, copy.redeem.confirm)

    // 整格消失（清空动效 0.32s 后删记录）+ 用掉一个 toast
    await waitForLeaveAnimation()
    await flushPromises()
    expect(wrapper.findAll('.prize-card')).toHaveLength(0)
    expect(wrapper.text()).toContain(copy.prizes.useUpToast('菠萝油'))
    expect(readActiveRedemptions()).toEqual([])
    // 星星账本逐字不变（用一个不产生任何流水）
    expect(localStorage.getItem('sq_stars')).toBe(starsSnapshot)
  })
})

// ===== AC-R72-4-2 无删除路径（#295：删除不再是奖品终态，孩子端无删除入口）=====

describe('AC-R72-4-2 无删除路径（#295 拍板：原「放弃」彻底移除）', () => {
  it('AC-R72-4-2-1 /prizes 持有奖品时整页无「放弃」「不要了」按钮；「用一个」确认弹窗不含「星星不会退回」；存储仅能经「用一个」消耗', async () => {
    seedRedeemed('reward_pineapple')
    const starsSnapshot = localStorage.getItem('sq_stars')
    wrapper = await mountApp('/prizes')

    // 每张聚合格卡只有一个「用一个」按钮；全页无删除入口措辞
    const card = wrapper.get('.prize-card')
    expect(card.findAll('button')).toHaveLength(1)
    expect(card.get('.btn-useup').text()).toBe(copy.prizes.useUpBtn)
    expect(wrapper.text()).not.toContain('放弃')
    expect(wrapper.text()).not.toContain('不要了')

    // 「用一个」确认弹窗为聚合口语版，不含「星星不会退回」删除警示
    await card.get('.btn-useup').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(copy.prizes.useUpConfirm('菠萝油', 0))
    expect(wrapper.text()).not.toContain('星星不会退回')

    // 确认后经使用路径消耗（先进先出删记录）、星星逐字不变
    await clickText(wrapper, copy.redeem.confirm)
    await waitForLeaveAnimation()
    await flushPromises()
    expect(readActiveRedemptions()).toEqual([])
    expect(wrapper.text()).toContain(copy.prizes.emptyState)
    expect(localStorage.getItem('sq_stars')).toBe(starsSnapshot)
  })
})

// ===== AC-R72-4-3 经济文件导出→导入往返 =====

describe('AC-R72-4-3 经济文件导出→导入往返', () => {
  it('AC-R72-4-3-1 兑换后、核销前家长页「流水管理」导出 → 文件 version 2.2 且含 activeRedemptions 全量 → 导入另一干净存储（localStorage 重建）→ 进行中兑换完整还原（存储原文 + /prizes 券卡可见）', async () => {
    // 设备 A：兑换两张券后导出
    seedRedeemed('reward_pineapple')
    expect(redeem('reward_tv').ok).toBe(true)
    const exported = readActiveRedemptions()
    expect(exported).toHaveLength(2)

    stubDownload()
    wrapper = await mountApp('/parent')
    await openLedgerModal(wrapper)
    await wrapper.get('.btn-export').trigger('click')
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    const fileText = await readBlobText(capturedBlob!)
    const parsed = JSON.parse(fileText) as Record<string, unknown>
    expect(parsed.version).toBe('2.4')
    expect(parsed.activeRedemptions).toEqual(exported)

    // 设备 B：干净存储导入同一文件（覆盖式确认）
    wrapper.unmount()
    wrapper = undefined
    localStorage.clear()
    initAppState()
    expect(readActiveRedemptions()).toEqual([]) // 干净存储无券
    wrapper = await mountApp('/parent')
    await openLedgerModal(wrapper)
    await selectFile(wrapper, fileText)
    expect(wrapper.get('.confirm-modal').exists()).toBe(true)
    await wrapper.get('.confirm-ok').trigger('click')
    expect(wrapper.find('.import-error').exists()).toBe(false)
    expect(wrapper.find('.import-success').exists()).toBe(true)

    // 进行中兑换完整还原：存储逐字段相等 + 页面券卡可见
    expect(readActiveRedemptions()).toEqual(exported)
    wrapper = await mountApp('/prizes')
    expect(wrapper.findAll('.prize-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('菠萝油')
    expect(wrapper.text()).toContain('看 10 分钟电视')
  })

  it('AC-R72-4-3-2 2.1 旧经济文件（无 activeRedemptions 键）导入 → 校验通过不报错（无 import-error、有成功提示），本地券被兜底清空、/prizes 列表为空显示空态', async () => {
    // 本地持 1 张券
    seedRedeemed('reward_pineapple')
    expect(readActiveRedemptions()).toHaveLength(1)

    // 2.1 旧经济文件：proposals 有、activeRedemptions 键缺失
    const legacyFile = JSON.stringify({
      version: '2.1',
      exportedAt: NOW,
      rewards: DEFAULT_REWARDS,
      proposals: [],
      starLedger: [{ id: 's1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星' }],
    })

    wrapper = await mountApp('/parent')
    await openLedgerModal(wrapper)
    await selectFile(wrapper, legacyFile)
    // 不报错：校验通过进二次确认，确认后成功提示
    expect(wrapper.get('.confirm-modal').exists()).toBe(true)
    await wrapper.get('.confirm-ok').trigger('click')
    expect(wrapper.find('.import-error').exists()).toBe(false)
    expect(wrapper.find('.import-success').exists()).toBe(true)

    // 兜底空数组（覆盖式落库）
    expect(readActiveRedemptions()).toEqual([])
    wrapper = await mountApp('/prizes')
    expect(wrapper.findAll('.prize-card')).toHaveLength(0)
    expect(wrapper.text()).toContain(copy.prizes.emptyState)
  })
})

// ===== AC-R72-4-4 空态与入口常驻 =====

describe('AC-R72-4-4 空态', () => {
  it('AC-R72-4-4-1 无进行中兑换：兑换页「我的奖品」入口常驻 → 进入 /prizes 显示空态文案、无券卡', async () => {
    expect(readActiveRedemptions()).toEqual([]) // 干净存储
    wrapper = await mountApp('/redeem')
    // 入口常驻（无券也在）
    findEntry(wrapper, copy.prizes.entry).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/prizes')
    expect(wrapper.findAll('.prize-card')).toHaveLength(0)
    expect(wrapper.text()).toContain(copy.prizes.emptyState)
  })
})

// ===== AC-R72-4-5 快照隔离（兑换项删除不影响已持有券）=====

describe('AC-R72-4-5 快照隔离', () => {
  it('AC-R72-4-5-1 兑换后清空 sq_rewards（兑换项删除）→ 券卡展示不变（名称/emoji 快照仍在）、sq_active_redemptions 存储原文不动', async () => {
    seedRedeemed('reward_pineapple')
    const snapshot = readActiveRedemptions()
    writeRewards([]) // 删除全部兑换项
    expect(readRewardsRaw()).toEqual([])

    wrapper = await mountApp('/prizes')
    const card = wrapper.get('.prize-card')
    expect(card.text()).toContain('菠萝油')
    expect(card.text()).toContain('🥐')
    // 存储侧快照记录逐字不动
    expect(readActiveRedemptions()).toEqual(snapshot)
  })
})

// ===== AC-R72-4-6 CONTEXT.md 术语登记 =====

describe('AC-R72-4-6 CONTEXT.md 术语登记', () => {
  it('AC-R72-4-6-1 仓库根 CONTEXT.md 含「我的奖品」「奖品」「奖品聚合」「使用」术语条目（粗体术语 + _Avoid_ 标注，一词一义）', () => {
    const context = readFileSync(resolve(process.cwd(), 'CONTEXT.md'), 'utf-8')
    // 「我的奖品」：页面术语条目（含 _Avoid_ 行）
    expect(context).toMatch(/\*\*我的奖品\*\*:/)
    expect(context).toMatch(/_Avoid_:[^\n]*奖品库[^\n]*券包/)
    // 守护口径已随 #296 奖品聚合落地更新：原「进行中兑换」词条已并入「奖品」聚合语义，
    // 「核销」更名为「使用」；此处断言新词汇表的三条正式词条登记到位。
    expect(context).toMatch(/\*\*奖品\*\*:/)
    expect(context).toMatch(/\*\*奖品聚合\*\*:/)
    expect(context).toMatch(/\*\*使用\*\*:/)
    // 旧口径词条头不再出现（#76 遗留断言随之作废）
    expect(context).not.toMatch(/\*\*进行中兑换\*\*:/)
    expect(context).not.toMatch(/\*\*核销\*\*:/)
    expect(context).not.toMatch(/\*\*放弃\*\*:/)
  })
})
