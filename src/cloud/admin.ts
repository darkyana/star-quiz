// 管理端点薄封装（#127，R-P1e）：家长页「设备与家庭」区的云端请求统一出口。
// 契约对齐 worker/src/admin.ts + worker/src/snapshot.ts（#124）：全部需 Bearer 认证
// （Authorization: Bearer <device_id>:<secret>，凭据读 useDeviceCredential 单一出口）+ 家长设备。
// 错误归一参照 src/cloud/api.ts 先例：类别化、永不 reject、断网仅归一为 network 不阻塞 App 其余功能；
// 文案映射归 copy.ts（本模块只归一错误类别）。
// 并行归属纪律（票内拍板）：本票不改 src/cloud/api.ts（隔壁 #126 并行扩展它做同步引擎），
// resolveBase 与认证底座在此私有实现，主会话合并时统一归位。
//
// 端点契约：
// - GET  /api/devices                → 200 { devices: [...] }（无认证 401 / 孩子设备 403）
// - POST /api/devices/<id>/revoke    → 200 { ok: true, device_id }（不存在 / 他家庭 404）
// - POST /api/devices/revoked/delete → 200 { ok: true, deleted }（清除已移除设备：硬删本家庭全部墓碑行，幂等）
// - GET  /api/family-code            → 200 { code, passphrase }（#190：现役家庭口令随码出示，未设置 → passphrase null）
// - POST /api/family-code/reset      → 200 { code, passphrase }（#192：新码+新口令成对轮换返回）
// - GET  /api/snapshots              → 200 { snapshots: [...] }（近 30 天每日快照，时间点，
//   服务端窗口过滤 + 倒序，#128 补齐端点后本封装零改动即用）
// - POST /api/snapshots/<id>/restore → 200 { ok: true, snapshot_id }（不存在 / 他家庭 404）
// #143 批准闭环：
// - GET  /api/devices/pending        → 200 { requests: [...] }（名字/申请角色/申请时间；无 IP）
// - POST /api/devices/<id>/approve   → 200 { ok: true, device_id }（批准 = 行翻 active）
// - POST /api/devices/<id>/reject    → 200 { ok: true, device_id }（拒绝 = 删行）
import { readDeviceCredential } from '../composables/useDeviceCredential'
import { DEFAULT_API_BASE } from './api'

/** 管理请求失败类别（页面据此映射 copy 文案；服务端错误结构 { error } 见 worker/src/http.ts） */
export type AdminErrorKind =
  | 'unpaired' // 401：本设备未配对 / 凭据失效（含被移除后的墓碑态）；本地无凭据同归此类
  | 'forbidden' // 403：孩子设备（家长页构造上不可达，防御性兜底）
  | 'conflict' // 409 / 404（仅批准·拒绝）：这条申请刚被另一家长处理过（#143 并发后到）
  | 'not-found' // 404：目标不存在 / 他家庭隔离
  | 'network' // fetch 抛错（断网 / DNS / 超时）
  | 'unknown' // 其余（含非 JSON 响应、服务端 5xx）

export interface AdminFailure {
  ok: false
  kind: AdminErrorKind
}

/** 设备名册行（worker GET /api/devices 响应形状） */
export interface DeviceRow {
  device_id: string
  name: string
  role: 'parent' | 'child'
  paired_at: number
  last_seen_at: number | null
  revoked: boolean
}

/** 快照行（时间点，毫秒时间戳；按 taken_at 倒序最新在前） */
export interface SnapshotRow {
  snapshot_id: string
  taken_at: number
}

/** 解析 API base：调用处显式覆盖（本地验证）> VITE_API_BASE > 生产默认（与 api.ts 同规则私有实现） */
function resolveBase(override?: string): string {
  if (typeof override === 'string' && override !== '') return override
  const env = import.meta.env?.VITE_API_BASE
  return typeof env === 'string' && env !== '' ? env : DEFAULT_API_BASE
}

type AdminResponse = { ok: true; status: number; body: Record<string, unknown> } | AdminFailure

/** 私有请求底座：无凭据不发请求归一 unpaired；fetch 抛错归一 network；非 JSON 归一 unknown */
async function adminRequest(
  input: { path: string; method: 'GET' | 'POST' },
  opts: { apiBase?: string } = {},
): Promise<AdminResponse> {
  const credential = readDeviceCredential()
  if (credential === null) return { ok: false, kind: 'unpaired' }
  let res: Response
  try {
    res = await fetch(`${resolveBase(opts.apiBase)}${input.path}`, {
      method: input.method,
      headers: { authorization: `Bearer ${credential.device_id}:${credential.secret}` },
    })
  } catch {
    return { ok: false, kind: 'network' }
  }
  let body: Record<string, unknown>
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, kind: 'unknown' }
  }
  return { ok: true, status: res.status, body }
}

/** 状态码 → 失败类别（成功路径由各端点按响应形状自行判定） */
function failureKind(status: number): AdminErrorKind {
  if (status === 401) return 'unpaired'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  return 'unknown'
}

function isDeviceRows(value: unknown): value is DeviceRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row?.device_id === 'string' &&
        typeof row?.name === 'string' &&
        (row?.role === 'parent' || row?.role === 'child') &&
        typeof row?.paired_at === 'number' &&
        (row?.last_seen_at === null || typeof row?.last_seen_at === 'number') &&
        typeof row?.revoked === 'boolean',
    )
  )
}

function isSnapshotRows(value: unknown): value is SnapshotRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) => typeof row?.snapshot_id === 'string' && typeof row?.taken_at === 'number',
    )
  )
}

/** GET /api/devices：本家庭设备名册（名字/角色/最后活跃/是否已移除；认证成功即刷新 last_seen） */
export async function listDevices(
  opts: { apiBase?: string } = {},
): Promise<{ ok: true; devices: DeviceRow[] } | AdminFailure> {
  const result = await adminRequest({ path: '/api/devices', method: 'GET' }, opts)
  if (!result.ok) return result
  if (result.status === 200 && isDeviceRows(result.body.devices)) {
    return { ok: true, devices: result.body.devices }
  }
  return { ok: false, kind: failureKind(result.status) }
}

/** POST /api/devices/<id>/revoke：移除设备（该设备随即与云端断开，本机数据保留不擦除） */
export async function revokeDevice(
  deviceId: string,
  opts: { apiBase?: string } = {},
): Promise<{ ok: true } | AdminFailure> {
  const result = await adminRequest(
    { path: `/api/devices/${encodeURIComponent(deviceId)}/revoke`, method: 'POST' },
    opts,
  )
  if (!result.ok) return result
  if (result.status === 200 && result.body.ok === true) return { ok: true }
  return { ok: false, kind: failureKind(result.status) }
}

/** POST /api/devices/revoked/delete：清除已移除设备（硬删本家庭全部墓碑行，幂等；删除数随响应返回） */
export async function deleteRevokedDevices(
  opts: { apiBase?: string } = {},
): Promise<{ ok: true; deleted: number } | AdminFailure> {
  const result = await adminRequest({ path: '/api/devices/revoked/delete', method: 'POST' }, opts)
  if (!result.ok) return result
  if (result.status === 200 && result.body.ok === true && typeof result.body.deleted === 'number') {
    return { ok: true, deleted: result.body.deleted }
  }
  return { ok: false, kind: failureKind(result.status) }
}

/** GET /api/family-code：出示现役 6 位家庭码 + 现役家庭口令（#190：passphrase null = 明确未设置态；形状非法 → unknown） */
export async function showFamilyCode(
  opts: { apiBase?: string } = {},
): Promise<{ ok: true; code: string; passphrase: string | null } | AdminFailure> {
  const result = await adminRequest({ path: '/api/family-code', method: 'GET' }, opts)
  if (!result.ok) return result
  if (result.status === 200 && typeof result.body.code === 'string' && /^\d{6}$/.test(result.body.code)) {
    const passphrase = result.body.passphrase
    if (passphrase === null || typeof passphrase === 'string') {
      return { ok: true, code: result.body.code, passphrase }
    }
  }
  return { ok: false, kind: failureKind(result.status) }
}

/** POST /api/family-code/reset：现役码打戳 + 新码·新口令成对签发（#192 双因子轮换；只拦后续加入，已配对设备不受影响） */
export async function resetFamilyCode(
  opts: { apiBase?: string } = {},
): Promise<{ ok: true; code: string; passphrase: string | null } | AdminFailure> {
  const result = await adminRequest({ path: '/api/family-code/reset', method: 'POST' }, opts)
  if (!result.ok) return result
  if (result.status === 200 && typeof result.body.code === 'string' && /^\d{6}$/.test(result.body.code)) {
    const passphrase = result.body.passphrase
    if (passphrase === null || typeof passphrase === 'string') {
      return { ok: true, code: result.body.code, passphrase }
    }
  }
  return { ok: false, kind: failureKind(result.status) }
}

/** GET /api/snapshots：近 30 天每日快照列表（时间点，倒序；窗口过滤归服务端，客户端不二次裁剪） */
export async function listSnapshots(
  opts: { apiBase?: string } = {},
): Promise<{ ok: true; snapshots: SnapshotRow[] } | AdminFailure> {
  const result = await adminRequest({ path: '/api/snapshots', method: 'GET' }, opts)
  if (!result.ok) return result
  if (result.status === 200 && isSnapshotRows(result.body.snapshots)) {
    return { ok: true, snapshots: result.body.snapshots }
  }
  return { ok: false, kind: failureKind(result.status) }
}

/** POST /api/snapshots/<id>/restore：快照整包回滚（覆盖当前云端状态，各设备下次同步生效） */
export async function restoreSnapshot(
  snapshotId: string,
  opts: { apiBase?: string } = {},
): Promise<{ ok: true } | AdminFailure> {
  const result = await adminRequest(
    { path: `/api/snapshots/${encodeURIComponent(snapshotId)}/restore`, method: 'POST' },
    opts,
  )
  if (!result.ok) return result
  if (result.status === 200 && result.body.ok === true) return { ok: true }
  return { ok: false, kind: failureKind(result.status) }
}

// ===== #143（R-129b）批准闭环 =====

/** 等家长批准的申请行（worker GET /api/devices/pending 响应形状；不采集展示 IP） */
export interface PairRequestRow {
  device_id: string
  name: string
  role: 'parent' | 'child'
  /** 申请落行时刻（毫秒） */
  paired_at: number
}

function isPairRequestRows(value: unknown): value is PairRequestRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row?.device_id === 'string' &&
        typeof row?.name === 'string' &&
        (row?.role === 'parent' || row?.role === 'child') &&
        typeof row?.paired_at === 'number',
    )
  )
}

/** GET /api/devices/pending：等家长批准的申请列表（名字 / 申请角色 / 申请时间） */
export async function listPairRequests(
  opts: { apiBase?: string } = {},
): Promise<{ ok: true; requests: PairRequestRow[] } | AdminFailure> {
  const result = await adminRequest({ path: '/api/devices/pending', method: 'GET' }, opts)
  if (!result.ok) return result
  if (result.status === 200 && isPairRequestRows(result.body.requests)) {
    return { ok: true, requests: result.body.requests }
  }
  return { ok: false, kind: failureKind(result.status) }
}

/**
 * 批准 / 拒绝的失败归一特化：409（已被批准/已处理）与 404（行已被并发拒绝删掉）同归
 * conflict「这条申请刚被处理过」——UI 流程里目标 id 必来自刚拉取的申请列表，
 * 查无此行即「另一家长刚处理完」，不再按 not-found 提示「内容不存在」。
 */
function pairActionFailureKind(status: number): AdminErrorKind {
  if (status === 404 || status === 409) return 'conflict'
  return failureKind(status)
}

/** POST /api/devices/<id>/approve：批准申请 = 行翻 active（孩子端 ≤5 秒轮询发现自动进家） */
export async function approvePairRequest(
  deviceId: string,
  opts: { apiBase?: string } = {},
): Promise<{ ok: true } | AdminFailure> {
  const result = await adminRequest(
    { path: `/api/devices/${encodeURIComponent(deviceId)}/approve`, method: 'POST' },
    opts,
  )
  if (!result.ok) return result
  if (result.status === 200 && result.body.ok === true) return { ok: true }
  return { ok: false, kind: pairActionFailureKind(result.status) }
}

/** POST /api/devices/<id>/reject：拒绝申请 = 删行（孩子端表现与错码构造上同构，永不知被拒） */
export async function rejectPairRequest(
  deviceId: string,
  opts: { apiBase?: string } = {},
): Promise<{ ok: true } | AdminFailure> {
  const result = await adminRequest(
    { path: `/api/devices/${encodeURIComponent(deviceId)}/reject`, method: 'POST' },
    opts,
  )
  if (!result.ok) return result
  if (result.status === 200 && result.body.ok === true) return { ok: true }
  return { ok: false, kind: pairActionFailureKind(result.status) }
}
