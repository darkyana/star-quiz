/** @vitest-environment happy-dom */
// 小工具为构建环境边界；真实 App / 首页 / 超能力状态，不 mock 内部协作模块。
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
vi.hoisted(() => { vi.stubEnv('VITE_MINITOOL', '1') })
import App from '../../src/App.vue'
import router from '../../src/router'
let wrapper: VueWrapper

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllEnvs()
})

it('小工具构建不展示迷你车库入口或游戏frame（#266 后小工具恒禁游戏入口，与任何开关/时窗无关）', async () => {
  localStorage.clear()
  await router.push('/')
  await router.isReady()
  wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
  expect(wrapper.find('button.game-sticker').exists()).toBe(false)
  expect(wrapper.find('button[aria-label="迷你车库"]').exists()).toBe(false)
  expect(wrapper.find('iframe').exists()).toBe(false)
})
