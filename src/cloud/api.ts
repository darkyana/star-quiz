// 云端 API 薄封装（#125，R-P1c）：本仓客户端 fetch 的统一出口。
// 契约对齐 worker/src/pair.ts（#123 → #142 申请化；#192 双因子补 passphrase 选填）：POST /api/pair { code, device_name, role, passphrase? } →
// 200 同构签发凭据（device_id + secret + status：pending 等待批准 · active 直入，明文仅此一次）/
// 400 格式校验兜底 / 429 per-IP 全提交限流（error 串带 retry 秒数）；错误结构统一 { error: string }。
// #126（R-P1d）扩展：同步推拉薄封装（契约 worker/src/sync.ts）——Bearer 认证头助手 +
// POST /api/sync/push（按域行批量 upsert）/ GET /api/sync/pull?since=<ms>（各域增量 + server_at）。
// #142（R-129a）扩展：GET /api/pair/status 申请状态轮询（唯一对 pending 凭据放行的端点）。
// 断网零退化：请求仅由用户显式动作触发（配对提交 / 等待页轮询）；fetch 抛错归一为 network 失败，
// 不抛异常、不阻塞 App 其余功能。文案映射归 copy.ts（本模块只归一错误类别）。

import { confirmFamilyStatus, type DeviceCredential } from '../composables/useDeviceCredential'

export const DEFAULT_API_BASE = 'https://api.starquiz.link'

/** 解析 API base：调用处显式覆盖（本地验证）> VITE_API_BASE > 生产默认 */
function resolveBase(override?: string): string {
  if (typeof override === 'string' && override !== '') return override
  const env = import.meta.env?.VITE_API_BASE
  return typeof env === 'string' && env !== '' ? env : DEFAULT_API_BASE
}

/**
 * 配对提交失败类别（页面据此映射 copy 文案；服务端 error 串见 worker/src/pair.ts）。
 * #142 起不存在码错类别：错码/已重置/超上限与真申请同构（一律 200 pending 进等待页），
 * 反馈只剩限流（locked，带服务端重试秒数）与网络/未知兜底。
 */
export type PairErrorKind =
  | 'locked' // 429 too many pairing attempts, retry in Ns（per-IP 全提交限流）
  | 'network' // fetch 抛错（断网 / DNS / 超时）
  | 'unknown' // 其余（含非 JSON 响应、未知错误串、服务端格式校验兜底）

/** 配对申请结果状态（#142）：active = 建家直入；pending = 进入等待页（真申请与假等待同构） */
export type PairApplicationStatus = 'pending' | 'active'

export interface PairSuccess {
  ok: true
  deviceId: string
  secret: string
  status: PairApplicationStatus
}

export interface PairFailure {
  ok: false
  kind: PairErrorKind
  /** 仅 locked：服务端提示的重试秒数（error 串解析；缺失时页面按限流窗口上限兜底） */
  retrySeconds?: number
}

export type PairResult = PairSuccess | PairFailure

/**
 * POST /api/pair：成功解析凭据与申请状态；失败归一错误类别（永不 reject）。
 * #144 重申请替换：input.previousCredential 存在时携带旧凭据 Authorization 头——
 * 服务端先删旧申请行、再按新申请重新评估（契约 worker/src/pair.ts handlePair 替换分支）。
 */
export async function pairDevice(
  input: {
    code: string
    deviceName: string
    role: 'parent' | 'child'
    /** #192 双因子：家庭口令选填（家长角色首台设备直入用；留空/缺省不进请求体，与旧形态完全兼容） */
    passphrase?: string
    previousCredential?: DeviceCredential
  },
  opts: { apiBase?: string } = {},
): Promise<PairResult> {
  let res: Response
  try {
    res = await fetch(`${resolveBase(opts.apiBase)}/api/pair`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.previousCredential !== undefined ? bearerHeaders(input.previousCredential) : {}),
      },
      body: JSON.stringify({
        code: input.code,
        device_name: input.deviceName,
        role: input.role,
        // #192：passphrase 仅在有值时携带——孩子角色与留空提交的请求体与旧契约逐字段一致
        ...(input.passphrase ? { passphrase: input.passphrase } : {}),
      }),
    })
  } catch {
    return { ok: false, kind: 'network' }
  }

  let body: { device_id?: unknown; secret?: unknown; status?: unknown; error?: unknown }
  try {
    body = (await res.json()) as { device_id?: unknown; secret?: unknown; status?: unknown; error?: unknown }
  } catch {
    return { ok: false, kind: 'unknown' }
  }

  if (
    res.status === 200 &&
    typeof body.device_id === 'string' &&
    typeof body.secret === 'string' &&
    (body.status === 'pending' || body.status === 'active')
  ) {
    return { ok: true, deviceId: body.device_id, secret: body.secret, status: body.status }
  }

  const error = typeof body.error === 'string' ? body.error : ''
  if (res.status === 429) {
    const seconds = /retry in (\d+)s/.exec(error)?.[1]
    return { ok: false, kind: 'locked', ...(seconds !== undefined ? { retrySeconds: Number(seconds) } : {}) }
  }
  return { ok: false, kind: 'unknown' }
}

// ===== 申请状态轮询（#142，R-129a；契约 worker/src/pair.ts handlePairStatus）=====

export interface PairStatusSuccess {
  ok: true
  status: PairApplicationStatus
}

export type PairStatusResult =
  | PairStatusSuccess
  | { ok: false; kind: 'network' | 'error' }

/**
 * GET /api/pair/status：申请状态轮询（Bearer 凭据）。服务端盲口径：查无此行/凭据损坏一律 pending，
 * 本端点永不 401；两种失败类别（network=fetch 抛错 / error=HTTP 非 200·非 JSON·状态值非法）
 * 对等待页语义相同——不清凭据、无限重试。永不 reject。
 */
export async function fetchPairStatus(
  credential: DeviceCredential,
  opts: { apiBase?: string } = {},
): Promise<PairStatusResult> {
  let res: Response
  try {
    res = await fetch(`${resolveBase(opts.apiBase)}/api/pair/status`, {
      method: 'GET',
      headers: bearerHeaders(credential),
    })
  } catch {
    return { ok: false, kind: 'network' }
  }
  let body: { status?: unknown }
  try {
    body = (await res.json()) as { status?: unknown }
  } catch {
    return { ok: false, kind: 'error' }
  }
  if (res.status === 200 && (body.status === 'pending' || body.status === 'active')) {
    confirmFamilyStatus(credential, body.status)
    return { ok: true, status: body.status }
  }
  return { ok: false, kind: 'error' }
}

// ===== 同步能力探测（#174 版本不兼容防护；契约 worker/src/sync.ts handleCapabilities）=====

/** 客户端要求的最低同步协议版本：6 = proposals 域新增可空 emoji 列（worker migrations 0010，#303）；
 *  5 = entry_visibility 域新增到期时间戳列 expires_at（worker migrations 0009，#278）；
 *  4 = trivia_entry 单布尔域替换为键控 entry_visibility 域（worker migrations 0008，#262）；
 *  3 = 新增 trivia_entry 域（worker migrations 0007，#236）；2 = 断代行身份（worker migrations 0003–0005）。
 *  旧 Worker 不认识新域（push 整包 400）——要求 6 让新客户端在旧 Worker 上干净判停（#174 机制）。 */
export const SYNC_PROTOCOL_REQUIRED = 6

export interface SyncCapabilitiesSuccess {
  ok: true
  protocol: number
}

export type SyncCapabilitiesResult =
  | SyncCapabilitiesSuccess
  | { ok: false; kind: SyncApiErrorKind }

/**
 * GET /api/sync/capabilities（Bearer 凭据）：问 Worker 当前同步协议版本；永不 reject。
 * 旧 Worker 无此端点 → 404 → error（调用方据此判定不兼容，阻断交换）。
 * 401 = 凭据未被云端认可（auth）：不是版本结论，调用方不得据此判不兼容（#174 审查修复）。
 */
export async function fetchSyncCapabilities(
  opts: { credential: DeviceCredential; apiBase?: string },
): Promise<SyncCapabilitiesResult> {
  let res: Response
  try {
    res = await fetch(`${resolveBase(opts.apiBase)}/api/sync/capabilities`, {
      method: 'GET',
      headers: bearerHeaders(opts.credential),
    })
  } catch {
    return { ok: false, kind: 'network' }
  }
  if (res.status === 401) return { ok: false, kind: 'auth' }
  let parsed: { sync_protocol?: unknown }
  try {
    parsed = (await res.json()) as { sync_protocol?: unknown }
  } catch {
    return { ok: false, kind: 'error' }
  }
  if (res.status === 200 && typeof parsed.sync_protocol === 'number') {
    confirmFamilyStatus(opts.credential, 'active')
    return { ok: true, protocol: parsed.sync_protocol }
  }
  return { ok: false, kind: 'error' }
}

// ===== 家庭码展示（2026-09-09 首页页脚「当前家庭」字段；契约 worker/src/admin.ts GET /api/family）=====

export interface FamilyCodeSuccess {
  ok: true
  code: string
}

export type FamilyCodeResult = FamilyCodeSuccess | { ok: false; kind: 'network' | 'auth' | 'error' }

/**
 * GET /api/family（Bearer 凭据）：任何已配对设备取现役家庭码（只回码不回口令）。
 * 永不 reject：fetch 抛错 → network；401 → auth（凭据失效，页面隐藏字段）；
 * 非 200 / 非 JSON / code 非 6 位数字 → error。文案拼装归 copy.ts。
 */
export async function fetchFamilyCode(opts: { credential: DeviceCredential; apiBase?: string }): Promise<FamilyCodeResult> {
  let res: Response
  try {
    res = await fetch(`${resolveBase(opts.apiBase)}/api/family`, {
      method: 'GET',
      headers: bearerHeaders(opts.credential),
    })
  } catch {
    return { ok: false, kind: 'network' }
  }
  if (res.status === 401) return { ok: false, kind: 'auth' }
  let parsed: { code?: unknown }
  try {
    parsed = (await res.json()) as { code?: unknown }
  } catch {
    return { ok: false, kind: 'error' }
  }
  if (res.status === 200 && typeof parsed.code === 'string' && /^\d{6}$/.test(parsed.code)) {
    confirmFamilyStatus(opts.credential, 'active')
    return { ok: true, code: parsed.code }
  }
  return { ok: false, kind: 'error' }
}

// ===== 同步推拉薄封装（#126，R-P1d；契约 worker/src/sync.ts）=====

/** Bearer 认证头（Bearer device_id:secret，与 worker/src/auth.ts 解析协议对齐） */
export function bearerHeaders(credential: DeviceCredential): Record<string, string> {
  return { authorization: `Bearer ${credential.device_id}:${credential.secret}` }
}

/** 同步失败类别：network = fetch 抛错（断网/DNS/超时）；error = HTTP 非 200 / 非 JSON / 形状非法 */
export type SyncApiErrorKind = 'network' | 'auth' | 'error'

export interface PushSyncSuccess {
  ok: true
  serverAt: number
}

export interface PushSyncFailure {
  ok: false
  kind: SyncApiErrorKind
}

/** POST /api/sync/push：按域行批量 upsert（worker 侧 SQL 约束承载并集/LWW）；永不 reject */
export async function pushSync(
  body: Record<string, unknown[]>,
  opts: { credential: DeviceCredential; apiBase?: string },
): Promise<PushSyncSuccess | PushSyncFailure> {
  let res: Response
  try {
    res = await fetch(`${resolveBase(opts.apiBase)}/api/sync/push`, {
      method: 'POST',
      headers: { ...bearerHeaders(opts.credential), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, kind: 'network' }
  }
  let parsed: { ok?: unknown; server_at?: unknown }
  try {
    parsed = (await res.json()) as { ok?: unknown; server_at?: unknown }
  } catch {
    return { ok: false, kind: 'error' }
  }
  if (res.status === 200 && parsed.ok === true && typeof parsed.server_at === 'number') {
    confirmFamilyStatus(opts.credential, 'active')
    return { ok: true, serverAt: parsed.server_at }
  }
  return { ok: false, kind: 'error' }
}

export interface PullSyncSuccess {
  ok: true
  serverAt: number
  /** 各域增量行（列含逐行 server_at；question_banks.content 已还原 JSON 对象） */
  domains: Record<string, Array<Record<string, unknown>>>
}

export interface PullSyncFailure {
  ok: false
  kind: SyncApiErrorKind
}

/** GET /api/sync/pull?since=<ms>：各域 server_at > since 的行 + 当前服务器时间戳；永不 reject */
export async function pullSync(
  since: number,
  opts: { credential: DeviceCredential; apiBase?: string },
): Promise<PullSyncSuccess | PullSyncFailure> {
  let res: Response
  try {
    res = await fetch(`${resolveBase(opts.apiBase)}/api/sync/pull?since=${since}`, {
      method: 'GET',
      headers: bearerHeaders(opts.credential),
    })
  } catch {
    return { ok: false, kind: 'network' }
  }
  let parsed: { server_at?: unknown }
  try {
    parsed = (await res.json()) as { server_at?: unknown }
  } catch {
    return { ok: false, kind: 'error' }
  }
  if (res.status !== 200 || typeof parsed.server_at !== 'number') {
    return { ok: false, kind: 'error' }
  }
  const domains: Record<string, Array<Record<string, unknown>>> = {}
  for (const [domain, rows] of Object.entries(parsed)) {
    if (domain === 'server_at') continue
    if (Array.isArray(rows)) domains[domain] = rows as Array<Record<string, unknown>>
  }
  confirmFamilyStatus(opts.credential, 'active')
  return { ok: true, serverAt: parsed.server_at, domains }
}
