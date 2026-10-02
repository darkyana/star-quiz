/**
 * #266 家长超能力卡收敛单测：会话级总开关删除，卡内唯一元素为常驻「超能力奖励」按钮。
 * 覆盖：无开关卡形态（无 role=switch / 无状态圆点 / 无开启态）、奖励按钮常驻可用、
 * 奖励弹窗全流程保持现状（表单校验拦截 → 二次确认正文呈现星数+原因 → 确认落账 / 取消零写入）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SuperPowerCard from '../SuperPowerCard.vue'
import { init as initAppState } from '../../composables/useDataInfra'
import { ledger as readLedger } from '../../composables/useStarData'
import { copy } from '../../copy'

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

/** 弹窗内按钮组：[取消, 确认]（actions 槽顺序） */
function dialogButtons(wrapper: ReturnType<typeof mount>) {
  const dialog = wrapper.get('[role="dialog"]')
  const buttons = dialog.findAll('.star-button')
  const cancel = buttons.find((b) => b.classes().includes('star-button--standard'))!
  const confirm = buttons.find((b) => b.classes().includes('star-button--primary'))!
  return { dialog, cancel, confirm }
}

describe('#266 卡形态（无总开关）', () => {
  it('渲染标题与一句描述 + 常驻「超能力奖励」按钮；无 role=switch、无状态圆点、无 is-on', () => {
    const wrapper = mount(SuperPowerCard)
    const card = wrapper.get('.super-power-card')
    expect(card.text()).toContain(copy.superPower.cardTitle)
    expect(card.text()).toContain(copy.superPower.cardDesc)
    expect(wrapper.find('[role="switch"]').exists()).toBe(false)
    expect(wrapper.find('.status-dot').exists()).toBe(false)
    expect(card.classes()).not.toContain('is-on')
  })

  it('卡内唯一元素 = 奖励单按钮（常驻可用，无需先开任何开关）', () => {
    const wrapper = mount(SuperPowerCard)
    const card = wrapper.get('.super-power-card')
    const cardButtons = card.findAll('.star-button')
    expect(cardButtons).toHaveLength(1)
    expect(cardButtons[0].text()).toBe(copy.superPower.rewardBtn)
    expect(card.element.children).toHaveLength(1) // 仅 card-info，无 switch / 展开区
  })
})

describe('#266 超能力奖励弹窗（表单 / 二次确认 / 流水形态与现状一致）', () => {
  async function openRewardModal(wrapper: ReturnType<typeof mount>) {
    await wrapper.get('.reward-btn').trigger('click')
    return wrapper.get('[role="dialog"]')
  }

  it('点奖励按钮 → StarModalStandard：标题 + 两字段表单（星数数字输入 / 原因文本输入）+ 取消/确认按钮；空表单确认不可用', async () => {
    const wrapper = mount(SuperPowerCard)
    const dialog = await openRewardModal(wrapper)

    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.text()).toContain(copy.superPower.rewardTitle)
    expect(dialog.find('input[type="number"]').exists()).toBe(true)
    expect(dialog.find('input[type="text"]').exists()).toBe(true)
    expect(dialog.text()).toContain(copy.superPower.rewardAmountLabel)
    expect(dialog.text()).toContain(copy.superPower.rewardReasonLabel)
    const { cancel, confirm } = dialogButtons(wrapper)
    expect(cancel.text()).toBe(copy.superPower.cancel)
    expect(confirm.text()).toBe(copy.superPower.confirm)
    expect(confirm.attributes('disabled')).toBeDefined()
  })

  it.each([
    ['0', '主动练琴', '星数 0'],
    ['100', '主动练琴', '星数 100'],
    ['-3', '主动练琴', '星数负数'],
    ['2.5', '主动练琴', '星数非整数'],
    ['5', '', '原因为空'],
    ['5', '   ', '原因纯空白'],
  ])('非法输入（%s）→ 确认仍不可用、零写入', async (amount, reason) => {
    const wrapper = mount(SuperPowerCard)
    const dialog = await openRewardModal(wrapper)

    await dialog.get('input[type="number"]').setValue(amount)
    await dialog.get('input[type="text"]').setValue(reason)

    const { confirm } = dialogButtons(wrapper)
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(readLedger()).toEqual([])
  })

  it('全流程：合法填表 → 确认进二次确认（正文含星数 + 原因摘要）→ 再确认 → grant 落账、弹窗关闭', async () => {
    const wrapper = mount(SuperPowerCard)
    const dialog = await openRewardModal(wrapper)

    await dialog.get('input[type="number"]').setValue('5')
    await dialog.get('input[type="text"]').setValue('主动练琴半小时')
    const { confirm } = dialogButtons(wrapper)
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    // 二次确认阶段：同一弹窗正文直接呈现星数 + 原因摘要（表单隐藏）
    const confirmStage = wrapper.get('[role="dialog"]')
    expect(confirmStage.text()).toContain('5')
    expect(confirmStage.text()).toContain('主动练琴半小时')
    expect(confirmStage.find('input').exists()).toBe(false)

    await dialogButtons(wrapper).confirm.trigger('click')

    expect(readLedger()).toHaveLength(1)
    expect(readLedger()[0]).toMatchObject({
      type: 'earn',
      amount: 5,
      source: copy.superPower.rewardSource('主动练琴半小时'),
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('二次确认取消：零写入、弹窗关闭', async () => {
    const wrapper = mount(SuperPowerCard)
    const dialog = await openRewardModal(wrapper)
    await dialog.get('input[type="number"]').setValue('3')
    await dialog.get('input[type="text"]').setValue('主动看书')
    await dialogButtons(wrapper).confirm.trigger('click')

    await dialogButtons(wrapper).cancel.trigger('click')

    expect(readLedger()).toEqual([])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('表单阶段取消：零写入、弹窗关闭', async () => {
    const wrapper = mount(SuperPowerCard)
    await openRewardModal(wrapper)

    await dialogButtons(wrapper).cancel.trigger('click')

    expect(readLedger()).toEqual([])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
