import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'

vi.mock('../../minitool', () => ({ IS_MINITOOL: true }))

import Home from '../Home.vue'
import ParentGuide from '../ParentGuide.vue'
import { router } from '../../router'
import { init } from '../../composables/useDataInfra'
import { copy } from '../../copy'
import { adoptTriviaSet, warmTriviaSet, triviaSetRef } from '../../data/trivia-set'

enableAutoUnmount(afterEach)
beforeEach(async () => {
  localStorage.clear()
  init()
  vi.stubGlobal('fetch', vi.fn())
  await router.replace('/')
})
afterEach(() => vi.unstubAllGlobals())

describe('#308 minitool local onboarding', () => {
  it('loads the current trivia content locally instead of retaining a forbidden fetch path', async () => {
    adoptTriviaSet(null)
    expect(await warmTriviaSet()).toBe(true)
    expect(triviaSetRef.value?.questions.length).toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps the guide and local CTA routes while cloud routes and game remain absent', async () => {
    for (const path of ['/pair', '/pair-wait', '/parent/family']) {
      expect(router.getRoutes().map(route => route.path)).not.toContain(path)
    }
    const home = mount(Home, { global: { plugins: [router] } })
    expect(home.find('.game-sticker').exists()).toBe(false)
    await home.get('button[aria-label="家长请看"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    const page = mount(ParentGuide, { global: { plugins: [router] } })
    expect(page.find('a[aria-haspopup="dialog"]').exists()).toBe(false)
    const create = page.findAll('button').find(button => button.text() === copy.parentGuide.familyAction)!
    await create.trigger('click')
    expect(page.get('[role="dialog"]').text()).toContain(copy.parentGuide.betaMessage)
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    await page.get('[role="dialog"] button').trigger('click')
    await page.findAll('button').find(button => button.text() === copy.parentGuide.questionsAction)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent/question-prompt')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('#321 acknowledges notifications locally with no network requests, reaching the empty state', async () => {
    const home = mount(Home, { global: { plugins: [router] } })
    await home.get('button[aria-label="家长请看"]').trigger('click')
    await flushPromises()
    let page = mount(ParentGuide, { global: { plugins: [router] } })
    // 未读照常逐条渲染 + 「知道了」本地生效：点一条少一条
    expect(page.findAll('.guide-card').length).toBe(3)
    await page.findAll('.guide-card')[1].findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
    await flushPromises()
    expect(page.findAll('.guide-card').length).toBe(2)
    page.unmount()
    // 已读状态本机持久（小工具版从不同步，也无网络请求）
    page = mount(ParentGuide, { global: { plugins: [router] } })
    expect(page.findAll('.guide-card').length).toBe(2)
    for (const card of [...page.findAll('.guide-card')]) {
      await card.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
      await flushPromises()
    }
    expect(page.findAll('.guide-card').length).toBe(0)
    expect(page.get('.guide-empty').text()).toContain(copy.parentGuide.allReadTitle)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('#323 archive form works offline in the minitool: all notifications render with no acknowledge and no network', async () => {
    await router.replace('/parent-guide?from=parent')
    let page = mount(ParentGuide, { global: { plugins: [router] } })
    // 归档形态不依赖云端：全部通知渲染、无「知道了」、永不空态
    expect(page.findAll('.guide-card').length).toBe(3)
    expect(page.findAll('button').map(button => button.text())).not.toContain(copy.parentGuide.dismiss)
    expect(page.find('.guide-empty').exists()).toBe(false)
    page.unmount()
    // 已读账零变化：再进通知视图仍是全部未读
    await router.replace('/parent-guide')
    page = mount(ParentGuide, { global: { plugins: [router] } })
    expect(page.findAll('.guide-card').length).toBe(3)
    expect(fetch).not.toHaveBeenCalled()
  })

  // #322 离线小工具版同条件显隐（#316 口径修订的说明见 Home.vue / 09-home）：有未读 → 贴纸在；未读清零 → 消失。
  // 小工具无配对概念（无孩子设备分支），只有未读驱动这一维。
  it('#322 home sticker follows unread notifications: shown while unread, hidden once all acknowledged', async () => {
    const home = mount(Home, { global: { plugins: [router] } })
    expect(home.find('.parent-sticker').exists()).toBe(true)
    await router.push('/parent-guide')
    const page = mount(ParentGuide, { global: { plugins: [router] } })
    for (const card of [...page.findAll('.guide-card')]) {
      await card.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
      await flushPromises()
    }
    await router.push('/')
    await flushPromises()
    expect(home.find('.parent-sticker').exists()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
