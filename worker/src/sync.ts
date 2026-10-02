// 同步推拉端点（票 #123，ADR 0002 分域语义 / ADR 0005 库表定稿 / ADR 0003 薄同步）：
// - POST /api/sync/push：按域批量 upsert；LWW 实体（updated_at 裁决）与流水（主键存在性）全部由
//   SQL 约束承载（ON CONFLICT ... DO UPDATE ... WHERE / DO NOTHING），服务端零合并逻辑；
// - GET /api/sync/pull?since=<ms>：各域 server_at > since 的行（since=0 全量冷启动）+ 当前服务器时间戳。
// 一切读写按认证凭据反查的 family_id 过滤（家庭租户边界）；题库仅家长设备可推（家长单写）。

import type { Env } from './env'
import { errorResponse, okResponse } from './http'
import { authenticate, type AuthedDevice } from './auth'

/**
 * 当前同步协议版本（#174 版本不兼容防护）：6 = proposals 域新增可空 emoji 列（migrations 0010，#303）；
 * 5 = entry_visibility 域新增可空到期时间戳列 expires_at
 * （migrations 0009，#278 限时通道）；4 = trivia_entry 单布尔域替换为键控 entry_visibility 域
 * （migrations 0008，#262）；3 = 新增 trivia_entry 域（migrations 0007，#236）；
 * 2 = 断代行身份（child_id/kind 列，migrations 0003–0005）。
 * 域清单或列形状再变时递增；客户端（src/cloud/api.ts SYNC_PROTOCOL_REQUIRED）据此拒绝与旧 Worker 交换
 * （旧 Worker 不认识新域，push 整包 400——递增让新客户端在旧 Worker 上干净判停而非反复失败）。
 */
export const SYNC_PROTOCOL_VERSION = 6

/** GET /api/sync/capabilities：能力探测（Bearer 认证）——旧 Worker 无此端点（404），新客户端据此判停 */
export async function handleCapabilities(request: Request, env: Env, corsOrigin: string | null): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('method not allowed', 405, corsOrigin)
  }
  const auth = await authenticate(request, env, corsOrigin)
  if (!auth.ok) return auth.response
  return okResponse({ ok: true, sync_protocol: SYNC_PROTOCOL_VERSION }, 200, corsOrigin)
}

/** 域定义：列名硬编码常量（非用户输入），family_id 由凭据注入、server_at 由服务端生成 */
interface DomainDef {
  /** 表的复合主键列（不含 family_id 前缀差异——见 conflictKey） */
  conflictKey: string
  /** 客户端可见列（= 表列 - family_id - server_at），按 INSERT 绑定顺序 */
  columns: string[]
  /** 必填列（浅校验：存在且非 null；值域校验交给表 CHECK，违例统一 400） */
  required: string[]
  /** LWW 实体（true）：updated_at 裁决覆写；流水（false）：主键存在即忽略 */
  lww: boolean
}

/** 同步域清单（ADR 0002/0005，#180 新增临场状态） */
export const DOMAINS: Record<string, DomainDef> = {
  star_entries: {
    conflictKey: '(family_id, child_id, id)',
    columns: ['child_id', 'kind', 'id', 'timestamp', 'type', 'amount', 'source', 'quiz_id'],
    required: ['id', 'timestamp', 'type', 'amount', 'source'],
    lww: false,
  },
  question_results: {
    conflictKey: '(family_id, child_id, question_id, answered_at)',
    columns: ['child_id', 'question_id', 'answered_at', 'outcome'],
    required: ['question_id', 'answered_at', 'outcome'],
    lww: false,
  },
  word_appearances: {
    conflictKey: '(family_id, child_id, word_id, appeared_at)',
    columns: ['child_id', 'word_id', 'appeared_at'],
    required: ['word_id', 'appeared_at'],
    lww: false,
  },
  reward_items: {
    conflictKey: '(family_id, id)',
    columns: ['id', 'name', 'price', 'emoji', 'requirement', 'updated_at', 'updated_by', 'deleted'],
    required: ['id', 'name', 'price', 'updated_at', 'updated_by', 'deleted'],
    lww: true,
  },
  proposals: {
    conflictKey: '(family_id, child_id, id)',
    columns: [
      'child_id', 'id', 'name', 'price', 'status', 'created_at', 'updated_at', 'description',
      'parent_status', 'child_status', 'initiator', 'last_action_by', 'last_action_kind',
      'deleted', 'updated_by', 'emoji',
    ],
    // emoji 可空可选（#303，migrations 0010）：不进必填，省略落 NULL、读取侧兜底 🎁（同 reward_items.emoji 先例）
    required: ['id', 'name', 'price', 'status', 'created_at', 'updated_at', 'description'],
    lww: true,
  },
  active_redemptions: {
    conflictKey: '(family_id, child_id, id)',
    columns: ['child_id', 'id', 'reward_id', 'name', 'emoji', 'created_at', 'updated_at', 'updated_by', 'deleted'],
    required: ['id', 'reward_id', 'name', 'emoji', 'created_at', 'updated_at', 'updated_by', 'deleted'],
    lww: true,
  },
  question_flags: {
    conflictKey: '(family_id, child_id, question_id)',
    columns: ['child_id', 'question_id', 'flagged_at', 'updated_at', 'updated_by', 'deleted'],
    required: ['question_id', 'flagged_at', 'updated_at', 'updated_by', 'deleted'],
    lww: true,
  },
  morale: {
    conflictKey: '(family_id, child_id)',
    columns: ['child_id', 'level', 'last_round_correct', 'updated_at', 'updated_by', 'deleted'],
    required: ['child_id', 'level', 'updated_at', 'updated_by', 'deleted'],
    lww: true,
  },
  question_banks: {
    // 每家庭一行整组 JSON（家长单写、整组 LWW，ADR 0005）；content 服务端 stringify/parse
    conflictKey: '(family_id)',
    columns: ['content', 'updated_at', 'updated_by'],
    required: ['content', 'updated_at', 'updated_by'],
    lww: true,
  },
  entry_visibility: {
    // 逐入口显隐开关（#262：按 entry_id 键控，每家庭 × 每入口一行，整行 LWW 沿 question_banks 形状）；
    // #278 新增可空到期时间戳 expires_at（限时档，visible 1 + 到期；非限时行 NULL）；无墓碑列
    conflictKey: '(family_id, entry_id)',
    columns: ['entry_id', 'visible', 'expires_at', 'updated_at', 'updated_by'],
    required: ['entry_id', 'visible', 'updated_at', 'updated_by'],
    lww: true,
  },
}

function upsertSql(table: string, def: DomainDef): string {
  const cols = ['family_id', ...def.columns, 'server_at']
  const placeholders = cols.map(() => '?').join(', ')
  if (!def.lww) {
    // 纯追加流水：同主键重复上传幂等 = 并集（ADR 0002）
    return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT ${def.conflictKey} DO NOTHING`
  }
  // LWW 实体：仅当上行 updated_at 严格新于库内才整行覆写（含 server_at 游标刷新）；
  // 平手/更旧静默不动——约束级防护，服务端零合并逻辑（ADR 0003 薄同步）
  const sets = [...def.columns, 'server_at'].map((c) => `${c} = excluded.${c}`).join(', ')
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT ${def.conflictKey} DO UPDATE SET ${sets} WHERE excluded.updated_at > ${table}.updated_at`
}

/** 行浅校验：对象且必填列齐全非 null（值域违例如 amount<=0 由表 CHECK 拒 → 统一 400） */
function validRow(row: unknown, def: DomainDef): boolean {
  if (typeof row !== 'object' || row === null) return false
  const record = row as Record<string, unknown>
  if (def.columns.includes('child_id') && 'child_id' in record) {
    if (typeof record.child_id !== 'string' || record.child_id.trim().length === 0) return false
  }
  if (def.columns.includes('kind') && 'kind' in record) {
    if (typeof record.kind !== 'string' || !['main', 'game', 'interest'].includes(record.kind)) return false
  }
  if (def.columns.includes('requirement') && record.requirement != null) {
    if (typeof record.requirement !== 'object' || Array.isArray(record.requirement)) return false
    // 与经济导入契约一致，只校验数据形状，不判定兑换资格。
    const { kind, amount } = record.requirement as Record<string, unknown>
    if (typeof kind !== 'string' || !['main', 'game', 'interest'].includes(kind)
      || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return false
  }
  if (def === DOMAINS.morale) {
    // SQLite INTEGER affinity accepts numeric strings; reject coercion at the wire boundary.
    if (typeof record.level !== 'number' || !Number.isInteger(record.level) || record.level < 1 || record.level > 3
      || (record.last_round_correct != null && (typeof record.last_round_correct !== 'number'
        || !Number.isInteger(record.last_round_correct) || record.last_round_correct < 0 || record.last_round_correct > 10))
      || typeof record.updated_at !== 'number' || !Number.isInteger(record.updated_at)
      || typeof record.updated_by !== 'string'
      || (record.deleted !== 0 && record.deleted !== 1)) return false
  }
  if (def === DOMAINS.entry_visibility) {
    // 同 morale 口径：INTEGER 列在 wire boundary 拒绝字符串/布尔等亲和强制（#262）；
    // entry_id 是域内业务键（键控显隐），非空字符串才合法；
    // #278 expires_at 可空（非限时行缺省/null 合法 = 存量行为零变化）；出现时必须为正整数 epoch ms
    if (typeof record.entry_id !== 'string' || record.entry_id.trim().length === 0
      || (record.visible !== 0 && record.visible !== 1)
      || typeof record.updated_at !== 'number' || !Number.isInteger(record.updated_at)
      || typeof record.updated_by !== 'string') return false
    if (record.expires_at != null
      && (typeof record.expires_at !== 'number' || !Number.isInteger(record.expires_at) || record.expires_at <= 0)) {
      return false
    }
  }
  for (const col of def.required) {
    if ((row as Record<string, unknown>)[col] === undefined || (row as Record<string, unknown>)[col] === null) {
      return false
    }
  }
  return true
}

export async function handlePush(request: Request, env: Env, corsOrigin: string | null): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('method not allowed', 405, corsOrigin)
  }
  const auth = await authenticate(request, env, corsOrigin)
  if (!auth.ok) return auth.response
  const device: AuthedDevice = auth.device

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return errorResponse('invalid json body', 400, corsOrigin)
    }
    body = parsed as Record<string, unknown>
  } catch {
    return errorResponse('invalid json body', 400, corsOrigin)
  }

  for (const domain of Object.keys(body)) {
    if (!(domain in DOMAINS)) {
      return errorResponse(`unknown domain: ${domain}`, 400, corsOrigin)
    }
    const rows = body[domain]
    if (rows !== undefined && !Array.isArray(rows)) {
      return errorResponse(`invalid rows for ${domain}`, 400, corsOrigin)
    }
  }

  // 题库角色门禁：家长单写（ADR 0002）
  const bankRows = body['question_banks']
  if (Array.isArray(bankRows) && bankRows.length > 0 && device.role !== 'parent') {
    return errorResponse('question bank push requires a parent device', 403, corsOrigin)
  }

  const statements: D1PreparedStatement[] = []
  for (const [domain, def] of Object.entries(DOMAINS)) {
    const rows = body[domain]
    if (rows === undefined) continue
    for (const row of rows as unknown[]) {
      if (!validRow(row, def)) {
        return errorResponse(`invalid row for ${domain}`, 400, corsOrigin)
      }
      const record = row as Record<string, unknown>
      // content / requirement：客户端传 JSON 对象，库列 TEXT，服务端序列化；
      // 省略的可空列（quiz_id/emoji 等）undefined → null（D1 绑定不支持 undefined）
      const values = def.columns.map((c) => {
        if (c === 'content') return JSON.stringify(record[c])
        if (c === 'requirement') return record[c] == null ? null : JSON.stringify(record[c])
        if (c === 'child_id' && record[c] === undefined) return 'default'
        if (c === 'kind' && record[c] === undefined) return 'main'
        const v = record[c]
        return v === undefined ? null : v
      })
      statements.push(env.DB.prepare(upsertSql(domain, def)).bind(device.family_id, ...values, Date.now()))
    }
  }

  if (statements.length > 0) {
    try {
      await env.DB.batch(statements)
    } catch {
      // 绑定/表约束失败（值域违例等）：客户端数据问题 → 400
      return errorResponse('invalid rows (constraint violation)', 400, corsOrigin)
    }
  }

  return okResponse({ ok: true }, 200, corsOrigin)
}

export async function handlePull(request: Request, env: Env, corsOrigin: string | null): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('method not allowed', 405, corsOrigin)
  }
  const auth = await authenticate(request, env, corsOrigin)
  if (!auth.ok) return auth.response
  const device: AuthedDevice = auth.device

  const sinceRaw = new URL(request.url).searchParams.get('since')
  if (sinceRaw === null || !/^-?\d+$/.test(sinceRaw)) {
    return errorResponse('missing or invalid since (server_at ms)', 400, corsOrigin)
  }
  const since = Math.max(0, Number(sinceRaw))

  const result: Record<string, unknown[]> = {}
  await Promise.all(
    Object.entries(DOMAINS).map(async ([domain, def]) => {
      const cols = [...def.columns, 'server_at'].join(', ')
      const { results } = await env.DB.prepare(
        `SELECT ${cols} FROM ${domain} WHERE family_id = ? AND server_at > ? ORDER BY server_at`,
      )
        .bind(device.family_id, since)
        .all<Record<string, unknown>>()
      // question_banks.content：库列 TEXT → 响应还原为 JSON 对象
      result[domain] =
        domain === 'question_banks'
          ? results.map((row) => ({ ...row, content: JSON.parse(row['content'] as string) }))
          : domain === 'reward_items'
            ? results.map((row) => ({ ...row, requirement: row.requirement === null ? null : JSON.parse(row.requirement as string) }))
            : results
    }),
  )

  return okResponse(result, 200, corsOrigin)
}
