// Build and verify with the real Pages runtime in a disposable, binding-free project.
import { spawn } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
// Keep this dependency outside worker/: Wrangler discovers config from its internal shim path.
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js')
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
// Local regression never needs Cloudflare credentials or repository bindings.
for (const key of Object.keys(env)) {
  if (/^(CLOUDFLARE_|CF_API_|CF_ACCOUNT_)/.test(key)) delete env[key]
}

function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, signal, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${command} failed (${signal ?? code})`)))
  })
}

await run('npm', ['run', 'build'])
const directory = await mkdtemp(join(tmpdir(), 'star-quiz-pages-'))
let server
let stopped
const abort = new AbortController()
const onSignal = () => abort.abort(new Error('Pages regression interrupted'))
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
try {
  await cp(join(root, 'dist'), join(directory, 'dist'), { recursive: true })
  // Explicit empty Pages config in an external cwd prevents Wrangler's repository discovery.
  await writeFile(join(directory, 'wrangler.json'), JSON.stringify({
    name: 'star-quiz-pages-regression',
    pages_build_output_dir: './dist',
    compatibility_date: '2026-08-31',
  }))
  server = spawn(process.execPath, [wrangler, 'pages', 'dev', 'dist',
    '--ip', '127.0.0.1', '--port', '0', '--inspector-port', '0'], {
    cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  stopped = new Promise(resolve => server.once('exit', resolve))
  const url = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Pages startup timed out')), 60000)
    const finish = (error, value) => {
      clearTimeout(timer)
      error ? reject(error) : resolve(value)
    }
    abort.signal.addEventListener('abort', () => finish(abort.signal.reason), { once: true })
    server.once('error', error => finish(error))
    server.once('exit', code => finish(new Error(`Pages exited before verification (${code})`)))
    const log = chunk => {
      process.stdout.write(chunk)
      output = (output + chunk.toString()).slice(-16000)
      const ready = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/)
      if (ready) finish(null, ready[1])
    }
    server.stdout.on('data', log)
    server.stderr.on('data', log)
  })
  abort.signal.throwIfAborted()
  await run(process.execPath, [join(root, 'tools/verify-pages.mjs'), url], abort.signal)
  abort.signal.throwIfAborted()
} finally {
  if (server?.pid) {
    const killGroup = signal => {
      try { process.kill(-server.pid, signal) } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    killGroup('SIGTERM')
    let timer
    await Promise.race([stopped, new Promise(resolve => { timer = setTimeout(resolve, 5000) })])
    clearTimeout(timer)
    killGroup('SIGKILL')
  }
  await rm(directory, { recursive: true, force: true })
  process.removeListener('SIGINT', onSignal)
  process.removeListener('SIGTERM', onSignal)
}
