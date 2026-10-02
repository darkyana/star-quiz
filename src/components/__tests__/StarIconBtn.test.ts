/**
 * StarIconBtn（C5，#56）组件单测——薄组件无变体派（原型 2026-08-30 拍板：A + 提议全收）
 * 文本断言模式（沿用 StarButtonStandard.test.ts）：规则读组件源码，不依赖 jsdom 布局。
 * 契约：零 variant / 零 size prop；热区恒 44；hover surface-dim 洗底；focus-visible 3px 环；
 * 图标尺寸/颜色/二态归 slot 内容；aria-label 使用处必传（断言两处真实使用：Quiz 红旗钮 + #59 起弹窗关闭钮随 StarModalStandard 收编）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const iconBtnVue = readFileSync(resolve(srcDir, 'components/StarIconBtn.vue'), 'utf-8')
const modalComponentVue = readFileSync(resolve(srcDir, 'components/StarModalStandard.vue'), 'utf-8')
const quizVue = readFileSync(resolve(srcDir, 'pages/Quiz.vue'), 'utf-8')
const parentVue = readFileSync(resolve(srcDir, 'pages/Parent.vue'), 'utf-8')

/** 提取某选择器（类名，不含点）的首个规则块声明文本 */
function extractRule(css: string, className: string): string {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`, 's')
  const m = css.match(re)
  return m ? m[1] : ''
}

describe('C5 StarIconBtn 基础形态（薄组件契约）', () => {
  it('热区恒 --touch-sm 令牌 + 透明底 + 圆形（radius-full 令牌）+ currentColor 语义色', () => {
    const rule = extractRule(iconBtnVue, 'star-icon-btn')
    expect(rule).toContain('width: var(--touch-sm)')
    expect(rule).toContain('height: var(--touch-sm)')
    expect(rule).toContain('background-color: transparent')
    expect(rule).toContain('border-radius: var(--radius-full)')
    expect(rule).toContain('color: var(--color-text-secondary)')
  })

  it('无 variant / 无 size：源码不含 star-icon-btn-- 变体类（防偷偷长出变体）', () => {
    expect(iconBtnVue).not.toContain('star-icon-btn--')
  })

  it('hover 统一 surface-dim 洗底（抹平历史两态：洗底 / 只变色）；#131 起包 @media (hover: hover) 触屏防护', () => {
    const hover = extractRule(iconBtnVue, 'star-icon-btn:hover')
    expect(hover).toContain('background-color: var(--color-surface-dim)')
    // #131：洗底只在 hover-capable 设备生效（同一 media 块内直达该选择器，中间无块边界）
    const style = iconBtnVue.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
    expect(style).toMatch(/@media\s*\(\s*hover:\s*hover\s*\)\s*\{[^{}]*\.star-icon-btn:hover/)
  })

  it('focus-visible 3px 主色环 + 2px offset（键盘可达性，A11y 同 C1）', () => {
    const focus = extractRule(iconBtnVue, 'star-icon-btn:focus-visible')
    expect(focus).toContain('outline: 3px solid var(--color-primary)')
    expect(focus).toContain('outline-offset: 2px')
  })

  it('disabled 与 StarButtonStandard 同口径（去饱和 + 降透明 + not-allowed）', () => {
    const disabled = extractRule(iconBtnVue, 'star-icon-btn:disabled')
    expect(disabled).toContain('filter: saturate(0.45)')
    expect(disabled).toContain('cursor: not-allowed')
  })

  it('无位移反馈：源码不含 transform（角落轻操作非 CTA，拍板决议）', () => {
    expect(iconBtnVue).not.toMatch(/transform:/)
  })
})

describe('C5 真实使用处契约（aria-label 必传）', () => {
  it('Quiz 红旗钮：StarIconBtn + class 透传 + aria-label / aria-pressed', () => {
    const usage = quizVue.match(/<StarIconBtn[\s\S]*?<\/StarIconBtn>/)?.[0] ?? ''
    expect(usage).toContain('class="flag-btn"')
    expect(usage).toContain(':aria-label=')
    expect(usage).toContain(':aria-pressed=')
    // 二态填充与升旗动效留页面（不入组件）
    expect(usage).toContain('flag-icon')
  })

  it('弹窗关闭钮（#59 起随 StarModalStandard 收编进组件）：StarIconBtn + class 透传 + aria-label', () => {
    const usage = modalComponentVue.match(/<StarIconBtn[\s\S]*?<\/StarIconBtn>/)?.[0] ?? ''
    expect(usage).toContain('class="star-modal__close"')
    expect(usage).toContain(':aria-label=')
  })

  it('页面不再自绘图标钮基础样式（热区/洗底/hover 只在组件；Parent 自绘关闭钮随 #59 清零）', () => {
    expect(extractRule(quizVue, 'flag-btn')).not.toContain('44px')
    expect(extractRule(parentVue, 'modal-close')).not.toContain('44px')
    expect(parentVue).not.toContain('modal-close')
  })
})
