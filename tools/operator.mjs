#!/usr/bin/env node
// 运营方发码脚本（票 #191，ADR 0007 运营方发码制与双因子占家闸；票 #204 加 --remote 显式生产开关）
// 运行：node tools/operator.mjs <issue|retire|list|add-passphrase> [args] [--remote]
// 经 npx wrangler d1 execute 直达 D1：默认 --local（本机 .wrangler 开发副本，保守兜底防手滑误碰生产），
// 显式加 --remote 才连 Cloudflare 生产 D1（库名从 worker/wrangler.jsonc 读，不硬编码）；
// --remote 下写操作（issue/retire/add-passphrase）执行前须终端输入 yes 人工确认，非交互环境安全侧默认中止。
// 公网零新增端点、零管理凭据，发码权限即 Cloudflare 账号权限（本地 wrangler 权限）。
// 纯函数区（生成 / SQL 组装 / 撞码重试 / 参数解析）可导出供单测：tests/acceptance/37-operator-script.test.ts
// 生成口径：6 位数字家庭码、4 位小写 a-z 家庭口令。口令逐位拒绝采样与 worker/src/admin.ts 同口径；
// 家庭码为本脚本独立实现（拒绝采样消除取模偏差），admin.ts 的 generateCode 无拒绝采样，两者不共享实现。
import { readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

// ===== 纯函数区（可导出、可单测）=====

/** 6 位数字家庭码（pairing_codes CHECK 约束口径）：拒绝采样消除取模偏差（独立实现，admin.ts 的 generateCode 无拒绝采样） */
export function generateCode() {
  // 拒绝上限取 floor(2^32 / 1e6) × 1e6 = 4294 × 1_000_000 = 4_294_000_000（< 2^32 = 4294967296）：
  // 丢弃 [LIMIT, 2^32) 的 967296 个样本后，剩余 4_294_000_000 个值恰能被 1e6 整除（每余数类恰 4294 个样本），
  // 模 1e6 完全均匀、零取模偏差。
  const LIMIT = 4_294_000_000
  const buf = new Uint32Array(1)
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] >= LIMIT)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}

/** 4 位小写 a-z 家庭口令（#190 双因子钥匙对）：逐位拒绝采样消除取模偏差（与 admin.ts 同口径） */
export function generatePassphrase() {
  let passphrase = ''
  while (passphrase.length < 4) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]
    if (byte < 234) passphrase += String.fromCharCode(97 + (byte % 26)) // 234 = 26×9：拒绝 234..255 消除取模偏差
  }
  return passphrase
}

/** 发码建空家：families 行 + pairing_codes 行两条 INSERT（经同一条 --command 原子提交，撞码整批回滚） */
export function buildIssueStatements({ familyId, code, passphrase, now }) {
  return (
    `INSERT INTO families (family_id, created_at) VALUES ('${familyId}', ${now});\n` +
    `INSERT INTO pairing_codes (code, family_id, issued_at, passphrase) VALUES ('${code}', '${familyId}', ${now}, '${passphrase}');`
  )
}

/** 家庭码退役：只给该码的现役行打 retired_at 戳（不动家庭与设备） */
export function buildRetireSql(code, now) {
  return `UPDATE pairing_codes SET retired_at = ${now} WHERE code = '${code}' AND retired_at IS NULL;`
}

/** 全服家庭一览：相关子查询取数，避免 codes × devices join 扇出污染计数；按创建时间倒序 */
export function buildListSql() {
  return [
    'SELECT f.family_id,',
    '  (SELECT pc.code FROM pairing_codes pc WHERE pc.family_id = f.family_id AND pc.retired_at IS NULL ORDER BY pc.issued_at DESC LIMIT 1) AS active_code,',
    '  (SELECT pc.passphrase FROM pairing_codes pc WHERE pc.family_id = f.family_id AND pc.retired_at IS NULL ORDER BY pc.issued_at DESC LIMIT 1) AS active_passphrase,',
    '  (SELECT COUNT(*) FROM devices d WHERE d.family_id = f.family_id) AS device_total,',
    "  (SELECT COUNT(*) FROM devices d WHERE d.family_id = f.family_id AND d.status = 'active' AND d.revoked_at IS NULL) AS device_active,",
    '  (SELECT MAX(d.last_seen_at) FROM devices d WHERE d.family_id = f.family_id) AS last_seen_at,',
    '  f.created_at',
    'FROM families f',
    'ORDER BY f.created_at DESC;',
  ].join('\n')
}

/** 按码取整行：retire / add-passphrase 共用的前置资格查询 */
export function buildCodeLookupSql(code) {
  return `SELECT code, family_id, retired_at, passphrase FROM pairing_codes WHERE code = '${code}';`
}

/** 退役回查：UPDATE 后确认该码已打戳（wrangler --json 的 meta 无 changes 字段，免 meta 依赖） */
export function buildRetireVerifySql(code) {
  return `SELECT retired_at FROM pairing_codes WHERE code = '${code}';`
}

/** 退役资格判定：码不存在 / 已退役一律拒绝（幂等保护） */
export function decideRetire(row) {
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.retired_at != null) return { ok: false, reason: 'already_retired' }
  return { ok: true }
}

/** 补发口令写入：WHERE 限定现役且无口令行（并发下不覆盖已有口令、不给退役码补发） */
export function buildSetPassphraseSql(code, passphrase, now) {
  return `UPDATE pairing_codes SET passphrase = '${passphrase}' WHERE code = '${code}' AND retired_at IS NULL AND passphrase IS NULL;`
}

/** CLI 入参防线：6 位数字（配对码 CHECK 口径），非数字入参零 SQL 面即零注入面 */
export function isValidCode(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code)
}

/** 补发资格判定：码不存在 / 已退役 / 已有口令（幂等保护）一律拒绝 */
export function decideAddPassphrase(row) {
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.retired_at != null) return { ok: false, reason: 'retired' }
  if (row.passphrase != null) return { ok: false, reason: 'has_passphrase' }
  return { ok: true }
}

/** 撞全服主键识别（对齐 admin.ts：错误消息含 UNIQUE 即撞号） */
export function isCodeCollision(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('UNIQUE')
}

/** 默认钥匙对生成：family_id UUID + 6 位码 + 4 位口令（同批重试时整批换新） */
function generateKeyPair() {
  return { familyId: crypto.randomUUID(), code: generateCode(), passphrase: generatePassphrase() }
}

/** 撞码重试循环：executor 抛 UNIQUE → 整批换号重提；其他错误原样上抛；达到上限抛「换号重试耗尽」 */
export async function issueWithRetry({ executor, generate = generateKeyPair, now = Date.now(), maxAttempts = 20 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const keyPair = generate()
    try {
      await executor(buildIssueStatements({ ...keyPair, now }))
      return { ...keyPair, attempts: attempt }
    } catch (error) {
      if (!isCodeCollision(error)) throw error
    }
  }
  throw new Error(`家庭码撞号，换号重试耗尽（${maxAttempts} 次），请重跑 issue 子命令`)
}

/** JSONC → JSON：剥离 // 行注释与块注释（字符串字面量内的 // 不误伤） */
function stripJsoncComments(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\' && next !== undefined) {
        out += next
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    out += ch
  }
  return out
}

/** 从 wrangler.jsonc 读 D1 库名（脚本内零硬编码库名） */
export function parseDatabaseName(jsoncText) {
  const config = JSON.parse(stripJsoncComments(jsoncText))
  const dbName = config?.d1_databases?.[0]?.database_name
  if (!dbName) throw new Error('worker/wrangler.jsonc 缺少 d1_databases[0].database_name 配置')
  return dbName
}

const SUBCOMMANDS = new Set(['issue', 'retire', 'list', 'add-passphrase'])
/** 接受一个位置参数（6 位家庭码）的子命令；issue/list 零位置参数，多给即报错（AC7 不静默吞参） */
const ARG_SUBCOMMANDS = new Set(['retire', 'add-passphrase'])

/**
 * CLI 参数解析（票 #204）：纯函数，不碰 process/console，可单测。
 * 契约：入参为 argv 切片（process.argv.slice(2)）；返回
 *   { subcommand: string|undefined, arg: string|undefined, remote: boolean, error?: string }
 * - --remote 可出现在任意位置（子命令前/后、位置参数后），出现即连生产；缺省 remote=false（保守连本地）
 * - --local 可显式声明本地（与缺省等价，仅为自文档化）
 * - 未知 flag（如 --foo）/ 多余位置参数（含给 issue/list 带参、任何子命令带两个以上位置参数）/ 未知子命令
 *   → 返回 error 字符串，由 main 打印用法并退出非零（不静默落到错的库）
 * - 空参数 → subcommand 为 undefined 且无 error，由 main 打印 USAGE
 * - 子命令自身参数格式校验（如 retire 须 6 位码）不在这里，留给各子命令的入参防线
 */
export function parseCliArgs(argv) {
  const positionals = []
  let remote = false
  for (const token of argv) {
    if (token === '--remote') {
      remote = true
    } else if (token === '--local') {
      remote = false
    } else if (token.startsWith('--')) {
      return { subcommand: undefined, arg: undefined, remote: false, error: `未知参数: ${token}` }
    } else {
      positionals.push(token)
    }
  }
  const [subcommand, arg, ...extra] = positionals
  if (subcommand !== undefined && !SUBCOMMANDS.has(subcommand)) {
    return { subcommand, arg: undefined, remote, error: `未知子命令: ${subcommand}` }
  }
  if (extra.length > 0) {
    return { subcommand, arg, remote, error: `多余参数: ${[arg, ...extra].join(' ')}（各子命令至多接受一个位置参数）` }
  }
  if (subcommand !== undefined && arg !== undefined && !ARG_SUBCOMMANDS.has(subcommand)) {
    return { subcommand, arg, remote, error: `子命令 ${subcommand} 不接受位置参数: ${arg}` }
  }
  return { subcommand, arg, remote }
}

// ===== wrangler 调用边（不单测；--local/--remote 实走验证，remote 写操作有人工确认关口）=====

/** import.meta.url 兼容：Node 直跑为 file:// URL，vitest 模块管道下为裸路径 */
function moduleFilePath() {
  const raw = import.meta.url
  return raw.startsWith('file://') ? fileURLToPath(raw) : raw
}

function resolveFromScript(relative) {
  return `${moduleFilePath().replace(/\/[^/]*$/, '')}/${relative}`
}

const SCRIPT_PATH = moduleFilePath()
const WORKER_DIR = resolveFromScript('../worker/')
const WRANGLER_CONFIG = resolveFromScript('../worker/wrangler.jsonc')

/** 读目标 D1 库名（始终从 worker/wrangler.jsonc 解析，local/remote 同名、库位不同） */
function readDatabaseName() {
  return parseDatabaseName(readFileSync(WRANGLER_CONFIG, 'utf8'))
}

/**
 * 经 wrangler 直达 D1：remote=true 走 --remote（Cloudflare 生产库），否则 --local（本机 .wrangler 开发副本）。
 * statements 数组结果原样返回；非零退出码把 stderr 作为错误上抛（撞码识别靠消息含 UNIQUE）。
 */
function executeSql(sql, remote = false) {
  const dbName = readDatabaseName()
  const result = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', dbName, '--command', sql, '--json', remote ? '--remote' : '--local'],
    {
      cwd: WORKER_DIR,
      encoding: 'utf8',
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `wrangler d1 execute 退出码 ${result.status}`)
  }
  return JSON.parse(result.stdout.slice(result.stdout.indexOf('[')))
}

/** 目标库显著标示：每个子命令输出首行打印，local/remote 一眼分清（票 #204 AC5） */
function printTargetBanner(remote, dbName) {
  if (remote) {
    console.log(`⚠️ REMOTE / 生产库 ${dbName}（Cloudflare 生产 D1，真实用户数据，谨慎操作）`)
  } else {
    console.log(`🔧 LOCAL / 本地开发库（${dbName} 的本机 .wrangler 副本，与生产数据互不相通）`)
  }
}

/** readline 单问：在真实终端提示并读一行回答 */
function askOnce(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

/**
 * 生产写操作人工确认关口（票 #204 AC5）：remote 下 issue/retire/add-passphrase 执行任何 SQL 前必过。
 * 安全侧失败：非交互环境（stdin 无 TTY，如管道/CI/`echo yes | ...`）一律默认中止，绝不默认继续；
 * 交互环境下仅当输入 trim 后恰为 `yes` 才放行，其他任意输入（含空行/Ctrl-C 之外的 EOF）一律中止。
 */
async function confirmRemoteWrite(dbName, actionLabel) {
  if (process.stdin.isTTY !== true) {
    fail(
      `检测到非交互环境（无 TTY/管道输入），生产写操作（${actionLabel}）安全侧默认中止：未执行任何 SQL。\n` +
        '请在真实终端交互运行本命令，并按提示手动输入 yes 确认。',
    )
  }
  const answer = await askOnce(
    `⚠️ 即将对【生产】库 ${dbName} 执行写操作：${actionLabel}（真实数据，写后不可撤销）。\n` +
      '请输入 yes 确认继续，输入其他任意内容或直接回车即中止：',
  )
  if (answer.trim() !== 'yes') {
    fail('已中止：未输入 yes，未对生产库执行任何操作。')
  }
  console.log('✅ 已确认，开始执行生产写操作…')
}

function fail(message) {
  console.error(`❌ ${message}`)
  process.exit(1)
}

// ===== 子命令 =====

const USAGE = `运营方发码脚本（ADR 0007）：本地 wrangler 直达 D1，零公网端点、零管理凭据

用法：node tools/operator.mjs <子命令> [参数] [--remote]

  issue                       发码建空家：原子写入家庭行+现役钥匙对，终端一次性输出家庭码+口令明文
  retire <6位家庭码>          退役指定现役码（只拦后续加入，不动家庭与设备）
  list                        全服家庭一览（现役码/口令有无、设备数、最后活跃）
  add-passphrase <6位现役码>  为无口令的现役码补发家庭口令（已有口令拒绝，幂等保护）

目标库开关（显式指定，默认保守连本地）：
  （缺省 / --local）  本机 .wrangler 下的开发副本，与真实用户无关；本地与生产是两个互不相通的库
  --remote            Cloudflare 生产 D1（star-quiz-sync，真实用户数据）
                      --remote 下写操作（issue/retire/add-passphrase）执行前须在终端输入 yes 人工确认，
                      非交互环境（无 TTY/管道/CI）安全侧默认中止；list 为只读，--remote 下直接执行不确认`

async function cmdIssue(remote) {
  const dbName = readDatabaseName()
  printTargetBanner(remote, dbName)
  if (remote) await confirmRemoteWrite(dbName, 'issue 发码建空家（INSERT families + pairing_codes）')
  const { familyId, code, passphrase, attempts } = await issueWithRetry({
    executor: (sql) => executeSql(sql, remote),
  })
  console.log(`✅ 家庭已建（family_id: ${familyId}${attempts > 1 ? `，撞码换号重试 ${attempts - 1} 次` : ''}）`)
  console.log(`家庭码: ${code}`)
  console.log(`家庭口令: ${passphrase}`)
  console.log('（明文仅此一次输出，请立即分发给家庭保管）')
}

async function cmdRetire(code, remote) {
  const dbName = readDatabaseName()
  printTargetBanner(remote, dbName)
  if (!isValidCode(code)) fail('用法: node tools/operator.mjs retire <6位家庭码> [--remote]')
  if (remote) await confirmRemoteWrite(dbName, `retire 退役家庭码 ${code}（UPDATE pairing_codes 打 retired_at 戳）`)
  const found = executeSql(buildCodeLookupSql(code), remote)
  const decision = decideRetire(found[0]?.results?.[0] ?? null)
  if (!decision.ok) {
    const reasons = {
      not_found: `家庭码 ${code} 不存在`,
      already_retired: `家庭码 ${code} 已退役，无需重复操作`,
    }
    fail(reasons[decision.reason])
  }
  executeSql(buildRetireSql(code, Date.now()), remote)
  const verify = executeSql(buildRetireVerifySql(code), remote)
  const row = verify[0]?.results?.[0] ?? null
  if (!row || row.retired_at == null) fail(`家庭码 ${code} 退役写入未生效（回查 retired_at 为空），请重试`)
  console.log(`✅ 家庭码 ${code} 已退役（retired_at 已打戳；只拦后续加入，家庭与已配对设备不受影响）`)
}

async function cmdList(remote) {
  const dbName = readDatabaseName()
  printTargetBanner(remote, dbName)
  const statements = executeSql(buildListSql(), remote)
  const rows = statements[0]?.results ?? []
  if (rows.length === 0) {
    console.log('（库内暂无家庭）')
    return
  }
  console.log('family_id\t现役码\t口令\t设备(active/总)\t最后活跃')
  for (const row of rows) {
    const lastSeen = row.last_seen_at == null ? '从未活跃' : new Date(row.last_seen_at).toISOString()
    console.log(
      `${row.family_id}\t${row.active_code ?? '—'}\t${row.active_passphrase != null ? '有' : '无'}\t${row.device_active}/${row.device_total}\t${lastSeen}`,
    )
  }
}

async function cmdAddPassphrase(code, remote) {
  const dbName = readDatabaseName()
  printTargetBanner(remote, dbName)
  if (!isValidCode(code)) fail('用法: node tools/operator.mjs add-passphrase <6位现役家庭码> [--remote]')
  if (remote) {
    await confirmRemoteWrite(dbName, `add-passphrase 为现役码 ${code} 补发口令（UPDATE pairing_codes SET passphrase）`)
  }
  const found = executeSql(buildCodeLookupSql(code), remote)
  const decision = decideAddPassphrase(found[0]?.results?.[0] ?? null)
  if (!decision.ok) {
    const reasons = {
      not_found: `家庭码 ${code} 不存在`,
      retired: `家庭码 ${code} 已退役，不给退役码补发口令`,
      has_passphrase: `家庭码 ${code} 已有口令（幂等保护拒绝重发；如需轮换请由家长走家庭码重置，成对轮换钥匙对）`,
    }
    fail(reasons[decision.reason])
  }
  const passphrase = generatePassphrase()
  executeSql(buildSetPassphraseSql(code, passphrase, Date.now()), remote)
  const verify = executeSql(buildCodeLookupSql(code), remote)
  const row = verify[0]?.results?.[0] ?? null
  if (!row || row.passphrase == null) fail(`家庭码 ${code} 口令写入未生效（回查 passphrase 为空），请重试`)
  console.log(`✅ 已为现役码 ${code} 补发家庭口令: ${passphrase}`)
  console.log('（明文仅此一次输出，请立即分发给家庭保管）')
}

// ===== 入口（仅直接运行时派发；被单测 import 时不执行 CLI）=====

async function main() {
  const { subcommand, arg, remote, error } = parseCliArgs(process.argv.slice(2))
  if (error) {
    console.error(`❌ ${error}`)
    console.error('')
    console.error(USAGE)
    process.exit(1)
  }
  switch (subcommand) {
    case 'issue':
      await cmdIssue(remote)
      break
    case 'retire':
      await cmdRetire(arg, remote)
      break
    case 'list':
      await cmdList(remote)
      break
    case 'add-passphrase':
      await cmdAddPassphrase(arg, remote)
      break
    default:
      console.log(USAGE)
  }
}

const isDirectRun = process.argv[1] !== undefined && realpathSync(process.argv[1]) === SCRIPT_PATH
if (isDirectRun) {
  await main()
}
