/**
 * R34 T5 提议新建 / 编辑表单页视角渲染单测（Spec 20260828-R34 §AC-R34-3 页面侧 + §REQ-R34-5 页面侧修订方向）。
 * 新建按视角传发起人（孩子 initiator:'child' 自动同意自己 / 家长 R32 回归）；
 * 编辑按视角传修订方（changedBy）；校验完全沿用 R32（页面层零特判，自主决策 #6）；
 * 文案按视角取 childView 槽位（先例形态：页面挂载 + 真实 router）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ProposalEdit from '../ProposalEdit.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeProposals, proposals as readProposals } from '../../composables/useProposals'
import type { ProposalRecord } from '../../types'

function makeProposal(id: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id,
    name: `提议${id}`,
    price: 3,
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
  const wrapper = mount(ProposalEdit, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

describe('AC-R34-3 新建按视角传发起人', () => {
  it('AC-R34-3-1 孩子视角填「乐高」/ 5 /「想要很久了」提交 → initiator child 初始态落盘 → 返回孩子端列表', async () => {
    await router.replace('/child/proposals/new')
    const wrapper = await mountPage()
    await wrapper.get('.form-name-input').setValue('乐高')
    await wrapper.get('.form-price-input').setValue('5')
    await wrapper.get('.form-desc-input').setValue('想要很久了')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    expect(readProposals()).toHaveLength(1)
    const saved = readProposals()[0]!
    expect(saved.name).toBe('乐高')
    expect(saved.price).toBe(5)
    expect(saved.description).toBe('想要很久了')
    expect(saved.initiator).toBe('child')
    expect(saved.childStatus).toBe('agreed')
    expect(saved.parentStatus).toBe('notAgreed')
    expect(saved.status).toBe('discussing')
    expect(router.currentRoute.value.path).toBe('/child/proposals')
  })

  it('AC-R34-3-2 家长视角同样内容提交 → initiator parent 初始态（R32 回归）→ 返回家长端列表', async () => {
    await router.replace('/proposals/new')
    const wrapper = await mountPage()
    await wrapper.get('.form-name-input').setValue('乐高')
    await wrapper.get('.form-price-input').setValue('5')
    await wrapper.get('.form-desc-input').setValue('想要很久了')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const saved = readProposals()[0]!
    expect(saved.initiator).toBe('parent')
    expect(saved.parentStatus).toBe('agreed')
    expect(saved.childStatus).toBe('notAgreed')
    expect(saved.status).toBe('discussing')
    expect(router.currentRoute.value.path).toBe('/proposals')
  })

  it('AC-R34-3-3 孩子视角价格填 0 提交 → 拒绝、校验提示显示、记录数不变、不跳转', async () => {
    await router.replace('/child/proposals/new')
    const wrapper = await mountPage()
    await wrapper.get('.form-name-input').setValue('乐高')
    await wrapper.get('.form-price-input').setValue('0')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const hint = wrapper.find('.form-validation-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe(copy.proposals.form.validationHint)
    expect(readProposals()).toHaveLength(0)
    expect(router.currentRoute.value.path).toBe('/child/proposals/new')
  })
})

describe('REQ-R34-5 页面侧修订方向（编辑模式按视角传 changedBy）', () => {
  it('孩子视角编辑 agreed 提议改名提交 → 对方（家长）重置 notAgreed、自身自动同意新版本（本例原本已同意）、status 回 discussing', async () => {
    writeProposals([
      makeProposal('p1', { name: '旧名', status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }),
    ])
    await router.replace('/child/proposals/p1/edit')
    const wrapper = await mountPage()
    await wrapper.get('.form-name-input').setValue('新名')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const stored = readProposals().find((p) => p.id === 'p1')!
    expect(stored.name).toBe('新名')
    expect(stored.parentStatus).toBe('notAgreed')
    expect(stored.childStatus).toBe('agreed')
    expect(stored.status).toBe('discussing')
    expect(router.currentRoute.value.path).toBe('/child/proposals')
  })
})

describe('REQ-R34-9 页面文案按视角取 childView 槽位', () => {
  it('孩子视角新建页：标题 / 保存 / 返回文案 = childView 槽位值', async () => {
    await router.replace('/child/proposals/new')
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain(copy.proposals.childView.form.pageTitle)
    expect(wrapper.get('.form-save-btn').text()).toBe(copy.proposals.childView.form.saveBtn)
    expect(wrapper.text()).toContain(copy.back)
  })
})
