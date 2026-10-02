/**
 * StarOptionRow 组件测试（#199 C- 组件卡）：五形态渲染 + select emit + disabled 禁点。
 * 组件契约（ADR-0008 受控边界）：组件只按 state 渲染四态，判分逻辑（哪个选项什么态）留页面。
 * 样式断言直接读组件源码提取规则块（与 StarFeedbackBar.test.ts 同法，jsdom 不计算样式）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarOptionRow from '../StarOptionRow.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarOptionRow.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarOptionRow — #199 五形态渲染', () => {
  it('normal：仅基类无修饰类 + 文案透传 + button 语义', () => {
    const wrapper = mount(StarOptionRow, { props: { label: 'normal · 选项样例', state: 'normal' } })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.classes()).toContain('star-option')
    expect(wrapper.classes()).not.toContain('star-option--normal')
    expect(wrapper.classes()).not.toContain('star-option--correct')
    expect(wrapper.text()).toContain('normal · 选项样例')
  })

  it('correct：金高亮修饰类 + 文案透传', () => {
    const wrapper = mount(StarOptionRow, { props: { label: 'correct · 选项样例', state: 'correct' } })
    expect(wrapper.classes()).toContain('star-option--correct')
    expect(wrapper.text()).toContain('correct · 选项样例')
  })

  it('reveal：与 correct 同貌修饰类（各自独立 class 不串用）', () => {
    const wrapper = mount(StarOptionRow, { props: { label: 'reveal · 选项样例', state: 'reveal' } })
    expect(wrapper.classes()).toContain('star-option--reveal')
    expect(wrapper.classes()).not.toContain('star-option--correct')
  })

  it('wrong：红系修饰类（不串金高亮）', () => {
    const wrapper = mount(StarOptionRow, { props: { label: 'wrong · 选项样例', state: 'wrong' } })
    expect(wrapper.classes()).toContain('star-option--wrong')
    expect(wrapper.classes()).not.toContain('star-option--correct')
  })

  it('disabled：按钮禁用 + 文案透传（state 独立传入，normal 态变淡）', () => {
    const wrapper = mount(StarOptionRow, { props: { label: 'disabled · 选项样例', state: 'normal', disabled: true } })
    expect((wrapper.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.classes()).toContain('star-option')
    expect(wrapper.text()).toContain('disabled · 选项样例')
  })
})

describe('StarOptionRow — #199 select emit 与禁点', () => {
  it('点击 emit select 一次', async () => {
    const wrapper = mount(StarOptionRow, { props: { label: '选项 A', state: 'normal' } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('disabled 时点击不 emit select', async () => {
    const wrapper = mount(StarOptionRow, { props: { label: '选项 A', state: 'normal', disabled: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})

describe('StarOptionRow — #199 态样式（probe #194 第 7 节直译，源码断言）', () => {
  it('normal 骨架：surface 底 + outline 描边 + 下抛唇边 + 触控 md 热区 + lg 圆角', () => {
    const base = extractRule('star-option')
    expect(base).toContain('border: var(--border-thin) solid var(--color-outline)')
    expect(base).toContain('background-color: var(--color-surface)')
    expect(base).toContain('color: var(--color-text)')
    expect(base).toContain('box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow)')
    expect(base).toContain('min-height: var(--touch-md)')
    expect(base).toContain('border-radius: var(--radius-lg)')
    expect(base).toContain('font-size: var(--font-size-body)')
  })

  it('correct / reveal 同貌：go 金填充 + on-go 字 + 深金描边（星光金体系，不引入绿色）', () => {
    const rule = extractRule('star-option--correct')
    expect(rule).toContain('background-color: var(--color-go)')
    expect(rule).toContain('border-color: var(--color-go-shadow)')
    expect(rule).toContain('color: var(--color-on-go)')
    expect(rule).toContain('box-shadow: 0 var(--shadow-sm) 0 var(--color-go-shadow)')
  })

  it('wrong：error-container 底 + warm 描边 + error 字', () => {
    const rule = extractRule('star-option--wrong')
    expect(rule).toContain('background-color: var(--color-error-container)')
    expect(rule).toContain('border-color: var(--color-warm)')
    expect(rule).toContain('color: var(--color-error)')
  })

  it('disabled：surface-dim 底 + 次级文字 + 无唇边 + not-allowed', () => {
    const rule = extractRule('star-option:disabled')
    expect(rule).toContain('background-color: var(--color-surface-dim)')
    expect(rule).toContain('color: var(--color-text-secondary)')
    expect(rule).toContain('box-shadow: none')
    expect(rule).toContain('cursor: not-allowed')
  })

  it('答后结果身份压过禁用变淡：correct/wrong 双类选择器置于禁用规则之后（2026-09-08 回归修复）', () => {
    const idxDisabled = COMPONENT_TEXT.indexOf('.star-option:disabled {')
    const idxCorrect = COMPONENT_TEXT.indexOf('.star-option.star-option--correct')
    const idxWrong = COMPONENT_TEXT.indexOf('.star-option.star-option--wrong')
    expect(idxDisabled).toBeGreaterThan(-1)
    expect(idxCorrect).toBeGreaterThan(idxDisabled)
    expect(idxWrong).toBeGreaterThan(idxDisabled)
    // 双类复合（同特异性、后位胜出）：答后选中项保金/红身份，变淡只落未选中项
    expect(COMPONENT_TEXT).toContain('.star-option.star-option--correct')
    expect(COMPONENT_TEXT).toContain('.star-option.star-option--wrong')
  })

  it('hover 悬停上浮 + 唇边加厚，且包 hover-capable 媒体查询（#131 触屏防护）', () => {
    const hoverRule = COMPONENT_TEXT.match(/\.star-option:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(hoverRule).toContain('transform: translateY(-2px)')
    expect(hoverRule).toContain('box-shadow: 0 var(--shadow-md) 0 var(--color-surface-shadow)')
    expect(COMPONENT_TEXT).toMatch(/@media \(hover: hover\)[\s\S]*?\.star-option:hover:not\(:disabled\)/)
  })

  it('#158 宽档封顶随组件化迁入：≥600 媒体块内 max-width 走 --control-max-width 令牌 + auto 居中 + 满宽（2026-09-09 等宽修复：内容收缩宽漂移）', () => {
    const block = COMPONENT_TEXT.match(/@media \(min-width: 600px\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/)?.[0] ?? ''
    expect(block).toContain('.star-option')
    expect(block).toContain('max-width: var(--control-max-width)')
    expect(block).toContain('margin-inline: auto')
    expect(block).toContain('width: 100%')
  })
})
