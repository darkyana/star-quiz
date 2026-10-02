/**
 * #266 提议板已作废删除常驻化 + 超能力卡收敛 × #265 删发布窗口 页面单测。
 * 删除钮：家长视角已作废卡常驻（不再依赖任何开关），确认 / 取消双路径，含不可恢复文案；
 * 发布：无发布窗口——发布门禁 = 发布门槛，门槛就绪任意时刻即出现，且页面不传任何超能力旁路；
 * 孩子端零呈现：删除钮 / 超能力文案构造性不可达。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Proposals from '../Proposals.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import { proposals as readProposals, writeProposals } from '../../composables/useProposals'
import type { ProposalRecord } from '../../types'

function makeProposal(id: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id,
    name: `提议${id}`,
    price: 5,
    description: '',
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

async function mountPage(path: string): Promise<VueWrapper> {
  await router.replace(path)
  const wrapper = mount(Proposals, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

describe('#266 已作废删除常驻化：家长视角已作废卡恒有删除钮（无任何开关）', () => {
  it('不开启任何开关：已作废卡「查看详情」旁出现删除钮；确认 → 记录物理移除、孩子端同步消失', async () => {
    writeProposals([
      makeProposal('p-voided', { status: 'voided' }),
      makeProposal('p-agreed', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
    ])
    const wrapper = await mountPage('/proposals')

    const card = wrapper.get('[data-proposal-id="p-voided"]')
    const deleteBtn = card.get('.delete-btn')
    expect(deleteBtn.text()).toBe(copy.proposals.deleteBtn)
    // 「查看详情」旁并存
    expect(card.get('.detail-btn').text()).toBe(copy.proposals.viewDetail)

    await deleteBtn.trigger('click')
    // 二次确认弹窗：文案含名称与「删除后不可恢复」
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('p-voided')
    expect(dialog.text()).toContain('删除后不可恢复')

    await dialog.get('.star-button--primary').trigger('click')

    expect(readProposals().map((p) => p.id)).not.toContain('p-voided') // 物理移除（storage 侧）
    expect(wrapper.find('[data-proposal-id="p-voided"]').exists()).toBe(false) // 页面同步消失（孩子端同数据源）
    expect(wrapper.find('[data-proposal-id="p-agreed"]').exists()).toBe(true) // 其余记录不动
  })

  it('取消路径：弹窗关闭、记录原样保留（取消零写入）', async () => {
    const seeded = [makeProposal('p-voided', { status: 'voided' })]
    writeProposals(seeded)
    const wrapper = await mountPage('/proposals')

    await wrapper.get('[data-proposal-id="p-voided"] .delete-btn').trigger('click')
    await wrapper.get('[role="dialog"] .star-button--standard').trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(readProposals()).toEqual(seeded)
    expect(wrapper.find('[data-proposal-id="p-voided"]').exists()).toBe(true)
  })

  it('进行中卡无删除钮；已发布不进列表（仅已作废可删）', async () => {
    writeProposals([
      makeProposal('p-discussing'),
      makeProposal('p-agreed', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
      makeProposal('p-voided', { status: 'voided' }),
    ])
    const wrapper = await mountPage('/proposals')

    expect(wrapper.find('[data-proposal-id="p-discussing"] .delete-btn').exists()).toBe(false)
    expect(wrapper.find('[data-proposal-id="p-agreed"] .delete-btn').exists()).toBe(false)
    expect(wrapper.find('[data-proposal-id="p-voided"] .delete-btn').exists()).toBe(true)
    expect(readProposals().map((p) => p.id)).not.toContain('p-published')
  })
})

describe('#265 后发布钮与超能力、时间均无关：门槛就绪任意时刻即出现', () => {
  it('已谈成卡发布钮出现（门禁只看门槛，无发布窗口）；全文零越窗/开关表述', async () => {
    writeProposals([
      makeProposal('p-agreed', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
    ])
    const wrapper = await mountPage('/proposals')

    expect(wrapper.find('[data-proposal-id="p-agreed"] .publish-btn').exists()).toBe(true)
  })
})

describe('门槛不旁路：孩子未同意任何情况都无发布钮（门禁只看门槛，#265）', () => {
  it('沟通中卡（孩子未同意）→ 无发布钮', async () => {
    writeProposals([makeProposal('p-discussing')])
    const wrapper = await mountPage('/proposals')

    expect(wrapper.find('[data-proposal-id="p-discussing"] .publish-btn').exists()).toBe(false)
  })
})

describe('#266 孩子端零呈现：无删除钮、无超能力文案', () => {
  it('孩子视角（/child/proposals）：已作废卡零按钮、已谈成卡无发布钮、全文零超能力文案', async () => {
    writeProposals([
      makeProposal('p-voided', { status: 'voided' }),
      makeProposal('p-agreed', { status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
    ])
    const wrapper = await mountPage('/child/proposals')

    expect(wrapper.find('[data-proposal-id="p-voided"] .delete-btn').exists()).toBe(false)
    expect(wrapper.find('[data-proposal-id="p-voided"] button').exists()).toBe(false) // 孩子端终态卡零按钮
    expect(wrapper.find('[data-proposal-id="p-agreed"] .publish-btn').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(copy.superPower.cardTitle)
    expect(wrapper.text()).not.toContain(copy.superPower.rewardBtn)
    expect(wrapper.text()).not.toContain(copy.proposals.deleteBtn)
  })
})
