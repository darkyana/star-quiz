// Current gameplay, art contract and browser verification.
// PLAYWRIGHT_MODULE=/path/to/playwright node tools/mini-garage-art/verify-playable.cjs
// PREVIEW_URL is the game directory URL on an existing HTTP(S) server, not file://.
// The 2026-09 agility recalibration intentionally supersedes the old byte-frozen
// model. Assert timing, full-route reachability and assets rather than old speeds.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
execFileSync(process.execPath, ['--test',
  'tools/mini-garage-pacing.test.mjs',
  'tools/mini-garage-boost.test.mjs',
  'tools/mini-garage-contract.test.mjs',
  'tools/mini-garage-assets.test.mjs',
], { cwd: repo, stdio: 'inherit' });
// Touch controls and the same-origin demo host; never start a replacement server.
import('../mini-garage-browser.mjs').catch(error => { console.error(error); process.exitCode = 1; });
