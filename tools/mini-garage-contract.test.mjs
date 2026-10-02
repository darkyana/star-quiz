import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createLifecycle } from '../public/games/mini-garage-prototype/lifecycle.js'

const root = new URL('../public/games/mini-garage-prototype/', import.meta.url)
function fixture(embedded = true) {
  const sent = [], hostWindow = {}, hostOrigin = 'https://example.test'
  const life = createLifecycle({ embedded, instanceId: 'instance', hostOrigin, hostWindow, send: m => sent.push(m) })
  const start = (changes = {}, event = {}) => life.receive({ source: hostWindow, origin: hostOrigin,
    data: { channel: 'mini-garage', version: 1, type: 'start', instanceId: 'instance', requestId: life.state.requestId, roundId: 'round-1', ...changes }, ...event })
  return { life, sent, start }
}
test('six-field handshake, one ended, fresh authorization for every replay', () => {
  const { life, sent, start } = fixture()
  assert.equal(start(), false)
  assert.equal(life.activate(), false)
  life.ready(); life.ready()
  assert.deepEqual(sent, [{ channel: 'mini-garage', version: 1, type: 'ready', instanceId: 'instance', requestId: 'instance:1', roundId: null }])
  assert.equal(start(), true)
  assert.equal(start({ roundId: 'duplicate-start' }), false)
  assert.equal(life.activate(), true)
  assert.equal(life.replay(), false)
  assert.equal(start({ roundId: 'playing-start' }), false)
  assert.equal(life.finish(), true); assert.equal(life.finish(), false)
  assert.equal(life.replay(), true); assert.equal(life.replay(), false)
  assert.equal(life.activate(), false)
  assert.equal(start(), false)
  assert.equal(start({ requestId: 'instance:1', roundId: 'round-2' }), false)
  assert.equal(start({ roundId: 'round-2' }), true)
  life.activate(); life.finish(); life.exit(); life.exit()
  assert.deepEqual(sent.map(m => m.type), ['ready', 'ended', 'replay-request', 'ended', 'exit'])
  assert.equal(sent[2].requestId, 'instance:2'); assert.equal(sent[2].roundId, 'round-1')
  assert.equal(sent[3].roundId, 'round-2')
  assert.ok(sent.every(m => Object.keys(m).length === 6))
})
test('reject malformed, wrong source/origin, stale and augmented messages', () => {
  const { life, start } = fixture(); life.ready()
  for (const change of [{ channel: 'skate-boy' }, { version: '1' }, { type: 'ended' }, { instanceId: 'old' },
    { requestId: 'instance:0' }, { requestId: 'instance:01' }, { roundId: null }, { roundId: '' }, { roundId: ' ' },
    { roundId: 123 }, { price: 0 }, { score: 100 }]) assert.equal(start(change), false)
  for (const event of [{ source: {} }, { origin: 'https://attacker.test' }, { data: null }, { data: [] }, { data: {} }]) assert.equal(start({}, event), false)
  assert.equal(life.state.phase, 'waiting'); assert.equal(life.startStandalone(), false)
})
test('exit uses current request and last authorized round in every phase', () => {
  for (const phase of ['loading', 'waiting', 'authorized', 'playing', 'ended', 'replay']) {
    const { life, sent, start } = fixture()
    if (phase !== 'loading') life.ready()
    if (['authorized', 'playing', 'ended', 'replay'].includes(phase)) start()
    if (['playing', 'ended', 'replay'].includes(phase)) life.activate()
    if (['ended', 'replay'].includes(phase)) life.finish()
    if (phase === 'replay') life.replay()
    life.exit(); life.ready()
    const exit = sent.at(-1)
    assert.equal(exit.type, 'exit')
    assert.equal(exit.requestId, phase === 'replay' ? 'instance:2' : 'instance:1')
    assert.equal(exit.roundId, ['loading', 'waiting'].includes(phase) ? null : 'round-1')
    assert.equal(start({ roundId: 'new' }), false); assert.equal(life.activate(), false)
  }
})
test('standalone supports replay without ever sending host messages', () => {
  const { life, sent } = fixture(false)
  life.ready(); assert.equal(life.startStandalone(), true); life.activate(); life.finish(); life.replay()
  assert.equal(life.startStandalone(), true); life.activate(); life.exit()
  assert.deepEqual(sent, [])
})

const html = readFileSync(new URL('index.html', root), 'utf8')
async function mount(embedded, assetsFail = false) {
  const window = new Window({ url: 'https://example.test/nested/game/index.html', settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } })
  window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''))
  window.document.querySelector('canvas').getContext = () => ({})
  window.requestAnimationFrame = () => 1
  window.scrollTo = () => {}
  const messages = [], host = { postMessage: (m, origin) => messages.push({ m, origin }) }
  window.createLifecycle = createLifecycle
  window.testHost = host
  window.GarageArt = { isReady: false, heroURL: () => './art-assets/hero-road-boost.webp', assetURL: f => './art-assets/track-kit/' + f,
    load: async () => { if (assetsFail) throw Error('missing'); window.GarageArt.isReady = true } }
  const scripts = [...html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map(m => m[1])
  window.eval(scripts[0] + '\n' + scripts[1].replace("import { createLifecycle } from './lifecycle.js';", '')
    .replace('const embedded=window.self!==window.top;', `const embedded=${embedded};`)
    .replaceAll('window.parent', 'window.testHost') + '\nwindow.inspect=()=>({state,screen,phase:lifecycle.state.phase});window.testFinish=()=>{state.phase="ended";finish()};window.testFrame=frame;')
  await new Promise(resolve => setImmediate(resolve))
  const click = id => window.document.getElementById(id).onclick({ isTrusted: true })
  const authorize = (roundId, extra = {}) => {
    const request = messages.at(-1).m
    window.dispatchEvent(new window.MessageEvent('message', { source: host, origin: window.location.origin,
      data: { ...request, type: 'start', roundId, ...extra } }))
  }
  return { window, messages, click, authorize }
}
test('embedded UI gates first start, replay and return routes; pauses background time', async () => {
  const { window: w, messages, click, authorize } = await mount(true)
  try {
    assert.equal(messages[0].m.type, 'ready'); assert.equal(messages[0].origin, w.location.origin)
    click('start'); assert.equal(w.inspect().state, null)
    authorize('round-1', { extra: true }); assert.equal(w.inspect().phase, 'waiting')
    authorize('round-1'); assert.equal(w.inspect().state, null)
    assert.match(w.document.getElementById('start').textContent, /触摸出发/)
    click('start'); assert.equal(w.inspect().state.phase, 'running')
    w.dispatchEvent(new w.Event('blur')); assert.equal(w.inspect().state.phase, 'paused')
    const before = w.inspect().state.time
    w.testFrame(100000); assert.equal(w.inspect().state.time, before)
    click('resume'); assert.equal(w.inspect().state.phase, 'running')
    w.testFinish(); w.testFinish(); assert.equal(messages.filter(x => x.m.type === 'ended').length, 1)
    click('replay'); click('start'); assert.equal(w.inspect().state, null)
    assert.equal(messages.at(-1).m.type, 'replay-request')
    authorize('round-1'); assert.equal(w.inspect().phase, 'waiting')
    authorize('round-2'); click('start'); assert.equal(w.inspect().state.phase, 'running')
    click('garage'); assert.equal(messages.at(-1).m.type, 'exit'); assert.equal(w.inspect().screen, 'exited')
  } finally { await w.happyDOM.close() }
})
test('failed assets never announce ready; pre-ready exit stays null', async () => {
  const { window: w, messages, click } = await mount(true, true)
  try {
    assert.equal(messages.length, 0); click('start'); assert.equal(w.inspect().state, null)
    assert.equal(w.document.getElementById('retryAssets').hidden, false)
    click('exitGame'); assert.equal(messages[0].m.roundId, null)
  } finally { await w.happyDOM.close() }
})
test('standalone UI returns to garage and runs again', async () => {
  const { window: w, messages, click } = await mount(false)
  try {
    click('start'); assert.equal(w.inspect().state.phase, 'running')
    click('garage'); assert.equal(w.inspect().screen, 'setup')
    click('start'); w.testFinish(); click('backToSetup'); click('start')
    assert.equal(w.inspect().state.phase, 'running'); assert.equal(messages.length, 0)
  } finally { await w.happyDOM.close() }
})
test('boost input acknowledges immediately and its timer freezes across pause and resets on replay', async () => {
  const { window: w, click } = await mount(false)
  try {
    click('start')
    const button = w.document.getElementById('activate')
    const press = () => button.onpointerdown({ pointerType: 'touch', preventDefault() {} })
    press()
    const s = w.inspect().state
    assert.equal(s.active, 1)
    assert.equal(s.boostStartedAt, 0)
    assert.equal(w.document.getElementById('activeLabel').textContent, '冲刺中！')
    assert.equal(button.disabled, true)
    press(); assert.equal(s.used, 1)
    click('pause')
    const before = [s.time, s.active, s.cooldown, s.boostStartedAt]
    w.testFrame(100000)
    assert.deepEqual([s.time, s.active, s.cooldown, s.boostStartedAt], before)
    click('resume')
    assert.equal(s.active, 1)
    s.active = 0; w.testFrame(100010)
    assert.match(w.document.getElementById('activeLabel').textContent, /加速喷口/)
    w.testFinish(); click('replay'); click('start')
    assert.equal(w.inspect().state.boostStartedAt, -Infinity)
    assert.equal(w.inspect().state.active, 0)
  } finally { await w.happyDOM.close() }
})
test('recalibrated setup, progress and pace labels follow the current model', async () => {
  const { window: w, click } = await mount(false)
  try {
    for (const route of ['sprint', 'gravel', 'workshop']) {
      w.document.querySelector(`#trackChoices [data-value="${route}"]`).click()
      assert.match(w.document.getElementById('routeSummary').textContent, /5,400 米/)
      assert.match(w.document.getElementById('routeSummary').textContent, /重复 3 段/)
      assert.ok(w.document.querySelectorAll('#routePreview span').length <= 5)
    }
    click('start')
    assert.equal(w.document.getElementById('progress').max, 5400)
    assert.equal(w.document.getElementById('paceLabel').textContent, '热身')
    w.inspect().state.time = 4; w.testFrame(1000)
    assert.match(w.document.getElementById('paceLabel').textContent, /渐进提速/)
    w.inspect().state.time = 24; w.testFrame(1010)
    assert.equal(w.document.getElementById('paceLabel').textContent, '冲刺 +25%')
  } finally { await w.happyDOM.close() }
})
test('all routes and configurations finish in the target playing-time range', () => {
  const w = new Window()
  try {
    const modelScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]
    w.eval(modelScript + '\nwindow.model=GarageModel;')
    for (const track of ['sprint', 'gravel', 'workshop']) for (const tire of ['road', 'offroad']) for (const gadget of ['boost', 'jump']) {
      const s = w.model.simulate(tire, gadget, track)
      assert.equal(s.phase, 'ended'); assert.ok(s.time >= 50 && s.time <= 80, `${track}/${tire}/${gadget}: ${s.time}`)
    }
  } finally { w.happyDOM.abort() }
})
