// Developer-only lifecycle harness. No ledger, pricing or economic storage.
export function mountHost(document, window) {
  const frame = document.querySelector('#game')
  const button = document.querySelector('#authorize')
  const status = document.querySelector('#host-status')
  let request = null
  let phase = 'loading'
  let roundId = null
  let requestNumber = 1
  const fields = ['channel', 'version', 'type', 'instanceId', 'requestId', 'roundId']
  function valid(message) {
    return message && typeof message === 'object' && !Array.isArray(message) &&
      Object.keys(message).length === fields.length && fields.every(key => Object.hasOwn(message, key)) &&
      message.channel === 'skate-boy' && message.version === 1 &&
      typeof message.instanceId === 'string' && message.instanceId.trim() !== '' &&
      typeof message.requestId === 'string' &&
      (message.roundId === null || (typeof message.roundId === 'string' && message.roundId.trim() !== ''))
  }
  function receive(event) {
    if (event.source !== frame.contentWindow || event.origin !== window.location.origin) return
    const message = event.data
    if (!valid(message) || phase === 'exited') return
    if (message.type === 'ready' && phase === 'loading' && message.roundId === null &&
      message.requestId === `${message.instanceId}:1`) {
      request = message
      phase = 'confirm'
      button.disabled = false
      status.textContent = '游戏已就绪，请确认试玩。'
      return
    }
    if (!request || message.instanceId !== request.instanceId || message.roundId !== roundId) return
    if (message.type === 'ended' && phase === 'playing' && message.requestId === request.requestId) {
      phase = 'ended'
      status.textContent = '本局已结束。游戏内点重玩后，请在这里重新确认。'
    } else if (message.type === 'replay-request' && phase === 'ended' &&
      message.requestId === `${request.instanceId}:${requestNumber + 1}`) {
      requestNumber++
      request = message
      phase = 'confirm'
      button.disabled = false
      status.textContent = '收到重玩请求，请重新确认一局。'
    } else if (message.type === 'exit' && message.requestId === request.requestId) {
      phase = 'exited'
      button.disabled = true
      status.textContent = '已退出。刷新试玩页可重新开始。'
    }
  }
  function authorize() {
    if (!request || phase !== 'confirm') return
    phase = 'playing'
    roundId = window.crypto.randomUUID?.() || [...window.crypto.getRandomValues(new Uint32Array(4))].join('-')
    button.disabled = true
    frame.contentWindow.postMessage({ ...request, type: 'start', roundId }, window.location.origin)
    status.textContent = '已授权一局，请触摸游戏出发。此页不扣星。'
  }
  window.addEventListener('message', receive)
  button.addEventListener('click', authorize)
  // Attach the receiver before navigating: a cached child may send ready immediately.
  if (frame.dataset.src) frame.setAttribute('src', frame.dataset.src)
  return () => { window.removeEventListener('message', receive); button.removeEventListener('click', authorize) }
}
