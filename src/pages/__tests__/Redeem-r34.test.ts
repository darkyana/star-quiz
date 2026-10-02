/**
 * R34 T7 兑换页「提议板」入口单测（Spec 20260828-R34 §AC-R34-1-1 / §AC-R34-1-2 / §AC-R34-9-2 入口侧）。
 * 入口与「星星记事本」入口位于同一并列容器、类名结构一致（同款样式复用，REQ-R34-1-1）；
 * 点击跳孩子端提议板路由（REQ-R34-1-2）；渲染文本与 copy 槽位值一致（组件零硬编码文案）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Redeem from '../Redeem.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import '../../composables/useStarData'
import '../../composables/useLearningData'

async function mountRedeem() {
  await router.replace('/redeem')
  const wrapper = mount(Redeem, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

describe('AC-R34-1-1 兑换页底部「提议板」入口（并列同款）', () => {
  it('存在提议板入口与星星记事本入口：同一并列容器内、类名结构一致（同款样式复用）', async () => {
    const wrapper = await mountRedeem()

    const links = wrapper.findAll('.page-links .ledger-link')
    expect(links).toHaveLength(2)
    // 类名结构一致（REQ-R34-1-1 同款样式 = 复用既有入口类名）
    expect(links[0]!.classes().join(' ')).toBe(links[1]!.classes().join(' '))

    const texts = links.map((l) => l.text())
    expect(texts).toContain(copy.redeem.ledgerLink)
    expect(texts).toContain(copy.redeem.proposalsEntry)
  })
})

describe('AC-R34-1-2 点击入口跳孩子端提议板路由', () => {
  it('点「提议板」入口 → 路由 /child/proposals（与家长端 /proposals 区分）', async () => {
    const wrapper = await mountRedeem()

    const entry = wrapper.findAll('.ledger-link').find((b) => b.text() === copy.redeem.proposalsEntry)!
    await entry.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/child/proposals')
  })
})

describe('AC-R34-9-2 入口渲染文本与 copy 槽位一致', () => {
  it('提议板入口文本 = copy.redeem.proposalsEntry 槽位值（组件零硬编码）', async () => {
    const wrapper = await mountRedeem()

    const entry = wrapper.findAll('.ledger-link').find((b) => b.text() === copy.redeem.proposalsEntry)
    expect(entry).toBeDefined()
    expect(entry!.text()).toBe(copy.redeem.proposalsEntry)
  })
})
