/**
 * R34 T6 提议详情页视角渲染单测（Spec 20260828-R34 §AC-R34-5-3 / §AC-R34-6 + §REQ-R34-6 / 非目标「不显示 initiator」页面侧）。
 * 字段与双方表态 / 整体状态展示双端一致；操作区按视角：编辑入口双端可见（仅非终态，自主决策 #4）、作废入口仅家长（R32 现状）；
 * 编辑 / 返回跳转按视角拼前缀（REQ-R34-1-4 会话不丢视角）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ProposalDetail from '../ProposalDetail.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeProposals } from '../../composables/useProposals'
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
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(ProposalDetail, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function findButton(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

describe('AC-R34-5-3 终态（已作废）详情页无编辑入口（双端）', () => {
  it('孩子 / 家长视角渲染 voided 提议详情 → 均无「编辑」入口', async () => {
    writeProposals([makeProposal('p-voided', { status: 'voided' })])

    for (const path of ['/child/proposals/p-voided', '/proposals/p-voided']) {
      await router.replace(path)
      const wrapper = await mountPage()
      expect(findButton(wrapper, copy.proposals.editBtn)).toBeUndefined()
      wrapper.unmount()
    }
  })
})

describe('AC-R34-6 详情页操作区按视角渲染', () => {
  it('AC-R34-6-1 孩子视角 discussing 详情 → 含「编辑」入口、无作废入口；双方表态与整体状态展示（双端一致）', async () => {
    writeProposals([makeProposal('p-a', { initiator: 'child', parentStatus: 'notAgreed', childStatus: 'agreed' })])
    await router.replace('/child/proposals/p-a')
    const wrapper = await mountPage()
    const text = wrapper.text()

    const editBtn = findButton(wrapper, copy.proposals.editBtn)
    expect(editBtn).toBeDefined()
    expect(findButton(wrapper, copy.proposals.voidBtn)).toBeUndefined()

    // REQ-R34-6-1 字段与双方表态 / 整体状态展示（双端一致）
    expect(text).toContain(copy.proposals.detail.parentStatusLabel)
    expect(text).toContain(copy.proposals.detail.childStatusLabel)
    expect(text).toContain(copy.proposals.detail.statusLabel)
    expect(text).toContain(copy.proposals.statusBadge.discussing)

    // 非目标（简报 4.3.10）：本版本不显示 initiator（发起人标签行不渲染）
    expect(text).not.toContain(copy.proposals.detail.initiatorLabel)
  })

  it('AC-R34-6-2 家长视角同一提议详情 → 含「编辑」入口与作废入口（R32 现状不变）', async () => {
    writeProposals([makeProposal('p-a', { initiator: 'child', parentStatus: 'notAgreed', childStatus: 'agreed' })])
    await router.replace('/proposals/p-a')
    const wrapper = await mountPage()

    expect(findButton(wrapper, copy.proposals.editBtn)).toBeDefined()
    expect(findButton(wrapper, copy.proposals.voidBtn)).toBeDefined()
  })
})

describe('REQ-R34-1-4 详情页跳转按视角拼前缀（会话不丢视角）', () => {
  it('孩子视角点「编辑」→ /child/proposals/:id/edit；点返回 → /child/proposals', async () => {
    writeProposals([makeProposal('p-a')])
    await router.replace('/child/proposals/p-a')
    const wrapper = await mountPage()

    await findButton(wrapper, copy.proposals.editBtn)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/child/proposals/p-a/edit')

    await router.replace('/child/proposals/p-a')
    const wrapper2 = await mountPage()
    await findButton(wrapper2, copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/child/proposals')
  })

  it('孩子视角页面文案取 childView 槽位（标题 / 返回）', async () => {
    writeProposals([makeProposal('p-a')])
    await router.replace('/child/proposals/p-a')
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain(copy.proposals.childView.detail.pageTitle)
    expect(wrapper.text()).toContain(copy.back)
  })
})
