/**
 * StarBatchBar 组件测试（#184 C- 组件卡）：批量操作条壳元组件渲染契约。
 * 组件只管壳与布局，逻辑留页面（ADR-0008 受控边界）：动作全经 actions 槽由使用方组装，
 * 「取消选择」= components.css config-link 样式集（不自绘按钮样式）。
 * 结构断言用挂载 DOM（2026-08-30 拍板）；布局链与令牌声明继续源码文本锁定（与 StarSectionShell.test.ts 同法）。
 */
import { describe, it, expect } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import StarBatchBar from '../StarBatchBar.vue'
import StarButtonStandard from '../StarButtonStandard.vue'

const COMPONENT_TEXT = readFileSync(resolve(process.cwd(), 'src/components/StarBatchBar.vue'), 'utf-8')

/** 提取某选择器（类名串，不含点）在组件样式中的首个规则块声明文本 */
function extractRule(cls: string): string {
  const re = new RegExp(`\\.${cls.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`)
  const m = COMPONENT_TEXT.match(re)
  return m ? m[1] : ''
}

describe('StarBatchBar — #184 渲染契约（计数 / 取消选择 / actions 槽 / feedback）', () => {
  it('计数行：默认 unit「题」，数字主色强调，附「取消选择」config-link 钮', () => {
    const wrapper = mount(StarBatchBar, { props: { count: 3 } })
    expect(wrapper.classes()).toContain('star-batch-bar')
    expect(wrapper.get('.star-batch-count-text').text()).toBe('已选 3 题')
    expect(wrapper.get('.star-batch-count-num').text()).toBe('3')
    expect(wrapper.get('button.star-batch-clear').classes()).toContain('config-link')
    expect(wrapper.get('button.star-batch-clear').text()).toBe('取消选择')
    // 未传 feedback 不渲染反馈行；未传 actions 槽不渲染动作区
    expect(wrapper.find('.star-batch-feedback').exists()).toBe(false)
    expect(wrapper.find('.star-batch-actions').exists()).toBe(false)
  })

  it('unit prop：自定义单位直译进计数行（导出等场景）', () => {
    const wrapper = mount(StarBatchBar, { props: { count: 5, unit: '项' } })
    expect(wrapper.get('.star-batch-count-text').text()).toBe('已选 5 项')
  })

  it('feedback prop：传了才渲染反馈文案行', () => {
    const withFeedback = mount(StarBatchBar, { props: { count: 3, feedback: '已导出 3 题' } })
    expect(withFeedback.get('.star-batch-feedback').text()).toBe('已导出 3 题')
    const emptyString = mount(StarBatchBar, { props: { count: 3, feedback: '' } })
    expect(emptyString.find('.star-batch-feedback').exists()).toBe(false)
  })

  it('clear emit：点「取消选择」emit clear（选中集判定留页面）', async () => {
    const wrapper = mount(StarBatchBar, { props: { count: 3 } })
    expect(wrapper.emitted('clear')).toBeUndefined()
    await wrapper.get('button.star-batch-clear').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('actions 槽：内容自由透传（使用方塞 StarButtonStandard），未传不渲染动作区', () => {
    const withActions = mount(StarBatchBar, {
      props: { count: 3 },
      slots: {
        actions: () => [
          h(StarButtonStandard, { variant: 'standard', size: 'small' }, () => '标星'),
          h(StarButtonStandard, { variant: 'primary', size: 'small' }, () => '移除'),
        ],
      },
    })
    const actionsArea = withActions.get('.star-batch-actions')
    const buttons = actionsArea.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].classes()).toContain('star-button--standard')
    expect(buttons[0].text()).toBe('标星')
    expect(buttons[1].classes()).toContain('star-button--primary')
    expect(buttons[1].text()).toBe('移除')
  })
})

describe('StarBatchBar — #184 票内视觉直译（样式源码断言）', () => {
  it('sticky 底栏壳：sticky bottom 0 + surface-bright 底 + outline 上描边 + 深色上抛阴影 + 页边距 + safe-area', () => {
    const rule = extractRule('star-batch-bar')
    expect(rule).toContain('position: sticky')
    expect(rule).toContain('bottom: 0')
    expect(rule).toContain('background-color: var(--color-surface-bright)')
    expect(rule).toContain('border-top: var(--border-thin) solid var(--color-outline)')
    expect(rule).toContain('var(--color-surface-shadow)')
    expect(rule).toContain('var(--space-page)')
    expect(rule).toContain('env(safe-area-inset-bottom)')
  })

  it('计数强调：数字 body-lg 档 + 700 + 主色；计数文字与反馈行 info 档次级色', () => {
    const numRule = extractRule('star-batch-count-num')
    expect(numRule).toContain('font-size: var(--font-size-body-lg)')
    expect(numRule).toContain('font-weight: 700')
    expect(numRule).toContain('color: var(--color-primary)')
    const textRule = extractRule('star-batch-count-text')
    expect(textRule).toContain('font-size: var(--font-size-info)')
    expect(textRule).toContain('color: var(--color-text-secondary)')
    const feedbackRule = extractRule('star-batch-feedback')
    expect(feedbackRule).toContain('font-size: var(--font-size-info)')
    expect(feedbackRule).toContain('color: var(--color-text-secondary)')
  })

  it('禁止自绘按钮样式：style 块无 button 选择器、无 color/background 按钮自绘；取消选择走 config-link 样式集（模板加类）', () => {
    const styleBlock = COMPONENT_TEXT.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? ''
    expect(styleBlock).not.toContain('button')
    // 锚点类不挂任何样式规则（沿 star-section-refresh 惯例）
    expect(extractRule('star-batch-clear')).toBe('')
    // 模板内「取消选择」= config-link 样式集
    expect(COMPONENT_TEXT).toContain('class="config-link star-batch-clear"')
  })

  it('仅用既有令牌：style 块无裸色值 / 魔数（calc + env + var 组合除外）', () => {
    const styleBlock = COMPONENT_TEXT.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? ''
    expect(styleBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(styleBlock).not.toMatch(/rgba?\(/)
    expect(styleBlock.match(/\b\d+px\b/g) ?? []).toEqual([])
  })
})
