/**
 * StarFeedbackBar 组件测试（#198 C- 组件卡）：tone 三态渲染 + correct 呼吸动画。
 * 组件契约（ADR-0008 受控边界）：组件只按 tone 渲染三态条，出现时机 / 文案判定留页面。
 * 样式断言直接读组件源码提取规则块（与 StarButtonStandard.test.ts 同法，jsdom 不计算样式）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarFeedbackBar from '../StarFeedbackBar.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarFeedbackBar.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarFeedbackBar — #198 tone 三态渲染', () => {
  it('correct：金渐变态 class + 勾形 SVG（currentColor）+ 文案透传', () => {
    const wrapper = mount(StarFeedbackBar, { props: { tone: 'correct', text: '回答正确！' } })
    expect(wrapper.classes()).toContain('star-feedback-bar--correct')
    const icon = wrapper.find('svg')
    expect(icon.exists()).toBe(true)
    expect(icon.attributes('aria-hidden')).toBe('true')
    expect(icon.find('path').attributes('fill')).toBe('currentColor')
    expect(wrapper.text()).toContain('回答正确！')
  })

  it('wrong：红系态 class + 叉形 SVG + 文案透传（不串 correct 态 class）', () => {
    const wrapper = mount(StarFeedbackBar, { props: { tone: 'wrong', text: '再想想' } })
    expect(wrapper.classes()).toContain('star-feedback-bar--wrong')
    expect(wrapper.classes()).not.toContain('star-feedback-bar--correct')
    expect(wrapper.find('svg path').attributes('d')).toContain('19 6.4')
    expect(wrapper.text()).toContain('再想想')
  })

  it('skipped：灰系态 class + 横线 SVG + 文案透传（不串 correct 态 class）', () => {
    const wrapper = mount(StarFeedbackBar, { props: { tone: 'skipped', text: '这题先跳过' } })
    expect(wrapper.classes()).toContain('star-feedback-bar--skipped')
    expect(wrapper.classes()).not.toContain('star-feedback-bar--correct')
    expect(wrapper.find('svg path').attributes('d')).toBe('M5 11h14v2H5z')
    expect(wrapper.text()).toContain('这题先跳过')
  })
})

describe('StarFeedbackBar — #198 correct 呼吸动画与共用骨架（样式源码断言）', () => {
  it('correct 态挂 feedback-glow 呼吸动画，走 --duration-breath 令牌（动效预算星光系）', () => {
    const rule = extractRule('star-feedback-bar--correct')
    expect(rule).toContain('animation: feedback-glow var(--duration-breath) ease-in-out infinite')
    expect(rule).toContain('color: var(--color-star)')
  })

  it('feedback-glow 关键帧：内透 + 外晕两级（inset 0 0 内透 + box-shadow 光晕扩散）', () => {
    const keyframes = COMPONENT_TEXT.match(/@keyframes feedback-glow\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(keyframes).toContain('box-shadow')
    expect(keyframes).toContain('inset 0 0')
  })

  it('三态共用骨架：flex 行 + info 档字重 700 + 48px 最小触达 + lg 圆角', () => {
    const base = extractRule('star-feedback-bar')
    expect(base).toContain('display: flex')
    expect(base).toContain('font-size: var(--font-size-info)')
    expect(base).toContain('font-weight: 700')
    expect(base).toContain('min-height: 48px')
    expect(base).toContain('border-radius: var(--radius-lg)')
  })

  it('wrong / skipped 两态保持纯文字着色（无填充，探针仅定义答对态）', () => {
    for (const cls of ['star-feedback-bar--wrong', 'star-feedback-bar--skipped']) {
      const rule = extractRule(cls)
      expect(rule).not.toContain('background')
      expect(rule).not.toContain('animation')
    }
  })
})
