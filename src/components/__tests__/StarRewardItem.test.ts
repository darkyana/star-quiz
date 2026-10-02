/**
 * StarRewardItem 组件测试（#202 C- 组件卡）：奖品行元组件两态渲染契约。
 * 只收编渲染，余额判定与兑换动作留页面（ADR-0008 受控边界）：locked 布尔由页面判、redeem 由页面接（emit），组件不持状态。
 * 结构断言用挂载 DOM（2026-08-30 拍板）；布局链与令牌声明继续源码文本锁定（与 StarSectionShell.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarRewardItem from '../StarRewardItem.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarRewardItem.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

/** 去注释样式文本（注释陷阱防护：断言前剥离注释） */
function strippedStyle(): string {
  const styleBlock = COMPONENT_TEXT.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? ''
  return styleBlock.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('StarRewardItem — #202 渲染契约（可兑换 / 锁态两态）', () => {
  it('可兑换态：根节点 = li.star-container.star-reward-item；名称 / 价格文案 / 价签星渲染；无 chip 无锁态', () => {
    const wrapper = mount(StarRewardItem, { props: { name: '周末动画夜', price: 30 } })
    expect(wrapper.element.tagName).toBe('LI')
    expect(wrapper.classes()).toContain('star-container')
    expect(wrapper.classes()).toContain('star-reward-item')
    expect(wrapper.classes()).not.toContain('is-locked')
    expect(wrapper.get('.star-reward-name').text()).toBe('周末动画夜')
    expect(wrapper.get('.star-reward-price').text()).toBe('30 颗星')
    // 价签星 = StarGlyph sm（18px 档类钩子），probe #194 第 6 节
    expect(wrapper.find('.star-reward-price .star-glyph--sm').exists()).toBe(true)
    expect(wrapper.find('.star-chip').exists()).toBe(false)
    // 行结构：info / title 两层容器（probe 直译）
    expect(wrapper.find('.star-reward-info .star-reward-title .star-reward-name').exists()).toBe(true)
  })

  it('锁态：is-locked 挂根节点；shortfall 传入才渲染 StarChip ghost × sm「还差 N 颗」；名称文案不变', () => {
    const wrapper = mount(StarRewardItem, { props: { name: '乐高小套装', price: 45, locked: true, shortfall: 12 } })
    expect(wrapper.classes()).toContain('is-locked')
    const chip = wrapper.get('.star-chip')
    expect(chip.classes()).toContain('star-chip--ghost')
    expect(chip.classes()).toContain('star-chip--sm')
    expect(chip.text()).toBe('还差 12 颗')
    expect(wrapper.get('.star-reward-name').text()).toBe('乐高小套装')
    expect(wrapper.get('.star-reward-price').text()).toBe('45 颗星')
  })

  it('locked 但 shortfall 未传：不渲染 chip（差值判定留页面，组件不持余额逻辑）', () => {
    const wrapper = mount(StarRewardItem, { props: { name: '乐高小套装', price: 45, locked: true } })
    expect(wrapper.find('.star-chip').exists()).toBe(false)
  })

  it('#299 emoji 传值：名称同行前置渲染（aria-hidden 装饰，语义归名称文本），锁态照常渲染', () => {
    const ok = mount(StarRewardItem, { props: { name: '冰淇淋', price: 3, emoji: '🍦' } })
    const emoji = ok.get('.star-reward-title .star-reward-emoji')
    expect(emoji.text()).toBe('🍦')
    expect(emoji.attributes('aria-hidden')).toBe('true')
    // 前置：emoji 在名称之前（DOM 顺序）
    const title = ok.get('.star-reward-title')
    expect(title.element.firstElementChild?.classList.contains('star-reward-emoji')).toBe(true)

    const locked = mount(StarRewardItem, { props: { name: '冰淇淋', price: 3, emoji: '🍦', locked: true, shortfall: 2 } })
    expect(locked.get('.star-reward-emoji').text()).toBe('🍦')
  })

  it('#299 emoji 不传：零元素布局不变（.star-reward-emoji 不渲染，既有两态断言不回归）', () => {
    const wrapper = mount(StarRewardItem, { props: { name: '周末动画夜', price: 30 } })
    expect(wrapper.find('.star-reward-emoji').exists()).toBe(false)
    expect(wrapper.find('.star-reward-title .star-reward-name').exists()).toBe(true)
  })

  it('未锁但 shortfall 传入：不渲染 chip（不足提示只属锁态）', () => {
    const wrapper = mount(StarRewardItem, { props: { name: '周末动画夜', price: 30, shortfall: 0 } })
    expect(wrapper.find('.star-chip').exists()).toBe(false)
  })

  it('兑换钮 = StarButtonStandard primary · small（.star-reward-redeem 锚点类），点击 emit redeem', async () => {
    const wrapper = mount(StarRewardItem, { props: { name: '周末动画夜', price: 30 } })
    const btn = wrapper.get('button.star-reward-redeem')
    expect(btn.classes()).toContain('star-button--primary')
    expect(btn.classes()).toContain('star-button--small')
    expect(btn.text()).toBe('兑换')
    expect(wrapper.emitted('redeem')).toBeUndefined()
    await btn.trigger('click')
    expect(wrapper.emitted('redeem')).toHaveLength(1)
  })

  it('锁态兑换钮禁用：disabled 属性生效（置灰视觉由 StarButtonStandard disabled 态承担），点击不 emit', async () => {
    const wrapper = mount(StarRewardItem, { props: { name: '乐高小套装', price: 45, locked: true, shortfall: 12 } })
    const btn = wrapper.get('button.star-reward-redeem')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    await btn.trigger('click')
    expect(wrapper.emitted('redeem')).toBeUndefined()
  })
})

describe('StarRewardItem — #202 probe #194 第 6 节直译（样式源码断言）', () => {
  it('行骨架：横向 flex + 圆角 xl 覆写 + sm/gutter 密度；容器视觉不自绘（无背景 / 阴影 / 描边声明）', () => {
    const rule = extractRule('star-reward-item')
    expect(rule).toContain('display: flex')
    expect(rule).toContain('align-items: center')
    expect(rule).toContain('gap: var(--space-sm)')
    expect(rule).toContain('padding: var(--space-sm) var(--space-gutter)')
    expect(rule).toContain('border-radius: var(--radius-xl)')
    expect(rule).not.toContain('background')
    expect(rule).not.toContain('box-shadow')
    expect(rule).not.toContain('border:')
  })

  it('锁态：surface-dim 暗槽底 + 名称转次级色（不用整体透明度 / filter）', () => {
    const card = extractRule('star-reward-item.is-locked')
    expect(card).toContain('background-color: var(--color-surface-dim)')
    expect(card).not.toContain('opacity')
    expect(card).not.toContain('filter')
    expect(extractRule('star-reward-item.is-locked .star-reward-name')).toContain('color: var(--color-text-secondary)')
  })

  it('名称：body 档 + 600；价格展示（probe 定稿非 pill）：num 档 + 800 + 星光金 + info 字距 + inline-flex，零边框声明', () => {
    const nameRule = extractRule('star-reward-name')
    expect(nameRule).toContain('font-size: var(--font-size-body)')
    expect(nameRule).toContain('font-weight: 600')
    const priceRule = extractRule('star-reward-price')
    expect(priceRule).toContain('display: inline-flex')
    expect(priceRule).toContain('font-size: var(--font-size-num)')
    expect(priceRule).toContain('font-weight: 800')
    expect(priceRule).toContain('letter-spacing: var(--letter-spacing-info)')
    expect(priceRule).toContain('color: var(--color-star)')
    expect(priceRule).not.toContain('border')
  })

  it('内部组装禁止自绘：模板组装 StarChip ghost × sm + StarGlyph sm + StarButtonStandard primary · small；无内联 svg / button 元素，样式块零 button 选择器', () => {
    expect(COMPONENT_TEXT).toMatch(/<StarChip\s[^>]*variant="ghost"[^>]*size="sm"/)
    expect(COMPONENT_TEXT).toContain('<StarGlyph size="sm" />')
    expect(COMPONENT_TEXT).toContain('<StarButtonStandard variant="primary" size="small"')
    // 自绘星形 / 自绘按钮零残留：模板无内联 svg 与 button 元素（probe 第 6 节组装直译）
    const template = COMPONENT_TEXT.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
    expect(template).not.toContain('<svg')
    expect(template).not.toContain('<path')
    expect(template).not.toContain('<button')
    const style = strippedStyle()
    expect(style).not.toContain('button')
    // chip / 星形 / 按钮形态类不在组件内挂规则（锚点类零规则，StarSectionShell 同法）
    expect(extractRule('star-reward-redeem')).toBe('')
    expect(extractRule('star-glyph')).toBe('')
    expect(extractRule('star-chip')).toBe('')
  })

  it('价格展示 probe 定稿清理：价签 pill 形态零残留（--radius-price-tag / --color-price-tag-border 引用清零）', () => {
    expect(COMPONENT_TEXT).not.toContain('--radius-price-tag')
    expect(COMPONENT_TEXT).not.toContain('--color-price-tag-border')
    expect(COMPONENT_TEXT).not.toContain('price-tag')
  })

  it('#158 封顶迁入组件自身样式：600 媒体块 max-width 令牌 + margin-inline 居中 + 满宽（2026-09-09 等宽修复）；容器 flex 照常胜出（媒体块不声明 display）', () => {
    const style = strippedStyle()
    const block = style.match(/@media \(min-width: 600px\)\s*\{([\s\S]*)\}/)?.[1] ?? ''
    expect(block).toContain('max-width: var(--control-max-width)')
    expect(block).toContain('margin-inline: auto')
    expect(block).toContain('width: 100%')
    expect(block).toContain('box-sizing: border-box')
    expect(block).not.toContain('display')
    // 封顶令牌引用只存在于 600 媒体块内
    expect(style.replace(block, '')).not.toContain('--control-max-width')
  })
})
