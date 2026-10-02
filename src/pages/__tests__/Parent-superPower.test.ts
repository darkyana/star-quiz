/**
 * #266 家长页超能力卡挂载位置单测（收敛后形态）。
 * 断言 DOM 顺序：.super-power-card 渲染于 parent-main 内、位于操作区大按钮（.parent-actions）之前；
 * 卡为无开关形态（无 role=switch），卡内含常驻「超能力奖励」按钮。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Parent from '../Parent.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

describe('#266 家长页超能力卡挂载（无开关、仅奖励按钮）', () => {
  it('家长页渲染「家长超能力」卡，位于 parent-main 内、操作区大按钮之前（DOM 顺序居前）', async () => {
    await router.replace('/parent')
    const wrapper = mount(Parent, { global: { plugins: [router] } })
    await flushPromises()

    const main = wrapper.get('.parent-main')
    const cards = main.findAll('.star-container')
    const spIndex = cards.findIndex((c) => c.classes().includes('super-power-card'))
    expect(spIndex).toBeGreaterThanOrEqual(0)
    expect(main.findAll('.parent-actions')).toHaveLength(1)
    expect(cards[spIndex].element.compareDocumentPosition(main.get('.parent-actions').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.get('.super-power-card').text()).toContain(copy.superPower.cardTitle)
  })

  it('超能力卡无总开关（零 role=switch）、含常驻「超能力奖励」按钮；家长页其余骨架零改动（返回钮 / 四操作钮常驻）', async () => {
    await router.replace('/parent')
    const wrapper = mount(Parent, { global: { plugins: [router] } })
    await flushPromises()

    const spCard = wrapper.get('.super-power-card')
    expect(spCard.find('[role="switch"]').exists()).toBe(false)
    expect(spCard.text()).toContain(copy.superPower.rewardBtn)
    expect(wrapper.text()).toContain(copy.parent.dataManage)
    expect(wrapper.text()).toContain(copy.parent.ledgerManage)
    expect(wrapper.text()).toContain(copy.parent.componentsLibrary)
    expect(wrapper.text()).toContain(copy.parent.proposalsEntry)
  })
})
