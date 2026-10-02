import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { init, readValue, registerMigrationBackup, STORAGE_KEYS } from '../useDataInfra'
// 业务键初始值与迁移实现由各域模块注册：星星域 useStarData（T2）、学习域 useLearningData（T3）
import '../useStarData'
import '../useLearningData'
// 剪环后备份注册上移组合根（架构评审 20260829）：测试扮演 main.ts 注册一次——
// 迁移前备份会先读取并治愈损坏键（与生产启动同构），损坏恢复断言口径不变
import { runMigrationBackup } from '../useExport'
registerMigrationBackup(runMigrationBackup)
import { router } from '../../router'
import App from '../../App.vue'
import type { StarEntry } from '../../types'

const originalWarn = console.warn
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  console.warn = originalWarn
  vi.unstubAllGlobals()
})

describe('数据损坏恢复（REQ-5 / E1）', () => {
  it('AC5-1 题池键损坏：重置为初始 20 题 + console.warn 含键名 + 应用正常渲染首页', async () => {
    localStorage.setItem('sq_questions', '{invalid json')

    init()

    const stored = JSON.parse(localStorage.getItem('sq_questions') as string) as { id: string }[]
    expect(stored).toHaveLength(20)
    expect(stored[0].id).toBe('000001')
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain('sq_questions')

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('AC5-2 流水键损坏：重置为 []', () => {
    localStorage.setItem('sq_stars', '[1,2,3')

    init()

    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('AC5-3 多键损坏互不干扰：questions/rewards 重置，合法 stars 保持原样', () => {
    const intactStars: StarEntry[] = [
      { id: 's1', timestamp: 1724140800000, type: 'earn', amount: 1, source: '答题得星' },
    ]
    localStorage.setItem('sq_questions', '{broken')
    localStorage.setItem('sq_rewards', '[1,2')
    localStorage.setItem('sq_stars', JSON.stringify(intactStars))

    init()

    const questions = JSON.parse(localStorage.getItem('sq_questions') as string) as { id: string }[]
    expect(questions).toHaveLength(20)
    const rewards = JSON.parse(localStorage.getItem('sq_rewards') as string) as { id: string }[]
    expect(rewards.map((r) => r.id)).toEqual(['reward_pineapple', 'reward_tv', 'reward_sukiyaki'])
    // #173 8→9 断代：合法流水不被损坏重置触碰，仅迁移补 kind/childId 两列（值语义不变）
    expect(readValue<StarEntry[]>(STORAGE_KEYS.stars)).toEqual(intactStars.map((e) => ({ ...e, kind: 'main', childId: 'default' })))
    // #169 起迁移前备份失败也留日志（jsdom 无下载器 → 2 条备份失败 warn），
    // 本断言意图不变：损坏重置 warn 恰好 2 条（questions / rewards 各一），不多报不漏报
    const resetWarns = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('已重置为初始值'))
    expect(resetWarns).toHaveLength(2)
    expect(resetWarns.some((m) => m.includes('sq_questions'))).toBe(true)
    expect(resetWarns.some((m) => m.includes('sq_rewards'))).toBe(true)
  })

  it('AC5-4 全部合法数据不误报 console.warn', () => {
    init()

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
