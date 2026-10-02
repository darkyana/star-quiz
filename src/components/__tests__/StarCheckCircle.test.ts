/**
 * StarCheckCircle 组件测试（#182）
 * 覆盖：checked × size 各态类名与内容、受控契约（无点击切换 / 无 emits / 无内部状态翻转）、
 * 视觉令牌直译（描边 outline / 选中底与描边 primary / ✓ on-primary + 字重 700）、
 * 尺寸矩阵（md 28 / sm 22px，字号 14 / 12px）、注册表条目与展示页四态。
 * 渲染尺寸走组件源码规则块断言（jsdom 不算真布局，与 StarGlyph.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarCheckCircle from '../StarCheckCircle.vue'
import { componentRegistry } from '../registry'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarCheckCircle.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarCheckCircle — checked × size 各态（#182）', () => {
  it('默认：checked=false + size=md → 根带 star-check-circle / --md，无 --checked、无 ✓', () => {
    const wrapper = mount(StarCheckCircle, { props: { checked: false } })
    expect(wrapper.classes()).toContain('star-check-circle')
    expect(wrapper.classes()).toContain('star-check-circle--md')
    expect(wrapper.classes()).not.toContain('star-check-circle--checked')
    expect(wrapper.find('.star-check-circle__tick').exists()).toBe(false)
  })

  it('checked=true（md）：带 --checked，渲染 ✓ 字符', () => {
    const wrapper = mount(StarCheckCircle, { props: { checked: true } })
    expect(wrapper.classes()).toContain('star-check-circle--checked')
    expect(wrapper.find('.star-check-circle__tick').text()).toBe('✓')
  })

  it('sm 档：类名 + 渲染尺寸 22px / 字号走 --font-size-caption（票面 12px 表外，令牌门禁保守取档）', () => {
    const wrapper = mount(StarCheckCircle, { props: { checked: false, size: 'sm' } })
    expect(wrapper.classes()).toContain('star-check-circle--sm')
    const rule = extractRule('star-check-circle--sm')
    expect(rule).toContain('width: 22px')
    expect(rule).toContain('height: 22px')
    expect(rule).toContain('font-size: var(--font-size-caption)')
  })

  it('md 档：渲染尺寸 28px / 字号走 --font-size-info', () => {
    const rule = extractRule('star-check-circle--md')
    expect(rule).toContain('width: 28px')
    expect(rule).toContain('height: 28px')
    expect(rule).toContain('font-size: var(--font-size-info)')
  })

  it('枚举封死：size prop 仅声明 sm/md 两档（无任意 px 通道）', () => {
    expect(COMPONENT_TEXT).toMatch(/size\?: 'sm' \| 'md'/)
  })
})

describe('StarCheckCircle — 视觉令牌契约（#182）', () => {
  it('未选基础态：透明底 + 2px 描边 --color-outline + 圆形', () => {
    const rule = extractRule('star-check-circle')
    expect(rule).toContain('background-color: transparent')
    expect(rule).toContain('border: 2px solid var(--color-outline)')
    expect(rule).toContain('border-radius: 50%')
  })

  it('选中态：底与描边同色 --color-primary + ✓ 色 --color-on-primary + 字重 700', () => {
    const rule = extractRule('star-check-circle--checked')
    expect(rule).toContain('background-color: var(--color-primary)')
    expect(rule).toContain('border-color: var(--color-primary)')
    expect(rule).toContain('color: var(--color-on-primary)')
    expect(rule).toContain('font-weight: 700')
  })

  it('无新造色值：源码只出现 color-primary / color-on-primary / color-outline 三处令牌色', () => {
    const colorVars = COMPONENT_TEXT.match(/var\(--color-[a-z-]+\)/g) ?? []
    expect([...new Set(colorVars)].sort()).toEqual([
      'var(--color-on-primary)',
      'var(--color-outline)',
      'var(--color-primary)',
    ])
  })
})

describe('StarCheckCircle — 受控契约（#182）', () => {
  it('无点击切换逻辑：无 emits 声明、无 slot 出口、无内部 ref 状态', () => {
    expect(COMPONENT_TEXT).not.toContain('defineEmits')
    expect(COMPONENT_TEXT).not.toContain('<slot')
    expect(COMPONENT_TEXT).not.toContain('ref(')
  })

  it('checked prop 不翻转：点击根元素后仍按传入 props 渲染', async () => {
    const wrapper = mount(StarCheckCircle, { props: { checked: false } })
    await wrapper.get('.star-check-circle').trigger('click')
    expect(wrapper.classes()).not.toContain('star-check-circle--checked')
    // 原生 click 经 attrs 透传属正常；契约断言 = 无 update:checked / toggle 等自定义事件出口
    expect(wrapper.emitted('update:checked')).toBeUndefined()
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('checked 响应式跟随调用方：prop 翻转 → 选中态跟随', async () => {
    const wrapper = mount(StarCheckCircle, { props: { checked: false } })
    await wrapper.setProps({ checked: true })
    expect(wrapper.classes()).toContain('star-check-circle--checked')
    expect(wrapper.find('.star-check-circle__tick').exists()).toBe(true)
  })
})

describe('StarCheckCircle — 注册表与展示页（#182）', () => {
  const entry = componentRegistry.find((e) => e.key === 'star-check-circle')

  it('注册表含 star-check-circle 条目，指向本组件', () => {
    expect(entry).toBeTruthy()
    expect(entry!.component).toBe(StarCheckCircle)
  })

  it('展示页四态：未选/选中 × sm/md', () => {
    expect(entry!.showcase).toHaveLength(4)
    const combos = entry!.showcase.map((c) => `${c.props.checked}/${c.props.size}`)
    expect(combos.sort()).toEqual(['false/sm', 'true/sm', 'false/md', 'true/md'].sort())
  })
})
