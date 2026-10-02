/**
 * StarProposalCardShell 组件测试（#203 C- 提议卡拆件）：提议卡卡壳渲染契约。
 * 视觉真相源 = probe #194 第 9 节（沟通中 / 已作废 / 已谈成三卡直译）。
 * 受控边界（ADR-0008）：徽章文案与 tone、名称可点与否全由页面传入，组件不含业务判定；
 * 淡化态按 probe 直译 = 标题 + 价格文字淡化（非整卡），由徽章 void tone 驱动。
 * 结构断言用挂载 DOM（2026-08-30 拍板）；布局链与令牌声明源码文本锁定（与 StarSectionShell.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarProposalCardShell from '../StarProposalCardShell.vue'
import { copy } from '../../copy'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarProposalCardShell.vue'), 'utf-8')

/**
 * 提取某选择器（类名串，不含点）在组件样式中的首个「块首」规则块声明文本：
 * 锚定规则块起始（行首 / 前一规则结束）+ 类名负向环视，防 descendant 复合规则（如已作废淡化规则）
 * 与前缀类名（如 proposal-price 出现在复合选择器尾部）抢先误吸。
 */
function extractRule(cls: string): string {
  const re = new RegExp(`(^|[}\\n])\\s*\\.${cls.replace(/\\./g, '\\.')}(?![\\w-])[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[2] : ''
}

describe('StarProposalCardShell — #203 渲染契约（props / 双槽 / 徽章两 tone）', () => {
  it('沟通中（无徽章）：根节点 div.star-container.proposal-card；名称 h3 + 价格行（StarGlyph sm + priceLabel 文案）；不出徽章', () => {
    const wrapper = mount(StarProposalCardShell, {
      props: { name: '周末去动物园', price: 80 },
    })
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.classes()).toContain('star-container')
    expect(wrapper.classes()).toContain('proposal-card')
    expect(wrapper.classes()).not.toContain('is-voided')
    expect(wrapper.get('h3.proposal-name').text()).toBe('周末去动物园')
    expect(wrapper.find('button.proposal-name').exists()).toBe(false)
    const price = wrapper.get('.proposal-price')
    expect(price.find('svg.star-glyph--sm').exists()).toBe(true)
    expect(price.text()).toContain(copy.proposals.priceLabel(80))
    expect(wrapper.find('.card-badge').exists()).toBe(false)
    expect(wrapper.get('.card-head').classes()).not.toContain('has-badge')
  })

  it('camps / actions 双槽透传：槽位内容渲染进卡壳，camps 在前 actions 在后', () => {
    const wrapper = mount(StarProposalCardShell, {
      props: { name: '野餐', price: 3 },
      slots: {
        camps: '<div class="camp-sides">双阵营区</div>',
        actions: '<div class="card-actions">操作行</div>',
      },
    })
    expect(wrapper.find('.camp-sides').exists()).toBe(true)
    expect(wrapper.find('.card-actions').exists()).toBe(true)
    const html = wrapper.html()
    expect(html.indexOf('camp-sides')).toBeGreaterThan(-1)
    expect(html.indexOf('camp-sides')).toBeLessThan(html.indexOf('card-actions'))
    expect(wrapper.text()).toContain('双阵营区')
    expect(wrapper.text()).toContain('操作行')
  })

  it('徽章 done tone：is-done 金色徽章渲染头部右上；根节点不挂淡化态（淡化仅 void 驱动）', () => {
    const wrapper = mount(StarProposalCardShell, {
      props: { name: '暑假图书套装', price: 60, badge: { text: '已谈成', tone: 'done' } },
    })
    const badgeEl = wrapper.get('.card-badge')
    expect(badgeEl.classes()).toContain('is-done')
    expect(badgeEl.classes()).not.toContain('is-void')
    expect(badgeEl.text()).toBe('已谈成')
    expect(wrapper.get('.card-head').classes()).toContain('has-badge')
    expect(wrapper.classes()).not.toContain('is-voided')
  })

  it('徽章 void tone：is-void 红色徽章 + 根节点挂淡化态（probe 已作废卡直译：标题价格文字淡化非整卡）', () => {
    const wrapper = mount(StarProposalCardShell, {
      props: { name: '乐园年卡', price: 200, badge: { text: '已作废', tone: 'void' } },
    })
    const badgeEl = wrapper.get('.card-badge')
    expect(badgeEl.classes()).toContain('is-void')
    expect(badgeEl.classes()).not.toContain('is-done')
    expect(badgeEl.text()).toBe('已作废')
    expect(wrapper.classes()).toContain('is-voided')
  })

  it('nameClickable：名称渲染为可点文本钮，点击 emit title-click；缺省渲染 h3 不可点', async () => {
    const clickable = mount(StarProposalCardShell, {
      props: { name: '野餐', price: 3, nameClickable: true },
    })
    const btn = clickable.get('button.proposal-name.is-clickable')
    expect(btn.text()).toBe('野餐')
    expect(clickable.emitted('title-click')).toBeUndefined()
    await btn.trigger('click')
    expect(clickable.emitted('title-click')).toHaveLength(1)

    const plain = mount(StarProposalCardShell, { props: { name: '野餐', price: 3 } })
    expect(plain.find('button.proposal-name').exists()).toBe(false)
    expect(plain.get('h3.proposal-name').text()).toBe('野餐')
  })
})

describe('StarProposalCardShell — #203 probe #194 第 9 节直译（样式源码断言）', () => {
  it('卡壳骨架：纵向 flex + 卡内间距；容器视觉不自绘（无背景 / 圆角 / 唇边 / 内边距声明）', () => {
    const rule = extractRule('proposal-card')
    expect(rule).toContain('position: relative')
    expect(rule).toContain('display: flex')
    expect(rule).toContain('flex-direction: column')
    expect(rule).toContain('gap: var(--space-sm)')
    expect(rule).not.toContain('background')
    expect(rule).not.toContain('border-radius')
    expect(rule).not.toContain('box-shadow')
    expect(rule).not.toContain('padding')
  })

  it('淡化态作用域（probe 直译）：void 态仅标题 + 价格文字 opacity 0.45，非整卡降透明', () => {
    const rule = extractRule('proposal-card\\.is-voided')
    expect(rule).toContain('opacity: 0.45')
    // 规则声明锁定为标题与价格两选择器（淡化作用域 = 头部文字，非卡壳整体）
    expect(COMPONENT_TEXT).toContain('.proposal-card.is-voided .proposal-name')
    expect(COMPONENT_TEXT).toContain('.proposal-card.is-voided .proposal-price')
    expect(COMPONENT_TEXT).not.toContain('.proposal-card.is-voided .card-head')
  })

  it('头部结构：纵向 flex 间距 xs；徽章出现时右侧留位（gutter 三倍 calc）', () => {
    const head = extractRule('card-head')
    expect(head).toContain('position: relative')
    expect(head).toContain('display: flex')
    expect(head).toContain('flex-direction: column')
    expect(head).toContain('gap: var(--space-xs)')
    const hasBadge = extractRule('card-head\\.has-badge')
    expect(hasBadge).toContain('padding-right: calc(var(--space-gutter) * 3)')
  })

  it('价格行 = StarGlyph sm + 金色文案（num 档 800 字重星光金，inline-flex 对齐与 StarRewardItem 同款视觉语言）', () => {
    const price = extractRule('proposal-price')
    expect(price).toContain('display: inline-flex')
    expect(price).toContain('align-items: center')
    expect(price).toContain('gap: var(--space-xs)')
    expect(price).toContain('font-size: var(--font-size-num)')
    expect(price).toContain('font-weight: 800')
    expect(price).toContain('color: var(--color-star)')
    expect(COMPONENT_TEXT).toContain('import StarGlyph')
  })

  it('徽章：绝对定位于头部右上（label 档 800 字重标题字距）；done 金 / void 红', () => {
    const badge = extractRule('card-badge')
    expect(badge).toContain('position: absolute')
    expect(badge).toContain('top: 0')
    expect(badge).toContain('right: 0')
    expect(badge).toContain('font-size: var(--font-size-label)')
    expect(badge).toContain('font-weight: 800')
    expect(badge).toContain('letter-spacing: var(--letter-spacing-title)')
    expect(extractRule('card-badge\\.is-done')).toContain('color: var(--color-go-text)')
    expect(extractRule('card-badge\\.is-void')).toContain('color: var(--color-flag-stroke)')
  })

  it('禁止自绘按钮 / 星形 / 头像：style 块无 button 选择器、模板无内联 svg 与星形 path（星形走 StarGlyph）', () => {
    const styleBlock = COMPONENT_TEXT.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? ''
    expect(styleBlock).not.toContain('button')
    expect(styleBlock).not.toContain('svg')
    expect(COMPONENT_TEXT).not.toContain('M12 2.5')
    expect(COMPONENT_TEXT).not.toContain('camp-avatar')
  })
})

describe('StarProposalCardShell — #299 提议图标（可选 prop）', () => {
  it('传 emoji：名称前同行渲染 span.proposal-emoji（aria-hidden 装饰），可点名称形态同样前置', () => {
    const wrapper = mount(StarProposalCardShell, {
      props: { name: '游乐园', price: 20, emoji: '🦄' },
    })
    const emoji = wrapper.get('.proposal-emoji')
    expect(emoji.text()).toBe('🦄')
    expect(emoji.attributes('aria-hidden')).toBe('true')
    const row = wrapper.get('.card-title-row')
    expect(row.classes()).toContain('card-title-row')
    // emoji 在名称之前（DOM 顺序）
    expect(row.element.firstElementChild).toBe(emoji.element)
    expect(wrapper.get('h3.proposal-name').text()).toBe('游乐园')
  })

  it('可点名称 + emoji：button.proposal-name 仍在 .card-title-row 内，点击照常 emit title-click', async () => {
    const wrapper = mount(StarProposalCardShell, {
      props: { name: '游乐园', price: 20, emoji: '🎡', nameClickable: true },
    })
    const btn = wrapper.get('button.proposal-name.is-clickable')
    expect(btn.element.previousElementSibling?.textContent).toBe('🎡')
    await btn.trigger('click')
    expect(wrapper.emitted('title-click')).toHaveLength(1)
  })

  it('不传 emoji：零 .proposal-emoji 元素、零 .card-title-row 图标位，布局不变（回归锚点）', () => {
    const wrapper = mount(StarProposalCardShell, {
      props: { name: '游乐园', price: 20 },
    })
    expect(wrapper.find('.proposal-emoji').exists()).toBe(false)
    expect(wrapper.get('.card-title-row h3.proposal-name').text()).toBe('游乐园')
  })

  it('图标行样式令牌：flex 行内 + gap xs + emoji 不收缩（body-lg 档）', () => {
    const row = extractRule('card-title-row')
    expect(row).toContain('display: flex')
    expect(row).toContain('align-items: center')
    expect(row).toContain('gap: var(--space-xs)')
    const emoji = extractRule('proposal-emoji')
    expect(emoji).toContain('font-size: var(--font-size-body-lg)')
    expect(emoji).toContain('flex-shrink: 0')
  })
})
