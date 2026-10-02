/**
 * T-Toast 组件测试（#139）：组件吞定时器 API 形态——
 * 挂载 DOM 断言（类名 star-container + toast / role=status / icon 有无）+
 * fake timers 计时行为（2400ms 消失 / expired 触发 / 重复触发重置 / unmount 清理 /
 * 静态挂载初值非空常显不计时 / 显示中清空立即隐藏——沿旧页面失败分支行为）。
 * 样式规则块断言（info 15px/700 与布局链）见 styles-pages.test.ts（断言分层拍板）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import StarToastStandard from '../StarToastStandard.vue'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('#139 挂载 DOM 结构', () => {
  it('初值空：不渲染', () => {
    const wrapper = mount(StarToastStandard, { props: { message: '' } })
    expect(wrapper.find('.toast').exists()).toBe(false)
  })

  it('message 非空出现：根元素挂 star-container 样式集类 + toast 类 + role=status，文本即 message', async () => {
    const wrapper = mount(StarToastStandard, { props: { message: '' } })
    await wrapper.setProps({ message: '兑换成功！宝物已放进星星宝藏箱' })
    const toast = wrapper.get('.toast')
    expect(toast.classes()).toContain('star-container')
    expect(toast.attributes('role')).toBe('status')
    expect(toast.text()).toBe('兑换成功！宝物已放进星星宝藏箱')
  })

  it('icon 默认 false：无图标 svg；icon=true：渲染 Material done 勾（18px，aria-hidden）', async () => {
    const plain = mount(StarToastStandard, { props: { message: '' } })
    await plain.setProps({ message: '核销成功！这件宝物完成使命啦' })
    expect(plain.find('.toast svg').exists()).toBe(false)

    const withIcon = mount(StarToastStandard, { props: { message: '', icon: true } })
    await withIcon.setProps({ message: '核销成功！这件宝物完成使命啦' })
    const svg = withIcon.get('.toast svg')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('width')).toBe('18')
    expect(svg.attributes('height')).toBe('18')
    expect(svg.get('path').attributes('d')).toBe('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z')
  })
})

describe('#139 计时行为（fake timers）', () => {
  it('2400ms 自动消失并触发 expired；随后页面清空 message（@expired 契约）不再重复触发', async () => {
    const wrapper = mount(StarToastStandard, { props: { message: '' } })
    await wrapper.setProps({ message: '已保存' })
    expect(wrapper.find('.toast').exists()).toBe(true)
    vi.advanceTimersByTime(2399)
    expect(wrapper.find('.toast').exists()).toBe(true)
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(wrapper.find('.toast').exists()).toBe(false)
    expect(wrapper.emitted('expired')).toHaveLength(1)
    // 页面契约：expired 后清空文案（空→空 watch 不重弹、不再触发 expired）
    await wrapper.setProps({ message: '' })
    expect(wrapper.emitted('expired')).toHaveLength(1)
  })

  it('同文案重弹依赖 @expired 清空：清空后同文案再来 → watch 触发再次显示', async () => {
    const wrapper = mount(StarToastStandard, { props: { message: '' } })
    await wrapper.setProps({ message: '已保存' })
    vi.advanceTimersByTime(2400)
    expect(wrapper.emitted('expired')).toHaveLength(1)
    // 页面监听 expired 清空 → 同文案第二次弹（原型 B 区坑的反面：契约正确时正常重弹）
    await wrapper.setProps({ message: '' })
    await wrapper.setProps({ message: '已保存' })
    expect(wrapper.find('.toast').exists()).toBe(true)
    vi.advanceTimersByTime(2400)
    expect(wrapper.emitted('expired')).toHaveLength(2)
  })

  it('重复触发重置计时：显示中换文案，计时从头算（旧计时不清零会提前消失）', async () => {
    const wrapper = mount(StarToastStandard, { props: { message: '' } })
    await wrapper.setProps({ message: '第一条' })
    vi.advanceTimersByTime(2000)
    await wrapper.setProps({ message: '第二条' })
    // 相对第二条仅过 400ms（若未重置，累计 2400ms 会消失）
    vi.advanceTimersByTime(400)
    expect(wrapper.find('.toast').exists()).toBe(true)
    expect(wrapper.get('.toast').text()).toBe('第二条')
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(wrapper.find('.toast').exists()).toBe(false)
    expect(wrapper.emitted('expired')).toHaveLength(1)
  })

  it('unmount 清理定时器：卸载后计时到期不再触发 expired', async () => {
    const wrapper = mount(StarToastStandard, { props: { message: '' } })
    await wrapper.setProps({ message: '已保存' })
    wrapper.unmount()
    vi.advanceTimersByTime(2400)
    expect(wrapper.emitted('expired')).toBeUndefined()
  })

  it('静态挂载初值非空 = 常显不计时（组件展示页形态：watch 不带 immediate）', async () => {
    const wrapper = mount(StarToastStandard, { props: { message: '兑换成功！宝物已放进星星宝藏箱' } })
    expect(wrapper.find('.toast').exists()).toBe(true)
    vi.advanceTimersByTime(4800)
    expect(wrapper.find('.toast').exists()).toBe(true)
    expect(wrapper.emitted('expired')).toBeUndefined()
  })

  it('显示中页面主动清空 message → 立即隐藏（沿旧页面失败分支 showToast 置 false 行为），不触发 expired', async () => {
    const wrapper = mount(StarToastStandard, { props: { message: '' } })
    await wrapper.setProps({ message: '复制成功' })
    expect(wrapper.find('.toast').exists()).toBe(true)
    await wrapper.setProps({ message: '' })
    expect(wrapper.find('.toast').exists()).toBe(false)
    vi.advanceTimersByTime(2400)
    expect(wrapper.emitted('expired')).toBeUndefined()
  })
})
