/**
 * StarSegmentTabs 组件测试（#183 C- 组件卡）：通用 N 项分段单选——v-model 单选、
 * 选中项类名切换、radiogroup 可达性口径、令牌直译视觉（源码断言，jsdom 不计算样式）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarSegmentTabs from '../StarSegmentTabs.vue'

const ITEMS = [
  { key: 'all', label: '全部' },
  { key: 'flag', label: '红旗' },
  { key: 'wrong', label: '最近错' },
]

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarSegmentTabs.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarSegmentTabs — #183 v-model 单选', () => {
  it('按 items 渲染 N 个 radio 按钮，文案透传', () => {
    const wrapper = mount(StarSegmentTabs, { props: { modelValue: 'all', items: ITEMS } })
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios).toHaveLength(3)
    expect(radios.map((r) => r.text())).toEqual(['全部', '红旗', '最近错'])
  })

  it('radiogroup 口径：容器 role=radiogroup，aria-checked 随 modelValue', () => {
    const wrapper = mount(StarSegmentTabs, { props: { modelValue: 'flag', items: ITEMS } })
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true)
    const states = wrapper.findAll('[role="radio"]').map((r) => r.attributes('aria-checked'))
    expect(states).toEqual(['false', 'true', 'false'])
  })

  it('点击未选项 emit update:modelValue（key），选中类名切换到新项', async () => {
    const wrapper = mount(StarSegmentTabs, { props: { modelValue: 'all', items: ITEMS } })
    expect(wrapper.findAll('.star-segment-tabs__item').map((b) => b.classes())).toEqual([
      expect.arrayContaining(['is-selected']),
      expect.not.arrayContaining(['is-selected']),
      expect.not.arrayContaining(['is-selected']),
    ])
    await wrapper.findAll('[role="radio"]')[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['flag']])
  })

  it('点击任意项均 emit update:modelValue（沿 StarModeEntry 先例，选中态归父级 modelValue）', async () => {
    const wrapper = mount(StarSegmentTabs, { props: { modelValue: 'all', items: ITEMS } })
    await wrapper.findAll('[role="radio"]')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['all']])
  })

  it('两段实例：grid 等分 2 列（内联样式随 items 数量）', () => {
    const wrapper = mount(StarSegmentTabs, {
      props: { modelValue: 'easy', items: [ITEMS[0], ITEMS[1]] },
    })
    expect(wrapper.attributes('style')).toContain('grid-template-columns: repeat(2, 1fr)')
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(2)
  })
})

describe('StarSegmentTabs — #183 态样式（票面视觉直译，源码断言）', () => {
  it('未选段：surface-dim 底 + outline 描边 + 次级字 + 700 字重 + info 字号 + md 圆角 + touch-sm 热区', () => {
    const rule = extractRule('star-segment-tabs__item')
    expect(rule).toContain('background-color: var(--color-surface-dim)')
    expect(rule).toContain('border: var(--border-thin) solid var(--color-outline)')
    expect(rule).toContain('color: var(--color-text-secondary)')
    expect(rule).toContain('font-weight: 700')
    expect(rule).toContain('font-size: var(--font-size-info)')
    expect(rule).toContain('border-radius: var(--radius-md)')
    expect(rule).toContain('min-height: var(--touch-sm)')
  })

  it('选中段：surface-bright 底 + 价签金描边 + 主色字（与 StarModeEntry 渐变填充选中态区分）', () => {
    const rule = extractRule('star-segment-tabs__item.is-selected')
    expect(rule).toContain('background-color: var(--color-surface-bright)')
    expect(rule).toContain('border-color: var(--color-price-tag-border)')
    expect(rule).toContain('color: var(--color-primary)')
  })

  it('轨道：grid 布局 + 项间距 space-base', () => {
    const rule = extractRule('star-segment-tabs')
    expect(rule).toContain('display: grid')
    expect(rule).toContain('gap: var(--space-base)')
  })

  it('无新造色值：组件样式不含裸 hex / rgba() 字面色', () => {
    expect(COMPONENT_TEXT).not.toMatch(/#[0-9a-fA-F]{6}\b/)
    expect(COMPONENT_TEXT).not.toMatch(/rgba?\(/)
  })
})
