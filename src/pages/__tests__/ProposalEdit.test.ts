/**
 * R32 T7 提议新建 / 编辑表单页单测（Spec 20260827-R32 §AC-R32-3）
 * 新建（/proposals/new）与编辑（/proposals/:id/edit）复用 ProposalEdit.vue；
 * 文案断言一律引用 copy 槽位；数据断言走 useProposals 读取与 localStorage 原始值。
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

beforeEach(async () => {
  localStorage.clear()
  initAppState()
})

describe('AC-R32-3-1 新建保存', () => {
  it('填名称「公园野餐」/ 消耗 5 / 说明「周六去」保存 → 追加 1 条全字段正确 → 返回列表（路由 /proposals）', async () => {
    await router.replace('/proposals/new')
    const wrapper = await mountPage()
    await wrapper.get('.form-name-input').setValue('公园野餐')
    await wrapper.get('.form-price-input').setValue('5')
    await wrapper.get('.form-desc-input').setValue('周六去')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const list = readProposals()
    expect(list).toHaveLength(1)
    const saved = list[0]!
    expect(saved.name).toBe('公园野餐')
    expect(saved.price).toBe(5)
    expect(saved.description).toBe('周六去')
    expect(saved.initiator).toBe('parent')
    expect(saved.parentStatus).toBe('agreed')
    expect(saved.childStatus).toBe('notAgreed')
    expect(saved.status).toBe('discussing')
    expect(typeof saved.createdAt).toBe('number')
    expect(typeof saved.updatedAt).toBe('number')
    expect(router.currentRoute.value.path).toBe('/proposals')
  })
})

describe('AC-R32-3-2/3 编辑保存（内容变更重置对方）', () => {
  it('agreed 提议改名称保存 → childStatus 重置 notAgreed、parentStatus 不变、status 回 discussing、updatedAt 刷新', async () => {
    writeProposals([
      makeProposal('p1', {
        name: '旧名字',
        status: 'agreed',
        childStatus: 'agreed',
        updatedAt: 1000,
      }),
    ])
    await router.replace('/proposals/p1/edit')
    const wrapper = await mountPage()
    // 编辑模式回填原值
    expect((wrapper.get('.form-name-input').element as HTMLInputElement).value).toBe('旧名字')
    await wrapper.get('.form-name-input').setValue('新名字')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const stored = readProposals().find((p) => p.id === 'p1')!
    expect(stored.name).toBe('新名字')
    expect(stored.childStatus).toBe('notAgreed')
    expect(stored.parentStatus).toBe('agreed')
    expect(stored.status).toBe('discussing')
    expect(stored.updatedAt).toBeGreaterThan(1000)
    expect(router.currentRoute.value.path).toBe('/proposals')
  })
})

describe('AC-R32-3-3 表单校验（零写入）', () => {
  it.each([
    ['名称为空', { name: '', price: '5' }],
    ['消耗 0', { name: '公园野餐', price: '0' }],
    ['消耗 -1', { name: '公园野餐', price: '-1' }],
    ['消耗 2.5', { name: '公园野餐', price: '2.5' }],
    ['消耗非数字', { name: '公园野餐', price: 'abc' }],
  ])('%s → 保存拒绝、校验提示槽位显示、条数不变', async (_label, input) => {
    await router.replace('/proposals/new')
    const wrapper = await mountPage()
    await wrapper.get('.form-name-input').setValue(input.name)
    await wrapper.get('.form-price-input').setValue(input.price)
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const hint = wrapper.find('.form-validation-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe(copy.proposals.form.validationHint)
    expect(readProposals()).toHaveLength(0)
    // 拒绝保存不跳转
    expect(router.currentRoute.value.path).toBe('/proposals/new')
  })
})

describe('AC-R32-3-5 终态提议不提供编辑保存路径', () => {
  it('published / voided 提议进入 /proposals/:id/edit → 不渲染表单与保存按钮，sq_proposals 逐字节零写入', async () => {
    writeProposals([
      makeProposal('p2', { status: 'published' }),
      makeProposal('p3', { status: 'voided' }),
    ])
    const before = localStorage.getItem('sq_proposals')

    for (const id of ['p2', 'p3']) {
      await router.replace(`/proposals/${id}/edit`)
      const wrapper = await mountPage()
      expect(wrapper.find('.proposal-form').exists()).toBe(false)
      expect(wrapper.find('.form-save-btn').exists()).toBe(false)
      wrapper.unmount()
    }
    expect(localStorage.getItem('sq_proposals')).toBe(before)
  })
})

describe('#299 提议图标宫格（#300 方案 B：行内收起/展开，默认 🎁）', () => {
  async function openGrid(wrapper: VueWrapper): Promise<void> {
    await wrapper.get('.emoji-toggle-row').trigger('click')
  }

  it('新建：收起行显示默认 🎁；展开宫格 30 格单选、🎁 首位选中；不改直接保存 → 落盘 emoji 🎁', async () => {
    await router.replace('/proposals/new')
    const wrapper = await mountPage()
    expect(wrapper.get('.emoji-current').text()).toBe('🎁')
    expect(wrapper.find('.emoji-grid').exists()).toBe(false) // 收起态宫格不渲染

    await openGrid(wrapper)
    const cells = wrapper.findAll('.emoji-cell')
    expect(cells).toHaveLength(30)
    const checked = cells.filter((c) => c.attributes('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]!.text()).toBe('🎁')

    await wrapper.get('.form-name-input').setValue('吃冰淇淋')
    await wrapper.get('.form-price-input').setValue('5')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()
    expect(readProposals()[0]!.emoji).toBe('🎁')
  })

  it('新建：宫格单选 🍕 后保存 → 落盘 emoji 🍕；切换文案收起/换一个随展开态翻转', async () => {
    await router.replace('/proposals/new')
    const wrapper = await mountPage()
    expect(wrapper.get('.emoji-toggle-hint').text()).toBe(copy.proposals.form.emojiSwapBtn)
    await openGrid(wrapper)
    expect(wrapper.get('.emoji-toggle-hint').text()).toBe(copy.proposals.form.emojiCollapseBtn)

    const pizza = wrapper.findAll('.emoji-cell').find((c) => c.text() === '🍕')!
    await pizza.trigger('click')
    expect(wrapper.get('.emoji-current').text()).toBe('🍕')
    expect(pizza.attributes('aria-checked')).toBe('true')

    await wrapper.get('.form-name-input').setValue('披萨之夜')
    await wrapper.get('.form-price-input').setValue('8')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()
    expect(readProposals()[0]!.emoji).toBe('🍕')
  })

  it('编辑：当前 emoji 🦄 进入选中态；不改保存 → 保持 🦄；只改 emoji 保存 → 修订即认同（修改方同意、对方重置）', async () => {
    writeProposals([
      makeProposal('p1', { name: '游乐园', price: 20, emoji: '🦄', status: 'agreed', childStatus: 'agreed' }),
    ])
    await router.replace('/proposals/p1/edit')
    const wrapper = await mountPage()
    expect(wrapper.get('.emoji-current').text()).toBe('🦄')

    await openGrid(wrapper)
    const unicorn = wrapper.findAll('.emoji-cell').find((c) => c.text() === '🦄')!
    expect(unicorn.attributes('aria-checked')).toBe('true')

    // 只改 emoji → 与改名称同走修订即认同单一语义
    const target = wrapper.findAll('.emoji-cell').find((c) => c.text() === '🎯')!
    await target.trigger('click')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const stored = readProposals().find((p) => p.id === 'p1')!
    expect(stored.emoji).toBe('🎯')
    expect(stored.name).toBe('游乐园') // 其余内容不变
    expect(stored.parentStatus).toBe('agreed') // 修改方（家长视角路由）自动同意
    expect(stored.childStatus).toBe('notAgreed') // 对方重置
    expect(stored.status).toBe('discussing')
  })

  it('存量提议无 emoji：读取兜底 🎁 选中（零迁移，落盘行不带 emoji 键直至再次保存）', async () => {
    writeProposals([makeProposal('p1', { name: '看电影', price: 10 })])
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)[0]).not.toHaveProperty('emoji')

    await router.replace('/proposals/p1/edit')
    const wrapper = await mountPage()
    expect(wrapper.get('.emoji-current').text()).toBe('🎁')
    await openGrid(wrapper)
    const checked = wrapper.findAll('.emoji-cell').filter((c) => c.attributes('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]!.text()).toBe('🎁')
  })

  it('编辑存量无 emoji 提议不改默认（只改名称）保存 → 落盘记录仍无 emoji 键（零物理补键）', async () => {
    writeProposals([makeProposal('p1', { name: '看电影', price: 10, childStatus: 'agreed' })])
    await router.replace('/proposals/p1/edit')
    const wrapper = await mountPage()
    expect(wrapper.get('.emoji-current').text()).toBe('🎁') // 回填默认 🎁

    // 用户未改 emoji，仅改名称保存
    await wrapper.get('.form-name-input').setValue('看话剧')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const stored = readProposals().find((p) => p.id === 'p1')!
    expect(stored.name).toBe('看话剧')
    expect(stored).not.toHaveProperty('emoji') // 无键保持缺省，不物理补键
    // 修订即认同不受影响：改名称触发修订（对方重置、修改方同意）
    expect(stored.parentStatus).toBe('agreed')
    expect(stored.childStatus).toBe('notAgreed')
  })

  it('编辑存量无 emoji 提议改选 🍕 保存 → 落盘记录带 emoji 键 🍕（显式选择照常落键）', async () => {
    writeProposals([makeProposal('p1', { name: '看电影', price: 10 })])
    await router.replace('/proposals/p1/edit')
    const wrapper = await mountPage()
    await openGrid(wrapper)
    const pizza = wrapper.findAll('.emoji-cell').find((c) => c.text() === '🍕')!
    await pizza.trigger('click')
    await wrapper.get('.form-save-btn').trigger('click')
    await flushPromises()

    const stored = readProposals().find((p) => p.id === 'p1')!
    expect(stored.emoji).toBe('🍕')
  })
})
