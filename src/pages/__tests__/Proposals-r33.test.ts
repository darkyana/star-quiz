/**
 * 提议板发布 UI 单测（原 R33 T4，#265 后发布窗口已删除：门槛就绪任意时刻即见发布按钮；其余操作不受任何时段限制）。
 * 文案断言引用 copy 槽位（组件不得硬编码）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Proposals from '../Proposals.vue'
import ProposalDetail from '../ProposalDetail.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import {
  writeProposals,
  proposals as readProposals,
  create,
  update,
  voidProposal,
} from '../../composables/useProposals'
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
  const wrapper = mount(Proposals, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function findButton(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

beforeEach(async () => {
  localStorage.clear()
  initAppState()
  await router.replace('/proposals')
})

describe('#265 发布按钮显隐：门槛就绪任意时刻即出现，无禁用；窗口说明行不复存在', () => {
  it('本地 22:00（原窗口外）：已谈成卡片发布按钮出现且无 disabled', async () => {
    vi.setSystemTime(new Date(2026, 0, 15, 22, 0, 0))
    writeProposals([makeProposal('p-b', { status: 'agreed', childStatus: 'agreed' })])
    const wrapper = await mountPage()

    expect(wrapper.get('[data-proposal-id="p-b"] .publish-btn').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain(copy.proposals.publishBtn)
    vi.useRealTimers()
  })

  it('本地 20:30（原窗口内）：同样出现且无 disabled', async () => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
    writeProposals([makeProposal('p-b', { status: 'agreed', childStatus: 'agreed' })])
    const wrapper = await mountPage()

    expect(wrapper.get('[data-proposal-id="p-b"] .publish-btn').attributes('disabled')).toBeUndefined()
    vi.useRealTimers()
  })

  it('列表上方窗口说明行（.window-note）随发布窗口删除，全页零窗口文案', async () => {
    writeProposals([makeProposal('p-b', { status: 'agreed', childStatus: 'agreed' })])
    const wrapper = await mountPage()

    expect(wrapper.find('.window-note').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('20:00')
  })
})

describe('四类操作不受任何时段限制（原 REQ-R33-4 口径，#265 后时段概念不存在）', () => {
  it('新建提议：入口无 disabled，点击跳转 /proposals/new；create 正常落 R32 提议存储', async () => {
    writeProposals([])
    const wrapper = await mountPage()

    const createBtn = findButton(wrapper, copy.proposals.createProposal)!
    expect(createBtn.attributes('disabled')).toBeUndefined()
    await createBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/new')

    create({ name: '新提议', price: 2, description: '' })
    const stored = readProposals()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: '新提议', price: 2, status: 'discussing', childStatus: 'notAgreed' })
  })

  it('确定提议：表态按钮无 disabled，家长点表态钮后 parentStatus / status 落盘 agreed（#63 单钮翻转语义）', async () => {
    writeProposals([makeProposal('p-a', { parentStatus: 'notAgreed', childStatus: 'agreed' })])
    const wrapper = await mountPage()

    const stanceBtn = wrapper.get('[data-proposal-id="p-a"] .stance-btn')
    expect(stanceBtn.attributes('disabled')).toBeUndefined()
    await stanceBtn.trigger('click')

    const stored = readProposals()[0]
    expect(stored.parentStatus).toBe('agreed')
    expect(stored.status).toBe('agreed')
  })

  it('修订 / 作废提议：家长点标题进详情无受限，详情页编辑 / 作废按钮无 disabled；update / voidProposal 正常落 R32 提议存储（#63 后列表详情入口＝家长点标题）', async () => {
    writeProposals([makeProposal('p-a')])
    const wrapper = await mountPage()

    const titleBtn = wrapper.get('[data-proposal-id="p-a"] .proposal-name')
    expect(titleBtn.attributes('disabled')).toBeUndefined()
    await titleBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/proposals/p-a')

    const detail = mount(ProposalDetail, { global: { plugins: [router] } })
    await flushPromises()
    expect(findButton(detail, copy.proposals.editBtn)!.attributes('disabled')).toBeUndefined()
    expect(findButton(detail, copy.proposals.voidBtn)!.attributes('disabled')).toBeUndefined()

    update('p-a', { name: '改名提议', price: 8, description: '' })
    expect(readProposals()[0]).toMatchObject({ name: '改名提议', price: 8, status: 'discussing', childStatus: 'notAgreed' })

    voidProposal('p-a')
    expect(readProposals()[0].status).toBe('voided')
  })
})
