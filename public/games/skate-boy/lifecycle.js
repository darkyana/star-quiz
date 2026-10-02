// Lifecycle only: never pass scores, balances, prices or ledger data.
export function createLifecycle({ embedded, instanceId, hostOrigin, hostWindow, send }) {
  let phase = 'waiting'
  let roundId = null
  let requestNumber = 1
  let requestId = `${instanceId}:${requestNumber}`
  const usedRounds = new Set()
  const fields = ['channel', 'version', 'type', 'instanceId', 'requestId', 'roundId']
  const envelope = type => ({ channel: 'skate-boy', version: 1, type, instanceId, requestId, roundId })
  return {
    get state() { return { phase, roundId, requestId } },
    ready() { if (embedded) send(envelope('ready')) },
    receive(event) {
      const message = event.data
      if (!embedded || event.source !== hostWindow || event.origin !== hostOrigin || !message ||
        typeof message !== 'object' || Array.isArray(message) || Object.keys(message).length !== fields.length ||
        !fields.every(key => Object.prototype.hasOwnProperty.call(message, key)) ||
        message.channel !== 'skate-boy' || message.version !== 1 || message.type !== 'start' ||
        message.instanceId !== instanceId || message.requestId !== requestId || phase !== 'waiting' ||
        typeof message.roundId !== 'string' || !message.roundId.trim() || usedRounds.has(message.roundId)) return false
      roundId = message.roundId
      usedRounds.add(roundId)
      phase = 'authorized'
      return true
    },
    finish() {
      if (phase !== 'playing') return false
      phase = 'ended'
      if (embedded) send(envelope('ended'))
      return true
    },
    replay() {
      if (phase !== 'ended') return false
      requestId = `${instanceId}:${++requestNumber}`
      phase = 'waiting'
      if (embedded) send(envelope('replay-request'))
      return true
    },
    exit() {
      if (phase === 'exited') return false
      phase = 'exited'
      if (embedded) send(envelope('exit'))
      return true
    },
    startStandalone() {
      if (embedded || phase !== 'waiting') return false
      roundId = `solo:${requestId}`
      phase = 'authorized'
      return true
    },
    activate() {
      if (phase !== 'authorized') return false
      phase = 'playing'
      return true
    },
  }
}
