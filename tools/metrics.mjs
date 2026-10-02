#!/usr/bin/env node
// 匿名聚合指标导出脚本（票 #229，ADR 0013 聚合导出只读脚本与官方口径）
// 运行：node tools/metrics.mjs --weeks <N> [--remote] [--json] [--help]
// 经 npx wrangler d1 execute 只读直达 D1：默认 --local（本机 .wrangler 开发副本），
// --remote 连 Cloudflare 生产 D1（纯 SELECT 零写操作，故无确认横幅；提示信息走 stderr 不污染数据流）。
// 输出一行 = 匿名家庭 × 自然周（全网格、无活动补 0）：CSV 到 stdout（UTF-8 逗号分隔含表头；--json 为 JSON 数组）。
// 匿名 ID：sha256('sq-metrics-v1' + family_id) 截 16 位（family_id 终身不变、码重置不断链，ADR 0013）。
// 时间口径（worker/migrations/0001 头注释）：
//   question_results.answered_at = TEXT ISO 8601 UTC（客户端 new Date().toISOString()，src/composables/useQuiz.ts）；
//   star_entries.timestamp / proposals.* / devices.paired_at / families.created_at = INTEGER 客户端本地毫秒；
//   *.server_at = INTEGER UTC 毫秒。三者同为绝对时刻，统一按 Asia/Shanghai (+8，无夏令时) 折日界，
//   周桶 = ISO 周（周一起始）。聚合全部在 SQL 侧完成（SELECT 只出家庭 × 周桶计数行，无逐题明细）；
//   family_id 仅在进程内存中转（聚合键），最终输出经 sha256 映射为 anon_id，任何路径不输出家庭码/口令/设备名。
// 纯函数区（ISO 周换算 / 匿名 ID / SQL 组装 / CSV 拼装 / 参数解析）导出供单测：tests/acceptance/40-metrics-script.test.ts
import { readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseDatabaseName } from './operator.mjs'

// ===== 常量（口径锚点）=====

/** 匿名 ID 前缀（版本化：换口径时 bump v1 → v2 即换整套 ID） */
const ANON_ID_PREFIX = 'sq-metrics-v1'
/** Asia/Shanghai 固定偏移 +8 小时（无夏令时，全年恒定） */
const TZ_OFFSET_MS = 8 * 3600 * 1000
const DAY_MS = 86400000

/** 输出列（顺序即 CSV 列序，schema 见 USAGE） */
export const METRIC_COLUMNS = [
  'anon_id',
  'family_created_week',
  'iso_week',
  'quiz_days_event',
  'quiz_days_sync',
  'quiz_active',
  'redemption_count',
  'proposal_touched',
  'proposal_created_count',
  'first_device_flag',
  'child_device_joins',
]

// ===== 纯函数区（可导出、可单测；自写 ISO 周换算，零第三方依赖）=====

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 取 UTC 字段格式化 'YYYY-MM-DD'（配合 +8h 偏移后的 Date，即北京墙上日期） */
function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

/** 北京墙上日期 → 该周周一日期（ISO 周周一起始：%w 给 0=周日..6=周六，(w+6)%7 = 距周一回退天数） */
function beijingDateToMonday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d)
  const weekday = new Date(utc).getUTCDay()
  return formatUtcDate(new Date(utc - ((weekday + 6) % 7) * DAY_MS))
}

/** 绝对毫秒（Date.now()/server_at 等本地或 UTC 毫秒语义同构）→ 北京墙上周一日期 */
export function msToBeijingMonday(ms) {
  const shifted = new Date(ms + TZ_OFFSET_MS) // UTC 字段 = 北京墙上时间
  return beijingDateToMonday(formatUtcDate(shifted))
}

/** 周一日期平移 N 天 */
function shiftMonday(monday, days) {
  const [y, m, d] = monday.split('-').map(Number)
  return formatUtcDate(new Date(Date.UTC(y, m - 1, d) + days * DAY_MS))
}

/**
 * TEXT ISO 8601（question_results.answered_at 口径）→ 北京墙上周一日期。
 * 归一规则与 SQLite date() 同构：无时区标记的串按 UTC 解析（数据源 toISOString 恒带 Z，此为防御归一）。
 */
export function isoTextToBeijingMonday(isoText) {
  const normalized = normalizeIsoText(isoText)
  return msToBeijingMonday(Date.parse(normalized))
}

/** ISO 串防御归一：校验形状 + 无时区标记补 Z；非法串抛错（宁可炸也不静默错桶） */
export function normalizeIsoText(isoText) {
  if (typeof isoText !== 'string' || !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(isoText)) {
    throw new Error(`非法 ISO 8601 时间串: ${isoText}`)
  }
  return /(Z|[+-]\d{2}:?\d{2})$/.test(isoText) ? isoText : `${isoText}Z`
}

/** 周一日期 → ISO 周标识 'YYYY-Www'（周四定 ISO 年、1 月 4 日恒在第 1 周，ISO 8601 经典算法） */
export function beijingMondayToIsoWeek(monday) {
  const [y, m, d] = monday.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const isoYear = new Date(ms + 3 * DAY_MS).getUTCFullYear() // 该周周四所在年 = ISO 年
  const jan4 = Date.UTC(isoYear, 0, 4)
  const jan4Weekday = new Date(jan4).getUTCDay()
  const week1Monday = jan4 - ((jan4Weekday + 6) % 7) * DAY_MS // 第 1 周周一（可能落在上年 12 月末）
  const week = Math.round((ms - week1Monday) / (7 * DAY_MS)) + 1
  return `${isoYear}-W${pad2(week)}`
}

/** 北京周一 00:00 对应的绝对毫秒（= 该日 UTC 00:00 减 8 小时；与 SQL 侧 (strftime('%s',…)-28800)*1000 同构） */
function mondayToUtcMs(monday) {
  return Date.parse(`${monday}T00:00:00Z`) - TZ_OFFSET_MS
}

/** 最近 N 个自然周的周一日期数组（升序，末位 = now 所在北京周；含当前不完整周） */
export function recentWeekMondays(nowMs, weeks) {
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error(`weeks 须为正整数: ${weeks}`)
  const last = msToBeijingMonday(nowMs)
  const mondays = []
  for (let i = weeks - 1; i >= 0; i--) mondays.push(shiftMonday(last, -7 * i))
  return mondays
}

/** 匿名家庭 ID：sha256(固定前缀 + family_id) 十六进制截 16 位（跨周/跨导出稳定，ADR 0013） */
export function anonFamilyId(familyId) {
  return createHash('sha256').update(ANON_ID_PREFIX + familyId).digest('hex').slice(0, 16)
}

/** SQLite 片段：内层日期表达式（北京墙上日期）→ 周一日期；与 JS beijingDateToMonday 同构 */
function sqlMondayOf(beijingDateExpr) {
  return (
    `date(${beijingDateExpr}, '-' || ((strftime('%w', ${beijingDateExpr}) + 6) % 7) || ' days')`
  )
}

/** SQLite 片段：INTEGER 毫秒列 → 北京墙上日期 */
function sqlBeijingDateOfMs(column) {
  return `date(${column} / 1000, 'unixepoch', '+8 hours')`
}

/**
 * 聚合 SQL 组装（纯函数，不碰进程/库）：一条 SELECT 出全网格行。
 * - weeks CTE 由 JS 算好的周一生成（VALUES 列表，无递归依赖）
 * - grid：families × 周，建家时刻 < 周末（= 下周一北京 00:00）才有行——即「建家时刻 ≤ 该周末」
 * - 各事件子查询独立按自身时间列过滤 + 分桶（quiz_sync 与 quiz_event 行集互不牵连，交叉校验口径自洽）
 * - LEFT JOIN + COALESCE 补零；输出列 = METRIC_COLUMNS 对应的原始形态（family_id 在此仍是聚合键，
 *   由调用方 mapExportRows 映射为 anon_id 后才离开进程）
 */
export function buildMetricsSql(mondays) {
  if (!Array.isArray(mondays) || mondays.length === 0) throw new Error('buildMetricsSql 需非空周一起始数组')
  const first = mondays[0]
  const endMonday = shiftMonday(mondays[mondays.length - 1], 7)
  const startMs = mondayToUtcMs(first)
  const endMs = mondayToUtcMs(endMonday)
  const startIso = new Date(startMs).toISOString()
  const endIso = new Date(endMs).toISOString()
  const values = mondays.map((m) => `('${m}')`).join(', ')
  return [
    `WITH weeks(monday) AS (VALUES ${values}),`,
    `grid AS (`,
    `  SELECT f.family_id AS family_id,`,
    `         w.monday AS monday,`,
    `         ${sqlMondayOf(sqlBeijingDateOfMs('f.created_at'))} AS family_created_monday`,
    `  FROM families f CROSS JOIN weeks w`,
    `  WHERE f.created_at < (CAST(strftime('%s', date(w.monday, '+7 days')) AS INTEGER) - 28800) * 1000`,
    `),`,
    `quiz_event AS (`,
    `  SELECT family_id,`,
    `         ${sqlMondayOf(`date(answered_at, '+8 hours')`)} AS monday,`,
    `         COUNT(DISTINCT date(answered_at, '+8 hours')) AS quiz_days_event`,
    `  FROM question_results`,
    `  WHERE answered_at >= '${startIso}' AND answered_at < '${endIso}'`,
    `  GROUP BY family_id, monday`,
    `),`,
    `quiz_sync AS (`,
    `  SELECT family_id,`,
    `         ${sqlMondayOf(sqlBeijingDateOfMs('server_at'))} AS monday,`,
    `         COUNT(DISTINCT ${sqlBeijingDateOfMs('server_at')}) AS quiz_days_sync`,
    `  FROM question_results`,
    `  WHERE server_at >= ${startMs} AND server_at < ${endMs}`,
    `  GROUP BY family_id, monday`,
    `),`,
    `redeem AS (`,
    `  SELECT family_id,`,
    `         ${sqlMondayOf(sqlBeijingDateOfMs('timestamp'))} AS monday,`,
    `         COUNT(*) AS redemption_count`,
    `  FROM star_entries`,
    `  WHERE type = 'redeem' AND timestamp >= ${startMs} AND timestamp < ${endMs}`,
    `  GROUP BY family_id, monday`,
    `),`,
    `prop_action AS (`,
    `  SELECT family_id,`,
    `         ${sqlMondayOf(sqlBeijingDateOfMs('updated_at'))} AS monday,`,
    `         1 AS proposal_touched`,
    `  FROM proposals`,
    `  WHERE updated_at >= ${startMs} AND updated_at < ${endMs}`,
    `  GROUP BY family_id, monday`,
    `),`,
    `prop_created AS (`,
    `  SELECT family_id,`,
    `         ${sqlMondayOf(sqlBeijingDateOfMs('created_at'))} AS monday,`,
    `         COUNT(*) AS proposal_created_count`,
    `  FROM proposals`,
    `  WHERE created_at >= ${startMs} AND created_at < ${endMs}`,
    `  GROUP BY family_id, monday`,
    `),`,
    `first_parent AS (`,
    `  SELECT family_id, MIN(paired_at) AS first_paired_at`,
    `  FROM devices`,
    `  WHERE role = 'parent' AND status = 'active' AND revoked_at IS NULL`,
    `  GROUP BY family_id`,
    `),`,
    `first_device AS (`,
    `  SELECT family_id,`,
    `         ${sqlMondayOf(sqlBeijingDateOfMs('first_paired_at'))} AS monday,`,
    `         1 AS first_device_flag`,
    `  FROM first_parent`,
    `  WHERE first_paired_at >= ${startMs} AND first_paired_at < ${endMs}`,
    `),`,
    `child_joins AS (`,
    `  SELECT family_id,`,
    `         ${sqlMondayOf(sqlBeijingDateOfMs('paired_at'))} AS monday,`,
    `         COUNT(*) AS child_device_joins`,
    `  FROM devices`,
    `  WHERE role = 'child' AND paired_at >= ${startMs} AND paired_at < ${endMs}`,
    `  GROUP BY family_id, monday`,
    `)`,
    `SELECT g.family_id, g.monday, g.family_created_monday,`,
    `  COALESCE(qe.quiz_days_event, 0) AS quiz_days_event,`,
    `  COALESCE(qs.quiz_days_sync, 0) AS quiz_days_sync,`,
    `  CASE WHEN COALESCE(qe.quiz_days_event, 0) >= 1 THEN 1 ELSE 0 END AS quiz_active,`,
    `  COALESCE(r.redemption_count, 0) AS redemption_count,`,
    `  COALESCE(pa.proposal_touched, 0) AS proposal_touched,`,
    `  COALESCE(pc.proposal_created_count, 0) AS proposal_created_count,`,
    `  COALESCE(fd.first_device_flag, 0) AS first_device_flag,`,
    `  COALESCE(cj.child_device_joins, 0) AS child_device_joins`,
    `FROM grid g`,
    `LEFT JOIN quiz_event qe ON qe.family_id = g.family_id AND qe.monday = g.monday`,
    `LEFT JOIN quiz_sync qs ON qs.family_id = g.family_id AND qs.monday = g.monday`,
    `LEFT JOIN redeem r ON r.family_id = g.family_id AND r.monday = g.monday`,
    `LEFT JOIN prop_action pa ON pa.family_id = g.family_id AND pa.monday = g.monday`,
    `LEFT JOIN prop_created pc ON pc.family_id = g.family_id AND pc.monday = g.monday`,
    `LEFT JOIN first_device fd ON fd.family_id = g.family_id AND fd.monday = g.monday`,
    `LEFT JOIN child_joins cj ON cj.family_id = g.family_id AND cj.monday = g.monday`,
    `ORDER BY g.family_id, g.monday;`,
  ].join('\n')
}

/** SQL 聚合行 → 导出行（family_id 映射 anon_id、周一映射 ISO 周；计数归一为 number）。离开本函数即无明文 family_id */
export function mapExportRows(rawRows) {
  return rawRows.map((row) => ({
    anon_id: anonFamilyId(row.family_id),
    family_created_week: beijingMondayToIsoWeek(row.family_created_monday),
    iso_week: beijingMondayToIsoWeek(row.monday),
    quiz_days_event: Number(row.quiz_days_event),
    quiz_days_sync: Number(row.quiz_days_sync),
    quiz_active: Number(row.quiz_active),
    redemption_count: Number(row.redemption_count),
    proposal_touched: Number(row.proposal_touched),
    proposal_created_count: Number(row.proposal_created_count),
    first_device_flag: Number(row.first_device_flag),
    child_device_joins: Number(row.child_device_joins),
  }))
}

/** CSV 拼装：首行表头（METRIC_COLUMNS 列序），逗号分隔，行尾换行；字段集为 hex/ISO 周/整数，无转义需求 */
export function toCsv(rows) {
  const lines = [METRIC_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(METRIC_COLUMNS.map((column) => String(row[column])).join(','))
  }
  return `${lines.join('\n')}\n`
}

/**
 * CLI 参数解析（纯函数，不碰 process/console，可单测）。
 * 契约：入参为 argv 切片；返回 { weeks: number|undefined, remote: boolean, json: boolean, help: boolean, error?: string }
 * - --weeks <N> 必填（正整数，缺失/非正整数/缺值 → error；数字校验后注入面为零）
 * - --remote / --json / --help 任意位置；--help 时不再要求 --weeks
 * - 未知 flag / 多余位置参数 → error，由 main 打印用法并退出非零
 */
export function parseMetricsArgs(argv) {
  let weeks
  let remote = false
  let json = false
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--remote') {
      remote = true
    } else if (token === '--json') {
      json = true
    } else if (token === '--help' || token === '-h') {
      help = true
    } else if (token === '--weeks') {
      const value = argv[i + 1]
      if (value === undefined) return { weeks, remote, json, help, error: '--weeks 缺少数值参数（用法：--weeks <N>）' }
      if (!/^\d+$/.test(value) || Number(value) < 1) return { weeks, remote, json, help, error: `--weeks 须为正整数: ${value}` }
      weeks = Number(value)
      i++
    } else {
      return { weeks, remote, json, help, error: `未知参数: ${token}` }
    }
  }
  if (!help && weeks === undefined) return { weeks, remote, json, help, error: '缺少必填参数 --weeks <N>' }
  return { weeks, remote, json, help }
}

// ===== wrangler 调用边（不单测；与 operator.mjs 同通道，仅 SELECT 只读）=====

/** import.meta.url 兼容：Node 直跑为 file:// URL，vitest 模块管道下为裸路径（与 operator.mjs 同法） */
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

/** 读目标 D1 库名：复用 operator.mjs 已导出的 parseDatabaseName（库名解析口径单一来源） */
function readDatabaseName() {
  return parseDatabaseName(readFileSync(WRANGLER_CONFIG, 'utf8'))
}

/**
 * 经 wrangler 只读直达 D1（复制自 operator.mjs 的 executeSql——彼处未导出，且本脚本不需要其写路径语义）。
 * remote=true 走 --remote（生产库），否则 --local；纯 SELECT 无写操作。
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

// ===== 入口（仅直接运行时派发；被单测 import 时不执行 CLI）=====

const USAGE = `匿名聚合指标导出（票 #229 / ADR 0013）：家庭 × 自然周只读聚合，输出仅周桶计数
用法：node tools/metrics.mjs --weeks <N> [--remote] [--json] [--help]

  --weeks <N>   导出最近 N 个自然周（含当前周；周桶 = ISO 周 × Asia/Shanghai 日界）
  --remote      查 Cloudflare 生产 D1（纯 SELECT 只读，无确认横幅；缺省连本地开发库）
  --json        输出 JSON 数组（缺省 CSV：UTF-8 逗号分隔、首行表头）
  --help        打印本用法

输出列（一行 = 匿名家庭 × 自然周，全网格、无活动补 0）：
  anon_id                 sha256('sq-metrics-v1' + family_id) 截 16 位（跨周稳定，ADR 0013）
  family_created_week     建家所在 ISO 周（families.created_at，cohort 用）
  iso_week                该行周桶（周一起始 ISO 周）
  quiz_days_event         当周 DISTINCT 答题日数（question_results.answered_at，主口径）
  quiz_days_sync          当周 DISTINCT 同步到达日数（question_results.server_at，交叉校验口径）
  quiz_active             当周有答题活动（quiz_days_event ≥ 1）→ 1/0
  redemption_count        当周兑换次数（star_entries type='redeem'，按 timestamp 归周）
  proposal_touched        当周提议板有动作（proposals.updated_at 落行）→ 1/0
  proposal_created_count  当周新建提议数（proposals.created_at）
  first_device_flag       该家最早 active 家长设备 paired_at 落在本周 → 1/0
  child_device_joins      当周孩子设备加入数（role='child' paired_at 行数，申请时刻近似批准）

口径备注：学习文件导入次数本期不交付（D1 无动作痕迹，ADR 0013）；提议板/设备配对为降级口径
（最终状态/申请时刻近似）。匿名边界：导出文件无家庭码/口令/设备名；家庭由运营方发码创建、
台账可反查（ADR 0013）。提示与横幅走 stderr，stdout 仅数据（可直接重定向落盘）。`

function fail(message) {
  console.error(`❌ ${message}`)
  process.exit(1)
}

async function main() {
  const { weeks, remote, json, help, error } = parseMetricsArgs(process.argv.slice(2))
  if (error) {
    console.error(`❌ ${error}`)
    console.error('')
    console.error(USAGE)
    process.exit(1)
  }
  if (help) {
    console.log(USAGE)
    return
  }
  const dbName = readDatabaseName()
  // 横幅/提示一律 stderr：stdout 只剩 CSV/JSON，重定向落盘即干净导出文件
  if (remote) {
    console.error(`📊 REMOTE / 生产库 ${dbName}（只读聚合导出，无写操作）`)
  } else {
    console.error(`🔧 LOCAL / 本地开发库（${dbName} 的本机 .wrangler 副本，与生产数据互不相通）`)
  }
  const mondays = recentWeekMondays(Date.now(), weeks)
  const sql = buildMetricsSql(mondays)
  const statements = executeSql(sql, remote)
  const rawRows = statements[0]?.results ?? []
  if (rawRows.length === 0) console.error('（范围内无家庭，stdout 仅输出表头/空数组）')
  const rows = mapExportRows(rawRows)
  console.log(json ? JSON.stringify(rows, null, 2) : toCsv(rows))
}

const isDirectRun = process.argv[1] !== undefined && realpathSync(process.argv[1]) === SCRIPT_PATH
if (isDirectRun) {
  await main()
}
