// Run against `wrangler pages dev dist` or a deployed Pages URL, not Vite preview.
import assert from 'node:assert/strict'

const base = process.argv[2]
assert.ok(base, 'Usage: node tools/verify-pages.mjs <base-url>')
const nonce = Date.now()
async function request(path, { hashedAsset = false } = {}) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) })
  // Existing content-hashed assets may retain the custom domain's browser TTL.
  // Shells and errors must not: those are the stale-version failure boundary.
  if (!hashedAsset || response.status !== 200) {
    assert.match(response.headers.get('cache-control') ?? '', /no-cache|no-store/, `${path} must revalidate or disable storage`)
    assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable/, `${path} must not cache misses permanently`)
  }
  return { response, body: await response.text() }
}

const home = await request('/')
assert.equal(home.response.status, 200, 'home status')
assert.match(home.body, /id="app"/, 'home must be application HTML')
for (const path of ['/assets/issue-213-missing.css', '/assets/issue-213-missing.js', '/assets/nested/issue-213-missing.png']) {
  const { response, body } = await request(`${path}?probe=${nonce}`)
  assert.equal(response.status, 404, `${path} must return 404`)
  assert.doesNotMatch(body, /id="app"/, `${path} must not return the app shell`)
}
for (const path of ['/#/quiz', '/#/parent/family', '/quiz', '/parent/family', '/proposals/example/edit']) {
  const { response, body } = await request(path)
  assert.equal(response.status, 200, `${path} status`)
  assert.equal(body, home.body, `${path} must serve the app shell`)
}
const assets = [...home.body.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(js|css))"/g)]
assert.ok(assets.some(([, , ext]) => ext === 'css'), 'built CSS reference required')
assert.ok(assets.some(([, , ext]) => ext === 'js'), 'built JS reference required')
for (const [, path, ext] of assets) {
  const { response, body } = await request(path, { hashedAsset: true })
  assert.equal(response.status, 200, `${path} status`)
  assert.match(response.headers.get('content-type') ?? '', ext === 'css' ? /text\/css/ : /javascript/, `${path} MIME type`)
  assert.doesNotMatch(body, /<!doctype html>/i)
}
console.log('PASS: missing assets 404; home, hash URLs, page rewrites and built JS/CSS OK')
