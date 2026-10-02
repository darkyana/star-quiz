/**
 * StarListSelectable 组件测试（#187）
 * 覆盖：toggle 行为三条契约（主体点击 emit / action 槽点击不 emit / disabled 不 emit）、
 * disabled 视觉（降透明度 + not-allowed）、选中视觉（primary 描边 + 外圈环，覆盖 star-container 默认）、
 * 勾选圆 = StarCheckCircle（size sm）调用而非自绘（组件源码断言：无自绘圆样式 + 有组件引用）、
 * 根元素挂 star-container + 令牌引用、注册表条目与展示页四格。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarListSelectable from '../StarListSelectable.vue'
import StarCheckCircle from '../StarCheckCircle.vue'
import { componentRegistry } from '../registry'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarListSelectable.vue'), 'utf-8')

describe('StarListSelectable — toggle 行为契约（#187）', () => {
  it('主体区点击 → emit toggle 一次', async () => {
    const wrapper = mount(StarListSelectable, { props: { selected: false }, slots: { default: '题干样例' } })
    await wrapper.get('.star-list-selectable__body').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('action 槽点击 → 不 emit toggle（stopPropagation 分区契约）', async () => {
    const wrapper = mount(StarListSelectable, {
      props: { selected: false },
      slots: { default: '题干样例', action: '<button class="act">编辑</button>' },
    })
    await wrapper.get('button.act').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('disabled=true → 点击主体不 emit toggle', async () => {
    const wrapper = mount(StarListSelectable, { props: { selected: true, disabled: true }, slots: { default: '题干样例' } })
    await wrapper.get('.star-list-selectable__body').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })
})

describe('StarListSelectable — 状态视觉与结构（#187）', () => {
  it('根元素挂 star-container 样式集 + 组件类；选中态带 --selected 修饰类', () => {
    const off = mount(StarListSelectable, { props: { selected: false } })
    expect(off.classes()).toContain('star-container')
    expect(off.classes()).toContain('star-list-selectable')
    expect(off.classes()).not.toContain('star-list-selectable--selected')
    const on = mount(StarListSelectable, { props: { selected: true } })
    expect(on.classes()).toContain('star-list-selectable--selected')
  })

  it('disabled：带 --disabled 修饰类，视觉降透明（0.62 口径）+ not-allowed', () => {
    const wrapper = mount(StarListSelectable, { props: { selected: false, disabled: true } })
    expect(wrapper.classes()).toContain('star-list-selectable--disabled')
    const text = readFileSync(resolve(process.cwd(), 'src/components/StarListSelectable.vue'), 'utf-8')
    expect(text).toContain('opacity: 0.62')
    expect(text).toContain('cursor: not-allowed')
  })

  it('结构：左勾选圆（StarCheckCircle sm）+ 中主体 + 右 action 槽（有槽才渲染）', () => {
    const plain = mount(StarListSelectable, { props: { selected: false }, slots: { default: '题干' } })
    const check = plain.findComponent(StarCheckCircle)
    expect(check.exists()).toBe(true)
    expect(check.props('checked')).toBe(false)
    expect(check.props('size')).toBe('sm')
    expect(plain.get('.star-list-selectable__body').text()).toBe('题干')
    expect(plain.find('.star-list-selectable__action').exists()).toBe(false)
    const withAction = mount(StarListSelectable, { props: { selected: true }, slots: { default: '题干', action: '<b>编辑</b>' } })
    expect(withAction.findComponent(StarCheckCircle).props('checked')).toBe(true)
    expect(withAction.get('.star-list-selectable__action').text()).toBe('编辑')
  })
})

describe('StarListSelectable — 勾选圆不自绘 + 令牌契约（#187）', () => {
  it('勾选圆 = StarCheckCircle 调用（size sm）：源码有组件引用，grep 不到勾选圆自绘样式', () => {
    expect(COMPONENT_TEXT).toMatch(/import StarCheckCircle from '\.\/StarCheckCircle\.vue'/)
    expect(COMPONENT_TEXT).toContain('<StarCheckCircle')
    // 自绘同貌禁区：不得出现圆形勾选样式（圆 border-radius:50% / 勾选字符 / 勾选圆类名）
    expect(COMPONENT_TEXT).not.toMatch(/border-radius:\s*50%/)
    expect(COMPONENT_TEXT).not.toContain('✓')
    expect(COMPONENT_TEXT).not.toMatch(/__check[\s\S]{0,200}\{[^}]*border[^}]*\}/)
  })

  it('选中视觉（票面直译）：描边与外环均 color-primary，全部令牌引用', () => {
    const rule = COMPONENT_TEXT.match(/\.star-list-selectable--selected\s*\{([^}]*)\}/)![1]
    expect(rule).toContain('border-color: var(--color-primary)')
    expect(rule).toMatch(/box-shadow: 0 0 0 1px var\(--color-primary\)/)
  })

  it('布局令牌（票面直译）：min-height touch-md + 内边距 space-sm/space-gutter，根不重复自绘白底灰描边', () => {
    const rule = COMPONENT_TEXT.match(/\.star-list-selectable\s*\{([^}]*)\}/)![1]
    expect(rule).toContain('min-height: var(--touch-md)')
    expect(rule).toContain('padding: var(--space-sm) var(--space-gutter)')
  })
})

describe('StarListSelectable — 注册表与展示页（#187）', () => {
  it('注册表含 star-list-selectable 条目，四格（未选/选中 × 带/不带 action 槽）', () => {
    const entry = componentRegistry.find((e) => e.key === 'star-list-selectable')!
    expect(entry.component).toBe(StarListSelectable)
    expect(entry.showcase).toHaveLength(4)
    const flags = entry.showcase.map((c) => ({ selected: c.props.selected, hasAction: !!c.slots?.action }))
    expect(flags).toEqual([
      { selected: false, hasAction: false },
      { selected: true, hasAction: false },
      { selected: false, hasAction: true },
      { selected: true, hasAction: true },
    ])
    // 四格形态覆盖 disabled（选中 × disabled 格）
    expect(entry.showcase[3].props.disabled).toBe(true)
  })
})
