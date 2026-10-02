/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
// #253 useGameSession 单元：脱离首页挂载最小宿主（注入 frame / onBlocked / onReplay），锁定
// 阶段迁移、看门狗超时退星、防重放拒绝、非法消息丢弃与消息监听生命周期对称。
// 经济链路走真实 useStarData（同 #226 / #232 验收 seam，不 mock 经济业务），时间 / iframe 是环境输入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { useGameSession } from '../../src/composables/useGameSession'
import { allLedger, balance, writeLedger } from '../../src/composables/useStarData'

type Session = ReturnType<typeof useGameSession>

const REFUND_SOURCE = '《迷你车库》未能开始，星星已退回'
const localTime = (hour: number) => new Date(2026, 8, 15, hour, 0, 0)

let wrapper: VueWrapper
let session: Session
let frame: Ref<HTMLIFrameElement | null>
const onBlocked = vi.fn()
const onReplay = vi.fn()

// 最小宿主：同首页挂载点形状——idle / failed 不渲染 iframe（failed 后 frame 卸载），@error 接模块 failLoad
function mountHost(): void {
  const hostFrame = ref<HTMLIFrameElement | null>(null)
  const Host = defineComponent({
    setup() {
      const game = useGameSession({ frame: hostFrame, onBlocked, onReplay })
      session = game
      return () => game.phase.value === 'idle' || game.phase.value === 'failed'
        ? null
        : h('iframe', { ref: hostFrame, src: '/games/mini-garage-prototype/index.html', onError: game.failLoad })
    },
  })
  wrapper = mount(Host, { attachTo: document.body })
  frame = hostFrame
}

/** 开一局已付费尝试（30 星本金 → 扣 15），刷新渲染让 iframe 挂上 */
async function paidRound(): Promise<void> {
  expect(session.start()).toBe(true)
  await flushPromises()
}

function game(instanceId = 'game-a') {
  const source = frame.value!.contentWindow!
  const sent = vi.spyOn(source, 'postMessage').mockImplementation(() => {})
  const message = (type: string, extra = {}, from: MessageEventSource | null = source, origin = location.origin) => {
    window.dispatchEvent(new MessageEvent('message', { source: from, origin, data: {
      channel: 'mini-garage', version: 1, type, instanceId, requestId: `${instanceId}:1`, roundId: null, ...extra,
    } }))
  }
  return { source, sent, message }
}

beforeEach(() => {
  onBlocked.mockClear()
  onReplay.mockClear()
  localStorage.clear()
  // 仅模拟 iframe 载入边界：保留真实 src 与独立 Window，不发测试服务器网络请求。
  vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLIFrameElement, url: string) {
    this.setAttribute('srcdoc', '')
    this.setAttribute('src', url)
  })
  // 假定时器先于挂载注册：看门狗 timer 全程可控（先 fake 再触发会挂载的动作链）
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(localTime(20))
  writeLedger([{ id: 'earned', type: 'earn', amount: 30, source: '答题得星', timestamp: 1 }])
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('#253 useGameSession 阶段迁移与开局扣星', () => {
  it('开局扣星进 loading；合法 ready 进 playing 并回发 start 授权，ready 后看门狗解除', async () => {
    mountHost()
    expect(session.phase.value).toBe('idle')
    await paidRound()
    expect(balance()).toBe(15)
    expect(allLedger()[1]).toMatchObject({ type: 'redeem', amount: 15, source: '兑换：迷你车库' })
    expect(session.phase.value).toBe('loading')
    expect(wrapper.find('iframe').exists()).toBe(true)
    const current = game()
    current.message('ready')
    expect(current.sent).toHaveBeenCalledTimes(1)
    expect(current.sent.mock.calls[0][0]).toMatchObject({ type: 'start', instanceId: 'game-a', requestId: 'game-a:1' })
    expect(current.sent.mock.calls[0][0].roundId).toEqual(expect.any(String))
    expect(current.sent.mock.calls[0][1]).toBe(location.origin)
    expect(session.phase.value).toBe('playing')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(session.phase.value).toBe('playing')
    expect(balance()).toBe(15)
  })

  it('ended / exit 消息按当前局收敛：ended 后 exit 才回 idle，全程零退回流水', async () => {
    mountHost()
    await paidRound()
    const current = game()
    current.message('ready')
    const roundId = current.sent.mock.calls[0][0].roundId
    current.message('ended', { roundId })
    expect(session.phase.value).toBe('ended')
    current.message('exit', { roundId })
    expect(session.phase.value).toBe('idle')
    expect(allLedger()).toHaveLength(2)
    expect(balance()).toBe(15)
  })

  it('重玩协议：ended 态 replay-request 才触发——exit 收敛 + onReplay 回调页面', async () => {
    mountHost()
    await paidRound()
    const current = game()
    current.message('ready')
    const roundId = current.sent.mock.calls[0][0].roundId
    current.message('replay-request', { requestId: 'game-a:2', roundId })
    expect(session.phase.value).toBe('playing')
    expect(onReplay).not.toHaveBeenCalled()
    current.message('ended', { roundId })
    current.message('replay-request', { requestId: 'game-a:2', roundId })
    expect(session.phase.value).toBe('idle')
    expect(onReplay).toHaveBeenCalledTimes(1)
    expect(balance()).toBe(15)
  })

  it('余额不足开局被拒：零写入、不进 loading，onBlocked 回调页面刷新（#264 时窗删除后唯一门禁）', () => {
    writeLedger([])
    mountHost()
    expect(session.start()).toBe(false)
    expect(balance()).toBe(0)
    expect(allLedger()).toHaveLength(0)
    expect(session.phase.value).toBe('idle')
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('提交中重入拒绝：同一已付费局只扣一次星', async () => {
    mountHost()
    expect(session.start()).toBe(true)
    expect(session.start()).toBe(false)
    expect(balance()).toBe(15)
    expect(allLedger()).toHaveLength(2)
  })

  it('无 randomUUID 环境仍能生成局授权（getRandomValues 兜底）', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      mountHost()
      await paidRound()
      const current = game()
      current.message('ready')
      expect(current.sent.mock.calls[0][0].roundId).toEqual(expect.any(String))
    } finally {
      if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor)
      else Reflect.deleteProperty(crypto, 'randomUUID')
    }
  })
})

describe('#253 useGameSession 看门狗与退星', () => {
  it('30 秒未 ready 超时退星进 failed：等额退回流水、帧卸载、晚到 ready 不再授权', async () => {
    mountHost()
    await paidRound()
    const current = game()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(session.phase.value).toBe('loading')
    await vi.advanceTimersByTimeAsync(1)
    expect(session.phase.value).toBe('failed')
    expect(balance()).toBe(30)
    expect(allLedger()[2]).toMatchObject({ type: 'earn', amount: 15, source: REFUND_SOURCE, kind: 'main', childId: 'default' })
    expect(wrapper.find('iframe').exists()).toBe(false)
    current.message('ready')
    expect(current.sent).not.toHaveBeenCalled()
    expect(allLedger()).toHaveLength(3)
  })

  it('iframe 加载错误接线 failLoad：与超时同口径退星，同次尝试不叠加退回', async () => {
    mountHost()
    await paidRound()
    await wrapper.get('iframe').trigger('error')
    expect(session.phase.value).toBe('failed')
    expect(balance()).toBe(30)
    await vi.advanceTimersByTimeAsync(30_000)
    session.exit()
    expect(allLedger()).toHaveLength(3)
    expect(balance()).toBe(30)
  })

  it('loading 期主动退出全额退星；ready 后退出不退', async () => {
    mountHost()
    await paidRound()
    session.exit()
    expect(session.phase.value).toBe('idle')
    expect(balance()).toBe(30)
    expect(allLedger()[2]).toMatchObject({ type: 'earn', amount: 15, source: REFUND_SOURCE })

    await paidRound()
    const current = game()
    current.message('ready')
    session.exit()
    expect(balance()).toBe(15)
    expect(allLedger()).toHaveLength(4)
  })
})

describe('#253 useGameSession 协议白名单与防重放', () => {
  it('非法消息丢弃：来源 / origin / 字段形状 / 频道版本白名单外零授权，ended 期间不误迁移', async () => {
    mountHost()
    await paidRound()
    const current = game()
    current.message('ready', {}, window)
    current.message('ready', {}, current.source, 'https://foreign.example')
    for (const extra of [{ version: 2 }, { channel: 'other' }, { instanceId: '' }, { requestId: 'other:1' }, { roundId: 'old' }, { score: 99 }]) {
      current.message('ready', extra)
    }
    expect(current.sent).not.toHaveBeenCalled()
    expect(session.phase.value).toBe('loading')

    current.message('ready')
    expect(current.sent).toHaveBeenCalledTimes(1)
    const roundId = current.sent.mock.calls[0][0].roundId
    for (const extra of [{ roundId: 'old' }, { requestId: 'game-a:2' }, { instanceId: 'other' }, { balance: 100 }]) {
      current.message('ended', { roundId, ...extra })
    }
    expect(session.phase.value).toBe('playing')
  })

  it('防重放拒绝：同实例 ready 只消费一次；新局拒绝旧实例在新 WindowProxy 上重放', async () => {
    mountHost()
    await paidRound()
    const first = game()
    first.message('ready')
    first.message('ready')
    expect(first.sent).toHaveBeenCalledTimes(1)

    const roundId = first.sent.mock.calls[0][0].roundId
    first.message('ended', { roundId })
    first.message('replay-request', { requestId: 'game-a:2', roundId })
    expect(session.phase.value).toBe('idle')
    // idle 帧先渲染卸载旧 iframe，付费后再挂新 frame（同真实重玩时序：重开说明经人工确认）
    await flushPromises()
    await paidRound()
    const second = game('game-b')
    expect(second.source).not.toBe(first.source)
    first.message('ready', {}, second.source)
    expect(second.sent).not.toHaveBeenCalled()
    second.message('ready')
    expect(second.sent).toHaveBeenCalledTimes(1)
  })
})

describe('#253 useGameSession 消息监听生命周期对称', () => {
  it('卸载注销监听并清看门狗：晚到消息零副作用、定时器归零', async () => {
    mountHost()
    await paidRound()
    const current = game()
    wrapper.unmount()
    current.message('ready')
    expect(current.sent).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
