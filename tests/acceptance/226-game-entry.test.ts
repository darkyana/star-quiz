/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router'
import { registerWriteListener } from '../../src/composables/useDataInfra'
import { writeEntryVisibilityValue } from '../../src/composables/useEntryVisibility'
import { GAME_SLOT } from '../../src/data/playable-games'
import { allLedger, balance, redeemGame, rewards, writeLedger } from '../../src/composables/useStarData'

// 已批准 seam：真实首页 + 路由 + 本地经济数据，时间/iframe 是环境输入，不 mock 经济业务。
let wrapper: VueWrapper
const localTime = (hour: number, minute = 0, second = 0) => new Date(2026, 8, 15, hour, minute, second)
async function home(amount = 15) {
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
async function open() {
  // 入口渲染是因为本文件 beforeEach 预设了 sq_entry_visibility['mini-garage-prototype']=true（#263 起未设置 = 默认隐藏）；直接点开说明弹窗。
  await wrapper.get('button[aria-label="迷你车库"]').trigger('click')
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
  // 时间不再是门禁输入（#264 时窗删除），仅 setTimeout（看门狗/toast 计时）需要确定性
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('#226 首页即时游玩兑换', () => {
  it('#266 无超能力开关后入口按预设显隐渲染（beforeEach 预设开关开；#263 起未设置 = 默认隐藏）', async () => {
    await home()
    const entry = () => wrapper.find('button[aria-label="迷你车库"]')
    expect(entry().exists()).toBe(true)
    await entry().trigger('click')
    expect(wrapper.get('.star-modal').text()).toContain('迷你车库')
    await wrapper.get('.star-modal .star-button--standard').trigger('click')
    expect(entry().exists()).toBe(true)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(balance()).toBe(15)
  })

  it('#264 时窗删除：星够任意本地时间正常扣星并授权游戏，关闭弹窗不打断已付费局', async () => {
    await home()
    await open()
    expect(start().attributes('disabled')).toBeUndefined()
    await start().trigger('click')
    expect(balance()).toBe(0)
    expect(allLedger()).toHaveLength(2)
    expect(allLedger()[1]).toMatchObject({ type: 'redeem', amount: 15, source: '兑换：迷你车库' })
    const current = game()
    current.message('ready')
    expect(current.sent).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }), location.origin)
  })

  it('#264 时窗删除：余额不足仍禁用且不扣星、不加载游戏', async () => {
    await home(14)
    await open()
    expect(start().attributes('disabled')).toBeDefined()
    expect(wrapper.get('.star-modal').text()).toContain('星星不足')
    await start().trigger('click')
    expect(balance()).toBe(14)
    expect(allLedger()).toHaveLength(1)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('#263 关闭游戏入口：已打开的说明弹窗即时关闭（开关拨关经写监听落回）', async () => {
    await home()
    await open()
    expect(wrapper.find('.star-modal').exists()).toBe(true)
    writeEntryVisibilityValue(GAME_SLOT.id, false)
    await flushPromises()
    expect(wrapper.find('.star-modal').exists()).toBe(false)
  })

  it('#263 关闭游戏入口后孩子无法新开局：入口隐藏时开局被拒、零扣星', async () => {
    await home()
    await open()
    // 写监听同步更新 gameEntryShown，watch 关弹窗在 nextTick——窗口期内点「开始」也被 startGame 门禁拒绝
    writeEntryVisibilityValue(GAME_SLOT.id, false)
    await start().trigger('click')
    expect(balance()).toBe(15)
    expect(allLedger()).toHaveLength(1)
    await flushPromises()
    // 弹窗随后被关闭（入口隐藏的连带效果），开局入口无从触达，也无 iframe 挂载
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('#264 时窗删除：redeemGame 星够任意时刻成功，仍不绕过游戏标识和余额校验', async () => {
    await home()
    expect(redeemGame('unknown')).toEqual({ ok: false, reason: 'game_not_found' })
    expect(balance()).toBe(15)
    expect(redeemGame('mini-garage-prototype')).toEqual({ ok: true })
    expect(balance()).toBe(0)
    expect(redeemGame('mini-garage-prototype')).toEqual({ ok: false, reason: 'insufficient_balance' })
    expect(allLedger()).toHaveLength(2)
  })

  it('20:00余额恰好15：人工开始同步扣一次，只有新frame ready后才授权真实游戏', async () => {
    await home()
    const catalog = rewards()
    await open()
    expect(start().attributes('disabled')).toBeUndefined()
    const button = start()
    await Promise.all([button.trigger('click'), button.trigger('click')])
    expect(balance()).toBe(0)
    expect(allLedger()).toHaveLength(2)
    expect(allLedger()[1]).toMatchObject({ type: 'redeem', amount: 15, source: '兑换：迷你车库', kind: 'main', childId: 'default' })
    expect(wrapper.text()).toContain('已兑换并使用《迷你车库》一次机会')
    expect(rewards()).toEqual(catalog)
    expect(localStorage.getItem('sq_active_redemptions')).toBeNull()
    const frame = wrapper.get<HTMLIFrameElement>('iframe')
    expect(frame.attributes('src')).toBe(`${import.meta.env.BASE_URL}games/mini-garage-prototype/index.html`)
    const post = vi.spyOn(frame.element.contentWindow!, 'postMessage').mockImplementation(() => {})
    expect(post).not.toHaveBeenCalled()
    const ready = { channel: 'mini-garage', version: 1, type: 'ready', instanceId: 'game-a', requestId: 'game-a:1', roundId: null }
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.element.contentWindow, data: ready }))
    await flushPromises()
    expect(post).toHaveBeenCalledWith({ ...ready, type: 'start', roundId: expect.any(String) }, location.origin)
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.element.contentWindow, data: ready }))
    expect(post).toHaveBeenCalledTimes(1)
    expect(balance()).toBe(0)
  })

  it('结束零扣费，重玩仅回说明；第二次人工确认才扣星并以新frame/new round授权', async () => {
    await home(45)
    await open(); await start().trigger('click')
    const first = game()
    first.message('ready')
    const roundId = first.sent.mock.calls[0][0].roundId
    first.message('ended', { roundId })
    await flushPromises()
    expect(balance()).toBe(30)
    first.message('replay-request', { requestId: 'game-a:2', roundId })
    first.message('replay-request', { requestId: 'game-a:2', roundId })
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.star-modal').exists()).toBe(true)
    expect(balance()).toBe(30)
    await start().trigger('click')
    expect(balance()).toBe(15)
    const second = game('game-b')
    expect(second.frame).not.toBe(first.frame)
    first.message('ready')
    first.message('exit', { roundId })
    expect(second.sent).not.toHaveBeenCalled()
    second.message('ready')
    const next = second.sent.mock.calls[0][0]
    expect(next.roundId).not.toBe(roundId)
    expect(next.requestId).toBe('game-b:1')
    second.message('exit', { roundId: next.roundId })
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
    expect(allLedger()).toHaveLength(3)
    expect(balance()).toBe(15)
  })

  it('#264 时窗删除：说明弹窗打开跨时间推移按钮不再过期，只随余额变化', async () => {
    await home()
    await open()
    expect(start().attributes('disabled')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3599000)
    expect(start().attributes('disabled')).toBeUndefined()
    writeLedger([])
    await flushPromises()
    expect(start().attributes('disabled')).toBeDefined()
    await start().trigger('click')
    expect(balance()).toBe(0)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('本地写广播即时刷新余额与不足原因，不依赖远端ACK；恰好够即可开始', async () => {
    await home(14)
    await open()
    expect(start().attributes('disabled')).toBeDefined()
    expect(wrapper.get('.star-modal').text()).toContain('星星不足')
    writeLedger([{ id: 'new-earned', type: 'earn', amount: 15, source: '答题得星', timestamp: 2 }])
    await flushPromises()
    expect(wrapper.get('.star-value').text()).toBe('15')
    expect(start().attributes('disabled')).toBeUndefined()
    writeLedger([])
    await flushPromises()
    expect(start().attributes('disabled')).toBeDefined()
    expect(wrapper.get('.star-value').text()).toBe('0')
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('回前台/focus与跨标签页存储事件重读余额（#264：与时间无关），卸载清理监听', async () => {
    localStorage.setItem('sq_stars', '[]')
    await home()
    await open()
    localStorage.setItem('sq_stars', JSON.stringify([{ id: 'earned', type: 'earn', amount: 15, source: '答题得星', timestamp: 1 }]))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(start().attributes('disabled')).toBeUndefined()
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(start().attributes('disabled')).toBeUndefined()
    localStorage.setItem('sq_stars', '[]')
    window.dispatchEvent(new StorageEvent('storage', { key: 'sq_stars' }))
    await flushPromises()
    expect(wrapper.get('.star-value').text()).toBe('0')
    expect(wrapper.get('.star-modal').text()).toContain('星星不足')
    wrapper.unmount()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    writeLedger([])
    expect(wrapper.get('.star-value').text()).toBe('0')
  })

  it('无法生成局授权时零扣费，不能先扣费再把局ID错误误报成可重试的兑换失败', async () => {
    await home(30)
    await open()
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('entropy unavailable') })
    await start().trigger('click')
    expect(balance()).toBe(30)
    expect(allLedger()).toHaveLength(1)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('游戏没有开始')
  })

  it.each(['error', 'timeout'])('已付费后加载失败（%s）自动退星、不接受晚到ready，退出返回首页', async (failure) => {
    await home(30)
    await open(); await start().trigger('click')
    const current = game()
    if (failure === 'error') await wrapper.get('iframe').trigger('error')
    else await vi.advanceTimersByTimeAsync(30000)
    expect(wrapper.text()).toContain('游戏未能加载')
    expect(wrapper.text()).toContain('星星已退回')
    expect(wrapper.find('iframe').exists()).toBe(false)
    current.message('ready')
    expect(current.sent).not.toHaveBeenCalled()
    expect(balance()).toBe(30)
    expect(allLedger()[2]).toMatchObject({ type: 'earn', amount: 15, source: '《迷你车库》未能开始，星星已退回' })
    await wrapper.get('.game-session .star-button--standard').trigger('click')
    expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
    expect(balance()).toBe(30)
    expect(allLedger()).toHaveLength(3)
  })

  it('只接受六字段合法来源/实例/请求/当前局状态；旧局即便伪装当前WindowProxy也不能结束或免费重玩', async () => {
    await home(45)
    await open(); await start().trigger('click')
    const first = game()
    first.message('ready', {}, window)
    first.message('ready', {}, first.source, 'https://foreign.example')
    for (const extra of [{ version: 2 }, { channel: 'other' }, { instanceId: '' }, { requestId: 'other:1' }, { roundId: 'old' }, { score: 99 }]) {
      first.message('ready', extra)
    }
    expect(first.sent).not.toHaveBeenCalled()
    first.message('ready')
    const roundId = first.sent.mock.calls[0][0].roundId
    first.message('replay-request', { requestId: 'game-a:2', roundId })
    first.message('ended', { roundId: 'old' })
    first.message('ended', { roundId, requestId: 'game-a:2' })
    first.message('ended', { roundId, instanceId: 'other' })
    first.message('ended', { roundId, balance: 100 })
    first.message('replay-request', { roundId, requestId: 'game-a:2' })
    await flushPromises()
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    first.message('ended', { roundId })
    first.message('replay-request', { roundId, requestId: 'game-a:2' })
    await flushPromises()
    await start().trigger('click')
    const second = game('game-b')
    // 新frame拒绝已使用实例ready，防止旧局数据在相同WindowProxy上被错绑。
    first.message('ready', {}, second.source)
    expect(second.sent).not.toHaveBeenCalled()
    second.message('ready')
    const nextRound = second.sent.mock.calls[0][0].roundId
    for (const extra of [{ instanceId: 'game-a' }, { requestId: 'game-b:2' }, { roundId }, { price: 0 }]) {
      second.message('ended', { roundId: nextRound, ...extra })
      second.message('exit', { roundId: nextRound, ...extra })
    }
    second.message('replay-request', { roundId: nextRound, requestId: 'game-b:2' })
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(balance()).toBe(15)
    expect(second.sent).toHaveBeenCalledTimes(1)
  })

  it('同步本地写监听抛错但流水已落盘时仍是已付费局，不误报失败或允许重复扣费', async () => {
    await home(30)
    await open()
    const stop = registerWriteListener(key => {
      if (key === 'sq_stars') throw new Error('display listener failed after persistence')
    })
    try {
      const button = start()
      await Promise.all([button.trigger('click'), button.trigger('click')])
      expect(balance()).toBe(15)
      expect(allLedger()).toHaveLength(2)
      expect(wrapper.find('.star-modal').exists()).toBe(false)
      expect(wrapper.find('iframe').exists()).toBe(true)
      expect(wrapper.text()).toContain('已兑换并使用《迷你车库》一次机会')
      const current = game()
      current.message('ready')
      expect(current.sent).toHaveBeenCalledTimes(1)
    } finally { stop() }
  })

  it('#264 付费后时间推移 ready 仍授权（无窗口概念，推进 1 秒不触看门狗），触摸/得分/结束不改账，重玩只能看说明需再次付费', async () => {
    await home(30)
    await open(); await start().trigger('click')
    const current = game()
    await vi.advanceTimersByTimeAsync(1000)
    current.message('ready')
    const roundId = current.sent.mock.calls[0][0].roundId
    // iframe 内真实触摸仅激活已授权局；这里以生命周期环境输入验证宿主不再次计费。
    current.message('score', { roundId, score: 999 })
    current.message('start', { roundId })
    current.message('ended', { roundId })
    current.message('ended', { roundId })
    expect(balance()).toBe(15)
    current.message('replay-request', { roundId, requestId: 'game-a:2' })
    await flushPromises()
    expect(start().attributes('disabled')).toBeUndefined()
    await start().trigger('click')
    expect(balance()).toBe(0)
    // 重玩付费后开新 frame（旧局 WindowProxy 不复用，旧授权不再被消费）
    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(current.sent).toHaveBeenCalledTimes(1)
  })

  it('提交重新校验真实余额，不相信尚未刷新的可用按钮，失败零写入（#264：余额是唯一门禁）', async () => {
    await home()
    await open()
    expect(start().attributes('disabled')).toBeUndefined()
    localStorage.setItem('sq_stars', '[]') // 跨标签页写入尚未通知宿主
    const before = localStorage.getItem('sq_stars')
    await start().trigger('click')
    expect(localStorage.getItem('sq_stars')).toBe(before)
    expect(start().attributes('disabled')).toBeDefined()
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('本地持久化未成功绝不创建frame或授权，解除故障后一次人工确认才付费', async () => {
    await home()
    await open()
    const setItem = localStorage.setItem.bind(localStorage)
    const fail = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'sq_stars') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      setItem(key, value)
    })
    await start().trigger('click')
    expect(balance()).toBe(15)
    expect(allLedger()).toHaveLength(1)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('游戏没有开始')
    fail.mockRestore()
    await start().trigger('click')
    expect(balance()).toBe(0)
    expect(wrapper.find('iframe').exists()).toBe(true)
  })

  it('即时消费保留其他孩子原流水，不制造游戏券库存', async () => {
    await home()
    const otherChild = { id: 'sibling', type: 'earn' as const, amount: 100, source: '答题得星', timestamp: 2, childId: 'sibling', kind: 'main' as const }
    writeLedger([...allLedger(), otherChild])
    await open(); await start().trigger('click')
    expect(balance()).toBe(0)
    expect(allLedger()).toHaveLength(3)
    expect(allLedger()).toContainEqual(otherChild)
    await wrapper.get('.game-session .star-button--standard').trigger('click')
    // loading 期退出按 #232 自动退回：退回流水只落默认孩子，他孩原流水原样保留
    expect(balance()).toBe(15)
    expect(allLedger()).toHaveLength(4)
    expect(allLedger()).toContainEqual(otherChild)
    expect(wrapper.get('.star-value').text()).toBe('15')
    expect(localStorage.getItem('sq_active_redemptions')).toBeNull()
  })

  it('快速重玩第二次付款也重新显示完整成功反馈，而不是继承上一条toast倒计时', async () => {
    await home(30)
    await open(); await start().trigger('click')
    const current = game()
    current.message('ready')
    const roundId = current.sent.mock.calls[0][0].roundId
    await vi.advanceTimersByTimeAsync(2000)
    current.message('ended', { roundId })
    current.message('replay-request', { roundId, requestId: 'game-a:2' })
    await flushPromises()
    await start().trigger('click')
    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.get('.toast').text()).toBe('已兑换并使用《迷你车库》一次机会')
  })

  it('贴纸可点，打开和取消只展示玩法/价格，不创建游戏或经济记录', async () => {
    await home()
    const before = allLedger()
    const catalog = rewards()
    const sticker = wrapper.get('button[aria-label="迷你车库"]')
    expect(sticker.classes()).toContain('star-icon-btn')
    // #230 Game artwork is the slot's image; other home illustrations are independent.
    expect(sticker.find('img.game-sticker__art').exists()).toBe(true)
    expect(sticker.get('img.game-sticker__art').attributes('src')).toBe(`${import.meta.env.BASE_URL}games/mini-garage-prototype/icon.svg`)
    expect(sticker.findAll('img')).toHaveLength(1)
    expect(wrapper.get('.home-scroll').element.parentElement).toBe(wrapper.get('[data-page="home"]').element)
    expect(wrapper.get('.home-scroll').element.lastElementChild?.tagName).toBe('FOOTER')
    await open()
    const modal = wrapper.get('.star-modal')
    expect(modal.text()).toContain('迷你车库')
    expect(modal.text()).toContain('拖动赛道')
    expect(modal.text()).toContain('点按装置')
    expect(modal.text()).not.toContain('20:00–21:00') // #264 时窗删除：弹窗无窗口文案
    expect(modal.text()).toContain('15')
    expect(start().attributes('disabled')).toBeUndefined()
    await modal.get('.star-button--standard').trigger('click')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(allLedger()).toEqual(before)
    expect(rewards()).toEqual(catalog)
    expect(localStorage.getItem('sq_active_redemptions')).toBeNull()
  })
})
