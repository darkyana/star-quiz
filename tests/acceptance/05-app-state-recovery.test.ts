/**
 * AC5-1 ~ AC5-4 数据损坏恢复（Spec §4 REQ-5）
 * 损坏键重置为 §3.3 初始值 + console.warn（含键名），应用正常启动不崩溃。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'

const KEYS = {
  questions: 'sq_questions',
  stars: 'sq_stars',
  rewards: 'sq_rewards',
  lastExport: 'sq_last_export',
}

async function mountHome() {
  window.location.hash = '#/'
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
})

describe('AC5 数据损坏恢复', () => {
  it('AC5-1 题池键损坏重置 + 提示：不崩溃、重置为初始 10 题、warn 首参含键名', async () => {
    localStorage.setItem(KEYS.questions, '{invalid json')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    initAppState()
    const wrapper = await mountHome()
    await flushPromises()

    // 应用正常渲染首页，不崩溃
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
    // 重置为初始 20 题数组
    const questions = JSON.parse(localStorage.getItem(KEYS.questions) as string) as { id: string }[]
    expect(questions).toHaveLength(20)
    expect(questions[0].id).toBe('000001')
    // console.warn 被调用且首个参数含键名
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(warnMessages.some((m) => m.includes('sq_questions'))).toBe(true)

    wrapper.unmount()
    warnSpy.mockRestore()
  })

  it('AC5-2 流水键损坏重置：sq_stars 重置为 []，应用正常渲染首页', async () => {
    localStorage.setItem(KEYS.stars, '[1,2,3')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    initAppState()
    const wrapper = await mountHome()
    await flushPromises()

    expect(JSON.parse(localStorage.getItem(KEYS.stars) as string)).toEqual([])
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)

    wrapper.unmount()
    warnSpy.mockRestore()
  })

  it('AC5-3 多键损坏互不干扰：损坏键重置、合法键保持', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(KEYS.questions, '{broken')
    localStorage.setItem(KEYS.rewards, 'nope')
    const starEntry = [
      { id: 's1', timestamp: 1724140800000, type: 'earn', amount: 1, source: '答题得星' },
    ]
    localStorage.setItem(KEYS.stars, JSON.stringify(starEntry))
    // 单测损坏恢复，不混入版本迁移（8→9 会合法补充数据字段）。
    localStorage.setItem('sq_data_version', '9')

    initAppState()

    const questions = JSON.parse(localStorage.getItem(KEYS.questions) as string) as { id: string }[]
    expect(questions).toHaveLength(20)
    expect(questions[0].id).toBe('000001')

    const rewards = JSON.parse(localStorage.getItem(KEYS.rewards) as string) as { id: string }[]
    expect(rewards).toHaveLength(3)
    expect(rewards.map((r) => r.id)).toEqual(['reward_pineapple', 'reward_tv', 'reward_sukiyaki'])

    expect(JSON.parse(localStorage.getItem(KEYS.stars) as string)).toEqual(starEntry)
    warnSpy.mockRestore()
  })

  it('AC5-4 合法数据不误报：console.warn 未被调用', async () => {
    localStorage.setItem(
      KEYS.questions,
      JSON.stringify([{ id: 'ok', type: 'zh2en', prompt: 'x', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w' }]),
    )
    localStorage.setItem(KEYS.stars, JSON.stringify([]))
    localStorage.setItem(KEYS.rewards, JSON.stringify([]))
    localStorage.setItem(KEYS.lastExport, JSON.stringify('2026-01-01T00:00:00.000Z'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    initAppState()
    const wrapper = await mountHome()
    await flushPromises()

    expect(warnSpy).not.toHaveBeenCalled()

    wrapper.unmount()
    warnSpy.mockRestore()
  })
})
