import { RULES } from './game.js'

// All scene styling lives here + CSS tokens. Gameplay geometry lives in RULES.
const VISUAL = Object.freeze({ trackLeft: 0.125, laneWidth: 0.25, particleCount: 12,
  particleLife: 0.45, shakeLife: 0.22, shakeSize: 3, dprLimit: 2,
  font: 'system-ui, sans-serif', riderScale: 0.36 })

export function createRenderer(canvas, reducedMotion) {
  const ctx = canvas.getContext('2d')
  const css = getComputedStyle(document.documentElement)
  const colors = Object.fromEntries(['night', 'panel', 'road', 'road-edge', 'ink', 'cyan',
    'pink', 'gold', 'white', 'muted', 'line', 'skin'].map(key => [key, css.getPropertyValue(`--${key}`).trim()]))
  let width = 1, height = 1, distance = 0, shake = 0, hit = 0
  let particles = []
  const laneX = lane => width * (VISUAL.trackLeft + VISUAL.laneWidth * (lane + 0.5))

  function resize() {
    const rect = canvas.getBoundingClientRect()
    width = Math.max(1, rect.width); height = Math.max(1, rect.height)
    const dpr = Math.min(VISUAL.dprLimit, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  function box(x, y, w, h, fill, stroke, radius = 4) {
    ctx.beginPath()
    // roundRect is not required on older iPad Safari.
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius)
    else ctx.rect(x, y, w, h)
    ctx.fillStyle = fill; ctx.fill()
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke() }
  }
  function star(x, y, radius) {
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5 - Math.PI / 2
      const r = i % 2 ? radius * 0.45 : radius
      const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath(); ctx.fillStyle = colors.gold; ctx.fill()
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.stroke()
  }
  function obstacle(x, y, size, resolved) {
    ctx.save(); ctx.translate(x, y)
    ctx.globalAlpha = resolved ? 0.6 : 1
    box(-size * 0.64, -size * 0.42, size * 1.28, size * 0.84, colors.ink, colors.pink, 5)
    box(-size * 0.56, -size * 0.32, size * 1.12, size * 0.64, colors.pink)
    // Bold diagonal black hazard bands: clearly not collectible stars.
    ctx.save(); ctx.beginPath(); ctx.rect(-size * 0.56, -size * 0.32, size * 1.12, size * 0.64); ctx.clip()
    ctx.strokeStyle = colors.ink; ctx.lineWidth = size * 0.18
    for (let i = -2; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * size * 0.35, -size * 0.4)
      ctx.lineTo(i * size * 0.35 - size * 0.5, size * 0.4); ctx.stroke()
    }
    ctx.restore()
    box(-size * 0.55, size * 0.38, size * 0.2, size * 0.18, colors.muted)
    box(size * 0.35, size * 0.38, size * 0.2, size * 0.18, colors.muted)
    ctx.restore()
  }
  function rider(lane) {
    const size = Math.min(width * VISUAL.laneWidth * VISUAL.riderScale, height * 0.065)
    ctx.save(); ctx.translate(laneX(lane), height * RULES.riderY)
    // Wheels and a long deck remain visible around the top-down helmet/body.
    box(-size * 0.66, -size * 0.8, size * 1.32, size * 0.22, colors.white)
    box(-size * 0.66, size * 0.68, size * 1.32, size * 0.22, colors.white)
    box(-size * 0.48, -size * 1.15, size * 0.96, size * 2.3, colors.cyan, colors.ink, size * 0.45)
    box(-size * 0.23, -size * 0.95, size * 0.46, size * 1.9, colors.panel)
    box(-size * 0.32, size * 0.12, size * 0.35, size * 0.68, colors.ink)
    box(size * 0.03, size * 0.12, size * 0.35, size * 0.68, colors.ink)
    box(-size * 0.78, -size * 0.3, size * 1.56, size * 0.28, colors.skin)
    box(-size * 0.42, -size * 0.48, size * 0.84, size * 0.91, colors.pink, colors.ink, size * 0.2)
    ctx.beginPath(); ctx.arc(0, -size * 0.6, size * 0.46, 0, Math.PI * 2)
    ctx.fillStyle = colors.gold; ctx.fill(); ctx.strokeStyle = colors.ink; ctx.lineWidth = 3; ctx.stroke()
    box(-size * 0.07, -size * 1.02, size * 0.14, size * 0.64, colors.ink)
    // No blinking invulnerability effect; a steady ring fades after an impact.
    if (hit > 0) {
      ctx.globalAlpha = Math.min(1, hit * 2)
      ctx.beginPath(); ctx.ellipse(0, 0, size * 1.3, size * 1.6, 0, 0, Math.PI * 2)
      ctx.strokeStyle = colors.pink; ctx.lineWidth = 3; ctx.stroke()
    }
    ctx.restore()
  }
  function street(state) {
    ctx.fillStyle = colors.night; ctx.fillRect(0, 0, width, height)
    box(width * 0.08, 0, width * 0.84, height, colors['road-edge'])
    box(width * VISUAL.trackLeft, 0, width * 0.75, height, colors.road)
    ctx.lineWidth = 2
    for (const edge of [0.125, 0.875]) {
      ctx.strokeStyle = colors.cyan; ctx.beginPath(); ctx.moveTo(width * edge, 0); ctx.lineTo(width * edge, height); ctx.stroke()
    }
    ctx.strokeStyle = colors.line; ctx.setLineDash([height * 0.045, height * 0.055])
    ctx.lineDashOffset = -distance * height
    for (const divider of [0.375, 0.625]) {
      ctx.beginPath(); ctx.moveTo(width * divider, 0); ctx.lineTo(width * divider, height); ctx.stroke()
    }
    ctx.setLineDash([])
    // Top-down rooftops / neon storefront edges. No vanishing point or perspective.
    const block = height * 0.23
    for (let row = -1; row < 5; row++) {
      const y = row * block + (distance * height) % block
      for (const right of [false, true]) {
        const x = right ? width * 0.925 : -width * 0.015
        box(x, y, width * 0.09, block * 0.8, colors.panel, colors.line)
        box(x + width * 0.015, y + block * 0.12, width * 0.06, block * 0.3, colors.ink, right ? colors.pink : colors.cyan)
        box(x + width * 0.025, y + block * 0.55, width * 0.035, block * 0.06, colors.gold)
      }
    }
    const size = Math.min(width * 0.105, height * 0.065)
    for (const entity of state.entities) {
      const x = laneX(entity.lane), y = entity.y * height
      if (entity.kind === 'star') star(x, y, size * 0.42)
      else obstacle(x, y, size, entity.resolved)
    }
    rider(state.lane)
  }

  resize()
  return {
    resize,
    laneAt(fraction) {
      return Math.max(0, Math.min(2, Math.floor((fraction - VISUAL.trackLeft) / VISUAL.laneWidth)))
    },
    feedback(kind, lane) {
      if (kind === 'hit') hit = 0.7
      if (reducedMotion.matches) return
      if (kind === 'hit') shake = VISUAL.shakeLife
      for (let i = 0; i < VISUAL.particleCount; i++) {
        const angle = i * Math.PI * 2 / VISUAL.particleCount
        particles.push({ x: laneX(lane), y: height * RULES.riderY,
          vx: Math.cos(angle) * 65, vy: Math.sin(angle) * 65,
          life: VISUAL.particleLife, color: kind === 'hit' ? colors.pink : colors.gold })
      }
    },
    reset() { particles = []; distance = 0; shake = 0; hit = 0 },
    draw(state, dt, moving) {
      if (!ctx) return
      // Obstacles still move (essential gameplay); decorative street scrolling can stop.
      if (moving && !reducedMotion.matches) distance += state.speed * dt
      hit = Math.max(0, hit - dt); shake = Math.max(0, shake - dt)
      if (reducedMotion.matches) { particles = []; shake = 0 }
      ctx.save()
      if (shake > 0) ctx.translate(Math.sin(shake * 95) * VISUAL.shakeSize * shake / VISUAL.shakeLife, 0)
      street(state)
      ctx.restore()
      for (const p of particles) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt
        ctx.globalAlpha = Math.max(0, p.life / VISUAL.particleLife)
        ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3)
      }
      ctx.globalAlpha = 1
      particles = particles.filter(p => p.life > 0)
    },
  }
}
