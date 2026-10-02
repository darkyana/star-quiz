// Offline browser fixture: serves files through Playwright interception, not a
// listening HTTP server. These are frozen renderer states, not a live URL or a
// full race/RAF benchmark. Keep the gameplay's actual HTML, CSS and image assets.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../public/games/mini-garage-prototype/', import.meta.url))
const base = 'https://mini-garage-preview.invalid/'
const output = process.env.REVIEW_DIR || await mkdtemp(join(tmpdir(), 'mini-garage-boost-review-'))
await mkdir(output, { recursive: true })
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  for (const [name, width, height] of [['phone', 390, 844], ['tablet', 1024, 768]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true })
    const errors = []
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) return route.abort()
      if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
      const path = resolve(root, '.' + decodeURIComponent(url.pathname))
      if (!path.startsWith(resolve(root) + sep)) return route.abort()
      try { await route.fulfill({ body: await readFile(path), contentType: mime[extname(path)] || 'application/octet-stream' }) }
      catch { await route.fulfill({ status: 404, body: 'Fixture file not found' }) }
    })
    await context.addInitScript(() => {
      window.requestAnimationFrame = callback => { window.previewFrame = callback; return 1 }
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
    await page.goto(new URL('index.html', base).href)
    await page.waitForFunction(() => !document.getElementById('start').disabled)
    await page.evaluate(() => {
      const step = GarageModel.step
      GarageModel.step = (s, ...args) => { window.previewState = s; return step(s, ...args) }
    })
    await page.locator('#trackChoices [data-value="workshop"]').click()
    await page.locator('#start').tap()
    await page.evaluate(() => { window.previewNow = performance.now() + 20; window.previewFrame(window.previewNow) })
    for (const mode of ['normal', 'boost', 'reduced']) {
      await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' })
      const frame = await page.evaluate(mode => {
        const s = window.previewState
        Object.assign(s, { time: 30, z: 580, speed: mode === 'normal' ? 80 : 128,
          x: GarageModel.center(580, 'workshop'), hits: 0, active: mode === 'normal' ? 0 : .7,
          boostStartedAt: mode === 'normal' ? -Infinity : 29.7, cooldown: mode === 'normal' ? 0 : 4.7 })
        // Freeze physics for the comparison while running the real UI and draw path.
        const step = GarageModel.step
        GarageModel.step = () => {}
        window.previewNow += 1000 / 60; window.previewFrame(window.previewNow)
        GarageModel.step = step
        return { frame: GarageArt.lastFrame, label: document.getElementById('activeLabel').textContent,
          width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }
      }, mode)
      assert.ok(frame.width <= width && frame.height <= height)
      assert.equal(frame.frame.boost.markers, mode === 'boost' ? 8 : 0)
      assert.equal(frame.frame.boost.streaks, mode === 'boost' ? 10 : 0)
      if (mode !== 'normal') assert.equal(frame.label, '冲刺中！')
      const path = join(output, `${name}-${mode}.png`)
      await page.screenshot({ path })
      console.log(path)
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('PASS: offline phone/tablet normal, boost and reduced-motion fixtures; no server started.')
} finally { await browser.close() }
