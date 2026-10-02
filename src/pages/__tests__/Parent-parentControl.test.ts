/**
 * #263 / #279 家长控制功能卡单测：渲染于「家长超能力」卡下方；游戏 / 惊喜每入口一个四态单选组
 * （关闭 / 保持 / 30分钟 / 1小时；未选档 = 关闭 = 默认隐藏语义）；选档写 sq_entry_visibility
 * （键控单一出口）；限时组内显示剩余分钟、到期经推导回初始态（推导逻辑归 #278 纯函数层不重复测，
 * 本文件只测页面外部行为：档位选择写域 / 剩余文案 / 到期回初始态 / 定时器清理）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Parent from '../Parent.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState, STORAGE_KEYS } from '../../composables/useDataInfra'
import { readEntryVisibilityMap } from '../../composables/useEntryVisibility'
import { GAME_SLOT } from '../../data/playable-games'
import { TRIVIA_ENTRY_ID } from '../../data/trivia-set'

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

async function mountParent() {
  await router.replace('/parent')
  const wrapper = mount(Parent, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

/** 段位组定位：两入口组以 aria-label 区分；选中段 = 组内 aria-checked=true 的 radio 文案 */
function groupOf(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.get(`.parent-control-card [aria-label="${label}"]`)
}

function selectedLabel(wrapper: ReturnType<typeof mount>, label: string): string {
  return groupOf(wrapper, label).find('[aria-checked="true"]').text()
}

async function selectOption(wrapper: ReturnType<typeof mount>, label: string, optionLabel: string) {
  await groupOf(wrapper, label).findAll('[role="radio"]').find((r) => r.text() === optionLabel)!.trigger('click')
  await flushPromises()
}

const GAME = 'game-entry-mode'
const TRIVIA = 'trivia-entry-mode'
const { entryOptionOff, entryOptionKeepOn, entryOptionTimed30, entryOptionTimed60 } = copy.parent

describe('#263 家长控制功能卡（位置 / 双入口四态单选组）', () => {
  it('卡渲染于「家长超能力」卡下方（DOM 顺序），卡标题 + 游戏 / 惊喜两组四态单选，未选档 = 关闭', async () => {
    const wrapper = await mountParent()
    const main = wrapper.get('.parent-main')
    const cards = main.findAll('.star-container')
    const spIndex = cards.findIndex((c) => c.classes().includes('super-power-card'))
    const pcIndex = cards.findIndex((c) => c.classes().includes('parent-control-card'))
    expect(spIndex).toBeGreaterThanOrEqual(0)
    expect(pcIndex).toBeGreaterThan(spIndex)
    const card = wrapper.get('.parent-control-card')
    expect(card.text()).toContain(copy.parent.parentControlTitle)
    const groups = card.findAll('[role="radiogroup"]')
    expect(groups).toHaveLength(2)
    for (const g of groups) expect(g.findAll('[role="radio"]')).toHaveLength(4)
    // 默认隐藏：未设置 = 两组均选中「关闭」档
    expect(selectedLabel(wrapper, GAME)).toBe(entryOptionOff)
    expect(selectedLabel(wrapper, TRIVIA)).toBe(entryOptionOff)
  })

  it('选档写域：关闭不落行（未设置）、保持落 true、30分钟 / 1小时落可见 + 到期时间戳（本机时钟起算）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T10:00:00'))
    const base = Date.now()
    const wrapper = await mountParent()
    // 未设置：记录为空（空记录不 diff 出行）
    expect(readEntryVisibilityMap()).toEqual({})
    await selectOption(wrapper, GAME, entryOptionKeepOn)
    expect(readEntryVisibilityMap()).toEqual({ [GAME_SLOT.id]: true })
    await selectOption(wrapper, GAME, entryOptionTimed30)
    expect(readEntryVisibilityMap()).toEqual({ [GAME_SLOT.id]: { visible: true, expires_at: base + 30 * 60_000 } })
    await selectOption(wrapper, GAME, entryOptionTimed60)
    expect(readEntryVisibilityMap()).toEqual({ [GAME_SLOT.id]: { visible: true, expires_at: base + 60 * 60_000 } })
    // 切回「关闭」= 显式落 false（既有语义：家长关掉是事实，须可同步传播）
    await selectOption(wrapper, GAME, entryOptionOff)
    expect(readEntryVisibilityMap()).toEqual({ [GAME_SLOT.id]: false })
    // 惊喜组独立写域
    await selectOption(wrapper, TRIVIA, entryOptionKeepOn)
    expect(readEntryVisibilityMap()).toEqual({ [GAME_SLOT.id]: false, [TRIVIA_ENTRY_ID]: true })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.entryVisibility) as string)).toEqual(readEntryVisibilityMap())
    vi.useRealTimers()
  })

  it('#277 重选同段位从当下重新起算：限时进行中再点同档 → 到期时间戳被覆写推后（记录层断言）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T10:00:00'))
    const wrapper = await mountParent()
    // 先选 30 分钟档，记录当次到期时间戳
    await selectOption(wrapper, GAME, entryOptionTimed30)
    const first = readEntryVisibilityMap()[GAME_SLOT.id]
    // 限时进行 10 分钟后重选同一「30分钟」段（已选中段也派发 click）：到期时间戳从当下重新起算被覆写推后
    vi.advanceTimersByTime(10 * 60_000)
    await selectOption(wrapper, GAME, entryOptionTimed30)
    const rewritten = readEntryVisibilityMap()[GAME_SLOT.id]
    expect(rewritten).toEqual({ visible: true, expires_at: Date.now() + 30 * 60_000 })
    expect((rewritten as { expires_at: number }).expires_at).toBeGreaterThan((first as { expires_at: number }).expires_at)
    // 页面剩余文案同步回到新起算的 30 分钟
    expect(wrapper.get('.parent-control-card').text()).toContain('剩余 30 分钟')
    vi.useRealTimers()
  })

  it('限时进行中组内显示剩余时间（分钟粒度）；不足 1 分钟 =「不到 1 分钟」；保持开启无剩余文案', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T10:00:00'))
    const wrapper = await mountParent()
    const card = wrapper.get('.parent-control-card')
    await selectOption(wrapper, GAME, entryOptionTimed30)
    expect(card.text()).toContain('剩余 30 分钟')
    // 挂载时起算的分钟粒度定时器刷新：2 分钟后 = 剩余 28 分钟
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(card.text()).toContain('剩余 28 分钟')
    // 限时中改档即覆写：重选 30 分钟档从当下重新起算（原 60 分钟档剩余被覆写）
    await selectOption(wrapper, GAME, entryOptionTimed30)
    expect(card.text()).toContain('剩余 30 分钟')
    // 改「保持」清到期，无剩余文案
    await selectOption(wrapper, GAME, entryOptionKeepOn)
    expect(card.text()).not.toContain('剩余')
    // 重选限时（先偏移 30s 使起算点不在整分位点，剩余可落到 1 分钟内）后推进到剩余不足 1 分钟
    await vi.advanceTimersByTimeAsync(30_000)
    await selectOption(wrapper, GAME, entryOptionTimed30)
    await vi.advanceTimersByTimeAsync(29 * 60_000 + 30_000)
    expect(card.text()).toContain(copy.parent.entryLessThanOneMinute)
    vi.useRealTimers()
  })

  it('到期后控制组经推导回未选档初始态（选中「关闭」、无倒计时残留），且无写回（记录原样）', async () => {
    vi.useFakeTimers()
    const wrapper = await mountParent()
    const card = wrapper.get('.parent-control-card')
    await selectOption(wrapper, GAME, entryOptionTimed30)
    const recorded = readEntryVisibilityMap()[GAME_SLOT.id]
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(selectedLabel(wrapper, GAME)).toBe(entryOptionOff)
    expect(card.text()).not.toContain('剩余')
    expect(card.text()).not.toContain(copy.parent.entryLessThanOneMinute)
    // 到期 = 纯推导无写回：记录仍为限时条目（孩子端同口径推导，各设备一致）
    expect(readEntryVisibilityMap()[GAME_SLOT.id]).toEqual(recorded)
    vi.useRealTimers()
  })

  it('存量映射（拍板 C）：已有可见无到期的行自动映射为「保持」档选中', async () => {
    localStorage.setItem(STORAGE_KEYS.entryVisibility, JSON.stringify({ [TRIVIA_ENTRY_ID]: true }))
    const wrapper = await mountParent()
    expect(selectedLabel(wrapper, TRIVIA)).toBe(entryOptionKeepOn)
    expect(selectedLabel(wrapper, GAME)).toBe(entryOptionOff)
  })

  it('挂载即反映已设档位（远端同步落库后重进家长页一致）：限时未到期映射按剩余就近选段', async () => {
    vi.useFakeTimers()
    localStorage.setItem(
      STORAGE_KEYS.entryVisibility,
      JSON.stringify({ [TRIVIA_ENTRY_ID]: { visible: true, expires_at: Date.now() + 45 * 60_000 } }),
    )
    const wrapper = await mountParent()
    expect(selectedLabel(wrapper, TRIVIA)).toBe(entryOptionTimed60)
    vi.useRealTimers()
  })

  it('卡外无任何入口控制残留（全页唯一入口档位组在此卡）；卸载清理分钟定时器', async () => {
    const wrapper = await mountParent()
    expect(wrapper.find('.trivia-entry-card').exists()).toBe(false)
    const page = wrapper.get('[data-page="parent"]')
    const inCard = wrapper.get('.parent-control-card').findAll('[role="radiogroup"]')
    expect(page.findAll('[role="radiogroup"]')).toHaveLength(inCard.length)
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    wrapper.unmount()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
