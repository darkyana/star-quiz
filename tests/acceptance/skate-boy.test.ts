import { describe, expect, it } from 'vitest'
import { createGame } from '../../public/games/skate-boy/game.js'

// Advance through the public clock until an observable gameplay milestone.
function until(game, predicate, seconds = 30) {
  for (let i = 0; i < seconds * 60 && !predicate(game.state); i++) game.advance(1 / 60)
  expect(predicate(game.state)).toBe(true)
}

function sequence(values) {
  let index = 0
  return () => values[index++ % values.length]
}

describe('滑板少年：独立玩法输入与可观察状态', () => {
  it('连续接星每颗10分，第三颗起双倍；漏接会断连击', () => {
    const game = createGame({ random: sequence([0.5, 0.1]) })
    game.start()
    until(game, s => s.combo === 1)
    expect(game.state.score).toBe(10)
    until(game, s => s.combo === 2)
    expect(game.state.score).toBe(20)
    until(game, s => s.combo === 3)
    expect(game.state).toMatchObject({ score: 40, multiplier: 2 })
    game.steer({ type: 'tap', lane: 0 })
    until(game, s => s.combo === 0)
    expect(game.state).toMatchObject({ score: 40, multiplier: 1 })
  })
  it('障碍每次扣一命且断连击；三命耗尽后计时和输入停止', () => {
    let obstacles = false
    const stars = sequence([0.5, 0.1])
    const blocks = sequence([0.5, 0.9])
    const game = createGame({ random: () => obstacles ? blocks() : stars() })
    game.start()
    until(game, s => s.combo === 3)
    obstacles = true
    until(game, s => s.lives === 2)
    expect(game.state).toMatchObject({ combo: 0, multiplier: 1, status: 'playing' })
    game.advance(0.3)
    expect(game.state.lives).toBe(2)
    until(game, s => s.lives === 1)
    until(game, s => s.status === 'ended')
    expect(game.state.lives).toBe(0)
    const final = game.state
    game.advance(60)
    game.steer({ type: 'tap', lane: 0 })
    expect(game.state).toEqual(final)
  })

  it('速度随游玩时间递增并封顶，帧拆分不改变确定性结果', () => {
    const a = createGame({ random: sequence([0.5, 0.1]) })
    const b = createGame({ random: sequence([0.5, 0.1]) })
    a.start(); b.start()
    const initial = a.state.speed
    a.advance(30)
    expect(a.state.speed).toBeGreaterThan(initial)
    const at30 = a.state.speed
    a.advance(90)
    expect(a.state.speed).toBeGreaterThan(at30)
    for (let i = 0; i < 1200; i++) b.advance(0.1)
    expect(b.state).toEqual(a.state)
    const maximum = a.state.speed
    a.advance(300)
    expect(a.state.speed).toBe(maximum)
  })

  it('只保存独立本机最高分；低分不覆盖，存储不可用仍可结算', () => {
    const data = new Map([['sq_star_ledger', 'untouched']])
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
    let obstacles = false
    const stars = sequence([0.5, 0.1]), blocks = sequence([0.5, 0.9])
    const game = createGame({ storage, random: () => obstacles ? blocks() : stars() })
    game.start()
    until(game, s => s.combo === 3)
    obstacles = true
    until(game, s => s.status === 'ended')
    const record = game.state.score
    expect(game.state.best).toBe(record)
    expect(data.get('skate-boy.v1.best')).toBe(String(record))
    expect([...data.keys()].sort()).toEqual(['skate-boy.v1.best', 'sq_star_ledger'])
    expect(data.get('sq_star_ledger')).toBe('untouched')
    const next = createGame({ storage, random: sequence([0.5, 0.9]) })
    expect(next.state.best).toBe(record)
    next.start(); until(next, s => s.status === 'ended')
    expect(next.state).toMatchObject({ score: 0, best: record })
    expect(data.get('skate-boy.v1.best')).toBe(String(record))
    const unavailable = createGame({ storage: {
      getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') },
    }, random: sequence([0.5, 0.9]) })
    unavailable.start(); until(unavailable, s => s.status === 'ended')
    expect(unavailable.state.best).toBe(0)
  })

  it('开局三命居中；点按选车道、滑动相邻换道且不越界', () => {
    const game = createGame()
    game.steer({ type: 'tap', lane: 0 })
    expect(game.state.status).toBe('idle')
    game.start()
    expect(game.state).toMatchObject({ status: 'playing', lane: 1, lives: 3, score: 0 })
    game.steer({ type: 'tap', lane: 2 })
    expect(game.state.lane).toBe(2)
    game.steer({ type: 'swipe', direction: 1 })
    expect(game.state.lane).toBe(2)
    game.steer({ type: 'swipe', direction: -1 })
    expect(game.state.lane).toBe(1)
    game.steer({ type: 'tap', lane: 0 })
    expect(game.state.lane).toBe(0)
    game.steer({ type: 'tap', lane: 9 })
    expect(game.state.lane).toBe(0)
  })
})
