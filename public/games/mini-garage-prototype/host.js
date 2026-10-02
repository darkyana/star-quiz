// Same-origin demonstration only: no economy or persistence.
let frame = document.querySelector('#game')
const button = document.querySelector('#authorize')
const status = document.querySelector('#host-status')
let request = null, phase = 'loading', roundId = null, requestNumber = 1
const fields = ['channel', 'version', 'type', 'instanceId', 'requestId', 'roundId']
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return
  const m = event.data
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length !== 6 ||
    !fields.every(key => Object.prototype.hasOwnProperty.call(m, key)) ||
    m.channel !== 'mini-garage' || m.version !== 1 || typeof m.instanceId !== 'string' || !m.instanceId.trim() ||
    typeof m.requestId !== 'string' || !(m.roundId === null || typeof m.roundId === 'string' && m.roundId.trim()) || phase === 'exited') return
  if (m.type === 'ready' && phase === 'loading' && m.roundId === null && m.requestId === `${m.instanceId}:1`) {
    request = m; phase = 'confirm'; button.disabled = false
    status.textContent = '游戏已就绪，请确认试玩。'
    return
  }
  // Permit exit before readiness too (assets may still be loading).
  if (m.type === 'exit' && phase === 'loading' && m.roundId === null && m.requestId === `${m.instanceId}:1`) {
    phase = 'exited'; frame.remove(); status.textContent = '加载期间已退出。'; return
  }
  if (!request || m.instanceId !== request.instanceId || m.roundId !== roundId) return
  if (m.type === 'ended' && phase === 'playing' && m.requestId === request.requestId) {
    phase = 'ended'; status.textContent = '本局结束。游戏内选择重玩后，需在此重新确认。'
  } else if (m.type === 'replay-request' && phase === 'ended' && m.requestId === `${request.instanceId}:${requestNumber + 1}`) {
    requestNumber++; request = m; phase = 'confirm'; button.disabled = false
    status.textContent = '收到重玩请求，请重新确认。'
  } else if (m.type === 'exit' && m.requestId === request.requestId) {
    phase = 'exited'; button.disabled = true; frame.remove(); status.textContent = '已退出，游戏 iframe 已销毁。'
  }
})
button.onclick = () => {
  if (phase !== 'confirm') return
  roundId = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
  phase = 'playing'; button.disabled = true
  frame.contentWindow.postMessage({ ...request, type: 'start', roundId }, location.origin)
  status.textContent = '已授权，请在游戏内触摸出发。'
}
document.querySelector('#reload').onclick = () => location.reload()
// Receiver must exist before the child is navigated.
frame.src = frame.dataset.src
