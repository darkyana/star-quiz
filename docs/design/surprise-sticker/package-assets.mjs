// Package the three reviewed artworks without repainting or adding outlines.
// Run from any cwd: node docs/design/surprise-sticker/package-assets.mjs [A|B|C]
// Default C is the approved initial release. Selecting another color only swaps assets.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const colors = { A: 'soft-purple', B: 'berry-pink', C: 'sky-blue' }
const selected = process.argv[2] ?? 'C'
if (!Object.hasOwn(colors, selected)) throw new Error('Choose A, B, or C')
const target = path.join(root, 'public/stickers/surprise-quiz')
await fs.mkdir(target, { recursive: true })
for (const [id, name] of Object.entries(colors)) {
  const png = await fs.readFile(path.join(here, '../surprise-sticker-preview', `${id}.png`))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>惊喜答题</title><image width="512" height="512" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`
  await fs.writeFile(path.join(here, `${id}-${name}.png`), png)
  await fs.writeFile(path.join(here, `${id}-${name}.svg`), svg)
  if (id === selected) {
    await fs.writeFile(path.join(target, 'icon.png'), png)
    await fs.writeFile(path.join(target, 'icon.svg'), svg)
  }
}
console.log(`Packaged A/B/C; active artwork: ${selected} (${colors[selected]})`)
