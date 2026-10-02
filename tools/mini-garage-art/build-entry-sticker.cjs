// Package the approved artwork without redrawing it or adding a sticker outline.
// SHARP_MODULE=/path/to/sharp node tools/mini-garage-art/build-entry-sticker.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'docs/game/mini-garage/entry-sticker/approved-original.png');
const target = path.join(root, 'public/games/mini-garage-prototype');
(async () => {
  const metadata = await sharp(source).metadata();
  assert(metadata.hasAlpha, 'Approved artwork must retain its transparent background');
  const png = await sharp(source).resize(512, 512, { fit: 'contain', background: '#00000000' }).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(target, 'icon.png'), png);
  // External images do not load when SVG is consumed through <img>. Embed the PNG
  // so icon.svg is a standalone, square, transparent protocol artifact.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>迷你车库</title><image width="512" height="512" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`;
  fs.writeFileSync(path.join(target, 'icon.svg'), svg);
  console.log(`Packaged approved sticker: icon.png ${png.length} bytes; self-contained icon.svg ${Buffer.byteLength(svg)} bytes`);
})().catch(error => { console.error(error); process.exitCode = 1; });
