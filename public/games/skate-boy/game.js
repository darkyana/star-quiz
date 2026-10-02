// Independent gameplay boundary. Coordinates: lanes 0–2, track y 0–1.
// Inject seconds and random values in [0, 1) for reproducible play.
const STEP = 1 / 60
export const RULES = Object.freeze({ riderY: 0.82, contactRadius: 0.045, starPoints: 10 })

export const BEST_KEY = 'skate-boy.v1.best'

export function createGame({ random = Math.random, storage } = {}) {
  function readBest() {
    try {
      const value = Number(storage?.getItem(BEST_KEY))
      return Number.isSafeInteger(value) && value >= 0 ? value : 0
    } catch { return 0 }
  }
  let best = readBest()
  const fresh = (status) => ({ status, lane: 1, lives: 3, score: 0, best, combo: 0,
    multiplier: 1, elapsed: 0, speed: 0.2, entities: [] })
  let state = fresh('idle')
  let remainder = 0
  let spawnIn = 1
  let serial = 0

  function tick() {
    state.elapsed += STEP
    state.speed = Math.min(0.62, 0.2 + state.elapsed * 0.0038)
    spawnIn -= STEP
    if (spawnIn <= 0) {
      state.entities.push({ id: ++serial, lane: Math.floor(random() * 3),
        kind: random() < 0.62 ? 'star' : 'obstacle', y: -0.06 })
      spawnIn += Math.max(0.55, 1.2 - state.elapsed * 0.006)
    }
    for (const entity of state.entities) {
      entity.y += state.speed * STEP
      if (entity.resolved) continue
      if (entity.lane === state.lane && Math.abs(entity.y - RULES.riderY) <= RULES.contactRadius) {
        entity.resolved = true
        if (entity.kind === 'star') {
          state.combo++
          state.multiplier = state.combo >= 3 ? 2 : 1
          state.score += RULES.starPoints * state.multiplier
        } else {
          state.lives--
          state.combo = 0; state.multiplier = 1
          if (state.lives === 0) {
            state.status = 'ended'
            best = Math.max(best, readBest(), state.score)
            state.best = best
            try { storage?.setItem(BEST_KEY, String(best)) } catch { /* Private mode / quota: keep session record. */ }
            break
          }
        }
      } else if (entity.y > RULES.riderY + RULES.contactRadius) {
        entity.resolved = true
        if (entity.kind === 'star') { state.combo = 0; state.multiplier = 1 }
      }
    }
    state.entities = state.entities.filter(entity => entity.y < 1.1 && !(entity.resolved && entity.kind === 'star'))
  }

  return {
    get state() { return { ...state, entities: state.entities.map(entity => ({ ...entity })) } },
    start() {
      state = fresh('playing')
      remainder = 0; spawnIn = 1; serial = 0
    },
    advance(seconds) {
      if (state.status !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return
      remainder += seconds
      while (remainder + 1e-10 >= STEP && state.status === 'playing') {
        remainder -= STEP
        tick()
      }
    },
    steer(input) {
      if (state.status !== 'playing') return
      if (input.type === 'tap' && Number.isInteger(input.lane) && input.lane >= 0 && input.lane <= 2) {
        state.lane = input.lane
      } else if (input.type === 'swipe' && Math.abs(input.direction) === 1) {
        state.lane = Math.max(0, Math.min(2, state.lane + input.direction))
      }
    },
  }
}
