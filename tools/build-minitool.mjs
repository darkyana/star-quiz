// 小红书小工具打包编排（npm run build:minitool）：
// vite 构建（vite.config.minitool.ts）→ index.html 后处理（剥 type="module"/modulepreload/crossorigin，
// 容器 CSP 只认经典脚本）→ 静态门禁自检（zip-artifact-spec §6 + device-capabilities §7 扫描清单）
// → 压缩目录内容为 zip（index.html 必须在 zip 根）。
// 门禁失败即退出非零码；审计体积另跑 skill 的 audit_artifact（存在时顺带执行，缺省提示人工门禁）。
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const dist = join(root, 'dist-minitool')
const zipPath = join(root, 'star-quiz-minitool.zip')

execSync('npx vite build --config vite.config.minitool.ts', { stdio: 'inherit', cwd: root })

// ---- 入口归位：Vite 保留 HTML 源文件名（minitool.html），zip 根入口必须是 index.html ----
const builtHtml = join(dist, 'minitool.html')
const htmlFile = join(dist, 'index.html')
execSync(`mv "${builtHtml}" "${htmlFile}"`, { stdio: 'inherit' })

// ---- index.html 后处理：IIFE 产物按经典脚本加载 ----
let html = readFileSync(htmlFile, 'utf8')
html = html
  .replace(/<link\s+rel="modulepreload"[^>]*>\s*/g, '')
  .replace(/<script([^>]*?)\s+type="module"([^>]*?)>/g, '<script$1$2>')
  .replace(/\s+crossorigin(="[^"]*")?/g, '')
  // 经典脚本无 module 的默认 defer：补 defer，避免 head 内阻塞解析、挂载时 #app 尚未创建
  .replace(/<script((?![^>]*\bdefer\b)[^>]*\ssrc=)/g, '<script defer$1')
writeFileSync(htmlFile, html)

// ---- 静态门禁 ----
const failures = []
const warns = []
const fail = (msg) => failures.push(msg)
const warn = (msg) => warns.push(msg)

if (!existsSync(htmlFile)) fail('index.html 不在产物根目录')
if (/<script[^>]*type="module"/.test(html)) fail('index.html 残留 type="module" script（容器 CSP 禁 module）')
if (/<link[^>]*modulepreload/.test(html)) fail('index.html 残留 modulepreload link')
if (/<script[^>]*\ssrc=[^>]*>/.test(html) && !/<script[^>]*\bdefer\b[^>]*\ssrc=/.test(html)) {
  fail('index.html 经典脚本缺 defer（head 内阻塞解析，挂载时 #app 未创建）')
}

const files = readdirSync(dist, { recursive: true }).filter((f) => statSync(join(dist, f)).isFile())
const textByExt = { '.html': [], '.css': [], '.js': [], '.json': [] }
for (const rel of files) {
  const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase()
  if (textByExt[ext]) textByExt[ext].push({ rel, text: readFileSync(join(dist, rel), 'utf8') })
}
const bannedNames = [/node_modules/, /\.git/, /\.DS_Store/, /\.map$/, /vite\.config/, /webpack\.config/]
for (const rel of files) if (bannedNames.some((re) => re.test(rel))) fail(`产物含禁入文件：${rel}`)

// 外部资源引用（图片/CSS/JS/字体一律打包在内，相对路径）
for (const { rel, text } of [...textByExt['.html'], ...textByExt['.css'], ...textByExt['.js']]) {
  const hit = text.match(/(src|href|url)\s*[=(]\s*["']?https?:\/\//i)
  if (hit) fail(`${rel} 引用外部资源（${hit[0].slice(0, 40)}…）——容器纯离线，须相对路径打包在内`)
}

// device-capabilities §7 扫描清单（小工具构建应已 tree-shake 干净；命中即门禁失败）
const forbiddenApi = [
  /\bfetch\(/, /sendBeacon/, /\/api\/metrics\/onboarding/, /XMLHttpRequest/, /new\s+WebSocket\(/, /new\s+EventSource\(/, /RTCPeerConnection/,
  /navigator\.clipboard/, /navigator\.serviceWorker/, /navigator\.geolocation/,
  /window\.open\(/, /window\.prompt\(/, /\beval\(/, /new\s+Function\(/, /WebAssembly\./,
  /new\s+Worker\(/, /navigator\.storage\.persist/, /document\.execCommand/,
]
// 已知保守残留（不阻断，交付摘要标注）：迁移前备份路径的 a[download]；Home 内不可达的 iframe 游戏代码
const acceptedResidue = [/\ba\.download\s*=/, /\.download\s*=\s*filename/, /createElement\('iframe'\)|createElement\("iframe"\)/, /<iframe/]

for (const { rel, text } of textByExt['.js']) {
  for (const re of forbiddenApi) {
    const m = text.match(re)
    if (m) fail(`${rel} 残留禁用 API：${m[0]}（应经 VITE_MINITOOL 门控 tree-shake 移出）`)
  }
  for (const re of acceptedResidue) if (re.test(text)) warn(`${rel} 含已备注的保守残留（交付摘要标注）：${re}`)
}

if (failures.length > 0) {
  console.error('\n[minitool] 门禁失败：')
  for (const f of failures) console.error(`  FAIL ${f}`)
  process.exit(1)
}
for (const w of warns) console.warn(`  WARN ${w}`)

// ---- 压缩目录内容（非目录本身）：index.html 落在 zip 根 ----
execSync(`cd "${dist}" && rm -f "${zipPath}" && zip -r -X "${zipPath}" . -x '*.DS_Store'`, { stdio: 'inherit' })

const zipSize = statSync(zipPath).size
const MIB = 1024 * 1024
console.log(`\n[minitool] 产物：${zipPath}（${(zipSize / MIB).toFixed(2)} MiB，上限 10 MiB，建议 ≤ 2 MiB）`)
if (zipSize > 10 * MIB) {
  console.error('  FAIL zip 超过 10 MiB 上限')
  process.exit(1)
}

// ---- skill 审计脚本（.skill/ 下存在则顺带执行；会议室外的常规环境走人工门禁） ----
const audit = join(root, '.skill/minitool-zip-builder/scripts/audit_artifact.mjs')
if (existsSync(audit)) execSync(`node "${audit}" "${dist}" && node "${audit}" "${zipPath}"`, { stdio: 'inherit', cwd: root })
else console.warn('  WARN 未找到 .skill/minitool-zip-builder（skill 未解压），跳过自动体积审计——上线前人工核对 zip 体积')
console.log('[minitool] 打包完成')
