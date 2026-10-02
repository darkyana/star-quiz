import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import Home from '../Home.vue'
import ParentGuide from '../ParentGuide.vue'
import { router } from '../../router'
import { init } from '../../composables/useDataInfra'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { writeEntryVisibilityValue } from '../../composables/useEntryVisibility'
import { GAME_SLOT } from '../../data/playable-games'
import { copy } from '../../copy'

enableAutoUnmount(afterEach)
beforeEach(async () => {
  localStorage.clear()
  init()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
  await router.replace('/')
})
afterEach(() => vi.unstubAllGlobals())

async function guide() {
  await router.push('/parent-guide')
  const wrapper = mount(ParentGuide, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('#308 / #309 parent discovery', () => {
  it('unpaired home shows the approved sticker; clicking opens the real guide route without pairing', async () => {
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    const sticker = home.get('button[aria-label="家长请看"]')
    expect(sticker.text()).toBe(copy.parentGuide.sticker)
    expect(sticker.get('img').attributes('src')).toContain('megaphone.svg')
    expect(home.get('.app-footer').text()).not.toContain('毛线没有接住')
    await sticker.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(router.currentRoute.value.matched[0].components?.default).toBe(ParentGuide)
  })

  // #322 角色矩阵（修订 #316「入口对所有设备可见」口径，spec #319 故事 39）：孩子设备（已入队）不显示
  // 通知角标是设计决定而非回归 bug，勿修回；未配对 / 待批准（unjoined）/ 家长设备照常显示（前提 = 存在未读）。
  it.each(['parent', 'child'] as const)('paired %s with pending approval (unjoined) retains the parent-guide sticker while unread notifications exist', async role => {
    writeDeviceCredential({ device_id: 'device', secret: 'secret', role, name: 'device' }, 'pending')
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(home.find('button[aria-label="家长请看"]').exists()).toBe(true)
  })

  it('#322 joined child device hides the sticker (explicit revision of #316 all-devices stance) while parent/pending devices keep it', async () => {
    writeDeviceCredential({ device_id: 'device', secret: 'secret', role: 'child', name: 'device' }, 'active')
    const childHome = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(childHome.find('button[aria-label="家长请看"]').exists()).toBe(false)
    childHome.unmount()
    writeDeviceCredential({ device_id: 'device', secret: 'secret', role: 'parent', name: 'device' }, 'active')
    const parentHome = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(parentHome.find('button[aria-label="家长请看"]').exists()).toBe(true)
  })

  it('pairing while home is mounted preserves the sticker without affecting quiz or redeem actions', async () => {
    const home = mount(Home, { global: { plugins: [router] } })
    expect(home.find('.parent-sticker').exists()).toBe(true)
    writeDeviceCredential({ device_id: 'device', secret: 'secret', role: 'parent', name: 'device' })
    await flushPromises()
    expect(home.find('.parent-sticker').exists()).toBe(true)
    expect(home.findAll('button').map(button => button.text())).toEqual(expect.arrayContaining([copy.home.startQuiz, copy.home.redeem]))
  })

  it('existing enabled stickers show their approved captions, independent of the parent sticker', async () => {
    writeEntryVisibilityValue(GAME_SLOT.id, true)
    writeEntryVisibilityValue('builtin-trivia', true)
    const home = mount(Home, { global: { plugins: [router] } })
    expect(home.get('.game-sticker').text()).toBe(GAME_SLOT.name)
    expect(home.get('.trivia-sticker').text()).toBe('惊喜问答')
    expect(home.get('.parent-sticker').text()).toBe('家长请看')
    writeEntryVisibilityValue(GAME_SLOT.id, false)
    await flushPromises()
    expect(home.find('.game-sticker').exists()).toBe(false)
    expect(home.find('.parent-sticker').exists()).toBe(true)
  })

  it('renders the approved four-step journey and three content cards, including the local-first note and contact', async () => {
    const page = await guide()
    expect(page.get('h1').text()).toBe('给家长的话')
    expect(page.get('ol').findAll('li').map(li => li.text())).toEqual(['认真答题', '赢下星星', '兑换奖励', '商量提议'])
    expect(page.findAll('section h2').map(h => h.text())).toEqual(['示范题有点难？', '星星攒着做什么？', '家长还能做什么？'])
    for (const text of [copy.parentGuide.questionsBody, copy.parentGuide.tryNote, copy.parentGuide.rewardsBody, ...copy.parentGuide.parentItems, copy.parentGuide.help]) {
      expect(page.text()).toContain(text)
    }
    expect(page.find('[role="dialog"]').exists()).toBe(false)
    // #321 通知视图：每条未读通知 = 功能入口按钮 + 「知道了」确认按钮（dismiss 与弹窗确认共用同一文案）
    expect(page.findAll('button').map(button => button.text())).toEqual([
      copy.back, '出一套我家的题', copy.parentGuide.dismiss, '看看星星兑换', copy.parentGuide.dismiss, '创建我们的家', copy.parentGuide.dismiss,
    ])
    // Informational content does not expose a superpower operation or a #310 statistics control.
    expect(page.findAll('button').some(button => /超能力奖励|数据统计说明/.test(button.text()))).toBe(false)
  })

  it.each([
    ['出一套我家的题', '/parent/question-prompt'],
    ['看看星星兑换', '/redeem'],
    [copy.back, '/'],
  ])('%s navigates to %s without requiring a family', async (label, path) => {
    const page = await guide()
    await page.findAll('button').find(button => button.text() === label)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(path)
  })

  it('create-family only opens the shared beta notice; dismiss returns focus and never navigates to pairing', async () => {
    const page = await guide()
    const create = page.findAll('button').find(button => button.text() === '创建我们的家')!
    create.element.focus()
    await create.trigger('click')
    await flushPromises()
    const modal = page.get('[role="dialog"]')
    expect(modal.text()).toContain(copy.parentGuide.betaMessage)
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    expect(document.activeElement).toBe(modal.get('button').element)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(modal.get('button').element)
    await modal.get('button').trigger('click')
    await flushPromises()
    expect(page.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(create.element)
    expect(router.currentRoute.value.path).toBe('/parent-guide')
    await create.trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(page.find('[role="dialog"]').exists()).toBe(false)
  })
})
