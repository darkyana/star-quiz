/**
 * StarSectionShell 组件测试（#201 C- 组件卡）：分区卡壳元组件渲染契约。
 * 只收编结构，逻辑留页面（ADR-0008 受控边界）：error / empty 文案由页面传、refresh 由页面接（emit），组件不持状态。
 * 结构断言用挂载 DOM（2026-08-30 拍板）；布局链与令牌声明继续源码文本锁定（与 StarFeedbackBar.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarSectionShell from '../StarSectionShell.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarSectionShell.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarSectionShell — #201 渲染契约（正常 / 错误 / 空态）', () => {
  it('正常态：根节点 = section.star-container.star-section-shell；标题 prop 渲染 h2；内容 slot 透传', () => {
    const wrapper = mount(StarSectionShell, {
      props: { title: '设备名册' },
      slots: { default: '<ul class="demo-list"><li>行内容</li></ul>' },
    })
    expect(wrapper.element.tagName).toBe('SECTION')
    expect(wrapper.classes()).toContain('star-container')
    expect(wrapper.classes()).toContain('star-section-shell')
    const title = wrapper.get('h2.star-section-title')
    expect(title.text()).toBe('设备名册')
    expect(wrapper.find('.demo-list').exists()).toBe(true)
    // 正常态不出错误行 / 刷新钮 / 空态行
    expect(wrapper.find('.star-section-error').exists()).toBe(false)
    expect(wrapper.find('.star-section-refresh').exists()).toBe(false)
    expect(wrapper.find('.star-section-empty').exists()).toBe(false)
  })

  it('错误态：error 传了才渲染 role="alert" 错误行 + 刷新钮；slot 内容不渲染（错误优先）', () => {
    const wrapper = mount(StarSectionShell, {
      props: { title: '等家长批准的申请', error: '加载失败，请重试' },
      slots: { default: '<ul class="demo-list"><li>行内容</li></ul>' },
    })
    const errorRow = wrapper.get('p.star-section-error')
    expect(errorRow.text()).toBe('加载失败，请重试')
    expect(errorRow.attributes('role')).toBe('alert')
    expect(wrapper.find('.demo-list').exists()).toBe(false)
    expect(wrapper.find('.star-section-empty').exists()).toBe(false)
  })

  it('error 未传 / 传空串：不渲染错误行与刷新钮', () => {
    const withoutProp = mount(StarSectionShell, { props: { title: '标题' } })
    expect(withoutProp.find('.star-section-error').exists()).toBe(false)
    expect(withoutProp.find('.star-section-refresh').exists()).toBe(false)
    const emptyString = mount(StarSectionShell, { props: { title: '标题', error: '' } })
    expect(emptyString.find('.star-section-error').exists()).toBe(false)
    expect(emptyString.find('.star-section-refresh').exists()).toBe(false)
  })

  it('刷新钮 = StarButtonStandard standard · small（.star-section-refresh 锚点类），点击 emit refresh', async () => {
    const wrapper = mount(StarSectionShell, { props: { title: '设备名册', error: '网络异常' } })
    const refreshBtn = wrapper.get('button.star-section-refresh')
    expect(refreshBtn.classes()).toContain('star-button--standard')
    expect(refreshBtn.classes()).toContain('star-button--small')
    expect(refreshBtn.text()).toBe('刷新')
    expect(wrapper.emitted('refresh')).toBeUndefined()
    await refreshBtn.trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('空态：empty 传了且 slot 无可见内容才渲染；有内容则不出空态行', () => {
    const emptyOnly = mount(StarSectionShell, { props: { title: '快照回滚', empty: '近 30 天暂无快照' } })
    expect(emptyOnly.get('p.star-section-empty').text()).toBe('近 30 天暂无快照')
    const withContent = mount(StarSectionShell, {
      props: { title: '快照回滚', empty: '近 30 天暂无快照' },
      slots: { default: '<ul class="demo-list"><li>行内容</li></ul>' },
    })
    expect(withContent.find('.star-section-empty').exists()).toBe(false)
    expect(withContent.find('.demo-list').exists()).toBe(true)
  })

  it('slot 仅 v-if 关闭（注释占位）：视为无内容，空态行照常渲染', () => {
    const wrapper = mount(StarSectionShell, {
      props: { title: '等家长批准的申请', empty: '没有等批准的申请' },
      slots: { default: '<ul v-if="false" class="demo-list"></ul>' },
    })
    expect(wrapper.find('.demo-list').exists()).toBe(false)
    expect(wrapper.get('p.star-section-empty').text()).toBe('没有等批准的申请')
  })

  it('empty 未传：slot 无内容也不出空态行（如设备名册空名册仍渲染空列表）', () => {
    const wrapper = mount(StarSectionShell, {
      props: { title: '设备名册' },
      slots: { default: '<ul class="demo-list"></ul>' },
    })
    expect(wrapper.find('.star-section-empty').exists()).toBe(false)
    expect(wrapper.find('.demo-list').exists()).toBe(true)
  })
})

describe('StarSectionShell — #201 probe #194 第 4 节直译（样式源码断言）', () => {
  it('卡壳骨架：纵向 flex + 标题-内容间距固定 --space-sm；容器视觉不自绘（无背景 / 圆角 / 唇边声明）', () => {
    const rule = extractRule('star-section-shell')
    expect(rule).toContain('display: flex')
    expect(rule).toContain('flex-direction: column')
    expect(rule).toContain('gap: var(--space-sm)')
    expect(rule).not.toContain('background')
    expect(rule).not.toContain('border-radius')
    expect(rule).not.toContain('box-shadow')
    expect(rule).not.toContain('padding')
  })

  it('标题样式组件内固定：body-lg 档 + 700 + 主文字色', () => {
    const rule = extractRule('star-section-title')
    expect(rule).toContain('font-size: var(--font-size-body-lg)')
    expect(rule).toContain('font-weight: 700')
    expect(rule).toContain('color: var(--color-text)')
  })

  it('错误行：info 档 + 600 字重 + error 系令牌；空态行：info 档 + 次级文字色', () => {
    const errorRule = extractRule('star-section-error')
    expect(errorRule).toContain('font-size: var(--font-size-info)')
    expect(errorRule).toContain('font-weight: 600')
    expect(errorRule).toContain('color: var(--color-error)')
    const emptyRule = extractRule('star-section-empty')
    expect(emptyRule).toContain('font-size: var(--font-size-info)')
    expect(emptyRule).toContain('color: var(--color-text-secondary)')
  })

  it('禁止自绘按钮样式：style 块无 button 选择器，star-section-refresh 锚点类不挂任何规则', () => {
    const styleBlock = COMPONENT_TEXT.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? ''
    expect(styleBlock).not.toContain('button')
    expect(extractRule('star-section-refresh')).toBe('')
  })
})
