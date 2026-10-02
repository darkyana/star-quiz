/**
 * StarProgressBar 组件测试（#200 C- 组件卡）
 * 覆盖：边界值（0 / max / max 非正防除零）、label 与 default slot 双通道（slot 优先、
 * 两者皆无不渲染文字区）、aria progressbar 内建、sticky 吸顶内置、
 * 填充纯 color-primary 实心（无金渐变无星光，probe #194 第 3 节定稿）。
 * 样式断言读组件源码提取规则块（与 StarButtonStandard.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarProgressBar from '../StarProgressBar.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarProgressBar.vue'), 'utf-8')

/** 提取某选择器（类名，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('#200 StarProgressBar — 边界值与百分比宽', () => {
  it('value=0 → 填充宽 0%', () => {
    const w = mount(StarProgressBar, { props: { value: 0, max: 10, label: '0 / 10' } })
    expect(w.get('.star-progress-fill').attributes('style')).toContain('width: 0%')
  })

  it('value=max → 填充宽 100%', () => {
    const w = mount(StarProgressBar, { props: { value: 10, max: 10, label: '10 / 10' } })
    expect(w.get('.star-progress-fill').attributes('style')).toContain('width: 100%')
  })

  it('中段按 value/max 直算（3/10 → 30%）', () => {
    const w = mount(StarProgressBar, { props: { value: 3, max: 10, label: '3 / 10' } })
    expect(w.get('.star-progress-fill').attributes('style')).toContain('width: 30%')
  })

  it('max 非正数防除零 → 回落 0%', () => {
    const w = mount(StarProgressBar, { props: { value: 5, max: 0, label: 'x' } })
    expect(w.get('.star-progress-fill').attributes('style')).toContain('width: 0%')
  })
})

describe('#200 StarProgressBar — label/slot 双通道', () => {
  it('label prop 一句话渲染进文字区', () => {
    const w = mount(StarProgressBar, { props: { value: 4, max: 10, label: '第 4 / 10 题' } })
    expect(w.get('.star-progress-label').text()).toBe('第 4 / 10 题')
  })

  it('default slot 复杂内容优先于 label', () => {
    const w = mount(StarProgressBar, {
      props: { value: 4, max: 10, label: '不应出现的文字' },
      slots: { default: '已选 13 题' },
    })
    expect(w.get('.star-progress-label').text()).toBe('已选 13 题')
    expect(w.text()).not.toContain('不应出现的文字')
  })

  it('label 与 slot 皆无 → 不渲染文字区', () => {
    const w = mount(StarProgressBar, { props: { value: 4, max: 10 } })
    expect(w.find('.star-progress-label').exists()).toBe(false)
  })
})

describe('#200 StarProgressBar — aria progressbar 内建', () => {
  it('轨道挂 role=progressbar，valuemin=0 / valuemax=max / valuenow=value', () => {
    const w = mount(StarProgressBar, { props: { value: 3, max: 10, label: '3 / 10' } })
    const bar = w.get('.star-progress-bar')
    expect(bar.attributes('role')).toBe('progressbar')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('10')
    expect(bar.attributes('aria-valuenow')).toBe('3')
  })
})

describe('#200 StarProgressBar — sticky 内置 + probe 第 3 节视觉直译', () => {
  it('sticky 吸顶内置：position sticky + top 0 挂行容器（jsdom 不算布局，源码文本锁定）', () => {
    const area = extractRule('star-progress-area')
    expect(area).toContain('position: sticky')
    expect(area).toContain('top: 0')
  })

  it('轨道：surface-dim 底 + outline 描边 + full 圆角 + 内阴影（probe 直译）', () => {
    const bar = extractRule('star-progress-bar')
    expect(bar).toContain('height: 16px')
    expect(bar).toContain('background-color: var(--color-surface-dim)')
    expect(bar).toContain('border: var(--border-thin) solid var(--color-outline)')
    expect(bar).toContain('border-radius: var(--radius-full)')
    expect(bar).toContain('overflow: hidden')
    expect(bar).toContain('box-shadow: inset 0 var(--shadow-xs) 0 var(--color-surface-shadow)')
  })

  it('填充：纯 color-primary 实心 + full 圆角 + 宽度过渡；组件零金渐变零微光令牌', () => {
    const fill = extractRule('star-progress-fill')
    expect(fill).toContain('background-color: var(--color-primary)')
    expect(fill).toContain('border-radius: var(--radius-full)')
    expect(fill).toContain('transition: width var(--duration-base) ease')
    expect(COMPONENT_TEXT).not.toContain('linear-gradient')
    expect(COMPONENT_TEXT).not.toContain('--glow-progress')
  })

  it('文字区骨架：label 档字号 + 次级色 + 不折行', () => {
    const label = extractRule('star-progress-label')
    expect(label).toContain('font-size: var(--font-size-label)')
    expect(label).toContain('color: var(--color-text-secondary)')
    expect(label).toContain('white-space: nowrap')
  })
})
