/**
 * 组件展示页返回导航单测（#207）：点顶栏返回应落在组件列表页 /components，
 * 不再跳过列表直接回家长页（家长页 → 组件列表 → 展示页链路可往返浏览其他组件）。
 * 沿 Prizes.test.ts 顶栏导航先例：真实 router + .back-btn click + currentRoute 断言。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ComponentShowcase from '../ComponentShowcase.vue'
import ComponentsList from '../ComponentsList.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { componentGroups, componentRegistry } from '../../components/registry'

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

describe('分组与代码名（#214）', () => {
  it('registry 22 条全归组且 componentGroups 组内顺序与票面定稿一致（无遗漏 / 无重复）', () => {
    expect(componentRegistry).toHaveLength(22)
    // 每条都有 group 元数据且属于四组之一，file = 组件文件名
    const groupKeys = componentGroups.map((g) => g.key)
    for (const entry of componentRegistry) {
      expect(groupKeys).toContain(entry.group)
      expect(entry.file).toMatch(/\.vue$/)
    }
    // 四组 order 拼起来恰好覆盖全部条目（无遗漏 / 无重复），组内顺序与票面定稿逐位一致
    const ordered = componentGroups.flatMap((g) => g.order)
    expect(ordered).toHaveLength(22)
    expect(new Set(ordered).size).toBe(22)
    expect(new Set(componentRegistry.map((e) => e.key))).toEqual(new Set(ordered))
    expect(componentGroups.map((g) => g.title)).toEqual(['Atom', '选择控件', '提醒', '区块'])
    expect(componentGroups[0].order).toEqual(['star-button-standard', 'star-chip', 'star-icon-btn', 'star-glyph', 'camp-avatar'])
    expect(componentGroups[1].order).toEqual(['star-check-circle', 'star-segment-tabs', 'star-mode-entry', 'star-list-selectable', 'star-option-row'])
    expect(componentGroups[2].order).toEqual(['star-modal-standard', 'star-toast-standard', 'star-feedback-bar', 'star-empty-state'])
    expect(componentGroups[3].order).toEqual([
      'star-nav-bar',
      'star-progress-bar',
      'star-section-shell',
      'star-reward-item',
      'star-batch-bar',
      'star-proposal-card-shell',
      'star-proposal-camps',
      'star-proposal-actions',
    ])
  })

  it('列表页按四组分区渲染：组标题可见、组内顺序照 order、每条目小字展示代码文件名', async () => {
    await router.replace('/components')
    const wrapper = mount(ComponentsList, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-page="components"]').exists()).toBe(true)
    // 四组标题按定稿顺序出现
    const titles = wrapper.findAll('.group-title').map((t) => t.text())
    expect(titles).toEqual(['Atom', '选择控件', '提醒', '区块'])
    // 条目顺序 = 四组 order 串联（列表页首条为 Atom 组首条「按钮」）
    const names = wrapper.findAll('.component-row .component-name').map((n) => n.text())
    expect(names).toHaveLength(22)
    expect(names[0]).toBe('按钮')
    // 每条目小字展示代码文件名（registry import 名）
    const files = wrapper.findAll('.component-row .component-file').map((f) => f.text())
    expect(files).toHaveLength(22)
    expect(files[0]).toBe('StarButtonStandard.vue')
    wrapper.unmount()
  })

  it('展示页在导航栏下方以小字展示代码文件名', async () => {
    await router.replace('/components/star-icon-btn')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('.showcase-file').text()).toBe('StarIconBtn.vue')
    wrapper.unmount()
  })
})

describe('顶栏返回导航（#207）', () => {
  it('「返回」→ /components（组件列表页，而非家长页）', async () => {
    await router.replace('/components/star-button-standard')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-page="component-showcase"]').exists()).toBe(true)
    await wrapper.get('.back-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/components')
    wrapper.unmount()
  })
})

describe('分段标签展示节（#183）', () => {
  it('注册表含 star-segment-tabs 条目（三段 + 两段示例），与出题方式入口并存', () => {
    const keys = componentRegistry.map((e) => e.key)
    expect(keys).toContain('star-segment-tabs')
    expect(keys).toContain('star-mode-entry')
    const entry = componentRegistry.find((e) => e.key === 'star-segment-tabs')!
    expect(entry.showcase).toHaveLength(2)
  })

  it('展示页渲染分段标签节，interactive 格点击真实切换选中段', async () => {
    await router.replace('/components/star-segment-tabs')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-page="component-showcase"]').exists()).toBe(true)
    // 两格示例（三段 + 两段）平铺
    const cells = wrapper.findAll('.showcase-cell')
    expect(cells).toHaveLength(2)
    // 三段格：初选「全部」，点击「红旗」后选中类名切换过去
    const segments = wrapper.findAll('[role="radio"]')
    expect(segments).toHaveLength(5)
    expect(segments[0].classes()).toContain('is-selected')
    await segments[1].trigger('click')
    expect(segments[1].classes()).toContain('is-selected')
    expect(segments[0].classes()).not.toContain('is-selected')
    wrapper.unmount()
  })
})

describe('批量操作条展示节（#184）', () => {
  it('/components/star-batch-bar 渲染注册表三格：计数行 + 取消选择 config-link + actions 槽按钮 + feedback', async () => {
    await router.replace('/components/star-batch-bar')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-page="component-showcase"]').exists()).toBe(true)
    // 三格 showcase（standard·small 排 / primary·small 排 + feedback / 不同动作 + 自定义 unit）
    const cells = wrapper.findAll('.showcase-cell')
    expect(cells).toHaveLength(3)
    // 计数行与取消选择（config-link 样式集）
    expect(wrapper.findAll('.star-batch-count-num').map((n) => n.text())).toEqual(['3', '12', '5'])
    expect(wrapper.findAll('.star-batch-clear')).toHaveLength(3)
    expect(wrapper.findAll('button.star-batch-clear')[0].classes()).toContain('config-link')
    // actions 槽按钮 = StarButtonStandard（2 / 2 / 3），第二格带 feedback 行
    const actionButtons = wrapper.findAll('.star-batch-actions button')
    expect(actionButtons.map((b) => b.text())).toEqual(['标星', '设难度', '应用修改', '批量删除', '全选', '导出', '删除'])
    expect(wrapper.findAll('.star-batch-feedback')).toHaveLength(2)
    wrapper.unmount()
  })
})

describe('弹窗展示节（#216）', () => {
  it('「actions 槽 · 三按钮」格打开后：三按钮纵向满宽堆叠（stacked 类）且顺序从上到下', async () => {
    await router.replace('/components/star-modal-standard')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    // 三按钮格 = registry actions 槽展示条目，点击其「打开」展开弹窗实例
    const cells = wrapper.findAll('.showcase-cell')
    const target = cells.find((c) => c.find('.showcase-label').text().includes('三按钮'))!
    expect(target).toBeDefined()
    await target.get('button').trigger('click')
    await flushPromises()
    const actions = wrapper.get('.star-modal__actions')
    expect(actions.classes()).toContain('star-modal__actions--stacked')
    expect(actions.findAll('button').map((b) => b.text())).toEqual(['取消', '导入并重置', '导入并追加'])
    // 既有 confirm 双按钮格不受影响：无 stacked 类
    const confirmCell = cells.find((c) => c.find('.showcase-label').text() === 'confirm · 默认（取消 / 确认）')!
    await confirmCell.get('button').trigger('click')
    await flushPromises()
    expect(confirmCell.get('.star-modal__actions').classes()).not.toContain('star-modal__actions--stacked')
    wrapper.unmount()
  })
})

describe('StarChip 新形态示例（#186）', () => {
  it('展示页平铺 selected 选中态与 tone 易/中/难三色格', async () => {
    await router.replace('/components/star-chip')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('.star-chip--selected').exists()).toBe(true)
    expect(wrapper.find('.star-chip--tone-go').exists()).toBe(true)
    expect(wrapper.find('.star-chip--tone-mist').exists()).toBe(true)
    expect(wrapper.find('.star-chip--tone-warm').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('StarChip tone 专属展示区（#217）', () => {
  it('既有展示格下方新增区域：标题 + default/sm 四种字色实例（默认 + go/mist/warm）+ 说明文字', async () => {
    await router.replace('/components/star-chip')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    const section = wrapper.get('.showcase-section')
    // 标题与说明文字照票面
    expect(section.get('.showcase-label').text()).toBe('tone：(go, mist, warm)')
    expect(section.get('.showcase-section-note').text()).toBe('tone 字色对 4 个变体都生效')
    // 内容区 = default/sm 的 4 种字色形态（默认字色 + 三种 tone）
    const chips = section.findAll('.star-chip')
    expect(chips).toHaveLength(4)
    expect(chips[0].classes()).toEqual(['star-chip', 'star-chip--default', 'star-chip--sm'])
    expect(chips[1].classes()).toContain('star-chip--tone-go')
    expect(chips[2].classes()).toContain('star-chip--tone-mist')
    expect(chips[3].classes()).toContain('star-chip--tone-warm')
    wrapper.unmount()
  })

  it('其他组件无专属展示区（区域是可选字段，页面零硬编码组件分支）', async () => {
    await router.replace('/components/star-icon-btn')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('.showcase-section').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('图标钮旗帜示例（#218）', () => {
  it('注册表旗帜格 label 描述可切换行为（不再写静态描边语义），StarIconBtn 仍为两格', () => {
    const entry = componentRegistry.find((e) => e.key === 'star-icon-btn')!
    expect(entry.showcase).toHaveLength(2)
    const labels = entry.showcase.map((c) => c.label)
    expect(labels[1]).toBe('旗帜图标 24px（Quiz 红旗形态，点击切换描边 / 填充）')
    expect(labels.some((l) => l.includes('描边语义'))).toBe(false)
  })

  it('展示页旗帜格点击在描边 / 填充两形态间往复切换（同一路径 ICON_FLAG）', async () => {
    await router.replace('/components/star-icon-btn')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-page="component-showcase"]').exists()).toBe(true)
    // 两格示例：关闭钮（静态 fill）+ 旗帜钮（可切换）
    const cells = wrapper.findAll('.showcase-cell')
    expect(cells).toHaveLength(2)
    const flagBtn = wrapper.get('button[aria-label="旗帜示例（点击切换描边 / 填充）"]')
    const pathOf = () => flagBtn.find('svg path')
    // 初态：描边（fill=none + stroke），点击后切填充（fill=currentColor、无 stroke），再点切回
    expect(pathOf().attributes('fill')).toBe('none')
    expect(pathOf().attributes('stroke')).toBe('currentColor')
    expect(pathOf().attributes('d')).toContain('M6.5 3.5v17')
    await flagBtn.trigger('click')
    expect(pathOf().attributes('fill')).toBe('currentColor')
    expect(pathOf().attributes('stroke')).toBeUndefined()
    await flagBtn.trigger('click')
    expect(pathOf().attributes('fill')).toBe('none')
    expect(pathOf().attributes('stroke')).toBe('currentColor')
    wrapper.unmount()
  })
})

describe('可选择列表项展示节（#187）', () => {
  it('/components/star-list-selectable 渲染注册表四格：未选/选中 × 带/不带 action 槽 + disabled 格', async () => {
    await router.replace('/components/star-list-selectable')
    const wrapper = mount(ComponentShowcase, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-page="component-showcase"]').exists()).toBe(true)
    // 四格 showcase（未选/选中 × 无/有 action 槽，末格 disabled）
    const cells = wrapper.findAll('.showcase-cell')
    expect(cells).toHaveLength(4)
    // 每格都有 StarCheckCircle 勾选圆（sm），选中格带 star-check-circle--checked
    const checks = wrapper.findAll('.star-check-circle')
    expect(checks).toHaveLength(4)
    expect(wrapper.findAll('.star-check-circle--checked')).toHaveLength(2)
    // 行选中视觉：--selected 两格；disabled 格带 --disabled 且降透明
    expect(wrapper.findAll('.star-list-selectable--selected')).toHaveLength(2)
    const disabledRows = wrapper.findAll('.star-list-selectable--disabled')
    expect(disabledRows).toHaveLength(1)
    // action 槽格渲染编辑钮（StarIconBtn），无槽格不渲染
    expect(wrapper.findAll('.star-list-selectable__action')).toHaveLength(2)
    wrapper.unmount()
  })
})
