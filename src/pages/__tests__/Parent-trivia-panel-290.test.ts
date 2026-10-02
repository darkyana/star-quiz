/**
 * #290 家长面板惊喜条目两行组装 + 得星开关：主题行 / 奖励行由现役题集对象与规则全自动组装
 * （单一事实源，无自由文本字段）；题集带规则才显示得星开关（键控惊喜入口，默认开），
 * 切换写 sq_entry_visibility 独立入口键；无规则显示「奖励：无」不显示开关；题集未加载不渲染两行。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Parent from '../Parent.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { init as initAppState } from '../../composables/useDataInfra'
import { readEntryVisibilityMap } from '../../composables/useEntryVisibility'
import { adoptTriviaSet, triviaSetRef } from '../../data/trivia-set'
import { TRIVIA_STAR_TOGGLE_KEY } from '../../composables/useTriviaStarToggle'

const triviaSetJson = JSON.parse(readFileSync(resolve(process.cwd(), 'public/trivia/current/set.json'), 'utf8'))
/** 带规则题集（档乱序给入：奖励行按正确率升序渲染）；无规则题集 = 现役 set.json 原样（本就无 starRule） */
const RULED_SET = { ...triviaSetJson, starRule: [{ minAccuracy: 1, stars: 25 }, { minAccuracy: 0.7, stars: 5 }] }

beforeEach(() => {
  localStorage.clear()
  triviaSetRef.value = null
  initAppState()
})

async function mountParent() {
  await router.replace('/parent')
  const wrapper = mount(Parent, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

const THEME_LINE = copy.parent.triviaSetTheme(triviaSetJson.category, triviaSetJson.book, triviaSetJson.questions.length)
const RULE_LINE = '奖励：答对 70% 得 5 颗星，全对得 25 颗星'

describe('#290 惊喜条目两行组装（题集对象 + 规则单一事实源）', () => {
  it('带规则题集：主题行 + 奖励行（档升序、100% 档「全对」）逐字渲染；两行同在惊喜入口块内', async () => {
    adoptTriviaSet(RULED_SET)
    const wrapper = await mountParent()
    const block = wrapper.findAll('.entry-block').find((b) => b.text().includes(copy.parent.triviaEntryTitle))!
    expect(block.find('.trivia-set-theme').text()).toBe(THEME_LINE)
    expect(block.find('.trivia-set-reward').text()).toBe(RULE_LINE)
  })

  it('无规则题集：奖励行「奖励：无」，不显得星开关（面板无 trivia-star-toggle 组）', async () => {
    adoptTriviaSet(triviaSetJson)
    const wrapper = await mountParent()
    const block = wrapper.findAll('.entry-block').find((b) => b.text().includes(copy.parent.triviaEntryTitle))!
    expect(block.find('.trivia-set-reward').text()).toBe('奖励：无')
    expect(wrapper.find('[aria-label="trivia-star-toggle"]').exists()).toBe(false)
  })

  it('题集未加载（缺失/损坏视为空题库）：两行与开关均不渲染', async () => {
    const wrapper = await mountParent()
    expect(wrapper.find('.trivia-set-theme').exists()).toBe(false)
    expect(wrapper.find('.trivia-set-reward').exists()).toBe(false)
    expect(wrapper.find('[aria-label="trivia-star-toggle"]').exists()).toBe(false)
  })
})

describe('#290 得星开关（仅带规则题集显示；键控惊喜入口，默认开）', () => {
  it('默认开（未设置不落记录）：开关组选中「得星开」', async () => {
    adoptTriviaSet(RULED_SET)
    const wrapper = await mountParent()
    const group = wrapper.get('[aria-label="trivia-star-toggle"]')
    expect(group.find('[aria-checked="true"]').text()).toBe(copy.parent.triviaStarOptionOn)
    expect(readEntryVisibilityMap()).toEqual({})
  })

  it('切换写域：点「得星关」落显式 false、页面跟随选中「得星关」；再点「得星开」落显式 true', async () => {
    adoptTriviaSet(RULED_SET)
    const wrapper = await mountParent()
    const group = wrapper.get('[aria-label="trivia-star-toggle"]')
    const off = group.findAll('[role="radio"]').find((r) => r.text() === copy.parent.triviaStarOptionOff)!
    await off.trigger('click')
    await flushPromises()
    expect(readEntryVisibilityMap()).toEqual({ [TRIVIA_STAR_TOGGLE_KEY]: false })
    expect(wrapper.get('[aria-label="trivia-star-toggle"]').find('[aria-checked="true"]').text()).toBe(copy.parent.triviaStarOptionOff)
    const on = wrapper.get('[aria-label="trivia-star-toggle"]').findAll('[role="radio"]').find((r) => r.text() === copy.parent.triviaStarOptionOn)!
    await on.trigger('click')
    await flushPromises()
    expect(readEntryVisibilityMap()).toEqual({ [TRIVIA_STAR_TOGGLE_KEY]: true })
  })

  it('挂载即反映已设开关（远端同步落库后重进家长页一致）：显式 false 选中「得星关」', async () => {
    adoptTriviaSet(RULED_SET)
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ [TRIVIA_STAR_TOGGLE_KEY]: false }))
    const wrapper = await mountParent()
    expect(wrapper.get('[aria-label="trivia-star-toggle"]').find('[aria-checked="true"]').text()).toBe(copy.parent.triviaStarOptionOff)
  })
})
