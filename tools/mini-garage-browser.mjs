// Uses an existing HTTP server; never starts/replaces the app server.
// PLAYWRIGHT_MODULE=/path/to/playwright node tools/mini-garage-browser.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/'
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const errors = [], requests = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => requests.push(r.url()))
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw Error('storage disabled') } })
    Object.defineProperty(window, 'sessionStorage', { get() { throw Error('storage disabled') } })
    // Explicitly exercise the Safari 15.4 path: roundRect does not exist there.
    CanvasRenderingContext2D.prototype.roundRect = undefined
  })
  async function inspectModel(frame) {
    await frame.evaluate(() => {
      const step = GarageModel.step
      GarageModel.step = (s, ...args) => { window.testState = s; return step(s, ...args) }
    })
  }
  async function finish(frame) {
    await frame.evaluate(() => { window.testState.z = GarageModel.length - .01; window.testState.speed = GarageModel.tuning.roadSpeed })
    await frame.locator('#resultScreen').waitFor({ state: 'visible' })
  }
  await page.goto(new URL('index.html', base).href)
  await page.waitForFunction(() => !document.getElementById('start').disabled)
  await inspectModel(page)
  for (const [width, height] of [[320,568], [390,844], [844,390], [1024,768]]) {
    await page.setViewportSize({ width, height })
    for (const route of ['sprint','gravel','workshop']) {
      await page.locator(`#trackChoices [data-value="${route}"]`).click()
      await page.locator('#start').tap()
      await page.waitForFunction(() => window.testState?.phase === 'running' && window.testState.time >= .8)
      const pace = await page.evaluate(() => ({ speed: window.testState.speed, max: document.getElementById('progress').max,
        summary: document.getElementById('routeSummary').textContent }))
      assert.ok(pace.speed > 70, `real-frame launch speed: ${pace.speed}`)
      assert.equal(pace.max, 5400); assert.ok(pace.summary.includes('5,400'))
      const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        bottom: document.querySelector('.controls').getBoundingClientRect().bottom, canvas: document.querySelector('canvas').clientHeight }))
      assert.ok(size.width <= width && size.height <= height && size.bottom <= height && size.canvas > 70, JSON.stringify({ width, height, size }))
      await page.locator('#pause').tap()
      const time = await page.evaluate(() => window.testState.time)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.evaluate(() => window.testState.time), time)
      await page.locator('#resume').tap()
      await finish(page)
      await page.locator('#backToSetup').tap()
    }
  }
  // All art is preloaded; disconnect after load and verify another full UI round.
  await page.context().setOffline(true)
  await page.locator('#gadgets [data-value="jump"]').tap()
  await page.locator('#start').tap()
  await page.waitForFunction(() => window.testState.phase === 'running')
  const cdp = await page.context().newCDPSession(page)
  const left = await page.locator('#left').boundingBox(), gadget = await page.locator('#activate').boundingBox()
  const fingers = [left, gadget].map((b, i) => ({ id: i + 1, x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers.slice(0, 1) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers })
  await page.waitForFunction(() => window.testState.used === 1)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await finish(page)
  await page.context().setOffline(false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(new URL('host.html', base).href)
  await page.waitForFunction(() => !document.getElementById('authorize').disabled)
  const frame = page.frames().find(f => f.url().endsWith('/index.html'))
  await inspectModel(frame)
  assert.equal(await frame.locator('#start').isDisabled(), true)
  await page.locator('#authorize').tap()
  await frame.waitForFunction(() => !document.getElementById('start').disabled)
  assert.equal(await frame.locator('#driveScreen').isVisible(), false)
  await frame.locator('#start').tap()
  await frame.waitForFunction(() => window.testState?.phase === 'running')
  await finish(frame)
  await frame.locator('#replay').tap()
  await page.waitForFunction(() => !document.getElementById('authorize').disabled)
  assert.equal(await frame.locator('#start').isDisabled(), true)
  await page.locator('#authorize').tap()
  await frame.locator('#start').tap()
  await frame.waitForFunction(() => window.testState.phase === 'running')
  await frame.locator('#garage').tap()
  await page.waitForFunction(() => !document.getElementById('game'))
  assert.deepEqual(errors, [])
  assert.ok(requests.every(url => url.startsWith(base) || url.endsWith('/favicon.ico')), requests.join('\n'))
  console.log('PASS: 12 route/viewport runs, Safari roundRect fallback, storage disabled, offline replay, multitouch, embedded two-round handshake and iframe exit; no browser/resource errors.')
} finally { await browser.close() }
