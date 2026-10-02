/**
 * StarChip 组件测试（#186）：selected 选中态与 tone 文字着色扩展。
 * 回归红线：未传新 props 时渲染类名与现状一致（仅 variant × size 两类）。
 * 样式断言走 extractRule 源码文本（既有先例），令牌零新造。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import StarChip from '../StarChip.vue'

const srcDir = resolve(__dirname, '../..')
const chipVue = readFileSync(resolve(srcDir, 'components/StarChip.vue'), 'utf-8')

/** 提取某选择器（类名，不含点）的首个规则块声明文本 */
function extractRule(css: string, className: string): string {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`, 's')
  const m = css.match(re)
  return m ? m[1] : ''
}

describe('回归红线：未传新 props 时渲染与现状一致', () => {
  it('默认 default × sm：类名仅 star-chip 与 variant/size 两类，无 selected / tone 类', () => {
    const wrapper = mount(StarChip, { slots: { default: '看中文选英文' } })
    const chip = wrapper.get('.star-chip')
    expect(chip.classes()).toEqual(['star-chip', 'star-chip--default', 'star-chip--sm'])
    expect(chip.classes()).not.toContain('star-chip--selected')
  })

  it('ghost × md 同理：无新形态类', () => {
    const wrapper = mount(StarChip, { props: { variant: 'ghost', size: 'md' } })
    expect(wrapper.get('.star-chip').classes()).toEqual(['star-chip', 'star-chip--ghost', 'star-chip--md'])
  })
})

describe('selected 选中态（#186）', () => {
  it('selected=true → star-chip--selected 类；样式 = surface-bright 底 + outline 描边 + text 字色', () => {
    const wrapper = mount(StarChip, { props: { variant: 'ghost', selected: true } })
    const chip = wrapper.get('.star-chip')
    expect(chip.classes()).toContain('star-chip--selected')
    const rule = extractRule(chipVue, 'star-chip--selected')
    expect(rule).toContain('background-color: var(--color-surface-bright)')
    expect(rule).toContain('border: 1px solid var(--color-outline)')
    expect(rule).toContain('color: var(--color-text)')
  })
})

describe('tone 文字着色（#186）', () => {
  it.each([
    ['go', 'color-go-text', 'star-chip--tone-go'],
    ['mist', 'color-mist', 'star-chip--tone-mist'],
    ['warm', 'color-warm', 'star-chip--tone-warm'],
  ] as const)('tone=%s → %s 类 + color: var(--%s)', (tone, token, cls) => {
    const wrapper = mount(StarChip, { props: { tone } })
    const chip = wrapper.get('.star-chip')
    expect(chip.classes()).toContain(cls)
    expect(extractRule(chipVue, cls)).toContain(`color: var(--${token})`)
  })

  it('tone 作用域（#217 方案 A）：tone 类对四变体组合（default/ghost × sm/md）都挂载，纯字色档不改底/形', () => {
    for (const variant of ['default', 'ghost'] as const) {
      for (const size of ['sm', 'md'] as const) {
        const wrapper = mount(StarChip, { props: { variant, size, tone: 'go' } })
        const chip = wrapper.get('.star-chip')
        expect(chip.classes()).toEqual(['star-chip', `star-chip--${variant}`, `star-chip--${size}`, 'star-chip--tone-go'])
        wrapper.unmount()
      }
    }
  })

  it('tone 规则特异性修复（#217）：tone 与 selected 规则均带 variant 前缀（0,2,0），置后覆盖矩阵字色', () => {
    // 每条 tone / selected 规则的选择器都必须带上 variant 前缀，否则被矩阵（0,2,0）覆盖
    for (const cls of ['tone-go', 'tone-mist', 'tone-warm', 'selected']) {
      const re = new RegExp(`\\.star-chip--(?:default|ghost)\\.star-chip--${cls}\\b[^{]*\\{`, 'g')
      const ruleCount = chipVue.match(re)?.length ?? 0
      expect(ruleCount).toBe(1) // 一条合并规则同时覆盖 default 与 ghost 两变体
      // 不存在裸（无 variant 前缀）的旧写法残留：仅当裸类紧随选择器列表起点（行首 / 逗号 / 规则边界）才算
      const bare = new RegExp(`(?:^|[,;{}])\\s*\\.star-chip--${cls}\\s*\\{`, 'm')
      expect(bare.test(chipVue)).toBe(false)
    }
  })
})
