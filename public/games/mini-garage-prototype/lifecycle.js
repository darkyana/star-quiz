// Protocol v1. Only lifecycle identifiers cross the host boundary.
export function createLifecycle({ embedded, instanceId, hostOrigin, hostWindow, send }) {
  let phase = 'waiting'
  let roundId = null
  let requestNumber = 1
  let requestId = `${instanceId}:1`
  let announced = false
  const usedRounds = new Set()
  const fields = ['channel', 'version', 'type', 'instanceId', 'requestId', 'roundId']
  const envelope = type => ({ channel: 'mini-garage', version: 1, type, instanceId, requestId, roundId })
  return {
    get state() { return { phase, roundId, requestId } },
    ready() {
      if (announced || phase !== 'waiting') return false
      announced = true
      if (embedded) send(envelope('ready'))
      return true
    },
    receive(event) {
      const message = event.data
      if (!embedded || !announced || event.source !== hostWindow || event.origin !== hostOrigin ||
        !message || typeof message !== 'object' || Array.isArray(message) ||
        Object.keys(message).length !== fields.length ||
        !fields.every(key => Object.prototype.hasOwnProperty.call(message, key)) ||
        message.channel !== 'mini-garage' || message.version !== 1 || message.type !== 'start' ||
        message.instanceId !== instanceId || message.requestId !== requestId || phase !== 'waiting' ||
        typeof message.roundId !== 'string' || !message.roundId.trim() || usedRounds.has(message.roundId)) return false
      roundId = message.roundId
      usedRounds.add(roundId)
      phase = 'authorized'
      return true
    },
    startStandalone() {
      if (embedded || !announced || phase !== 'waiting') return false
      roundId = `solo:${requestId}`
      phase = 'authorized'
      return true
    },
    activate() {
      if (phase !== 'authorized') return false
      phase = 'playing'
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
  }
}
