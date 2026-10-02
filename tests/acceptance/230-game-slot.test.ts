/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
// #230 配置驱动验证：把槽位配置整体替换为另一个游戏后，宿主按新配置加载与校验
// （id / name / price / path / channel / icon），证明引用方读配置而非硬编码滑板。
// #264 时窗删除 + #266 无超能力开关：配置不再含时窗字段，入口无任何时钟/开关门禁。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router'
import { allLedger, balance, redeemGame, writeLedger } from '../../src/composables/useStarData'

const ALT_SLOT = vi.hoisted(() => ({
  id: 'maze-runner',
  name: '迷宫快跑',
  price: 9,
  path: 'games/maze-runner/index.html',
  channel: 'maze-runner',
  icon: 'games/maze-runner/icon.svg',
  instructions: '测试玩法说明。',
}))
vi.mock('../../src/data/playable-games', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data/playable-games')>()
  return { ...actual, GAME_SLOT: ALT_SLOT }
})

// 已批准 seam（同 #226 验收）：真实首页 + 路由 + 本地经济数据，iframe 是环境输入，不 mock 经济业务。
let wrapper: VueWrapper
async function home(amount = 9) {
  writeLedger([{ id: 'earned', type: 'earn', amount, source: '答题得星', timestamp: 1 }])
  await router.push('/')
  await router.isReady()
  wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  // #263 游戏入口改挂家长控制开关：本文件覆盖开局/兑换行为，前置开关开（显隐行为见 src 页面单测）
  localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'maze-runner': true }))
  // 仅模拟 iframe 载入边界：保留真实 src 与独立 Window，不发测试服务器网络请求。
  vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLIFrameElement, url: string) {
    this.setAttribute('srcdoc', '')
    this.setAttribute('src', url)
  })
  // 时间不再是门禁输入（#264 时窗删除），仅 setTimeout（看门狗/toast 计时）需要确定性
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('#230 游戏槽位配置驱动', () => {
  it('即时兑换按新配置校验 id 并按新价格扣费，旧游戏 id 不再可信', () => {
    writeLedger([{ id: 'earned', type: 'earn', amount: 9, source: '答题得星', timestamp: 1 }])
    expect(redeemGame('mini-garage-prototype')).toEqual({ ok: false, reason: 'game_not_found' })
    expect(redeemGame('maze-runner')).toEqual({ ok: true })
    expect(balance()).toBe(0)
    expect(allLedger()[1]).toMatchObject({ type: 'redeem', amount: 9, source: '兑换：迷宫快跑' })
    expect(redeemGame('maze-runner')).toEqual({ ok: false, reason: 'insufficient_balance' })
  })

  it('贴纸入口与说明弹窗按新配置渲染：名称 / 图标路径 / 玩法 / 价格', async () => {
    await home()
    const sticker = wrapper.get('button[aria-label="迷宫快跑"]')
    expect(sticker.get('img.game-sticker__art').attributes('src')).toBe(`${import.meta.env.BASE_URL}games/maze-runner/icon.svg`)
    await sticker.trigger('click')
    const modal = wrapper.get('.star-modal')
    expect(modal.text()).toContain('迷宫快跑')
    expect(modal.text()).toContain('测试玩法说明')
    expect(modal.text()).toContain('每局 9 颗星')
    expect(wrapper.text()).not.toContain('迷你车库')
    await modal.get('.star-button--standard').trigger('click')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
  })

  it('开始游戏后 iframe 按新配置 path 加载、toast 按新名称反馈，握手按新 channel 校验', async () => {
    await home()
    await wrapper.get('button[aria-label="迷宫快跑"]').trigger('click')
    await wrapper.get('.star-modal .star-button--primary').trigger('click')
    expect(wrapper.text()).toContain('已兑换并使用《迷宫快跑》一次机会')
    const frame = wrapper.get<HTMLIFrameElement>('iframe')
    expect(frame.attributes('src')).toBe(`${import.meta.env.BASE_URL}games/maze-runner/index.html`)
    const sent = vi.spyOn(frame.element.contentWindow!, 'postMessage').mockImplementation(() => {})
    const ready = { channel: 'maze-runner', version: 1, type: 'ready', instanceId: 'alt-a', requestId: 'alt-a:1', roundId: null }
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.element.contentWindow, data: { ...ready, channel: 'mini-garage' } }))
    await flushPromises()
    expect(sent).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.element.contentWindow, data: ready }))
    await flushPromises()
    expect(sent).toHaveBeenCalledWith({ ...ready, type: 'start', roundId: expect.any(String) }, location.origin)
  })
})
