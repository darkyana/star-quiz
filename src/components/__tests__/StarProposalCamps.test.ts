/**
 * StarProposalCamps 组件测试（#203 C- 提议卡拆件）：提议卡双阵营区容器渲染契约。
 * 视觉真相源 = probe #194 第 9 节直译：双 camp 槽（surface-dim 圆角块各一）；
 * 槽位内容（CampAvatar + 阵营态文字）由调用方组装，阵营就绪判定留页面（ADR-0008 受控红线），
 * 阵营态文字样式走 slotted 通道随组件走。零 props 零 emits。
 * 结构断言用挂载 DOM（2026-08-30 拍板）；布局链与令牌声明源码文本锁定。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarProposalCamps from '../StarProposalCamps.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarProposalCamps.vue'), 'utf-8')

/**
 * 提取某选择器（类名串，不含点）在组件样式中的首个「块首」规则块声明文本：
 * 锚定规则块起始（行首 / 前一规则结束）+ 类名负向环视，防前缀类名误吸（camp-side ↔ camp-sides）
 * 与 descendant 复合规则抢先匹配。
 */
function extractRule(cls: string): string {
  const re = new RegExp(`(^|[}\\n])\\s*\\.${cls.replace(/\\./g, '\\.')}(?![\\w-])[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[2] : ''
}

describe('StarProposalCamps — #203 渲染契约（双 camp 槽容器）', () => {
  it('根节点 div.camp-sides，内含恰好两个 camp 块；左槽内容落第一块、右槽内容落第二块（顺序锁定）', () => {
    const wrapper = mount(StarProposalCamps, {
      slots: {
        left: '<span class="camp-state left-state">还在考虑</span>',
        right: '<span class="camp-state right-state">已点头</span>',
      },
    })
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.classes()).toContain('camp-sides')
    const sides = wrapper.findAll('.camp-side')
    expect(sides).toHaveLength(2)
    expect(sides[0].get('.left-state').text()).toBe('还在考虑')
    expect(sides[1].get('.right-state').text()).toBe('已点头')
  })

  it('槽位缺省也能渲染（空 camp 块不报错，结构仍在）', () => {
    const wrapper = mount(StarProposalCamps)
    expect(wrapper.findAll('.camp-side')).toHaveLength(2)
  })

  it('零 props 零 emits 受控件：源码无状态声明与判定逻辑（就绪判定留页面，is-agree 只出现在样式通道）', () => {
    expect(COMPONENT_TEXT).not.toContain('defineProps')
    expect(COMPONENT_TEXT).not.toContain('defineEmits')
    const structureText = COMPONENT_TEXT.slice(0, COMPONENT_TEXT.indexOf('<style'))
    expect(structureText).not.toContain('is-agree')
  })
})

describe('StarProposalCamps — #203 probe #194 第 9 节直译（样式源码断言）', () => {
  it('双阵营区骨架：横向 flex + 区块间距 sm', () => {
    const rule = extractRule('camp-sides')
    expect(rule).toContain('display: flex')
    expect(rule).toContain('gap: var(--space-sm)')
    expect(rule).not.toContain('background')
  })

  it('单阵营块：flex 均分两端对齐 + surface-dim 圆角底 + 纵向内边距（全令牌引用无裸值）', () => {
    const rule = extractRule('camp-side')
    expect(rule).toContain('flex: 1')
    expect(rule).toContain('display: flex')
    expect(rule).toContain('align-items: center')
    expect(rule).toContain('justify-content: space-between')
    expect(rule).toContain('gap: var(--space-sm)')
    expect(rule).toContain('background: var(--color-surface-dim)')
    expect(rule).toContain('border-radius: var(--radius-md)')
    expect(rule).toContain('padding: var(--space-sm) var(--space-gutter)')
  })

  it('阵营态文字样式走 slotted 通道（页面槽位内容由组件持样式）：label 档 700 次级色右对齐；就绪态挂 is-agree 金色', () => {
    expect(COMPONENT_TEXT).toContain(':slotted(.camp-state)')
    expect(COMPONENT_TEXT).toContain(':slotted(.camp-state.is-agree)')
    const slottedBlock = COMPONENT_TEXT.match(/:slotted\(\.camp-state\)[^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(slottedBlock).toContain('font-size: var(--font-size-label)')
    expect(slottedBlock).toContain('font-weight: 700')
    expect(slottedBlock).toContain('color: var(--color-text-secondary)')
    expect(slottedBlock).toContain('text-align: right')
    const agreeBlock = COMPONENT_TEXT.match(/:slotted\(\.camp-state\.is-agree\)[^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(agreeBlock).toContain('color: var(--color-go-text)')
  })

  it('禁止自绘按钮 / 头像：style 块无 button 选择器与头像绘制（头像走 CampAvatar 组合调用）', () => {
    const styleBlock = COMPONENT_TEXT.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? ''
    expect(styleBlock).not.toContain('button')
    expect(styleBlock).not.toContain('camp-avatar')
    expect(COMPONENT_TEXT).not.toContain('<svg')
  })
})
