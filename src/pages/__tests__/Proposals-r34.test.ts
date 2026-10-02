/**
 * R34 T4 提议板列表页视角渲染单测（Spec 20260828-R34 §AC-R34-1-3 / §AC-R34-2 / §AC-R34-7 / §AC-R34-8-2 页面侧；
 * #63 双阵营卡重排后按 Spec #61 终稿同步：单表态钮文案翻转替代双按钮 aria-pressed、阵营换序、孩子端无详情入口、发布窗口外按钮不出现）。
 * 视角经路由 meta.view='child' 注入（先例形态：页面挂载 + 真实 router + vi.setSystemTime 固定系统时间）；
 * 文案断言一律引用 copy 槽位（双端共用 agreeBtn / rethinkBtn；孩子视角文案取 childView 组）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Proposals from '../Proposals.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeProposals, proposals as readProposals } from '../../composables/useProposals'
import type { ProposalRecord } from '../../types'

function makeProposal(id: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id,
    name: `提议${id}`,
    price: 5,
    description: `说明${id}`,
    status: 'discussing',
    createdAt: 1000,
    updatedAt: 1000,
    parentStatus: 'notAgreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

/** 注入固定本地时刻（R33 渲染时点判定，窗口判定只看时分秒；窗口 = 每天 20:00–21:00） */
function setClock(hour: number, minute: number): void {
  vi.setSystemTime(new Date(2026, 0, 15, hour, minute, 0))
}

async function mountPage(path: string): Promise<VueWrapper> {
  await router.replace(path)
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

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AC-R34-1-3 孩子视角返回目标 + 列表页跳转按视角拼前缀', () => {
  it('孩子视角点返回导航 → 路由回 /redeem', async () => {
    writeProposals([])
    const wrapper = await mountPage('/child/proposals')

    const backBtn = wrapper.findAll('button').find((b) => b.text() === copy.back)!
    await backBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/redeem')
  })

  it('孩子视角新建 / 「我要改改」/ 直达详情均落孩子端路由组（REQ-R34-1-4 列表页侧；#63 后详情入口仅家长标题，孩子端直达路由校验）', async () => {
    writeProposals([makeProposal('p-a')])
    const wrapper = await mountPage('/child/proposals')

    const createBtn = wrapper.findAll('button').find((b) => b.text() === copy.proposals.childView.createProposal)!
    await createBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/child/proposals/new')

    // 回列表 → 「改提议」直接进编辑
    await router.replace('/child/proposals')
    await flushPromises()
    const editBtn = wrapper.findAll('button').find((b) => b.text() === copy.proposals.changeBtn)!
    await editBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/child/proposals/p-a/edit')

    // 孩子端详情页路由组仍可达（meta.view 不丢）
    await router.replace('/child/proposals/p-a')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/child/proposals/p-a')
    expect(router.currentRoute.value.meta.view).toBe('child')
  })
})

describe('AC-R34-2 列表页视角渲染（#63 双阵营卡）', () => {
  it('AC-R34-2-1 孩子视角：discussing 卡片表态钮文案 =「同意」（本方未点头时的下一步动作），全卡片无发布按钮 / 无作废入口', async () => {
    writeProposals([
      makeProposal('p-a'),
      makeProposal('p-b', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
    ])
    setClock(20, 30)
    const wrapper = await mountPage('/child/proposals')

    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.get('.stance-btn').text()).toBe(copy.proposals.agreeBtn)

    for (const id of ['p-a', 'p-b']) {
      const c = wrapper.get(`[data-proposal-id="${id}"]`)
      expect(c.find('.publish-btn').exists()).toBe(false)
      expect(c.text()).not.toContain(copy.proposals.voidBtn)
    }
  })

  it('AC-R34-2-2 家长视角：discussing 卡片含表态钮与「我要改改」，不存在「代孩子同意」开关', async () => {
    writeProposals([makeProposal('p-a')])
    const wrapper = await mountPage('/proposals')

    const card = wrapper.get('[data-proposal-id="p-a"]')
    expect(card.find('.stance-btn').exists()).toBe(true)
    expect(card.text()).toContain(copy.proposals.changeBtn)
    expect(card.find('.child-agree-toggle').exists()).toBe(false)
    expect(card.text()).not.toContain(copy.proposals.childAgreeToggle)
  })

  it('AC-R34-2-3 家长视角：窗口内已谈成卡片发布按钮与表态钮并存，右上角出现「已谈成」标识', async () => {
    writeProposals([makeProposal('p-b', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })])
    setClock(20, 30)
    const wrapper = await mountPage('/proposals')

    const card = wrapper.get('[data-proposal-id="p-b"]')
    expect(card.find('.publish-btn').exists()).toBe(true)
    expect(card.find('.stance-btn').exists()).toBe(true)
    expect(card.text()).toContain(copy.proposals.campStateDone)
  })

  it('AC-R34-2-4 parentStatus=notAgreed / childStatus=agreed（各控各，#63 载体＝表态钮文案随本方状态翻转）：孩子视角显示「再想想」、家长视角显示「同意」', async () => {
    writeProposals([makeProposal('p-a', { childStatus: 'agreed' })])

    const child = await mountPage('/child/proposals')
    const childCard = child.get('[data-proposal-id="p-a"]')
    expect(childCard.get('.stance-btn').text()).toBe(copy.proposals.rethinkBtn)
    // 孩子视角阵营换序：对方（家长）在左
    const childAvatars = childCard.findAll('.camp-side .camp-avatar')
    expect(childAvatars[0].attributes('aria-label')).toBe(copy.proposals.ariaParentSide)
    expect(childAvatars[1].attributes('aria-label')).toBe(copy.proposals.ariaChildSide)

    const parent = await mountPage('/proposals')
    const parentCard = parent.get('[data-proposal-id="p-a"]')
    expect(parentCard.get('.stance-btn').text()).toBe(copy.proposals.agreeBtn)
    // 家长视角：对方（孩子）在左
    const parentAvatars = parentCard.findAll('.camp-side .camp-avatar')
    expect(parentAvatars[0].attributes('aria-label')).toBe(copy.proposals.ariaChildSide)
    expect(parentAvatars[1].attributes('aria-label')).toBe(copy.proposals.ariaParentSide)
  })

  it('AC-R34-2-5 孩子视角空列表：孩子空态文案 + 新建入口', async () => {
    writeProposals([])
    const wrapper = await mountPage('/child/proposals')

    expect(wrapper.text()).toContain(copy.proposals.childView.emptyState)
    const createBtn = wrapper.findAll('button').find((b) => b.text() === copy.proposals.childView.createProposal)
    expect(createBtn).toBeDefined()
  })

  it('页面侧表态各控各：孩子点表态钮（文案「同意」）→ childStatus 落盘 agreed 且 parentStatus 不动', async () => {
    writeProposals([makeProposal('p-a')])
    const wrapper = await mountPage('/child/proposals')

    await wrapper.get('[data-proposal-id="p-a"] .stance-btn').trigger('click')

    const stored = readProposals().find((p) => p.id === 'p-a')!
    expect(stored.childStatus).toBe('agreed')
    expect(stored.parentStatus).toBe('notAgreed')
  })
})

describe('AC-R34-7 显示范围：已发布不显示', () => {
  /** 四态基线：discussing / agreed / published / voided 各一条，createdAt 递增 */
  function seedFourStatuses(): void {
    writeProposals([
      makeProposal('p-a', { createdAt: 1, updatedAt: 1 }),
      makeProposal('p-b', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed', createdAt: 2, updatedAt: 2 }),
      makeProposal('p-c', { status: 'published', createdAt: 3, updatedAt: 3 }),
      makeProposal('p-d', { status: 'voided', createdAt: 4, updatedAt: 4 }),
    ])
  }

  it('AC-R34-7-1 家长视角：四态各一条 → 恰好 3 张卡片（published 不出现）', async () => {
    seedFourStatuses()
    const wrapper = await mountPage('/proposals')
    expect(cardIds(wrapper)).toEqual(['p-b', 'p-a', 'p-d'])
  })

  it('AC-R34-7-2 孩子视角：同一数据 → 同样 3 张卡片（published 不出现）', async () => {
    seedFourStatuses()
    const wrapper = await mountPage('/child/proposals')
    expect(cardIds(wrapper)).toEqual(['p-b', 'p-a', 'p-d'])
  })

  it('AC-R34-7-3 排序：discussing 最早 / agreed 居中 / voided 最新 → 顺序 agreed、discussing、voided', async () => {
    writeProposals([
      makeProposal('p-discussing', { createdAt: 1, updatedAt: 1 }),
      makeProposal('p-agreed', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed', createdAt: 2, updatedAt: 2 }),
      makeProposal('p-voided', { status: 'voided', createdAt: 3, updatedAt: 3 }),
    ])
    const wrapper = await mountPage('/proposals')
    expect(cardIds(wrapper)).toEqual(['p-agreed', 'p-discussing', 'p-voided'])
  })
})

describe('#265 家长视角发布回归：门槛就绪任意时刻即见发布按钮', () => {
  it('本地 22:00（原窗口外）：已谈成卡片发布按钮出现；已谈成标识与表态钮仍在', async () => {
    vi.setSystemTime(new Date(2026, 0, 15, 22, 0, 0))
    writeProposals([makeProposal('p-b', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })])
    const wrapper = await mountPage('/proposals')

    expect(wrapper.get('[data-proposal-id="p-b"] .publish-btn').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.window-note').exists()).toBe(false)
    // 已谈成标识与表态钮仍在
    const card = wrapper.get('[data-proposal-id="p-b"]')
    expect(card.text()).toContain(copy.proposals.campStateDone)
    expect(card.find('.stance-btn').exists()).toBe(true)
    vi.useRealTimers()
  })
})

describe('#63 双阵营卡：终态分视角（Spec #61 终稿 R10/R11）', () => {
  it('已作废：家长端右上角「已作废」+ 仅「查看详情」；孩子端同样有「已作废」但无任何按钮', async () => {
    writeProposals([makeProposal('p-d', { status: 'voided' })])

    const parent = await mountPage('/proposals')
    const parentCard = parent.get('[data-proposal-id="p-d"]')
    expect(parentCard.text()).toContain(copy.proposals.statusBadge.voided)
    expect(parentCard.find('.camp-sides').exists()).toBe(false)
    expect(parentCard.find('.stance-btn').exists()).toBe(false)
    expect(parentCard.text()).toContain(copy.proposals.viewDetail)

    const child = await mountPage('/child/proposals')
    const childCard = child.get('[data-proposal-id="p-d"]')
    expect(childCard.text()).toContain(copy.proposals.statusBadge.voided)
    expect(childCard.find('button').exists()).toBe(false)
  })
})

describe('#66 阵营文案渲染接线（答案卡单一出口：判定矩阵全枚举移 proposalState 计算器测试，本处保留卡上渲染接线断言）', () => {
  it('孩子新建提议 → 家长视角：孩子侧（对方）「刚刚提议」、家长侧（自己）「还在考虑」；孩子视角：自己也是「刚刚提议」', async () => {
    writeProposals([
      makeProposal('p-a', {
        status: 'discussing',
        parentStatus: 'notAgreed',
        childStatus: 'agreed',
        initiator: 'child',
        lastActionBy: 'child',
        lastActionKind: 'proposed',
      }),
    ])
    const parent = await mountPage('/proposals')
    const parentStates = parent.get('[data-proposal-id="p-a"]').findAll('.camp-state')
    expect(parentStates[0].text()).toBe(copy.proposals.campStateProposed) // 家长看对方（孩子）
    expect(parentStates[1].text()).toBe(copy.proposals.campStateNotAgreed) // 家长看自己

    const child = await mountPage('/child/proposals')
    const childStates = child.get('[data-proposal-id="p-a"]').findAll('.camp-state')
    expect(childStates[1].text()).toBe(copy.proposals.campStateProposed) // 孩子看自己（右）
    expect(childStates[0].text()).toBe(copy.proposals.campStateNotAgreed) // 孩子看对方（家长）
  })

  it('双方同意（最后动作＝孩子点头）→ 家长视角双侧「已点头」+ 右上角绿徽章「已谈成」渲染在卡上', async () => {
    writeProposals([
      makeProposal('p-a', {
        status: 'discussing',
        parentStatus: 'agreed',
        childStatus: 'agreed',
        lastActionBy: 'child',
        lastActionKind: 'agreed',
      }),
    ])
    const wrapper = await mountPage('/proposals')
    const states = wrapper.get('[data-proposal-id="p-a"]').findAll('.camp-state')
    expect(states[0].text()).toBe(copy.proposals.campStateAgreed) // 对方（孩子）已点头
    expect(states[1].text()).toBe(copy.proposals.campStateAgreed) // 自己（家长）已点头
    expect(wrapper.get('[data-proposal-id="p-a"]').text()).toContain(copy.proposals.campStateDone)
  })
})
