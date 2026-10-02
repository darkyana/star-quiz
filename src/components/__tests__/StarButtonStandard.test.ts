/**
 * C1 StarButtonStandard 组件测试（#33 补充，2026-08-29）
 * 覆盖：#33 拍板的三项行为——edgeInset 两分支（large 默认留边撑满 / false 贴边）、
 * small 不受 edgeInset 影响、standard 变体白底 + 1.5px 描边（large/small 统一）、box-sizing 防溢出。
 * 样式断言直接读组件源码提取规则块（与 22-styles-r15 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarButtonStandard from '../StarButtonStandard.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarButtonStandard.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('C1 StarButtonStandard — #33 edgeInset 宽度行为', () => {
  it('large 默认 edgeInset=true → 撑满留边 class（margin-inline auto + calc 宽度）', () => {
    const wrapper = mount(StarButtonStandard, { props: { size: 'large' }, slots: { default: '按钮' } })
    expect(wrapper.classes()).toContain('star-button--edge-inset')
    expect(wrapper.classes()).not.toContain('star-button--edge-full')
    const rule = extractRule('star-button--large.star-button--edge-inset')
    expect(rule).toContain('calc(100% - 2 * var(--space-page))')
    expect(rule).toContain('margin-inline: auto')
  })

  it('large edgeInset=false → 贴边 100%', () => {
    const wrapper = mount(StarButtonStandard, { props: { size: 'large', edgeInset: false }, slots: { default: '按钮' } })
    expect(wrapper.classes()).toContain('star-button--edge-full')
    expect(wrapper.classes()).not.toContain('star-button--edge-inset')
    expect(extractRule('star-button--large.star-button--edge-full')).toContain('width: 100%')
  })

  it('small 不受 edgeInset 影响（无 edge class，宽度随文字）', () => {
    const wrapper = mount(StarButtonStandard, { props: { size: 'small', edgeInset: false }, slots: { default: '按钮' } })
    expect(wrapper.classes()).not.toContain('star-button--edge-inset')
    expect(wrapper.classes()).not.toContain('star-button--edge-full')
  })
})

describe('C1 StarButtonStandard — #146 补一轮 按钮圆角对齐探针 P1-r2', () => {
  it('基础圆角 = xl 档（探针主按钮 20px；md 档被选项行等非按钮元素共用，不动其值）', () => {
    expect(extractRule('star-button')).toContain('border-radius: var(--radius-xl)')
  })

  it('small 档圆角 = lg 档（探针小钮 16px，覆写基础档；行首锚定匹配尺寸骨架规则）', () => {
    const rule = COMPONENT_TEXT.match(/(?:^|\n)\.star-button--small\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('border-radius: var(--radius-lg)')
  })
})

describe('C1 StarButtonStandard — #33 standard 变体白底描边', () => {
  it('standard × large：白底 + --border-thin 细描边（复用 --color-secondary-shadow）+ 唇边保留（#215 对齐 small 档 --shadow-sm）', () => {
    const rule = extractRule('star-button--standard.star-button--large')
    expect(rule).toContain('background-color: var(--color-surface)')
    expect(rule).toContain('border: var(--border-thin) solid var(--color-secondary-shadow)')
    expect(rule).toContain('box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow)')
  })

  it('standard × small：白底 + --border-thin 细描边 + 唇边保留（--shadow-sm）', () => {
    const rule = extractRule('star-button--standard.star-button--small')
    expect(rule).toContain('background-color: var(--color-surface)')
    expect(rule).toContain('border: var(--border-thin) solid var(--color-secondary-shadow)')
    expect(rule).toContain('box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow)')
  })

  it('基础类含 box-sizing: border-box（描边不溢出撑满宽度）', () => {
    expect(extractRule('star-button')).toContain('box-sizing: border-box')
  })
})

describe('C1 StarButtonStandard — #215 阴影全矩阵统一（variant × size × hover/disabled）', () => {
  const PRIMARY_SHADOW = 'box-shadow: 0 var(--shadow-sm) 0 var(--color-primary-shadow), var(--glow-star-soft)'
  const STANDARD_SHADOW = 'box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow)'
  const HOVER_PRIMARY_SHADOW = 'box-shadow: 0 var(--shadow-md) 0 var(--color-primary-shadow), var(--glow-star-soft)'
  const HOVER_STANDARD_SHADOW = 'box-shadow: 0 var(--shadow-md) 0 var(--color-surface-shadow)'

  it('基础态 4 格：同 variant 下 large 与 small 阴影一致，均等于原 small 形态', () => {
    expect(extractRule('star-button--primary.star-button--large')).toContain(PRIMARY_SHADOW)
    expect(extractRule('star-button--primary.star-button--small')).toContain(PRIMARY_SHADOW)
    expect(extractRule('star-button--standard.star-button--large')).toContain(STANDARD_SHADOW)
    expect(extractRule('star-button--standard.star-button--small')).toContain(STANDARD_SHADOW)
  })

  it('hover 态 4 格：全矩阵统一增厚档 --shadow-md，光晕层次不丢失', () => {
    expect(extractRule('star-button--primary.star-button--large:hover')).toContain(HOVER_PRIMARY_SHADOW)
    expect(extractRule('star-button--primary.star-button--small:hover')).toContain(HOVER_PRIMARY_SHADOW)
    expect(extractRule('star-button--standard.star-button--large:hover')).toContain(HOVER_STANDARD_SHADOW)
    expect(extractRule('star-button--standard.star-button--small:hover')).toContain(HOVER_STANDARD_SHADOW)
  })

  it('disabled：不覆写 box-shadow（沿用基础阴影），归零/换影的覆写不存在', () => {
    const disabledRule = extractRule('star-button:disabled')
    expect(disabledRule).not.toContain('box-shadow')
    expect(COMPONENT_TEXT).not.toMatch(/\.star-button[^{]*:disabled\s*\{[^}]*box-shadow/)
  })

  it('旧 large 专属阴影形态已移除（--shadow-lg 唇边 / --glow-btn / secondary-shadow 唇边）', () => {
    expect(COMPONENT_TEXT).not.toContain('--glow-btn')
    expect(COMPONENT_TEXT).not.toContain('box-shadow: 0 var(--shadow-lg)')
    expect(COMPONENT_TEXT).not.toContain('box-shadow: 0 var(--shadow-md) 0 var(--color-secondary-shadow)')
  })
})
