// Synthesized, short and quiet. Construct/resume only inside a real user gesture.
const SOUNDS = Object.freeze({
  start: [[330, 0, 0.09], [440, 0.1, 0.09], [660, 0.2, 0.16]],
  lane: [[220, 0, 0.045]],
  star: [[740, 0, 0.07], [990, 0.06, 0.1]],
  combo: [[660, 0, 0.07], [880, 0.07, 0.07], [1320, 0.14, 0.12]],
  hit: [[100, 0, 0.14], [165, 0.16, 0.13], [110, 0.3, 0.2]],
  end: [[440, 0, 0.12], [330, 0.15, 0.12], [220, 0.3, 0.3]],
})

export function createAudio(onStatus) {
  let context, master, muted = false, unsupported = false
  function status() {
    onStatus(muted ? '声音：关闭' : unsupported ? '声音：不可用' :
      context?.state === 'running' ? '声音：开启' : '声音：待触摸', muted)
  }
  function unlock() {
    if (muted) return
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext
        if (!Audio) { unsupported = true; status(); return }
        context = new Audio()
        master = context.createGain()
        master.gain.value = 0.16
        master.connect(context.destination)
        context.addEventListener('statechange', status)
      }
      // Safari may leave this promise pending. Never await it to start a paid round.
      if (context.state !== 'running') context.resume().then(status).catch(status)
    } catch { unsupported = true }
    status()
  }
  return {
    unlock,
    toggle() {
      muted = !muted
      if (master) master.gain.value = muted ? 0 : 0.16
      if (!muted) unlock()
      status()
    },
    play(kind) {
      if (muted || context?.state !== 'running') return
      for (const [frequency, delay, duration] of SOUNDS[kind] || []) {
        const oscillator = context.createOscillator(), gain = context.createGain()
        const at = context.currentTime + delay
        oscillator.type = kind === 'hit' ? 'triangle' : 'sine'
        oscillator.frequency.setValueAtTime(frequency, at)
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(0.45, at + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.001, at + duration)
        oscillator.connect(gain); gain.connect(master)
        oscillator.start(at); oscillator.stop(at + duration + 0.01)
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      }
    },
  }
}
