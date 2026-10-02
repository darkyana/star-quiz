/**
 * 检查更新（版本号可点击）单测：构建身份（__BUILD_ID__）比对云端 version.json 的 build 字段，
 * 业务版本号不参与判定；new/latest 确认 = reload，error 确认 = 关弹窗。
 * fetch 经 vi.stubGlobal 打桩（页面 fetch `${BASE_URL}version.json`, cache no-store）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import Home from '../Home.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { copy } from '../../copy'

enableAutoUnmount(afterEach)

async function mountHome() {
  const wrapper = mount(Home, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function versionJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  window.location.hash = '#/'
  router.replace('/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openUpdateCheck(wrapper: Awaited<ReturnType<typeof mountHome>>) {
  await wrapper.get('.version-btn').trigger('click')
  await flushPromises()
}

describe('检查更新（版本号可点击）', () => {
  it('云端 build 与本机构建身份一致 → 「已是最新」+「重新加载」按钮', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => versionJsonResponse({ version: '0.14.0', build: __BUILD_ID__ })))
    const wrapper = await mountHome()
    await openUpdateCheck(wrapper)
    expect(wrapper.get('.star-modal__title').text()).toBe(copy.home.update.title)
    expect(wrapper.get('.star-modal__text').text()).toBe(copy.home.update.latest)
    expect(wrapper.text()).toContain(copy.home.update.reload)
    expect(wrapper.text()).not.toContain(copy.home.update.update)
  })

  it('云端 build 不同（新部署未 bump 业务版本号也判定为新）→ 「发现新版本」+「立即更新」；确认触发 reload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => versionJsonResponse({ version: '0.14.0', build: 'different-build' })))
    const reload = vi.fn()
    const reloadDesc = Object.getOwnPropertyDescriptor(window.location, 'reload')
    Object.defineProperty(window.location, 'reload', { value: reload, configurable: true })
    const wrapper = await mountHome()
    await openUpdateCheck(wrapper)
    expect(wrapper.get('.star-modal__text').text()).toBe(copy.home.update.newVersion('0.14.0'))
    expect(wrapper.text()).toContain(copy.home.update.update)
    // confirm = 主按钮「立即更新」→ reload（绕过 iOS PWA 页面快照强制刷新）
    const confirmBtn = wrapper.findAll('.star-modal__actions .star-button').find((b) => b.text() === copy.home.update.update)
    expect(confirmBtn).toBeDefined()
    await confirmBtn!.trigger('click')
    expect(reload).toHaveBeenCalledTimes(1)
    if (reloadDesc) Object.defineProperty(window.location, 'reload', reloadDesc)
  })

  it('请求失败（离线/非 2xx）→ 错误文案，确认 = 关闭弹窗不 reload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down')
    }))
    const wrapper = await mountHome()
    await openUpdateCheck(wrapper)
    expect(wrapper.get('.star-modal__text').text()).toBe(copy.home.update.error)
    const confirmBtn = wrapper.findAll('.star-modal__actions .star-button').find((b) => b.text() === copy.home.update.dismiss)
    expect(confirmBtn).toBeDefined()
    await confirmBtn!.trigger('click')
    expect(wrapper.find('.star-modal__title').exists()).toBe(false)
  })
})
