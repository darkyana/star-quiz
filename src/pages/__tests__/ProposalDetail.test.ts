/**
 * R32 T7 提议详情页单测（Spec 20260827-R32 §AC-R32-4 / §AC-R32-8 页面侧）
 * 全字段展示（时间分钟级，不含秒）+ 作废二次确认（StarModalStandard）+ 终态不展示作废按钮与家长 / 孩子状态。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ProposalDetail from '../ProposalDetail.vue'
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

// 本地时区固定时刻：2026-08-27 09:05:45（含秒，断言展示层截断到分钟）
const CREATED_AT = new Date(2026, 7, 27, 9, 5, 45).getTime()
const UPDATED_AT = CREATED_AT + 2 * 60 * 1000 // 09:07:45

beforeEach(async () => {
  localStorage.clear()
  initAppState()
})

describe('AC-R32-4-1 详情页全字段展示（discussing）', () => {
  it('名称 / 消耗 / 说明全文 / 创建与变更时间（分钟级不含秒）/ 发起人 / 家长状态 / 孩子状态 / 整体状态 / 作废按钮', async () => {
    writeProposals([
      makeProposal('p1', {
        name: '公园野餐',
        price: 5,
        description: '周六去公园野餐',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      }),
    ])
    await router.replace('/proposals/p1')
    const wrapper = await mountPage()
    const text = wrapper.text()

    expect(text).toContain('公园野餐')
    expect(text).toContain(copy.proposals.priceLabel(5))
    expect(text).toContain('周六去公园野餐')
    // 分钟级 YYYY-MM-DD HH:mm，不含秒
    expect(text).toContain('2026-08-27 09:05')
    expect(text).toContain('2026-08-27 09:07')
    expect(text).not.toContain('09:05:45')
    expect(text).not.toContain('09:07:45')

    // R34 非目标（简报 4.3.10）：发起人不再展示，发起人行断言移除
    expect(text).toContain(copy.proposals.detail.parentStatusLabel)
    expect(text).toContain(copy.proposals.agreementValue.agreed)
    expect(text).toContain(copy.proposals.detail.childStatusLabel)
    expect(text).toContain(copy.proposals.agreementValue.notAgreed)
    expect(text).toContain(copy.proposals.detail.statusLabel)
    expect(text).toContain(copy.proposals.statusBadge.discussing)

    const voidBtn = findButton(wrapper, copy.proposals.voidBtn)
    expect(voidBtn).toBeDefined()
  })
})

describe('AC-R32-8-1 作废二次确认（页面侧）', () => {
  it('点作废 → 二次确认弹窗（含 voidConfirm(name) 文案）→ 确认后 status voided', async () => {
    writeProposals([makeProposal('p1', { name: '公园野餐' })])
    await router.replace('/proposals/p1')
    const wrapper = await mountPage()

    await findButton(wrapper, copy.proposals.voidBtn)!.trigger('click')
    const modal = wrapper.find('.star-modal')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain(copy.proposals.voidConfirm('公园野餐'))
    // 未确认前零写入
    expect(readProposals()[0]!.status).toBe('discussing')

    await findButton(wrapper, copy.parent.confirm)!.trigger('click')
    expect(readProposals().find((p) => p.id === 'p1')!.status).toBe('voided')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
  })

  it('取消确认 → 弹窗关闭且状态不变', async () => {
    writeProposals([makeProposal('p1', { name: '公园野餐' })])
    await router.replace('/proposals/p1')
    const wrapper = await mountPage()

    await findButton(wrapper, copy.proposals.voidBtn)!.trigger('click')
    await findButton(wrapper, copy.parent.cancel)!.trigger('click')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(readProposals()[0]!.status).toBe('discussing')
  })
})

describe('AC-R32-4-2 终态提议详情页（published / voided）', () => {
  it('无作废按钮、无编辑入口、不展示家长 / 孩子状态（含其取值文案）', async () => {
    writeProposals([
      makeProposal('p2', { status: 'published', parentStatus: 'agreed', childStatus: 'agreed' }),
      makeProposal('p3', { status: 'voided' }),
    ])
    for (const id of ['p2', 'p3']) {
      await router.replace(`/proposals/${id}`)
      const wrapper = await mountPage()
      const text = wrapper.text()

      expect(findButton(wrapper, copy.proposals.voidBtn)).toBeUndefined()
      expect(findButton(wrapper, copy.proposals.editBtn)).toBeUndefined()
      expect(text).not.toContain(copy.proposals.detail.parentStatusLabel)
      expect(text).not.toContain(copy.proposals.detail.childStatusLabel)
      expect(text).not.toContain(copy.proposals.agreementValue.agreed)
      expect(text).not.toContain(copy.proposals.agreementValue.notAgreed)
      // 整体状态徽标仍可见（终态可辨识）
      expect(text).toContain(copy.proposals.statusBadge[id === 'p2' ? 'published' : 'voided'])
      wrapper.unmount()
    }
  })
})

describe('#299 详情页图标展示', () => {
  it('名称前显示提议 emoji；存量无 emoji 兜底 🎁（proposalEmoji 单一出口、aria-hidden 装饰）', async () => {
    writeProposals([
      makeProposal('p1', { name: '游乐园', emoji: '🦄' }),
      makeProposal('p2', { name: '看电影' }),
    ])
    await router.replace('/proposals/p1')
    let wrapper = await mountPage()
    expect(wrapper.get('.detail-emoji').text()).toBe('🦄')
    expect(wrapper.get('.detail-emoji').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.detail-name').text()).toContain('游乐园')
    wrapper.unmount()

    await router.replace('/proposals/p2')
    wrapper = await mountPage()
    expect(wrapper.get('.detail-emoji').text()).toBe('🎁')
    wrapper.unmount()
  })
})
