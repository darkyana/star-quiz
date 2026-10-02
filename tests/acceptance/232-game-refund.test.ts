/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
// #232 开局未就绪自动退款验收：以「本次尝试是否收到过 ready」为唯一判定——
// 未收到 ready（加载超时 / iframe 加载错误 / loading 期主动退出）追加等额 earn 退回流水，余额恢复开局前；
// ready 之后（playing / ended）退出不退；同次失败尝试恰好一退；正常全流程零退回流水；退款写失败有提示。
// 已批准 seam（同 #226 验收）：真实首页 + 路由 + 本地经济数据，时间 / iframe 是环境输入，不 mock 经济业务。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router'
import { allLedger, balance, writeLedger } from '../../src/composables/useStarData'

const REFUND_SOURCE = '《迷你车库》未能开始，星星已退回'
const refundEntries = () => allLedger().filter(e => e.type === 'earn' && e.source === REFUND_SOURCE)

let wrapper: VueWrapper
const localTime = (hour: number, minute = 0, second = 0) => new Date(2026, 8, 15, hour, minute, second)
async function home(amount = 30) {
  writeLedger([{ id: 'earned', type: 'earn', amount, source: '答题得星', timestamp: 1 }])
  await router.push('/')
  await router.isReady()
  wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
}
function game(instanceId = 'game-a') {
  const frame = wrapper.get<HTMLIFrameElement>('iframe').element
  const source = frame.contentWindow!
  const sent = vi.spyOn(source, 'postMessage').mockImplementation(() => {})
  const message = (type: string, extra = {}, from: MessageEventSource | null = source, origin = location.origin) => {
    window.dispatchEvent(new MessageEvent('message', { source: from, origin, data: {
      channel: 'mini-garage', version: 1, type, instanceId, requestId: `${instanceId}:1`, roundId: null, ...extra,
    } }))
  }
  return { frame, source, sent, message }
}
const start = () => wrapper.get('.star-modal .star-button--primary')
// #258 游戏会话全屏化：loading/failed 走空态块内小号「退出」钮，running 态走右上角 X 图标钮（.game-exit）——
// 退出路径与退星口径不变，仅宿主按钮形态按阶段二分
const exitButton = () => wrapper.get('.game-session .star-button--standard, .game-session .game-exit')
async function open() {
  // #266 起无超能力开关、#264 起无时窗：入口常驻可见，直接点开说明弹窗。
  await wrapper.get('button[aria-label="迷你车库"]').trigger('click')
}
/** 开局一次已付费尝试（30 星本金 → 扣 15）：返回该局的 frame 握手工具 */
async function paidAttempt() {
  vi.setSystemTime(localTime(20))
  await home(30)
  await open(); await start().trigger('click')
  return game()
}

beforeEach(() => {
  localStorage.clear()
  // #263 游戏入口改挂家长控制开关：本文件覆盖开局/兑换行为，前置开关开（显隐行为见 src 页面单测）
  localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'mini-garage-prototype': true }))
  // 仅模拟 iframe 载入边界：保留真实 src 与独立 Window，不发测试服务器网络请求。
  vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLIFrameElement, url: string) {
    this.setAttribute('srcdoc', '')
    this.setAttribute('src', url)
  })
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(localTime(20)) // 钉住时刻仅去抖动（时间已非门禁）
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('#232 开局未就绪自动退款', () => {
  it.each(['timeout', 'error'])('未收到 ready 进入 failed（%s）：追加等额退回流水、余额恢复开局前、晚到 ready 不再授权', async (failure) => {
    const current = await paidAttempt()
    expect(balance()).toBe(15)
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30000)
    else await wrapper.get('iframe').trigger('error')
    expect(wrapper.text()).toContain('游戏未能加载，星星已退回')
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(allLedger()[2]).toMatchObject({ type: 'earn', amount: 15, source: REFUND_SOURCE, kind: 'main', childId: 'default' })
    expect(balance()).toBe(30)
    current.message('ready')
    expect(current.sent).not.toHaveBeenCalled()
    expect(allLedger()).toHaveLength(3)
  })

  it('loading 期主动退出退星；ready 后 playing / ended 退出均不退', async () => {
    await paidAttempt()
    expect(wrapper.text()).toContain('游戏加载中，未能开始会自动退回星星')
    await exitButton().trigger('click')
    expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
    expect(balance()).toBe(30)
    expect(allLedger()[2]).toMatchObject({ type: 'earn', amount: 15, source: REFUND_SOURCE })

    await open(); await start().trigger('click')
    const playing = game()
    playing.message('ready')
    expect(playing.sent).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }), location.origin)
    await exitButton().trigger('click')
    expect(balance()).toBe(15)
    expect(allLedger()).toHaveLength(4)

    await open(); await start().trigger('click')
    const ended = game('game-b')
    ended.message('ready')
    const roundId = ended.sent.mock.calls[0][0].roundId
    ended.message('ended', { roundId })
    ended.message('exit', { roundId })
    await flushPromises()
    expect(balance()).toBe(0)
    expect(refundEntries()).toHaveLength(1)
  })

  it('正常全流程（扣费→就绪→游玩→结束→重玩→再退出）零退回流水，余额变化仅是扣费', async () => {
    vi.setSystemTime(localTime(20))
    await home(45)
    await open(); await start().trigger('click')
    const first = game()
    first.message('ready')
    const roundId = first.sent.mock.calls[0][0].roundId
    first.message('ended', { roundId })
    first.message('replay-request', { requestId: 'game-a:2', roundId })
    await flushPromises()
    expect(wrapper.get('.star-modal').exists()).toBe(true)
    await start().trigger('click')
    const second = game('game-b')
    second.message('ready')
    const nextRound = second.sent.mock.calls[0][0].roundId
    second.message('exit', { roundId: nextRound })
    await flushPromises()
    expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
    expect(refundEntries()).toHaveLength(0)
    expect(allLedger()).toHaveLength(3)
    expect(balance()).toBe(15)
  })

  it('同一失败尝试恰好退一次：error 后看门狗到期、failed 态退出均不叠加退回', async () => {
    await paidAttempt()
    await wrapper.get('iframe').trigger('error')
    await vi.advanceTimersByTimeAsync(30000)
    await exitButton().trigger('click')
    expect(refundEntries()).toHaveLength(1)
    expect(allLedger()).toHaveLength(3)
    expect(balance()).toBe(30)
  })

  it('退款写账失败不静默：failed 提示照常、toast 提示检查本地存储、账本保持扣费后', async () => {
    await paidAttempt()
    const setItem = localStorage.setItem.bind(localStorage)
    const fail = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'sq_stars') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      setItem(key, value)
    })
    await vi.advanceTimersByTimeAsync(30000)
    fail.mockRestore()
    expect(wrapper.text()).toContain('游戏未能加载')
    expect(allLedger()).toHaveLength(2)
    expect(balance()).toBe(15)
    expect(wrapper.get('.toast').text()).toBe('星星未能退回，请检查本地存储。')
  })
})
