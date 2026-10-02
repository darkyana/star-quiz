import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { router } from '../../router'
import { init } from '../../composables/useDataInfra'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { copy } from '../../copy'

// Real routes and page components; intercept all transport, including navigation sync.
enableAutoUnmount(afterEach)
beforeEach(async () => {
  localStorage.clear()
  init()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
  await router.replace('/')
})
afterEach(() => vi.unstubAllGlobals())
async function app(path: string) {
  await router.replace(path)
  const page = mount({ render: () => h(RouterView) }, { global: { plugins: [router] } })
  await flushPromises()
  return page
}

describe('#316 all-device guide discovery（#322 修订：孩子设备不再显示首页贴纸）', () => {
  // #322 口径修订（spec #319 故事 39）：#316 原「parent/child × active/pending 四格全部能从首页贴纸进说明页」
  // 改为：家长设备（active/pending）、待批准 child、未配对 → 贴纸在、可进；已入队 child 设备 → 首页无贴纸。
  // 这是对 #316 的显式修订而非回归 bug，勿修回。
  it.each([
    ['parent', 'active'], ['parent', 'pending'], ['child', 'pending'],
  ] as const)('%s / %s retains the home sticker and can open the actual guide from home', async (role, status) => {
    writeDeviceCredential({ device_id: 'device', secret: 'secret', role, name: 'device' }, status)
    const page = await app('/')
    await page.get('button[aria-label="家长请看"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(page.get('h1').text()).toBe(copy.parentGuide.pageTitle)
    if (role === 'child') {
      await router.push('/parent')
      expect(router.currentRoute.value.path).toBe('/')
    }
  })

  it('#322 child / active (joined) has no home sticker — explicit revision of #316, not a regression; the guide route itself stays reachable', async () => {
    writeDeviceCredential({ device_id: 'device', secret: 'secret', role: 'child', name: 'device' }, 'active')
    const page = await app('/')
    expect(page.find('button[aria-label="家长请看"]').exists()).toBe(false)
    await router.push('/parent-guide')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(page.get('h1').text()).toBe(copy.parentGuide.pageTitle)
    await router.push('/parent')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('unpaired devices retain the guide entry', async () => {
    const page = await app('/')
    await page.get('.parent-sticker').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
  })
})

describe('#321 notification view: unread-only render + acknowledge ledger', () => {
  it('first entry renders only unread notifications, each with an acknowledge button', async () => {
    const page = await app('/parent-guide')
    expect(page.findAll('.guide-card').length).toBe(3)
    for (const card of page.findAll('.guide-card')) {
      expect(card.findAll('button').map(button => button.text())).toEqual([
        card.get('h2').text() === copy.parentGuide.questionsTitle ? copy.parentGuide.questionsAction
          : card.get('h2').text() === copy.parentGuide.rewardsTitle ? copy.parentGuide.rewardsAction
            : copy.parentGuide.familyAction,
        copy.parentGuide.dismiss,
      ])
    }
  })

  it('acknowledging one card removes it immediately and leaves the others untouched', async () => {
    const page = await app('/parent-guide')
    const first = page.findAll('.guide-card')[0]
    await first.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
    await flushPromises()
    const headings = page.findAll('.guide-card h2').map(h => h.text())
    expect(headings).toEqual([copy.parentGuide.rewardsTitle, copy.parentGuide.parentTitle])
  })

  it('acknowledged cards stay hidden on re-entry; merely visiting writes no read state', async () => {
    const page = await app('/parent-guide')
    await page.findAll('.guide-card')[0].findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
    await flushPromises()
    page.unmount()
    const reentered = await app('/parent-guide')
    expect(reentered.findAll('.guide-card h2').map(h => h.text())).toEqual([copy.parentGuide.rewardsTitle, copy.parentGuide.parentTitle])
    // 只是浏览不写任何已读状态：再次进入未点的两条照常显示
    reentered.unmount()
    const third = await app('/parent-guide')
    expect(third.findAll('.guide-card').length).toBe(2)
  })

  it('dismissing a non-last notification moves focus to the next remaining card acknowledge button (spec #319 story 29)', async () => {
    await router.replace('/parent-guide')
    const page = mount({ render: () => h(RouterView) }, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()
    // 第一条（共三条，非最后）：移除后焦点应落到下一条剩余卡片的「知道了」，而不是掉到 body
    const firstAck = page.findAll('.guide-card')[0]!.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!
    firstAck.element.focus()
    await firstAck.trigger('click')
    await flushPromises()
    expect(page.findAll('.guide-card').length).toBe(2)
    const secondAck = page.findAll('.guide-card')[0]!.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!
    expect(document.activeElement).toBe(secondAck.element)
    // 移除剩余末条（仍非最后一条，剩一张）：焦点落到新的末条（上一条）的「知道了」
    secondAck.element.focus()
    await secondAck.trigger('click')
    await flushPromises()
    expect(page.findAll('.guide-card').length).toBe(1)
    const previousAck = page.findAll('.guide-card')[0]!.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!
    expect(document.activeElement).toBe(previousAck.element)
    page.unmount()
  })

  it('dismissing the last one shows the positive closing empty state with no button and focus lands on it', async () => {
    await router.replace('/parent-guide')
    const page = mount({ render: () => h(RouterView) }, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()
    for (const card of [...page.findAll('.guide-card')]) {
      const acknowledge = card.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!
      acknowledge.element.focus()
      await acknowledge.trigger('click')
      await flushPromises()
    }
    expect(page.findAll('.guide-card').length).toBe(0)
    const empty = page.get('.guide-empty')
    expect(empty.text()).toContain(copy.parentGuide.allReadTitle)
    expect(empty.text()).toContain(copy.parentGuide.allReadHint)
    // 空态不配按钮：页面只剩返回栏的「返回」（无任何「知道了」/功能入口按钮）
    expect(page.findAll('main button')).toHaveLength(0)
    expect(page.findAll('button').map(button => button.text())).toEqual([copy.back])
    // 焦点不悬空：点掉最后一条后焦点落在空态文本上
    expect(document.activeElement).toBe(empty.element)
    page.unmount()
  })

  it('a page loaded with everything already read opens directly on the empty state', async () => {
    const page = await app('/parent-guide')
    for (const card of [...page.findAll('.guide-card')]) {
      await card.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
      await flushPromises()
    }
    page.unmount()
    const fresh = await app('/parent-guide')
    expect(fresh.findAll('.guide-card').length).toBe(0)
    expect(fresh.get('.guide-empty').text()).toContain(copy.parentGuide.allReadTitle)
    expect(fresh.findAll('button').map(button => button.text())).toEqual([copy.back])
  })
})

describe('#323 archive form: explicit source param, full render, return matrix', () => {
  it('archive form (?from=parent) renders ALL notifications with zero read/unread trace and no acknowledge button', async () => {
    // 先在通知视图点掉两条，制造「已读/未读混合」状态
    const seed = await app('/parent-guide')
    await seed.findAll('.guide-card')[0].findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
    await seed.findAll('.guide-card')[0].findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
    await flushPromises()
    seed.unmount()
    // 归档形态：全部三条照常渲染，已读未读渲染完全一致（无痕迹类、无隐藏、无任何区分）
    const page = await app('/parent-guide?from=parent')
    expect(page.findAll('.guide-card').length).toBe(3)
    expect(page.findAll('.guide-card h2').map(h => h.text())).toEqual([
      copy.parentGuide.questionsTitle, copy.parentGuide.rewardsTitle, copy.parentGuide.parentTitle,
    ])
    // 归档形态不渲染「知道了」：每卡只剩功能入口按钮
    for (const card of page.findAll('.guide-card')) {
      expect(card.findAll('button').map(button => button.text())).toEqual([
        card.get('h2').text() === copy.parentGuide.questionsTitle ? copy.parentGuide.questionsAction
          : card.get('h2').text() === copy.parentGuide.rewardsTitle ? copy.parentGuide.rewardsAction
            : copy.parentGuide.familyAction,
      ])
    }
    expect(page.findAll('button').map(button => button.text())).not.toContain(copy.parentGuide.dismiss)
    // 归档永不出现空态（即使通知视图已读空也照常渲染全部）
    expect(page.find('.guide-empty').exists()).toBe(false)
    page.unmount()
  })

  it('archive form with everything already read still renders all three cards and never the empty state', async () => {
    const seed = await app('/parent-guide')
    for (const card of [...seed.findAll('.guide-card')]) {
      await card.findAll('button').find(button => button.text() === copy.parentGuide.dismiss)!.trigger('click')
      await flushPromises()
    }
    seed.unmount()
    const page = await app('/parent-guide?from=parent')
    expect(page.findAll('.guide-card').length).toBe(3)
    expect(page.find('.guide-empty').exists()).toBe(false)
    expect(page.findAll('button').map(button => button.text())).not.toContain(copy.parentGuide.dismiss)
  })

  it.each([
    ['?from=parent', '/parent'],
    ['', '/'],
    ['?from=unknown', '/'],
    ['?from=https%3A%2F%2Fevil.example', '/'],
    ['?from=parent&from=parent', '/'],
    ['?from', '/'],
  ])('source %s determines the return target %s', async (query, fallback) => {
    const page = await app('/parent-guide' + query)
    // 非法 / 缺失 / 重复 / 外部来源一律降级通知视图（未读照常带「知道了」）
    if (query !== '?from=parent') {
      expect(page.findAll('main button').map(button => button.text())).toContain(copy.parentGuide.dismiss)
    }
    await page.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(fallback)
    page.unmount()
  })

  it('entering the archive from the parent page button returns to the parent page', async () => {
    const parent = await app('/parent')
    await parent.get('.btn-parent-guide').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(router.currentRoute.value.query).toEqual({ from: 'parent' })
    const page = mount({ render: () => h(RouterView) }, { global: { plugins: [router] } })
    await flushPromises()
    expect(page.findAll('.guide-card').length).toBe(3)
    await page.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent')
  })

  it('entering from the home sticker keeps the notification view and returns home', async () => {
    const home = await app('/')
    await home.get('button[aria-label="家长请看"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(router.currentRoute.value.query).toEqual({})
    const page = mount({ render: () => h(RouterView) }, { global: { plugins: [router] } })
    await flushPromises()
    expect(page.findAll('.guide-card').length).toBe(3)
    await page.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('archive entry, scrolling and re-entry write no read state', async () => {
    let page = await app('/parent-guide?from=parent')
    expect(page.findAll('.guide-card').length).toBe(3)
    // 浏览（滚动等价于纯渲染观察，无任何交互）后离开
    page.unmount()
    // 再进归档：仍全部渲染且无「知道了」
    page = await app('/parent-guide?from=parent')
    expect(page.findAll('.guide-card').length).toBe(3)
    expect(page.findAll('button').map(button => button.text())).not.toContain(copy.parentGuide.dismiss)
    page.unmount()
    // 已读账零变化：通知视图仍是全部未读
    const view = await app('/parent-guide')
    expect(view.findAll('.guide-card').length).toBe(3)
  })

  it.each([
    ['出一套我家的题', '/parent/question-prompt'], ['看看星星兑换', '/redeem'],
  ])('archive action %s keeps the existing from=parent-guide return to the notification view', async (label, destination) => {
    const page = await app('/parent-guide?from=parent')
    await page.findAll('button').find(button => button.text() === label)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(destination)
    // 既有返回优先级不变：显式来源 from=parent-guide > 页面默认
    await page.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    // 返回落在通知视图（无来源参数），再返回回首页
    expect(router.currentRoute.value.query).toEqual({})
    const guide = mount({ render: () => h(RouterView) }, { global: { plugins: [router] } })
    await flushPromises()
    await guide.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })
})

describe('#317 guide destination return chain', () => {
  it.each([
    ['出一套我家的题', '/parent/question-prompt'], ['看看星星兑换', '/redeem'],
  ])('%s returns to the guide from %s', async (label, destination) => {
    const page = await app('/parent-guide')
    await page.findAll('button').find(button => button.text() === label)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(destination)
    await page.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(page.get('h1').text()).toBe(copy.parentGuide.pageTitle)
  })

  it.each([
    ['/parent', '.btn-question-prompt', '/parent/question-prompt'],
    ['/', null, '/redeem'],
  ])('preserves the original %s entry and return', async (origin, selector, destination) => {
    const page = await app(origin!)
    const entry = selector ? page.get(selector) : page.findAll('button').find(button => button.text() === copy.home.redeem)!
    await entry.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(destination)
    expect(router.currentRoute.value.query).toEqual({})
    await page.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(origin)
  })

  it.each(['/parent/question-prompt', '/redeem'])('retains source on a fresh-router load of %s without history', async destination => {
    const page = await app('/parent-guide')
    const label = destination === '/redeem' ? '看看星星兑换' : '出一套我家的题'
    await page.findAll('button').find(button => button.text() === label)!.trigger('click')
    await flushPromises()
    const url = router.currentRoute.value.fullPath
    page.unmount()
    const freshRouter = createRouter({ history: createMemoryHistory(), routes: router.options.routes })
    await freshRouter.push(url)
    await freshRouter.isReady()
    const reloaded = mount({ render: () => h(RouterView) }, { global: { plugins: [freshRouter] } })
    await flushPromises()
    await reloaded.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
    await flushPromises()
    expect(freshRouter.currentRoute.value.path).toBe('/parent-guide')
    expect(reloaded.get('h1').text()).toBe(copy.parentGuide.pageTitle)
  })

  it.each([
    '', '?from=unknown', '?from=https%3A%2F%2Fevil.example', '?from=%2F%2Fevil.example',
    '?from', '?from=parent-guide&from=parent-guide',
  ])('rejects missing or unallowlisted source %s with page-specific defaults', async query => {
    for (const [destination, fallback] of [['/parent/question-prompt', '/parent'], ['/redeem', '/']]) {
      const page = await app(destination + query)
      await page.findAll('button').find(button => button.text() === copy.back)!.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe(fallback)
      page.unmount()
    }
  })
})
