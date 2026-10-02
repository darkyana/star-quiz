/**
 * StarEmptyState 组件测试（#196 C- 组件卡）：空态块元组件渲染契约。
 * icon 两态（默认 true → 内部 StarGlyph lg；false = 纯文案态）+ default slot 透传。
 * 结构断言用挂载 DOM（2026-08-30 拍板）；probe 直译样式继续源码文本锁定（与 StarSectionShell.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarEmptyState from '../StarEmptyState.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarEmptyState.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarEmptyState — #196 渲染契约（icon 两态 + slot）', () => {
  it('默认（不传 props）：icon=true，根节点 div.star-empty-state + 内部 StarGlyph lg（不自绘星形）', () => {
    const wrapper = mount(StarEmptyState, {
      slots: { default: '兑换目录还空着' },
    })
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.classes()).toContain('star-empty-state')
    // 不挂 star-container（页面级区块，容器视觉归页面）
    expect(wrapper.classes()).not.toContain('star-container')
    // 星形本体 = StarGlyph lg 档组件（#195 收编，非自绘 svg）
    expect(wrapper.find('svg.star-glyph--lg').exists()).toBe(true)
    expect(wrapper.find('svg.star-glyph--lg').classes()).toContain('star-glyph')
  })

  it('icon=true 显式传入：与默认同貌，星形 + 文案并存', () => {
    const wrapper = mount(StarEmptyState, {
      props: { icon: true },
      slots: { default: '宝藏箱还空着' },
    })
    expect(wrapper.find('svg.star-glyph--lg').exists()).toBe(true)
    expect(wrapper.get('p.star-empty-text').text()).toBe('宝藏箱还空着')
  })

  it('icon=false：纯文案态，不渲染星形，文案照常渲染', () => {
    const wrapper = mount(StarEmptyState, {
      props: { icon: false },
      slots: { default: '还没有提议，先新建一个吧' },
    })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.get('p.star-empty-text').text()).toBe('还没有提议，先新建一个吧')
  })

  it('default slot 透传：富文本（多节点 / 强调标记）原样容纳', () => {
    const wrapper = mount(StarEmptyState, {
      props: { icon: false },
      slots: { default: '<span class="demo-rich">空态文案</span><strong class="demo-em">强调</strong>' },
    })
    expect(wrapper.find('.demo-rich').exists()).toBe(true)
    expect(wrapper.find('.demo-em').exists()).toBe(true)
    expect(wrapper.get('p.star-empty-text').text()).toBe('空态文案强调')
  })

  it('文案节点恒为 p.star-empty-text（两态一致；get 缺失即抛错）', () => {
    const withIcon = mount(StarEmptyState, { slots: { default: '文案' } })
    const noIcon = mount(StarEmptyState, { props: { icon: false }, slots: { default: '文案' } })
    expect(withIcon.get('p.star-empty-text').text()).toBe('文案')
    expect(noIcon.get('p.star-empty-text').text()).toBe('文案')
  })
})

describe('StarEmptyState — #196 probe #194 第 2 节直译（样式源码断言）', () => {
  it('空态块：纵向居中 flex + 间距令牌（gap sm / padding xl·gutter）+ 文案居中', () => {
    const rule = extractRule('star-empty-state')
    expect(rule).toContain('display: flex')
    expect(rule).toContain('flex-direction: column')
    expect(rule).toContain('align-items: center')
    expect(rule).toContain('gap: var(--space-sm)')
    expect(rule).toContain('padding: var(--space-xl) var(--space-gutter)')
    expect(rule).toContain('text-align: center')
  })

  it('空态文案：body 档 + 400 字重 + 次级文字色 + 无外边距', () => {
    const rule = extractRule('star-empty-text')
    expect(rule).toContain('margin: 0')
    expect(rule).toContain('font-size: var(--font-size-body)')
    expect(rule).toContain('font-weight: 400')
    expect(rule).toContain('color: var(--color-text-secondary)')
  })

  it('禁止自绘星形：组件模板无 svg 元素，星形本体只经 StarGlyph 组件引入', () => {
    const template = COMPONENT_TEXT.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
    expect(template).not.toContain('<svg')
    expect(COMPONENT_TEXT).toContain("import StarGlyph from './StarGlyph.vue'")
  })
})
