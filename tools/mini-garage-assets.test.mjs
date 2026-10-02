import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const game = new URL('../public/games/mini-garage-prototype/', import.meta.url)
const archive = new URL('../docs/game/mini-garage/', import.meta.url)
const read = (name, base = game) => readFileSync(new URL(name, base))

test('approved original is unchanged; protocol SVG embeds the shipped transparent PNG', () => {
  assert.equal(createHash('sha256').update(read('entry-sticker/approved-original.png', archive)).digest('hex'),
    '7cb2379f89a481432792b7e25a9cdc162141420620d2d66e550fc8099290ed72')
  const png = read('icon.png'), svg = read('icon.svg').toString()
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), 512); assert.equal(png.readUInt32BE(20), 512)
  assert.equal(png[25], 6, 'PNG must retain RGBA')
  assert.match(svg, /viewBox="0 0 512 512"/)
  assert.doesNotMatch(svg, /stroke=|<rect|<filter/)
  const embedded = svg.match(/href="data:image\/png;base64,([^"]+)"/)
  assert.ok(embedded)
  assert.deepEqual(Buffer.from(embedded[1], 'base64'), png)
})

test('production directory contains runtime art only; development assets are archived', () => {
  const manifestURL = new URL('art-assets/track-kit/manifest.json', archive)
  const manifest = JSON.parse(readFileSync(manifestURL, 'utf8'))
  assert.equal(new URL(manifest.runtimeBase, manifestURL).href, new URL('art-assets/track-kit/', game).href)
  assert.deepEqual(readdirSync(new URL('art-assets/track-kit/', game)).sort(), manifest.assets.map(a => a.file).sort())
  for (const a of manifest.assets) assert.ok(existsSync(new URL(a.file, new URL(manifest.runtimeBase, manifestURL))), a.file)
  for (const a of manifest.originals) {
    const data = readFileSync(new URL(a.file, manifestURL))
    assert.equal(createHash('sha256').update(data).digest('hex'), a.sha256, a.file)
  }
  assert.deepEqual(readdirSync(new URL('art-assets/', game)).sort(),
    ['hero-offroad-boost.webp', 'hero-offroad-jump.webp', 'hero-road-boost.webp', 'hero-road-jump.webp', 'track-kit'].sort())
  for (const item of ['PROTOTYPE.md', 'PLAYABLE-ART.md', 'ART-STUDY.md', 'TRACK-KIT.md', 'art-review', 'art-prototype.html', 'track-kit-preview.js', 'track-kit-preview.css']) {
    assert.ok(existsSync(new URL(item, archive)), item)
    assert.equal(existsSync(new URL(item, game)), false, item)
  }
})

test('archived preview and game static resource references still resolve', () => {
  for (const [name, base] of [['index.html', game], ['host.html', game], ['art-prototype.html', archive]]) {
    const html = read(name, base).toString()
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^(https?:|data:)/.test(m[1])) continue
      const url = new URL(m[1], new URL(name, base)); url.search = ''; url.hash = ''
      assert.ok(existsSync(url), `${name}: ${m[1]}`)
    }
  }
  for (const name of ['index.html', 'playable-art.js', 'playable-art.css', 'lifecycle.js'])
    assert.doesNotMatch(read(name).toString(), /\.\.\/|docs\/game|art-review|art-prototype/)
})
