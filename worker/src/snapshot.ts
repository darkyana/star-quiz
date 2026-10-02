// 快照与回滚（票 #124，ADR 0002「云端保留当前态 + 每日快照 ×30 天」/ ADR 0005 表结构）：
// - 同步域 10 表 = 纯追加流水 ×3 + 记录级 LWW 实体 ×5 + 题库整组 ×1 + 开关单值 ×1（设备凭据域不进快照）
// - #247 起表清单 / 列清单 / 墓碑过滤一律从 sync.ts DOMAINS 推导：新增域后快照与回滚自动跟随，本模块零改动
// - GET  /api/snapshots（家长设备，票 #128）：近 30 天每日快照列表（时间点，倒序最新在前）；
//   窗口过滤归服务端（#127 拍板：客户端不二次裁剪），他家庭快照不可见（family_id 租户边界）
// - POST /api/snapshots/<id>/restore（家长设备）：快照整包写回各域当前态——
//   以新版本写入（打新 server_at），不做 D1 时间旅行；快照里没有的行打墓碑而非物理删
//   （LWW 世界物理 DELETE 不可合并）；纯追加流水按并集语义只恢复快照内行、不回退其后增量。
import { requireParent } from './auth'
import type { Env } from './env'
import { errorResponse, jsonResponse, okResponse } from './http'
import { DOMAINS } from './sync'

/** 快照保留窗口 ×30 天（ADR 0002）：Cron 窗口外清理与列表端点窗口过滤同源，单一真相 */
export const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** 同步域表名（#247 起从 sync.ts DOMAINS 推导，单一真相：新增域自动进每日快照与回滚，
 *  无需记得另改本模块）；顺序 = DOMAINS 键序，与 stateSelects / upsert SQL 一一对应。
 *  注：推导后 SyncTableName 退化为 string 别名，静态字面量联合护栏让位于单一真相源（运行时一致由测试锁定） */
export const SYNC_TABLE_NAMES = Object.keys(DOMAINS)

export type SyncTableName = (typeof SYNC_TABLE_NAMES)[number]

/** 有墓碑列的实体表（读快照过滤墓碑、回滚先全量打墓碑）：从 DOMAINS 列集推导——
 *  题库/开关为无墓碑列的整组表、流水为纯追加并集，均不在列 */
const TOMBSTONE_TABLE_NAMES: readonly SyncTableName[] = SYNC_TABLE_NAMES.filter(
  (table) => DOMAINS[table].columns.includes('deleted'),
)

/** 快照 content 结构（结构版本化留位，票 #124 取 1） */
export interface SnapshotContent {
  schema_version: number
  family_id: string
  taken_at: number
  tables: Record<SyncTableName, Record<string, unknown>[]>
}

/** 单家庭全域当前态读取（D1 batch 单事务一致视图），跟随 DOMAINS（表名非用户输入，与 push 端 upsertSql 同口径）：
 * 有墓碑列的实体表过滤墓碑（当前态 = 活行）；流水表与整组表取全行。 */
export function stateSelects(db: D1Database, familyId: string): D1PreparedStatement[] {
  return SYNC_TABLE_NAMES.map((table) => {
    const tombstoneFilter = DOMAINS[table].columns.includes('deleted') ? ' AND deleted = 0' : ''
    return db.prepare(`SELECT * FROM ${table} WHERE family_id = ?${tombstoneFilter}`).bind(familyId)
  })
}

/** 各表 upsert 列序（INSERT OR REPLACE：同主键重复应用幂等，值以本包为准）：
 * family_id + 该域客户端可见列（DOMAINS.columns 同序）+ server_at，与 push 端 upsertSql 列集同构 */
const UPSERT_COLUMNS: Record<SyncTableName, readonly string[]> = Object.fromEntries(
  SYNC_TABLE_NAMES.map((table) => [table, ['family_id', ...DOMAINS[table].columns, 'server_at']]),
)

/**
 * 快照整包写回（回滚）：单 batch 原子完成。
 * - LWW 实体表：当前活行先全量打墓碑（快照外行最终呈墓碑态），快照行随后 REPLACE 覆盖回活行
 *   （updated_at 还原快照原值——LWW 裁决时钟回到快照时刻；server_at 打回滚时刻新值）
 * - 流水表：快照行 upsert 恢复原值；快照后的新增行按并集语义保留（append-only 无删除概念）
 * - 题库：快照有行则整组 REPLACE；快照无行则该域回到空态（单行整组无墓碑列，物理删是模型内唯一表达）
 */
export async function restoreSnapshotState(
  db: D1Database,
  familyId: string,
  actorDeviceId: string,
  snapshot: SnapshotContent,
): Promise<void> {
  const now = Date.now()
  const statements: D1PreparedStatement[] = []

  for (const table of TOMBSTONE_TABLE_NAMES) {
    // Snapshots taken before a domain existed (e.g. pre-#180 morale) do not carry its key;
    // absence is not an empty current state — leave live rows alone.
    if (!Object.hasOwn(snapshot.tables, table)) continue
    statements.push(
      db.prepare(
        `UPDATE ${table} SET deleted = 1, updated_at = ?, updated_by = ?, server_at = ? WHERE family_id = ? AND deleted = 0`,
      ).bind(now, actorDeviceId, now, familyId),
    )
  }

  for (const table of SYNC_TABLE_NAMES) {
    const columns = UPSERT_COLUMNS[table]
    const placeholders = columns.map(() => '?').join(', ')
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
    // child_id 必填与否跟随域定义（唯一必填域 = morale，#180）：必填域行缺失/空串即坏包拒绝
    const childIdRequired = DOMAINS[table].required.includes('child_id')
    for (const row of snapshot.tables[table] ?? []) {
      if (columns.includes('child_id') && (childIdRequired || 'child_id' in row)
        && (typeof row.child_id !== 'string' || row.child_id.trim().length === 0)) {
        throw new Error('invalid snapshot child_id')
      }
      if (columns.includes('kind') && 'kind' in row
        && (typeof row.kind !== 'string' || !['main', 'game', 'interest'].includes(row.kind))) {
        throw new Error('invalid snapshot kind')
      }
      // 旧 schema_version=1 快照没有新增列：仅缺省补 default/main/null。
      const values = columns.map((column) => {
        if (column === 'server_at') return now
        if (column === 'child_id' && row[column] === undefined) return 'default'
        if (column === 'kind' && row[column] === undefined) return 'main'
        if (column === 'requirement' && row[column] === undefined) return null
        // #278 旧快照行缺 expires_at（可空列）：补 null（非限时 = 保持开启语义），避免绑定 undefined
        if (column === 'expires_at' && row[column] === undefined) return null
        // #303 旧快照行缺 proposals.emoji（可空可选列）：补 null（读取侧兜底 🎁），避免绑定 undefined
        if (column === 'emoji' && row[column] === undefined) return null
        return row[column]
      })
      statements.push(db.prepare(sql).bind(...values))
    }
  }

  // 无墓碑列的整组表（题库 #124 / 开关 #236，= LWW 且无 deleted 列，从 DOMAINS 推导）：空态的唯一表达是物理删；
  // 流水表（lww=false）空数组不删——并集语义保留快照后增量。
  // 整组表显式空数组才清空（开关回「未设置 = 默认显示」）；旧快照缺键 = 快照时刻无此域，保留当前态
  // （沿 #180 morale 缺域口径；question_banks 自 #124 起快照必有键，缺键豁免对既有快照行为不变且更保守）
  for (const table of SYNC_TABLE_NAMES) {
    const def = DOMAINS[table]
    if (!def.lww || def.columns.includes('deleted')) continue
    if (Object.hasOwn(snapshot.tables, table) && (snapshot.tables[table] ?? []).length === 0) {
      statements.push(db.prepare(`DELETE FROM ${table} WHERE family_id = ?`).bind(familyId))
    }
  }

  // 全域缺键的旧快照（如手工构造的 tables:{}）可能一条语句都不产生：空数组 batch 会被 D1 拒绝，判空跳过（同 handlePush 口径）
  if (statements.length > 0) {
    await db.batch(statements)
  }
}

/** GET /api/snapshots + POST /api/snapshots/<id>/restore（家长设备）；不匹配返回 null */
export async function handleSnapshotRoutes(request: Request, env: Env, corsOrigin: string | null, pathname: string): Promise<Response | null> {
  // GET 列表：精确路径匹配在前（与下方 restore 正则互不重叠），认证/家长门禁同 restore 口径
  if (pathname === '/api/snapshots') {
    if (request.method !== 'GET') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    const device = guard.device

    // 近 30 天窗口过滤归服务端（与 Cron 清理同窗口常量，窗口外即便尚未被清理也不可见）；
    // 按 taken_at 倒序（最新在前），行形状 { snapshot_id, taken_at } 对齐客户端 SnapshotRow 契约
    const cutoff = Date.now() - SNAPSHOT_RETENTION_MS
    const result = await env.DB.prepare(
      'SELECT snapshot_id, taken_at FROM family_snapshots WHERE family_id = ? AND taken_at >= ? ORDER BY taken_at DESC',
    )
      .bind(device.family_id, cutoff)
      .all<{ snapshot_id: string; taken_at: number }>()
    return okResponse({ snapshots: result.results }, 200, corsOrigin)
  }

  const match = /^\/api\/snapshots\/([^/]+)\/restore$/.exec(pathname)
  if (match === null) return null
  if (request.method !== 'POST') return errorResponse('method not allowed', 405, corsOrigin)

  const guard = await requireParent(request, env, corsOrigin)
  if ('response' in guard) return guard.response
  const device = guard.device

  // 快照按家庭隔离：他家庭的 snapshot_id 不可见 → 404
  const snapshotId = decodeURIComponent(match[1]!)
  const row = await env.DB.prepare(
    'SELECT content FROM family_snapshots WHERE family_id = ? AND snapshot_id = ?',
  )
    .bind(device.family_id, snapshotId)
    .first<{ content: string }>()
  if (row === null) return jsonResponse({ error: 'not found' }, 404, corsOrigin)

  let snapshot: SnapshotContent
  try {
    snapshot = JSON.parse(row.content) as SnapshotContent
  } catch {
    return jsonResponse({ error: 'corrupt snapshot' }, 500, corsOrigin)
  }
  if (snapshot.schema_version !== 1 || snapshot.family_id !== device.family_id) {
    return jsonResponse({ error: 'unsupported snapshot' }, 500, corsOrigin)
  }

  try {
    await restoreSnapshotState(env.DB, device.family_id, device.device_id, snapshot)
  } catch {
    return jsonResponse({ error: 'restore failed' }, 500, corsOrigin)
  }
  return okResponse({ ok: true, snapshot_id: snapshotId }, 200, corsOrigin)
}
