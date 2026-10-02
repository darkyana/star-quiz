/**
 * R32 T6 提议板列表页单测（Spec 20260827-R32 §AC-R32-2 / §AC-R32-5 / §AC-R32-7 页面侧；
 * #63 双阵营卡重排后按 Spec #61 终稿同步：单表态钮文案翻转 / 阵营文案 / 右上角标识 / 发布仅窗口内出现）。
 * 文案断言一律引用 copy 槽位（不硬编码 [TBD] 占位文字）；
 * 数据断言走 useProposals / useStarData 读取函数与 localStorage 值。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Proposals from '../Proposals.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeProposals, proposals as readProposals } from '../../composables/useProposals'
import { rewards as readRewards, writeRewards } from '../../composables/useStarData'
import type { ProposalRecord, RewardItem } from '../../types'

let seq = 0

/** 造一条提议：默认家长已同意 / 孩子未同意 / 沟通中，createdAt 随调用递增 */
function makeProposal(id: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  seq += 1
  return {
    id,
    name: `提议${id}`,
    price: 3,
    description: `说明${id}`,
    status: 'discussing',
    createdAt: seq,
    updatedAt: seq,
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

/** AC-R32-2-1 四态基线：A 沟通中 / B 已达成一致 / C 已发布 / D 已作废，createdAt A < B < C < D */
function seedFourStatuses(): void {
  writeProposals([
    makeProposal('p-a', { name: '野餐A', description: '说明A', createdAt: 1, updatedAt: 1 }),
    makeProposal('p-b', {
      name: '公园野餐B',
      description: '说明B',
      status: 'agreed',
      childStatus: 'agreed',
      createdAt: 2,
      updatedAt: 2,
    }),
    makeProposal('p-c', { name: '看电影C', description: '说明C', status: 'published', createdAt: 3, updatedAt: 3 }),
    makeProposal('p-d', { name: '游乐场D', description: '说明D', status: 'voided', createdAt: 4, updatedAt: 4 }),
  ])
}

function makeReward(id: string, name = '奖励', price = 3): RewardItem {
  return { id, name, price }
}

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(Proposals, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function cardIds(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('.proposal-card')
    .map((c) => c.attributes('data-proposal-id'))
    .filter((id): id is string => id !== undefined)
}

beforeEach(async () => {
  localStorage.clear()
  seq = 0
  initAppState()
  await router.replace('/proposals')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AC-R32-2 列表分组与卡片要素（#63 双阵营卡结构）', () => {
  it('AC-R32-2-1 非作废在前（组内创建时间倒序 B→A），已作废 D 整体排最后；已发布 C 不显示（R34 REQ-R34-7-1 同步）', async () => {
    seedFourStatuses()
    const wrapper = await mountPage()
    expect(cardIds(wrapper)).toEqual(['p-b', 'p-a', 'p-d'])
  })

  it('AC-R32-2-2 卡片要素（Spec #61 终稿）：名称 / 消耗槽位 / 阵营状态文案 / 操作区；说明文字不上卡片', async () => {
    seedFourStatuses()
    const wrapper = await mountPage()
    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.text()).toContain('野餐A')
    expect(card.text()).toContain(copy.proposals.priceLabel(3))
    // 阵营状态文案（双侧同规则，缺归因字段兜底 by=initiator/proposed）：默认种子（家长发起已同意/孩子未同意，无 lastAction）
    expect(card.text()).toContain(copy.proposals.campStateProposed) // 家长侧（发起人兜底）
    expect(card.text()).toContain(copy.proposals.campStateNotAgreed) // 孩子侧
    expect(card.find('.card-actions').exists()).toBe(true)
    expect(card.text()).not.toContain('说明A')
  })

  it('AC-R32-2-3 空列表：空状态槽位显示，「新建提议」按钮存在可点击', async () => {
    writeProposals([])
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain(copy.proposals.emptyState)
    const btn = wrapper.findAll('button').find((b) => b.text() === copy.proposals.createProposal)
    expect(btn).toBeDefined()
    expect(btn!.attributes('disabled')).toBeUndefined()
  })

  it('AC-R32-2-4 操作行条件（Spec #61 终稿）：非终态有表态钮与「我要改改」；已谈成且窗口内另有发布；已作废无表态无发布、家长端留查看详情；published 不显示', async () => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
    seedFourStatuses()
    const wrapper = await mountPage()
    const discussing = wrapper.get('[data-proposal-id="p-a"]')
    expect(discussing.find('.stance-btn').exists()).toBe(true)
    expect(discussing.text()).toContain(copy.proposals.changeBtn)
    expect(discussing.text()).not.toContain(copy.proposals.publishBtn)

    const agreed = wrapper.get('[data-proposal-id="p-b"]')
    expect(agreed.find('.stance-btn').exists()).toBe(true)
    expect(agreed.text()).toContain(copy.proposals.publishBtn)

    const voided = wrapper.get('[data-proposal-id="p-d"]')
    expect(voided.find('.stance-btn').exists()).toBe(false)
    expect(voided.text()).not.toContain(copy.proposals.publishBtn)
    expect(voided.text()).toContain(copy.proposals.viewDetail)

    expect(wrapper.find('[data-proposal-id="p-c"]').exists()).toBe(false)
  })
})

describe('AC-R32-5 表态（#63 单表态钮：文案随状态翻转，点击切换本视角开关）', () => {
  it('家长点「同意」（未点头态按钮文案）：parentStatus/status 落盘 agreed、右侧阵营变「已点头」、出现「已谈成」标识与发布按钮', async () => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
    writeProposals([
      makeProposal('p-a', {
        name: '野餐',
        status: 'discussing',
        parentStatus: 'notAgreed',
        childStatus: 'agreed',
        createdAt: 1,
        updatedAt: 1,
      }),
    ])
    const wrapper = await mountPage()
    expect(wrapper.get('[data-proposal-id="p-a"] .stance-btn').text()).toBe(copy.proposals.agreeBtn)
    await wrapper.get('[data-proposal-id="p-a"] .stance-btn').trigger('click')

    const stored = readProposals().find((p) => p.id === 'p-a')!
    expect(stored.parentStatus).toBe('agreed')
    expect(stored.childStatus).toBe('agreed')
    expect(stored.status).toBe('agreed')

    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.text()).toContain(copy.proposals.campStateDone)
    expect(card.text()).toContain(copy.proposals.publishBtn)
  })

  it('agreed 提议按钮文案翻转为「再想想」：点击收回 → status 回 discussing、发布按钮与「已谈成」标识消失', async () => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
    writeProposals([
      makeProposal('p-b', {
        name: '公园野餐',
        status: 'agreed',
        childStatus: 'agreed',
        createdAt: 1,
        updatedAt: 1,
      }),
    ])
    const wrapper = await mountPage()
    expect(wrapper.get('[data-proposal-id="p-b"] .stance-btn').text()).toBe(copy.proposals.rethinkBtn)
    await wrapper.get('[data-proposal-id="p-b"] .stance-btn').trigger('click')

    const stored = readProposals().find((p) => p.id === 'p-b')!
    expect(stored.parentStatus).toBe('notAgreed')
    expect(stored.status).toBe('discussing')

    const card = wrapper.get('[data-proposal-id="p-b"]')
    expect(card.text()).not.toContain(copy.proposals.publishBtn)
    expect(card.text()).not.toContain(copy.proposals.campStateDone)
  })
})

describe('AC-R32-7-1 发布兑换项（页面侧）', () => {
  // D6（Spec R33）：点发布走 publish 成功路径，注入固定窗口内时刻（本地 20:30）避免真实时间落在窗口外导致 flaky
  // 时钟注入：vi.setSystemTime 固定系统时间（发布门禁收口后 publishClock 可变单例已移除，架构评审 20260829）
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('点发布按钮：sq_rewards 末尾追加新项（name/price）、提议 status published、卡片整体从列表消失（R34 已发布不显示）', async () => {
    writeRewards([makeReward('r1'), makeReward('r2'), makeReward('r3')])
    writeProposals([
      makeProposal('p-b', {
        name: '公园野餐',
        price: 5,
        status: 'agreed',
        childStatus: 'agreed',
        createdAt: 1,
        updatedAt: 1,
      }),
    ])
    const wrapper = await mountPage()
    await wrapper.get('[data-proposal-id="p-b"] .publish-btn').trigger('click')

    const rewardsAfter = readRewards()
    expect(rewardsAfter).toHaveLength(4)
    expect(rewardsAfter[3]).toMatchObject({ name: '公园野餐', price: 5 })

    const stored = readProposals().find((p) => p.id === 'p-b')!
    expect(stored.status).toBe('published')

    expect(wrapper.find('[data-proposal-id="p-b"]').exists()).toBe(false)
  })
})

describe('AC-R32-2-1 新建提议入口', () => {
  it('点击「新建提议」→ 路由跳转 /proposals/new', async () => {
    writeProposals([])
    const wrapper = await mountPage()
    const btn = wrapper.findAll('button').find((b) => b.text() === copy.proposals.createProposal)!
    await btn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/new')
  })
})

describe('#63 双阵营卡（Spec #61 终稿补充：阵营换序 / 标题详情 / 编辑入口）', () => {
  it('家长视角：对方（孩子）在左、自己（家长）在右；头像 aria 标签按阵营取槽位', async () => {
    writeProposals([makeProposal('p-a', { parentStatus: 'notAgreed', childStatus: 'notAgreed' })])
    const wrapper = await mountPage()
    const card = wrapper.get('[data-proposal-id="p-a"]')
    const avatars = card.findAll('.camp-side .camp-avatar')
    expect(avatars).toHaveLength(2)
    expect(avatars[0].attributes('aria-label')).toBe(copy.proposals.ariaChildSide)
    expect(avatars[1].attributes('aria-label')).toBe(copy.proposals.ariaParentSide)
  })

  it('家长点标题 → 进入提议详情；「改提议」→ 进入编辑表单', async () => {
    writeProposals([makeProposal('p-a')])
    const wrapper = await mountPage()
    await wrapper.get('[data-proposal-id="p-a"] .proposal-name').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/p-a')

    await router.replace('/proposals')
    await flushPromises()
    await wrapper.get('[data-proposal-id="p-a"] .change-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/p-a/edit')
  })
})

describe('头像规格（#63 拍板补录 2026-08-30；窗口说明行已随 #265 删除）', () => {
  it('阵营头像 44（--touch-sm）、mini 头像 24（--touch-xs）：触控档令牌、无裸 px（#197 头像样式随组件迁出，等价改读 CampAvatar.vue 组件契约）', () => {
    // 文本断言模式（沿 StarIconBtn.test.ts 惯例）：读组件源码断言令牌引用
    const source = readFileSync(resolve(__dirname, '../../components/CampAvatar.vue'), 'utf-8')
    expect(source).toContain('width: var(--touch-sm)')
    expect(source).toContain('width: var(--touch-xs)')
    expect(source).not.toMatch(/camp-avatar[^}]*width:\s*\d+px/)
  })
})

describe('#299 提议板列表卡图标展示', () => {
  it('卡名称前显示提议 emoji；存量无 emoji 兜底 🎁（proposalEmoji 单一出口）', async () => {
    writeProposals([
      makeProposal('p-emoji', { name: '游乐园', emoji: '🦄' }),
      makeProposal('p-legacy', { name: '看电影' }),
    ])
    const wrapper = await mountPage()
    const cards = wrapper.findAll('.proposal-card')
    const emojiTexts = cards.map((c) => c.find('.proposal-emoji').text())
    expect(emojiTexts).toContain('🦄')
    expect(emojiTexts).toContain('🎁') // 兜底
    // emoji 位于名称之前（DOM 顺序）
    for (const c of cards) {
      expect(c.get('.card-title-row').element.firstElementChild?.textContent).toBe(
        c.get('.proposal-emoji').text(),
      )
    }
  })
})
