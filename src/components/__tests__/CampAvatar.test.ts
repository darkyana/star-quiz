/**
 * CampAvatar 组件测试（#197 搬家升 registry）：纯搬家，契约 = Proposals 内联原实现（视觉真相源 probe #194 第 5 节）。
 * 覆盖：kind 两态渲染（孩子脸 / 家长脸结构组，结构断言走挂载 DOM）、label 有无的 a11y 行为
 * （有 label → role=img + aria-label / 无 label → aria-hidden）、mini 尺寸档（既有 camp-avatar--mini 类 +
 * 触控档令牌；布局链与令牌声明走源码文本锁定，沿 StarButtonStandard.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import CampAvatar from '../CampAvatar.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/CampAvatar.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('#197 CampAvatar — kind 两态渲染（结构断言：挂载 DOM）', () => {
  it('child：底圆（--color-secondary）+ 卷发弧 + 点点眼 + 微笑，viewBox 40', () => {
    const wrapper = mount(CampAvatar, { props: { kind: 'child', label: '孩子' } })
    const svg = wrapper.get('svg')
    expect(svg.classes()).toContain('camp-avatar')
    expect(svg.attributes('viewBox')).toBe('0 0 40 40')
    expect(wrapper.get('circle').attributes('fill')).toBe('var(--color-secondary)')
    const paths = wrapper.findAll('path').map((p) => p.attributes('d'))
    expect(paths).toEqual(['M20 6c4.5-3 7 1 3.5 3.5', 'M14 25q6 5 12 0'])
    const eyes = wrapper.findAll('circle').filter((c) => c.attributes('r') === '1.9')
    expect(eyes).toHaveLength(2)
    expect(eyes[0].attributes('fill')).toBe('var(--color-on-secondary)')
  })

  it('adult：弧发 + 圆框眼镜（r 3.6 描边圈）+ 鼻梁镜腿 + 微笑', () => {
    const wrapper = mount(CampAvatar, { props: { kind: 'adult', label: '家长' } })
    const glasses = wrapper.findAll('circle').filter((c) => c.attributes('r') === '3.6')
    expect(glasses).toHaveLength(2)
    expect(glasses[0].attributes('fill')).toBe('none')
    expect(glasses[0].attributes('stroke')).toBe('var(--color-on-secondary)')
    const paths = wrapper.findAll('path').map((p) => p.attributes('d'))
    expect(paths).toEqual([
      'M7.5 15Q20 2.5 32.5 15',
      'M18.1 19.5h3.8M8.5 18.5 6 17.5M31.5 18.5 34 17.5',
      'M15 27q5 4 10 0',
    ])
  })
})

describe('#197 CampAvatar — label 有无的 a11y 行为', () => {
  it('有 label → role=img + aria-label（无障碍名由调用方传），无 aria-hidden', () => {
    const wrapper = mount(CampAvatar, { props: { kind: 'child', label: '孩子' } })
    const svg = wrapper.get('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('孩子')
    expect(svg.attributes('aria-hidden')).toBeUndefined()
  })

  it('无 label（mini 用法即此态）→ aria-hidden，无 role 无 aria-label', () => {
    const wrapper = mount(CampAvatar, { props: { kind: 'child' } })
    const svg = wrapper.get('svg')
    expect(svg.attributes('role')).toBeUndefined()
    expect(svg.attributes('aria-label')).toBeUndefined()
    expect(svg.attributes('aria-hidden')).toBe('true')
  })
})

describe('#197 CampAvatar — 尺寸档（mini 走既有修饰类，触控档令牌）', () => {
  it('调用方加 mini 修饰类 → 根元素类合并（既有类名照搬，不自创新档）', () => {
    const wrapper = mount(CampAvatar, { props: { kind: 'child' }, attrs: { class: 'camp-avatar--mini' } })
    expect(wrapper.classes()).toContain('camp-avatar')
    expect(wrapper.classes()).toContain('camp-avatar--mini')
  })

  it('默认 44 档 = touch-sm、mini 24 档 = touch-xs：源码文本锁定令牌引用、无裸 px', () => {
    const base = extractRule('camp-avatar')
    expect(base).toContain('width: var(--touch-sm)')
    expect(base).toContain('height: var(--touch-sm)')
    expect(base).toContain('flex: none')
    const mini = extractRule('camp-avatar--mini')
    expect(mini).toContain('width: var(--touch-xs)')
    expect(mini).toContain('height: var(--touch-xs)')
    expect(COMPONENT_TEXT).not.toMatch(/camp-avatar[^}]*width:\s*\d+px/)
  })
})
