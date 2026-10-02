/**
 * StarModalStandard 组件单测（#216）：actions 槽三按钮形态纵向满宽堆叠，双按钮横排不变。
 * 结构断言走挂载 DOM（2026-08-30 样式断言分层拍板）：stacked 类落位 / 按钮顺序 / 非三按钮形态零变化。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { Fragment, h } from 'vue'
import StarModalStandard from '../StarModalStandard.vue'
import StarButtonStandard from '../StarButtonStandard.vue'

const ACTIONS_SELECTOR = '.star-modal__actions'
const STACKED_CLASS = 'star-modal__actions--stacked'

async function mountModal(actions: () => unknown) {
  const wrapper = mount(StarModalStandard, {
    props: { message: '本次导入将写入 3 题' },
    slots: { actions },
  })
  // stacked 计数在 onMounted 后置位，重渲染在 nextTick 落 DOM
  await nextTick()
  return wrapper
}

function button(text: string, variant: 'standard' | 'primary' = 'standard') {
  return h(StarButtonStandard, { variant, size: 'large', edgeInset: false }, () => text)
}

describe('#216 actions 槽三按钮纵向堆叠', () => {
  it('三按钮形态：actions 容器挂 stacked 类，按钮从上到下为 取消 / 导入并重置 / 导入并追加', async () => {
    const wrapper = await mountModal(() => [
      button('取消'),
      button('导入并重置', 'primary'),
      button('导入并追加', 'primary'),
    ])
    const actions = wrapper.get(ACTIONS_SELECTOR)
    expect(actions.classes()).toContain(STACKED_CLASS)
    const labels = actions.findAll('button').map((b) => b.text())
    expect(labels).toEqual(['取消', '导入并重置', '导入并追加'])
    wrapper.unmount()
  })

  it('双按钮形态（取消 / 确认）：无 stacked 类（既有横排不变）', async () => {
    const wrapper = await mountModal(() => [button('取消'), button('导入并重置', 'primary')])
    expect(wrapper.get(ACTIONS_SELECTOR).classes()).not.toContain(STACKED_CLASS)
    wrapper.unmount()
  })

  it('内置 confirm 双按钮形态：无 stacked 类（无 actions 槽零变化）', async () => {
    const wrapper = mount(StarModalStandard, { props: { message: '确定要重新开始吗？' } })
    await nextTick()
    expect(wrapper.get(ACTIONS_SELECTOR).classes()).not.toContain(STACKED_CLASS)
    expect(wrapper.findAll(ACTIONS_SELECTOR + ' button')).toHaveLength(2)
    wrapper.unmount()
  })

  it('Fragment 嵌套（template 分支编译产物）中的三按钮同样识别为三钮形态（Parent 使用形态）', async () => {
    const wrapper = mount(StarModalStandard, {
      props: { message: 'confirm' },
      slots: {
        actions: () => [
          h(Fragment, null, [button('取消'), button('导入并重置', 'primary'), button('导入并追加', 'primary')]),
        ],
      },
    })
    await nextTick()
    expect(wrapper.get(ACTIONS_SELECTOR).classes()).toContain(STACKED_CLASS)
    expect(wrapper.findAll(ACTIONS_SELECTOR + ' button')).toHaveLength(3)
    wrapper.unmount()
  })
})
