/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
// #256 已批准 seam：真实 App 用户操作与游戏消息边界；不 mock 槽位或内部经济逻辑。
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router'
import { allLedger, balance, redeemGame, rewards, writeLedger } from '../../src/composables/useStarData'
import { createLifecycle } from '../../public/games/mini-garage-prototype/lifecycle.js'

let wrapper: VueWrapper
async function home() {
  writeLedger([{ id: 'earned', type: 'earn', amount: 45, source: '答题得星', timestamp: 1 }])
  await router.push('/')
  await router.isReady()
  wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
}
const confirm = () => wrapper.get('.star-modal .star-button--primary').trigger('click')

// 仅桥接浏览器 postMessage 传输，两端使用真实 App 与游戏生命周期实现。
function connectGame(instanceId: string) {
  const frame = wrapper.get<HTMLIFrameElement>('iframe').element
  const source = frame.contentWindow!
  const life = createLifecycle({ embedded: true, instanceId, hostOrigin: location.origin, hostWindow: window,
    send: (data: unknown) => window.dispatchEvent(new MessageEvent('message', { source, origin: location.origin, data })),
  })
  vi.spyOn(source, 'postMessage').mockImplementation(data => {
    life.receive({ source: window, origin: location.origin, data })
  })
  return { frame, life }
}

beforeEach(() => {
  localStorage.clear()
  // #263 游戏入口改挂家长控制开关：本文件覆盖开局/兑换行为，前置开关开（显隐行为见 src 页面单测）
  localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'mini-garage-prototype': true }))
  // 仅替换 iframe 网络载入，仍使用真实 DOM Window 与消息来源校验。
  vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLIFrameElement, url: string) {
    this.setAttribute('srcdoc', '')
    this.setAttribute('src', url)
  })
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(2026, 8, 15, 20)) // 钉住时刻仅去抖动（时间已非门禁）
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('首页唯一游戏位及说明可访问名称是迷你车库，不展示旧游戏入口', async () => {
  await home()
  const entries = wrapper.findAll('button.game-sticker')
  expect(entries).toHaveLength(1)
  expect(entries[0].attributes('aria-label')).toBe('迷你车库')
  expect(wrapper.find('button[aria-label="滑板少年"]').exists()).toBe(false)
  await entries[0].trigger('click')
  expect(wrapper.get('.star-modal').text()).toContain('迷你车库')
  expect(wrapper.get('.star-modal').text()).not.toContain('滑板少年')
})

it('透明图标按钮引用获批小车正式 SVG 包装，不换成场景主图', async () => {
  await home()
  const entry = wrapper.get('button.game-sticker')
  expect(entry.classes()).toContain('star-icon-btn')
  expect(entry.get('img.game-sticker__art').attributes('src')).toBe(`${import.meta.env.BASE_URL}games/mini-garage-prototype/icon.svg`)
  expect(entry.get('img').attributes('aria-hidden')).toBe('true')
})

it('打开取消仅说明配车、转向、装置与冲线，不扣星也不产生兑换项', async () => {
  await home()
  const before = allLedger()
  const catalog = rewards()
  await wrapper.get('button.game-sticker').trigger('click')
  const modal = wrapper.get('.star-modal')
  for (const instruction of ['赛道', '轮胎', '装置', '自动前进', '左右转向', '减速', '冲线结算', '游戏得分不增加答题星星']) {
    expect(modal.text()).toContain(instruction)
  }
  expect(modal.text()).not.toMatch(/三车道|三条命|接星星|滑板/)
  expect(modal.text()).not.toContain('20:00–21:00') // #264 时窗删除：弹窗无窗口文案
  expect(modal.text()).toContain('每局 15 颗星')
  expect(allLedger()).toEqual(before)
  await modal.get('.star-button--standard').trigger('click')
  expect(wrapper.find('.star-modal').exists()).toBe(false)
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(allLedger()).toEqual(before)
  expect(rewards()).toEqual(catalog)
  expect(localStorage.getItem('sq_active_redemptions')).toBeNull()
})

it('人工确认后扣一次15星并加载正式游戏index，不进入演示宿主且历史流水原样保留', async () => {
  await home()
  const historical = { id: 'old-game', type: 'redeem' as const, amount: 15, source: '兑换：滑板少年', timestamp: 2 }
  writeLedger([...allLedger(), historical])
  await wrapper.get('button.game-sticker').trigger('click')
  await Promise.all([confirm(), confirm()])
  expect(balance()).toBe(15)
  expect(allLedger()).toHaveLength(3)
  expect(allLedger()).toContainEqual(historical)
  expect(allLedger()[2]).toMatchObject({ type: 'redeem', amount: 15, source: '兑换：迷你车库' })
  const frame = wrapper.get('iframe')
  expect(frame.attributes('title')).toBe('迷你车库')
  expect(frame.attributes('src')).toBe(`${import.meta.env.BASE_URL}games/mini-garage-prototype/index.html`)
})

it('真实mini-garage协议获宿主授权，结束不奖励，重玩重新确认付费建文档，配车未出发退出也不退款', async () => {
  await home()
  const catalog = rewards()
  await wrapper.get('button.game-sticker').trigger('click')
  await confirm()
  const first = connectGame('garage-first')
  first.life.ready()
  expect(first.life.state.phase).toBe('authorized')
  expect(balance()).toBe(30)
  expect(first.life.activate()).toBe(true)
  expect(first.life.finish()).toBe(true)
  expect(balance()).toBe(30)
  expect(allLedger()).toHaveLength(2)
  expect(rewards()).toEqual(catalog)
  expect(localStorage.getItem('sq_active_redemptions')).toBeNull()
  const firstRound = first.life.state.roundId
  expect(first.life.replay()).toBe(true)
  await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(wrapper.get('.star-modal').text()).toContain('迷你车库')
  expect(balance()).toBe(30)
  expect(first.life.activate()).toBe(false)
  await confirm()
  const second = connectGame('garage-second')
  expect(second.frame).not.toBe(first.frame)
  expect(second.frame.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}games/mini-garage-prototype/index.html`)
  second.life.ready()
  expect(second.life.state.phase).toBe('authorized')
  expect(second.life.state.roundId).not.toBe(firstRound)
  expect(balance()).toBe(15)
  // ready/start 已完成，但尚未 activate（对应配车、未触摸出发）。
  second.life.exit()
  await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
  expect(balance()).toBe(15)
  expect(allLedger()).toHaveLength(3)
})

it('即时消费仅接受新槽位id，旧滑板标识不再可信且协议频道不是消费id', async () => {
  await home()
  expect(redeemGame('skate-boy')).toEqual({ ok: false, reason: 'game_not_found' })
  expect(redeemGame('mini-garage')).toEqual({ ok: false, reason: 'game_not_found' })
  expect(balance()).toBe(45)
  expect(redeemGame('mini-garage-prototype')).toEqual({ ok: true })
  expect(balance()).toBe(30)
  expect(allLedger()[1]).toMatchObject({ source: '兑换：迷你车库', amount: 15 })
})
