/**
 * StarProposalActions 组件测试（#203 C- 提议卡拆件）：提议卡操作行容器渲染契约。
 * 视觉真相源 = probe #194 第 9 节直译：actions 槽右对齐 flex 行；内容完全由调用方组装
 * （mini 头像 + 钮一律 StarButtonStandard），动作 emit 与显隐判定留页面（ADR-0008 受控红线）。
 * 结构断言用挂载 DOM（2026-08-30 拍板）；布局链与令牌声明源码文本锁定。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarProposalActions from '../StarProposalActions.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarProposalActions.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个「块首」规则块声明文本（锚定规则块起始防复合选择器抢先） */
function extractRule(cls: string): string {
  const re = new RegExp(`(^|[}\\n])\\s*\\.${cls.replace(/\\./g, '\\.')}(?![\\w-])[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[2] : ''
}

describe('StarProposalActions — #203 渲染契约（actions 槽右对齐行）', () => {
  it('根节点 div.card-actions；default 槽内容透传且保持顺序（页面组装的钮列原样落位）', () => {
    const wrapper = mount(StarProposalActions, {
      slots: {
        default: [
          '<button type="button" class="stance-btn">同意</button>',
          '<button type="button" class="publish-btn">发布</button>',
        ],
      },
    })
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.classes()).toContain('card-actions')
    const stance = wrapper.get('.stance-btn')
    expect(stance.text()).toBe('同意')
    expect(wrapper.element.children.length).toBe(2)
    expect(wrapper.element.children[1].classList.contains('publish-btn')).toBe(true)
  })

  it('空槽也渲染行容器（终态孩子端无按钮时行结构仍在，视觉零高度无内容）', () => {
    const wrapper = mount(StarProposalActions)
    expect(wrapper.find('.card-actions').exists()).toBe(true)
    expect(wrapper.element.children.length).toBe(0)
  })

  it('零 props 零 emits 受控件：源码无状态声明，内容与动作全由页面组装', () => {
    expect(COMPONENT_TEXT).not.toContain('defineProps')
    expect(COMPONENT_TEXT).not.toContain('defineEmits')
  })
})

describe('StarProposalActions — #203 probe #194 第 9 节直译（样式源码断言）', () => {
  it('操作行骨架：flex 右对齐 + 行内间距 sm（最底一行整体靠右）', () => {
    const rule = extractRule('card-actions')
    expect(rule).toContain('display: flex')
    expect(rule).toContain('align-items: center')
    expect(rule).toContain('justify-content: flex-end')
    expect(rule).toContain('gap: var(--space-sm)')
    expect(rule).not.toContain('background')
    expect(rule).not.toContain('padding')
  })

  it('禁止自绘按钮：style 块无 button 选择器（钮一律 StarButtonStandard，样式归组件库）', () => {
    const styleBlock = COMPONENT_TEXT.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? ''
    expect(styleBlock).not.toContain('button')
  })
})
