import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const root = new URL('../public/games/mini-garage-prototype/', import.meta.url)
const html = readFileSync(new URL('index.html', root), 'utf8')
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('const GarageModel ='))
const artScript = readFileSync(new URL('playable-art.js', root), 'utf8')
const model = () => vm.runInNewContext(script + ';GarageModel')

class Path {
  commands = []
  moveTo(...args) { this.commands.push(['move', ...args]) }
  lineTo(...args) { this.commands.push(['line', ...args]) }
  rect(...args) { this.commands.push(['rect', ...args]) }
  addPath(path) { this.commands.push(['add', path.commands]) }
  closePath() { this.commands.push(['close']) }
}

// Record actual renderer calls, including the clipping scope. No clock, DOM or
// substitute physics in this fixture. Visual screenshots use real Chrome separately.
function recordingContext() {
  const calls = [], stack = []
  let state = { tx: 0, ty: 0, outside: false, globalAlpha: 1 }
  const ctx = new Proxy({
    save() { stack.push({ ...state }) },
    restore() { state = stack.pop() },
    translate(x, y) { state.tx += x; state.ty += y },
    rotate() {}, scale() {},
    clip(path, rule) { if (rule === 'evenodd') state.outside = true },
    createPattern() { return 'texture' },
    drawImage(image, ...args) { calls.push({ kind: 'image', asset: image.src, args, ...state }) },
    fillRect(...args) { calls.push({ kind: 'fillRect', args, ...state }) },
    stroke(path) { calls.push({ kind: 'stroke', args: path.commands, ...state }) },
    fill(path) { calls.push({ kind: 'fill', args: path?.commands, ...state }) },
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {},
    fillText(...args) { calls.push({ kind: 'text', args, ...state }) },
    measureText(text) { return { width: text.length * 12 } },
  }, {
    get(target, prop) { return prop in target ? target[prop] : state[prop] },
    set(target, prop, value) { state[prop] = value; return true },
  })
  return { ctx, calls }
}

async function renderer() {
  const context = {
    window: {}, Path2D: Path,
    Image: class {
      width = 256; height = 256
      set src(value) { this.url = value; this.onload() }
      get src() { return this.url }
    },
    document: { createElement() { return { getContext() { return recordingContext().ctx } } } },
  }
  vm.runInNewContext(artScript, context)
  const art = context.window.GarageArt
  await art.load()
  return art
}

function draw(art, m, s, reduced = false) {
  const { ctx, calls } = recordingContext()
  art.draw(ctx, { w: 390, h: 600, state: s, model: m, reduced, motion: { arc: 0, bump: 0, squash: 0 } })
  return calls
}

function boosted(m) {
  const s = m.create('road', 'boost', 'workshop')
  s.time = 24; s.z = 580; s.speed = 128; s.x = m.center(s.z, s.trackId)
  m.activate(s); s.time += .3; s.active -= .3
  return s
}

test('boost feedback attacks quickly, fades after release, freezes on pause and resets per round', async () => {
  const m = model(), art = await renderer(), s = m.create('road', 'boost')
  assert.equal(art.boostMotion(s, m).strength, 0)
  m.activate(s)
  s.time = .06
  const attack = art.boostMotion(s, m).strength
  assert.ok(attack > .8 && attack < 1)
  s.time = .12
  assert.equal(art.boostMotion(s, m).strength, 1)
  s.time = 1.14; s.active = 0
  assert.ok(Math.abs(art.boostMotion(s, m).strength - .5) < 1e-8)
  s.phase = 'paused'
  const before = JSON.stringify(art.boostMotion(s, m))
  m.step(s, 1, 1); m.activate(s)
  assert.equal(JSON.stringify(art.boostMotion(s, m)), before)
  s.time = 1.3
  assert.equal(art.boostMotion(s, m).strength, 0)
  assert.equal(art.boostMotion(m.create('road', 'boost'), m).strength, 0)
})

test('extra scenery is bounded and clipped outside the road; gameplay draw commands are unchanged', async () => {
  const m = model(), art = await renderer(), s = boosted(m)
  const normal = { ...s, active: 0, boostStartedAt: -Infinity }
  const plain = draw(art, m, normal), before = JSON.stringify(s)
  const burst = draw(art, m, s)
  assert.equal(JSON.stringify(s), before, 'renderer must not mutate physics or clocks')
  const world = calls => calls.filter(c => !c.outside && !c.asset?.includes('boost-flame'))
  assert.equal(JSON.stringify(world(burst)), JSON.stringify(world(plain)))
  for (const asset of ['barrier.png', 'ramp.png', 'slow-strip.png']) {
    assert.ok(burst.some(c => c.asset?.includes(asset) && !c.outside), asset)
  }
  assert.equal(art.lastFrame.boost.markers, 8)
  assert.equal(art.lastFrame.boost.streaks, 10)
  assert.equal(burst.filter(c => c.outside && c.kind === 'image').length, 8)
  const frozenFrame = JSON.stringify(burst)
  assert.equal(JSON.stringify(draw(art, m, s)), frozenFrame, 'same state must redraw identically')
  const p1 = art.projection(390, 600, s.z), travel1 = art.boostMotion(s, m).travel
  s.z += 10
  const p2 = art.projection(390, 600, s.z), travel2 = art.boostMotion(s, m).travel
  assert.equal(p2.Y(602) - p1.Y(602), 10 * p1.scale)
  assert.equal(p2.Y(682) - p1.Y(682), 10 * p1.scale)
  assert.equal(p2.Y(690) - p1.Y(690), 10 * p1.scale)
  assert.ok(Math.abs((travel2 - travel1) - 17) < 1e-8)
})

test('reduced motion removes passing scenery and streaks but retains a steady boost flame', async () => {
  const m = model(), art = await renderer(), s = boosted(m)
  const calls = draw(art, m, s, true)
  assert.equal(art.lastFrame.boost.markers, 0)
  assert.equal(art.lastFrame.boost.streaks, 0)
  assert.equal(calls.some(c => c.outside), false)
  const flame = calls.find(c => c.asset?.includes('boost-flame'))
  assert.ok(flame)
  s.time += .1; s.active -= .1
  const later = draw(art, m, s, true).find(c => c.asset?.includes('boost-flame'))
  assert.equal(JSON.stringify(later.args), JSON.stringify(flame.args), 'no flame size pulse')
  assert.equal(later.globalAlpha, flame.globalAlpha)
  const enhanced = draw(art, m, s).find(c => c.asset?.includes('boost-flame'))
  assert.ok(enhanced.args[3] > flame.args[3] * 1.8, 'normal-mode flame is much longer')
  s.time = 26; s.active = 0
  assert.equal(draw(art, m, s).some(c => c.asset?.includes('boost-flame')), false)
  assert.equal(art.lastFrame.boost.markers, 0)
})
