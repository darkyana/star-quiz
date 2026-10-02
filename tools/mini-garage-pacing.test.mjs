import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const root = new URL('../public/games/mini-garage-prototype/', import.meta.url)
const html = readFileSync(new URL('index.html', root), 'utf8')
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('const GarageModel ='))
const model = () => vm.runInNewContext(script + ';GarageModel')
const dt = 1 / 120
const routes = ['sprint', 'gravel', 'workshop']
const tires = ['road', 'offroad']

function tick(m, s, offset = 0) {
  m.step(s, dt, (m.center(s.z + 8, s.trackId) + offset - s.x) * m.tuning.dragGain)
}
function clearEvents(m, id) {
  Object.assign(m.trackFor(id), { obstacles: [], ramps: [], bands: [] })
}

test('agility pace, projection and event intervals stay in the calibrated envelope', () => {
  const m = model(), context = { window: {} }
  vm.runInNewContext(readFileSync(new URL('playable-art.js', root), 'utf8'), context)
  for (const [w, h] of [[320, 350], [390, 600], [1024, 550]]) {
    const p = context.window.GarageArt.projection(w, h, 0)
    const ahead = p.carY / p.scale
    assert.ok(Math.abs(ahead - 121.6) < 1e-8)
    assert.ok(ahead / m.tuning.roadSpeed >= 1.5 && ahead / m.tuning.roadSpeed <= 1.55)
    assert.ok(ahead / (m.tuning.roadSpeed * m.paceAt(24)) >= 1.2)
    // The stronger one-second burst has a smaller window; the delayed-path test
    // below also covers sustained peak speed, not just this geometric bound.
    assert.ok(ahead / (m.tuning.roadSpeed * m.paceAt(24) * m.tuning.boostMultiplier) >= .75)
  }
  assert.equal(m.paceAt(-10), 1)
  assert.equal(m.paceAt(3), 1)
  assert.equal(m.paceAt(24), 1.25)
  assert.equal(m.paceAt(300), 1.25)
  for (let t = 0; t < 30; t += .1) assert.ok(m.paceAt(t + .1) >= m.paceAt(t))
  const obstacles = m.trackFor('sprint').obstacles
  for (let i = 1; i < obstacles.length; i++) {
    const interval = (obstacles[i].z - obstacles[i - 1].z) / 100
    assert.ok(interval >= 1 && interval <= 2.6, `sprint interval ${interval}`)
  }
})

test('all 12 configurations retain roughly a minute and count every event beyond bit 31', () => {
  const m = model()
  assert.equal(m.length, 5400)
  for (const id of routes) {
    const track = m.trackFor(id)
    assert.ok(track.obstacles.length > 32)
    assert.equal(track.parts.at(-1).end, m.length)
    for (let i = 1; i < track.obstacles.length; i++) assert.ok(track.obstacles[i].z > track.obstacles[i - 1].z)
    for (const tire of tires) for (const gadget of ['boost', 'jump']) {
      const s = m.simulate(tire, gadget, id)
      const label = `${id}/${tire}/${gadget}`
      assert.equal(s.phase, 'ended', label)
      assert.ok(s.time >= 50 && s.time <= 80, `${label}: ${s.time}`)
      assert.equal(s.hits, 0, label)
      assert.equal(s.checked.size, track.obstacles.length, label)
      assert.equal(s.hits + s.dodged + s.cleared, track.obstacles.length, label)
      assert.equal(s.rampJumps, track.ramps.length, label)
      assert.equal(s.bandsCleared, track.bands.length, label)
      assert.equal(s.slowTime, 0, label)
    }
  }
})

test('one-second boost has a brisk real acceleration, smooth release and unchanged normal pace', () => {
  const m = model(); clearEvents(m, 'sprint')
  const s = m.create('road', 'boost'), normal = m.create('road', 'jump')
  for (const state of [s, normal]) { state.time = 24; state.speed = 100 }
  m.activate(s)
  assert.equal(s.boostStartedAt, 24)
  assert.equal(s.active, 1)
  assert.equal(s.cooldown, 5)
  m.activate(s); assert.equal(s.used, 1)
  for (let i = 0; i < 24; i++) { tick(m, s); tick(m, normal) }
  assert.ok(s.speed > 145 && s.speed <= 160)
  assert.equal(normal.speed, 100)
  assert.ok(s.z > normal.z + 5, 'boost must move the world, not just the display')
  while (s.active > 0) tick(m, s)
  assert.ok(s.speed > 150, 'release must not snap to cruise speed')
  for (let i = 0; i < 120; i++) tick(m, s)
  assert.ok(s.speed >= 100 && s.speed < 102)
  assert.ok(s.cooldown > 0)
  while (s.cooldown > 0) tick(m, s)
  m.activate(s)
  assert.equal(s.used, 2)
  assert.equal(s.boostStartedAt, s.time)
  const fresh = model()
  assert.ok(Math.abs(fresh.simulate('road', 'jump', 'sprint').time - 56.94) < .02)
})

test('third-section collisions have distinct identities and are never counted twice', () => {
  const m = model(), s = m.create('road', 'boost'), track = m.trackFor('sprint')
  for (const [i, o] of track.obstacles.entries()) {
    s.z = o.z - .01; s.x = m.center(o.z) + o.x; s.speed = 100
    m.step(s, dt, 0)
    assert.equal(s.hits, i + 1)
    assert.equal(s.checked.has(i), true)
    m.step(s, dt, 0)
    assert.equal(s.hits, i + 1)
  }
  const fresh = m.create('road', 'boost')
  assert.equal(fresh.checked.size, 0)
  s.phase = 'paused'
  const time = s.time, speed = s.speed, hits = s.hits
  m.step(s, 1, 1); m.activate(s)
  assert.deepEqual([s.time, s.speed, s.hits], [time, speed, hits])
})

test('soft surfaces retain speed and a full 0.6 lateral move completes within 0.5 seconds', () => {
  for (const tire of tires) for (const [id, z] of [['sprint', 400], ['gravel', 700], ['gravel', 950]]) {
    const m = model(); clearEvents(m, id)
    const s = m.create(tire, 'jump', id)
    s.z = z; s.time = 24; s.x = m.center(z, id) - .3
    let elapsed = 0
    while (s.x < m.center(s.z + 8, id) + .3 - .02 && elapsed < 1) {
      tick(m, s, .3); elapsed += dt
    }
    assert.ok(elapsed <= .5, `${tire}/${id}/${z} drag: ${elapsed}`)
    while (elapsed < 1.5) { tick(m, s, .3); elapsed += dt }
    assert.ok(s.speed >= 79, `${tire}/${id}/${z}: ${s.speed}`)
  }
})

test('collision recovery is brief and grounded slow strips take about half a second', () => {
  const m = model(), s = m.create('road', 'boost')
  const o = m.trackFor('sprint').obstacles[0]
  s.z = o.z - .01; s.time = 24; s.speed = 100; s.x = m.center(o.z) + o.x
  m.step(s, dt, 0)
  assert.equal(s.hits, 1)
  assert.equal(s.speed, 60)
  for (let i = 0; i < 48; i++) tick(m, s)
  assert.ok(s.speed >= 90)
  const b = m.create('road', 'jump', 'workshop')
  b.z = 320; b.time = 24; b.speed = 100; b.x = m.center(b.z, b.trackId)
  while (b.z < 334) tick(m, b)
  assert.ok(b.slowTime >= .48 && b.slowTime <= .52, `${b.slowTime}`)
  assert.equal(b.bandDone.size, 1)
  assert.equal(b.bandsCleared, 0)
})

test('short manual jump clears a strip; charge, no midair relaunch and cooldown remain enforced', () => {
  for (const tire of tires) {
    const m = model(), s = m.create(tire, 'jump', 'workshop')
    // Second band is on sand. Deliberately miss its ramp to test the device alone.
    const speed = (tire === 'road' ? m.tuning.roadRoughSpeed : m.tuning.offroadRoughSpeed) * 1.25
    s.z = 690 - speed * .4; s.time = 24; s.speed = speed; s.x = m.center(s.z, s.trackId) - .3
    m.activate(s)
    assert.equal(s.charge, m.tuning.jumpCharge)
    m.activate(s); assert.equal(s.used, 1)
    while (s.charge > 0) tick(m, s, -.3)
    assert.equal(s.airTotal, .65)
    const air = s.air
    m.activate(s); assert.equal(s.air, air); assert.equal(s.used, 1)
    while (s.z < 704) tick(m, s, -.3)
    assert.equal(s.bandsCleared, 1)
    assert.equal(s.rampJumps, 0)
    assert.equal(s.slowTime, 0)
    while (s.air > 0) tick(m, s, -.3)
    assert.ok(s.cooldown > 0)
  }
})

// This is a reachability witness, not a model of child skill. Observe only the
// geometric forward view every 100ms, then delay each command by 180ms. Apply the
// same capped, eased lateral controller as touch dragging. No active jumps.
function delayedDriver(m, id, tire, sustainedBoost) {
  const s = m.create(tire, 'boost', id), track = m.trackFor(id), commands = []
  s.time = m.tuning.fullPaceAt
  let nextObservation = s.time, offset = 0
  while (s.phase === 'running' && s.time < 150) {
    if (s.time >= nextObservation) {
      const visible = item => item.z > s.z && item.z - s.z < 121.6
      const events = [
        ...track.obstacles.filter(visible).map(o => ({ ...o, kind: 'obstacle' })),
        ...track.ramps.filter(visible).map(r => ({ ...r, kind: 'ramp' })),
      ].sort((a, b) => a.z - b.z)
      const e = events[0]
      commands.push({ at: s.time + .18, offset: e ? e.kind === 'ramp' ? e.x : e.x >= 0 ? -.34 : .34 : 0 })
      nextObservation = s.time + .1
    }
    while (commands.length && commands[0].at <= s.time) offset = commands.shift().offset
    if (sustainedBoost) s.active = 1 // Conservative envelope: faster than legal cooldown cycling.
    else if (s.cooldown === 0) m.activate(s)
    tick(m, s, offset)
  }
  return s
}

test('visible-only delayed paths remain clear on every route, including sustained maximum boost', () => {
  const m = model()
  for (const id of routes) for (const tire of tires) for (const sustained of [false, true]) {
    const s = delayedDriver(m, id, tire, sustained), label = `${id}/${tire}/sustained=${sustained}`
    assert.equal(s.phase, 'ended', label)
    assert.equal(s.hits, 0, label)
    assert.equal(s.offTime, 0, label)
    assert.equal(s.rampJumps, m.trackFor(id).ramps.length, label)
    assert.equal(s.bandsCleared, m.trackFor(id).bands.length, label)
  }
})

test('30/60/120Hz render batches produce the same model trajectory using fixed substeps', () => {
  const m = model(); clearEvents(m, 'sprint')
  const states = [30, 60, 120].map(fps => {
    const s = m.create('road', 'boost')
    for (let frame = 0; frame < 30 * fps; frame++) {
      for (let sub = 0; sub < 120 / fps; sub++) tick(m, s)
    }
    return s
  })
  assert.equal(JSON.stringify(states[0]), JSON.stringify(states[1]))
  assert.equal(JSON.stringify(states[1]), JSON.stringify(states[2]))
})
