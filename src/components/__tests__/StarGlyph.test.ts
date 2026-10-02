/**
 * StarGlyph 组件测试（#195）
 * 覆盖：size 三档（sm 18 / md 24 / lg 48）类名 + 渲染尺寸档、星光微光令牌内置、
 * fill/stroke 恒 --color-star（全仓星星一色，不加 tone）、枚举封死、attrs 透传。
 * 渲染尺寸走组件源码规则块断言（jsdom 不算真布局，与 StarButtonStandard.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarGlyph from '../StarGlyph.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarGlyph.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarGlyph — size 三档（#195）', () => {
  it('默认 size=md：根 svg 带 star-glyph 与 star-glyph--md 类', () => {
    const wrapper = mount(StarGlyph)
    expect(wrapper.classes()).toContain('star-glyph')
    expect(wrapper.classes()).toContain('star-glyph--md')
  })

  it('sm 档：类名 + 渲染尺寸 18px（probe #194 第 1 节直译）', () => {
    const wrapper = mount(StarGlyph, { props: { size: 'sm' } })
    expect(wrapper.classes()).toContain('star-glyph--sm')
    const rule = extractRule('star-glyph--sm')
    expect(rule).toContain('width: 18px')
    expect(rule).toContain('height: 18px')
  })

  it('md 档：类名 + 渲染尺寸 24px', () => {
    const wrapper = mount(StarGlyph, { props: { size: 'md' } })
    expect(wrapper.classes()).toContain('star-glyph--md')
    const rule = extractRule('star-glyph--md')
    expect(rule).toContain('width: 24px')
    expect(rule).toContain('height: 24px')
  })

  it('lg 档：类名 + 渲染尺寸 48px', () => {
    const wrapper = mount(StarGlyph, { props: { size: 'lg' } })
    expect(wrapper.classes()).toContain('star-glyph--lg')
    const rule = extractRule('star-glyph--lg')
    expect(rule).toContain('width: 48px')
    expect(rule).toContain('height: 48px')
  })

  it('枚举封死：size prop 仅声明 sm/md/lg 三档（无任意 px 通道）', () => {
    expect(COMPONENT_TEXT).toMatch(/size\?: 'sm' \| 'md' \| 'lg'/)
  })
})

describe('StarGlyph — 星形契约（#195，probe #194 第 1 节）', () => {
  it('viewBox 24 + aria-hidden + 星光微光令牌内置', () => {
    const wrapper = mount(StarGlyph)
    expect(wrapper.attributes('viewBox')).toBe('0 0 24 24')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(extractRule('star-glyph')).toContain('filter: var(--glow-star-svg-soft)')
  })

  it('单一 path：fill/stroke 恒 --color-star 同色 + 圆角 join（圆润发光母型，无 tone）', () => {
    const wrapper = mount(StarGlyph)
    const paths = wrapper.findAll('path')
    expect(paths).toHaveLength(1)
    const path = paths[0]!
    expect(path.attributes('d')).toBeTruthy()
    expect(path.attributes('fill')).toBe('var(--color-star)')
    expect(path.attributes('stroke')).toBe('var(--color-star)')
    expect(path.attributes('stroke-width')).toBe('3')
    expect(path.attributes('stroke-linejoin')).toBe('round')
  })

  it('attrs 透传：外部 class / style 落在根 svg（页面私有尺寸档与动效覆写通道）', () => {
    const wrapper = mount(StarGlyph, { attrs: { class: 'home-big-star', style: 'width: 112px' } })
    expect(wrapper.classes()).toContain('home-big-star')
    expect(wrapper.attributes('style')).toContain('width: 112px')
  })

  it('纯展示：无 slot 出口、无 emits 声明', () => {
    expect(COMPONENT_TEXT).not.toContain('<slot')
    expect(COMPONENT_TEXT).not.toContain('defineEmits')
  })
})
