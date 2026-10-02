import { createGame } from './game.js'
import { createLifecycle } from './lifecycle.js'
import { createRenderer } from './renderer.js'
import { createAudio } from './audio.js'

const element = id => document.getElementById(id)
const canvas = element('track')
const overlay = element('overlay'), action = element('action')
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const embedded = window.parent !== window
const instanceId = crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint32Array(4))].join('-')
let storage
try { storage = window.localStorage } catch { /* Storage is optional in private/sandboxed browsers. */ }
const game = createGame({ storage })
const renderer = createRenderer(canvas, reducedMotion)
const audio = createAudio((label, muted) => {
  element('sound').textContent = label
  element('sound').setAttribute('aria-pressed', String(muted))
})
const session = createLifecycle({ embedded, instanceId, hostOrigin: location.origin,
  hostWindow: window.parent, send: message => window.parent.postMessage(message, location.origin) })
let paused = false, lastTime = performance.now(), gesture = null, feedbackUntil = 0
const SWIPE_THRESHOLD = 24

function showPanel() {
  const { phase } = session.state
  overlay.hidden = phase === 'playing' && !paused
  action.hidden = phase === 'exited'
  action.disabled = phase === 'waiting'
  element('pause').disabled = phase !== 'playing'
  element('pause').textContent = paused ? '继续' : '暂停'
  element('exit').disabled = phase === 'exited'
  element('mode').textContent = embedded ? '宿主授权游玩 · 游戏分数独立' : '独立试玩 · 不消耗答题星星'
  element('result').hidden = phase !== 'ended'
  const content = {
    waiting: ['等待开局确认', '请在外层页面确认开始。重玩需要重新确认；这里不会自行开启新一局。', '等待宿主授权'],
    authorized: ['一起滑进夜色', '左右滑动换道，或点按目标车道。躲路障、接星星，连续接到第 3 颗起双倍计分！', '触摸出发'],
    playing: ['歇一会儿', '已经暂停，不扣命、不计时。准备好后继续这一局。', '触摸继续'],
    ended: ['这一趟，真酷！', embedded ? '再玩一次会请求宿主确认，不会直接重开。' : '挑战自己的最高分？再试一次吧。', embedded ? '请求再玩一局' : '再玩一局'],
    exited: ['已退出街区', embedded ? '已通知宿主，可以返回主产品。' : '试玩已结束，可以关闭本页。', ''],
  }[phase]
  element('panel-title').textContent = content[0]
  element('panel-copy').textContent = content[1]
  action.textContent = content[2]
  if (phase === 'ended') element('result').textContent = `本局 ${game.state.score} 分 · 本机最高 ${game.state.best} 分`
}
function updateHud(state) {
  element('score').textContent = String(state.score)
  element('combo').textContent = String(state.combo)
  element('multiplier').textContent = `×${state.multiplier}`
  element('lives').textContent = '♥ '.repeat(state.lives).trim() || '—'
  element('lives').setAttribute('aria-label', `${state.lives}条命`)
  element('best').textContent = String(Math.max(state.best, state.score))
  element('pace').textContent = state.elapsed < 30 ? '轻松滑行' : state.elapsed < 75 ? '逐渐加速' : '全速街头'
  const seconds = Math.floor(state.elapsed)
  element('duration').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function announce(message) {
  element('feedback').textContent = message
  feedbackUntil = performance.now() + 1000
}
function activate() {
  if (!session.activate()) return
  game.start(); renderer.reset(); paused = false; gesture = null
  lastTime = performance.now()
  audio.play('start')
  element('feedback').textContent = ''
  showPanel(); updateHud(game.state)
}
function togglePause() {
  if (session.state.phase !== 'playing') return
  paused = !paused; gesture = null; lastTime = performance.now()
  showPanel()
}

// Resume is deliberately fire-and-forget. Touch is not another authorization request.
action.addEventListener('click', () => {
  audio.unlock()
  if (paused) { togglePause(); return }
  if (session.state.phase === 'ended') {
    session.replay()
    if (!embedded) session.startStandalone()
  }
  if (session.state.phase === 'authorized') activate()
  else showPanel()
})
element('sound').addEventListener('click', () => audio.toggle())
element('pause').addEventListener('click', () => { audio.unlock(); togglePause() })
element('exit').addEventListener('click', () => {
  session.exit(); paused = false; gesture = null
  showPanel()
})
window.addEventListener('message', event => { if (session.receive(event)) showPanel() })
document.addEventListener('visibilitychange', () => {
  lastTime = performance.now()
  if (document.hidden && session.state.phase === 'playing') {
    paused = true; gesture = null; showPanel()
  }
})

function steer(input) {
  if (paused || session.state.phase !== 'playing') return
  const lane = game.state.lane
  game.steer(input)
  if (game.state.lane !== lane) audio.play('lane')
}
canvas.addEventListener('pointerdown', event => {
  audio.unlock()
  if (!event.isPrimary || event.button !== 0 || gesture || paused || session.state.phase !== 'playing') return
  event.preventDefault()
  canvas.setPointerCapture(event.pointerId)
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, swiped: false }
})
canvas.addEventListener('pointermove', event => {
  if (!gesture || gesture.id !== event.pointerId || gesture.swiped) return
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
  if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
    steer({ type: 'swipe', direction: Math.sign(dx) })
    gesture.swiped = true
  }
})
canvas.addEventListener('pointerup', event => {
  if (!gesture || gesture.id !== event.pointerId) return
  if (!gesture.swiped && Math.abs(event.clientX - gesture.x) < SWIPE_THRESHOLD && Math.abs(event.clientY - gesture.y) < SWIPE_THRESHOLD) {
    const rect = canvas.getBoundingClientRect()
    steer({ type: 'tap', lane: renderer.laneAt((event.clientX - rect.left) / rect.width) })
  }
  gesture = null
})
for (const name of ['pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, () => { gesture = null })
}
canvas.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); audio.unlock()
    steer({ type: 'swipe', direction: event.key === 'ArrowLeft' ? -1 : 1 })
  }
})
const observer = new ResizeObserver(() => renderer.resize())
observer.observe(canvas)

function frame(now) {
  // Dropped/background frames never fast-forward into an unseen obstacle.
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000))
  lastTime = now
  const moving = session.state.phase === 'playing' && !paused && !document.hidden
  const before = game.state
  if (moving) game.advance(dt)
  const state = game.state
  if (state.lives < before.lives) {
    renderer.feedback('hit', state.lane); audio.play('hit')
    announce(state.lives ? `碰到路障 · 还剩 ${state.lives} 条命` : '本局结束')
  } else if (state.score > before.score) {
    const combo = state.multiplier > 1
    renderer.feedback('star', state.lane); audio.play(combo ? 'combo' : 'star')
    const gained = state.score - before.score
    announce(combo ? `连击 ${state.combo} · 双倍 +${gained}` : `+${gained} · 漂亮！`)
  } else if (before.combo > 0 && state.combo === 0) announce('漏接了 · 再接一串！')
  if (state.status === 'ended' && session.state.phase === 'playing') {
    session.finish(); audio.play('end'); showPanel(); action.focus()
  }
  if (feedbackUntil < now) element('feedback').textContent = ''
  renderer.draw(state, dt, moving)
  updateHud(state)
  if (session.state.phase !== 'exited') requestAnimationFrame(frame)
  else observer.disconnect()
}

if (!embedded) session.startStandalone()
showPanel(); updateHud(game.state)
session.ready()
requestAnimationFrame(frame)
