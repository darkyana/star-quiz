import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountHost } from '../../public/games/skate-boy/host.js'

let dispose = () => {}
afterEach(() => { dispose(); document.body.innerHTML = ''; vi.restoreAllMocks() })

function setup() {
  document.body.innerHTML = '<p id="host-status"></p><button id="authorize" disabled>确认试玩</button><iframe id="game"></iframe>'
  const frame = document.querySelector('iframe')!
  const button = document.querySelector('button')!
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  dispose = mountHost(document, window)
  const message = (type: string, extra = {}, source = frame.contentWindow, origin = window.location.origin) => {
    window.dispatchEvent(new MessageEvent('message', { source, origin, data: {
      channel: 'skate-boy', version: 1, type, instanceId: 'game-a', requestId: 'game-a:1', roundId: null, ...extra,
    } }))
  }
  return { frame, button, sent, message }
}

describe('滑板少年独立试玩宿主', () => {
  it('局域网HTTP试玩没有randomUUID时仍能生成局授权', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window.crypto, 'randomUUID')
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const { button, sent, message } = setup()
      message('ready'); button.click()
      expect(sent).toHaveBeenCalledTimes(1)
      expect(sent.mock.calls[0][0].roundId).toEqual(expect.any(String))
      expect(sent.mock.calls[0][0].roundId.length).toBeGreaterThan(0)
    } finally {
      if (descriptor) Object.defineProperty(window.crypto, 'randomUUID', descriptor)
      else Reflect.deleteProperty(window.crypto, 'randomUUID')
    }
  })

  it('监听器就绪后才加载游戏，卸载后不再响应消息或确认', () => {
    document.body.innerHTML = '<p id="host-status"></p><button id="authorize" disabled>确认</button><iframe id="game" data-src="about:blank"></iframe>'
    const frame = document.querySelector('iframe')!
    dispose = mountHost(document, window)
    expect(frame.getAttribute('src')).toBe('about:blank')
    dispose()
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: window.location.origin, data: {
      channel: 'skate-boy', version: 1, type: 'ready', instanceId: 'game-a', requestId: 'game-a:1', roundId: null,
    } }))
    expect(document.querySelector('button')!.disabled).toBe(true)
  })
  it('拒绝错误来源、畸形就绪和携带经济字段的消息，并拒绝复用旧请求', () => {
    const { button, sent, message } = setup()
    message('ready', {}, window)
    message('ready', {}, undefined, 'https://foreign.example')
    message('ready', { instanceId: '' })
    message('ready', { price: 0 })
    message('ready', { requestId: 'other:1' })
    expect(button.disabled).toBe(true)
    expect(sent).not.toHaveBeenCalled()
    message('ready'); button.click()
    const roundId = sent.mock.calls[0][0].roundId
    message('ended', { roundId })
    message('replay-request', { roundId })
    expect(button.disabled).toBe(true)
    message('replay-request', { roundId, requestId: 'game-a:2' })
    expect(button.disabled).toBe(false)
  })
  it('结束不自动重开，重玩请求仅允许再次确认并生成不同局授权，退出后不能再授权', () => {
    const { button, sent, message } = setup()
    message('ready'); button.click()
    const roundId = sent.mock.calls[0][0].roundId
    message('ended', { roundId })
    expect(button.disabled).toBe(true)
    message('replay-request', { roundId, requestId: 'game-a:2' })
    expect(button.disabled).toBe(false)
    expect(sent).toHaveBeenCalledTimes(1)
    button.click()
    expect(sent).toHaveBeenCalledTimes(2)
    const second = sent.mock.calls[1][0]
    expect(second.requestId).toBe('game-a:2')
    expect(second.roundId).not.toBe(roundId)
    message('exit', { roundId: second.roundId, requestId: 'game-a:2' })
    message('ready'); button.click()
    expect(button.disabled).toBe(true)
    expect(sent).toHaveBeenCalledTimes(2)
  })
  it('就绪不自动授权，人工确认一次只发送一局授权，不接触经济存储', () => {
    const { button, sent, message } = setup()
    localStorage.setItem('sq_stars', 'untouched')
    message('ready')
    expect(button.disabled).toBe(false)
    expect(sent).not.toHaveBeenCalled()
    button.click(); button.click()
    expect(sent).toHaveBeenCalledTimes(1)
    expect(sent.mock.calls[0][0]).toMatchObject({ type: 'start', instanceId: 'game-a', requestId: 'game-a:1' })
    expect(sent.mock.calls[0][0].roundId).toEqual(expect.any(String))
    expect(sent.mock.calls[0][1]).toBe(window.location.origin)
    expect(button.disabled).toBe(true)
    expect(localStorage.getItem('sq_stars')).toBe('untouched')
  })
})
