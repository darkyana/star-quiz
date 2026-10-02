import { describe, expect, it } from 'vitest'
import { createLifecycle } from '../../public/games/skate-boy/lifecycle.js'

const origin = 'https://family.example'
function setup() {
  const host = {}
  const messages = []
  const session = createLifecycle({ embedded: true, instanceId: 'frame-a', hostOrigin: origin,
    hostWindow: host, send: message => messages.push(message) })
  session.ready()
  function authorize(overrides = {}, source = host, eventOrigin = origin) {
    return session.receive({ source, origin: eventOrigin, data: {
      channel: 'skate-boy', version: 1, type: 'start', instanceId: 'frame-a',
      requestId: messages.at(-1).requestId, roundId: 'round-1', ...overrides,
    } })
  }
  return { session, messages, host, authorize }
}

describe('滑板少年：无经济数据的嵌入生命周期', () => {
  it('结束只通知一次；重玩仅请求，新请求不能复用旧局授权；退出终结实例', () => {
    const { session, messages, authorize } = setup()
    expect(session.replay()).toBe(false)
    authorize(); session.activate()
    session.finish(); session.finish()
    expect(messages.map(m => m.type)).toEqual(['ready', 'ended'])
    expect(messages[1].roundId).toBe('round-1')
    expect(session.replay()).toBe(true)
    expect(session.replay()).toBe(false)
    expect(session.state.phase).toBe('waiting')
    expect(session.activate()).toBe(false)
    expect(messages.at(-1)).toMatchObject({ type: 'replay-request', requestId: 'frame-a:2', roundId: 'round-1' })
    expect(authorize()).toBe(false)
    expect(authorize({ requestId: 'frame-a:1', roundId: 'round-2' })).toBe(false)
    expect(authorize({ roundId: 'round-2' })).toBe(true)
    expect(session.activate()).toBe(true)
    session.exit(); session.exit()
    expect(messages.map(m => m.type)).toEqual(['ready', 'ended', 'replay-request', 'exit'])
    expect(session.state.phase).toBe('exited')
    expect(authorize({ roundId: 'round-3' })).toBe(false)
    expect(session.replay()).toBe(false)
    for (const message of messages) {
      expect(Object.keys(message).sort()).toEqual(['channel', 'instanceId', 'requestId', 'roundId', 'type', 'version'])
    }
  })

  it('独立试玩可本地开始/重玩，嵌入模式不能使用独立开始入口', () => {
    const messages = []
    const solo = createLifecycle({ embedded: false, instanceId: 'solo', send: m => messages.push(m) })
    solo.ready()
    expect(solo.startStandalone()).toBe(true)
    expect(solo.activate()).toBe(true)
    expect(solo.startStandalone()).toBe(false)
    solo.finish(); solo.replay()
    expect(solo.startStandalone()).toBe(true)
    expect(solo.activate()).toBe(true)
    solo.exit()
    expect(solo.startStandalone()).toBe(false)
    expect(messages).toEqual([])
    const { session } = setup()
    expect(session.startStandalone()).toBe(false)
    expect(session.state.phase).toBe('waiting')
  })

  it('等待授权；只接受当前宿主/来源/实例/请求，重复授权不能重置已授权局', () => {
    const { session, messages, authorize } = setup()
    expect(messages[0]).toEqual({ channel: 'skate-boy', version: 1, type: 'ready',
      instanceId: 'frame-a', requestId: 'frame-a:1', roundId: null })
    expect(session.state.phase).toBe('waiting')
    expect(authorize({}, {})).toBe(false)
    expect(authorize({}, undefined, 'https://evil.example')).toBe(false)
    expect(authorize({ instanceId: 'old-frame' })).toBe(false)
    expect(authorize({ requestId: 'expired' })).toBe(false)
    expect(authorize({ version: 2 })).toBe(false)
    expect(authorize({ score: 999, price: 0 })).toBe(false)
    expect(authorize({ roundId: '' })).toBe(false)
    expect(session.state.phase).toBe('waiting')
    expect(authorize()).toBe(true)
    expect(session.state).toMatchObject({ phase: 'authorized', roundId: 'round-1' })
    expect(authorize()).toBe(false)
    expect(session.activate()).toBe(true)
    expect(session.activate()).toBe(false)
    expect(session.state.phase).toBe('playing')
    expect(authorize({ roundId: 'round-2' })).toBe(false)
  })
})
