// 家庭码配对端点（票 #123 起家，#142 R-129a 申请化改造，#144 R-129c 重申请替换，#190 R-130a 建家收权与双因子直入，#84 配对域，ADR 0005 租户边界 / ADR 0007 运营方发码制）：
// POST /api/pair { code, device_name, role, passphrase? } → 申请-等待形态（伞票 #129 共识 7-13）：
// - 唯一直入路径（status=active 跳过等待）：现役码 + 无现役家长设备 + 家长角色 + 家庭口令匹配
//   （#190 双因子：码+口令成对钥匙，空家入驻与丢失全部家长设备后的恢复共用此入口；
//   直入口径只看家长设备，孩子设备健在时家长恢复不再死锁）；
// - 其余一切提交（有效码加入 / 码错 / 码已重置 / 码不存在 / 口令错或缺 / 孩子角色+新码 / 超申请上限）
//   返回**同构 pending 响应**：响应结构、状态码、凭据形态逐字段一致——真申请落 devices 行（status=pending），
//   假凭据（同长度同格式的 UUID + 64hex secret）不落任何库表，外界无法探测「码后是否有人」。
// - #190 建家收权（ADR 0007）：家庭码收归运营方签发（运营方经本地脚本建空家并成对签发码+口令），
//   「码不存在 + 家长角色 → 建家庭」自助路径已删，码不存在并入假等待盲口径；passphrase 入参
//   仅在直入判定中被消费，其余场景忽略（口令格式错误不单独 400——报错即泄露码状态）。
// 防爆破（共识 10）：per-IP 全提交计数（10 次/15 分钟 → 429），废除码级失败维度；429 只反映手速不泄露存在性。
// 重申请替换（共识 14 / 场景 F，#144）：提交可带旧凭据（Authorization 头）——先删自己对应的
// pending 旧行、再按新申请重新评估；响应与首申同构（见 handlePair 内注释）。
// GET /api/pair/status（Bearer 凭据）→ 申请状态轮询：唯一对 pending 凭据放行的端点（盲口径见函数注释）。

import type { Env } from './env'
import { errorResponse, okResponse } from './http'
import { parseBearer, sha256Hex } from './auth'

// ===== 防爆破常量（#142 口径：per-IP 滑动窗口全提交计数，与码对错无关）=====
/** 同 IP 15 分钟窗口内提交上限（含成功与格式失败——不存在「失败才计数」维度） */
export const PAIR_MAX_SUBMISSIONS_PER_IP = 10
/** 计数滑动窗口时长 15 分钟 */
export const PAIR_WINDOW_MS = 15 * 60 * 1000
/** 每家庭并发真 pending 上限（伞票场景 J：超限静默转假等待——报错即泄露码有效） */
export const PAIR_MAX_PENDING_PER_FAMILY = 5

/**
 * 配对提交计数器（内存实现：单实例 worker 足够，票面 AC 未要求持久化）。
 * 口径 = per-IP 全提交滑动窗口：每次提交（不论成败）记一枚时间戳，窗口内满
 * PAIR_MAX_SUBMISSIONS_PER_IP 枚即拒绝；窗口随旧时间戳过期自然滑动。
 * 纯状态机与时间解耦（now 由调用方传入），便于直接单测。
 */
export class PairRateLimiter {
  private readonly submissions = new Map<string, number[]>()

  /** 记一次提交：窗口已满 → 返回需等待毫秒（本次不记录，不续窗）；未满 → 记录并返回 null */
  recordSubmission(ip: string, now: number): number | null {
    const stamps = (this.submissions.get(ip) ?? []).filter((t) => t > now - PAIR_WINDOW_MS)
    if (stamps.length >= PAIR_MAX_SUBMISSIONS_PER_IP) {
      return Math.max(stamps[0]! + PAIR_WINDOW_MS - now, 1)
    }
    stamps.push(now)
    this.submissions.set(ip, stamps)
    return null
  }
}

/** 端点级单例（worker isolate 生命周期内存活） */
const rateLimiter = new PairRateLimiter()

/** 客户端 IP：Cloudflare 边缘注入；测试/本地无此头时归并到 unknown */
function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

/** 6 位数字家庭码（与 pairing_codes 表 CHECK 同口径，ADR 0005） */
function isValidCode(code: unknown): code is string {
  return typeof code === 'string' && /^[0-9]{6}$/.test(code)
}

/** 生成设备凭据 secret：32 字节随机 hex（64 字符，不含冒号，与 Bearer 解析兼容） */
function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function handlePair(request: Request, env: Env, corsOrigin: string | null): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('method not allowed', 405, corsOrigin)
  }

  // 防爆破（共识 10）：提交即计数，先判后记——窗口满则 429（拒绝的提交不记录，不续窗）。
  // 计数与码对错无关：成功直入、假等待、格式 400 全部同维消耗窗口。
  const retryMs = rateLimiter.recordSubmission(clientIp(request), Date.now())
  if (retryMs !== null) {
    return errorResponse(`too many pairing attempts, retry in ${Math.ceil(retryMs / 1000)}s`, 429, corsOrigin)
  }

  let body: { code?: unknown; device_name?: unknown; role?: unknown; passphrase?: unknown }
  try {
    body = await request.json()
  } catch {
    return errorResponse('invalid json body', 400, corsOrigin)
  }

  // 入参校验 400：发生在任何 DB 访问之前，不构成存在性泄露面
  const { code, device_name: deviceName, role, passphrase } = body
  if (!isValidCode(code)) {
    return errorResponse('invalid pairing code', 400, corsOrigin)
  }
  if (typeof deviceName !== 'string' || deviceName.trim().length === 0) {
    return errorResponse('invalid device name', 400, corsOrigin)
  }
  if (role !== 'parent' && role !== 'child') {
    return errorResponse('invalid role', 400, corsOrigin)
  }

  // #190 家庭口令入参：仅直入判定消费，其余场景忽略；比对前归一小写。
  // 缺失 / 非字符串（保守兜底）/ 空串 → 按无口令走盲口径，不 400（不因口令格式单独报错泄露码状态）。
  const passphraseInput = typeof passphrase === 'string' ? passphrase.toLowerCase() : ''

  // ===== 重申请替换（#144，共识 14 / 场景 F）=====
  // 带旧凭据提交（Authorization: Bearer <device_id>:<secret>）：条件 DELETE 只可能命中
  // 「自己凭据对应 + status=pending + 未移除」的那一行——先删旧行再按新申请重新评估
  // （下方 pending 计数因此已含释放的名额）。查无此行（假凭据）/ active 行 / revoked 行 /
  // 摘要不符 / 凭据格式坏 → 0 命中静默跳过，按新申请评估，与无凭据首申行为一致；
  // 对响应零影响（同构红线）。解析走共享 parseBearer（票 #254 归一），仅格式拆分不查库。
  // 能力边界（票面红线）：本删除不构成任何其他 auth 能力——不走 authenticate，不签发任何权限。
  const oldCredential = parseBearer(request)
  if (oldCredential !== null) {
    await env.DB.prepare(
      "DELETE FROM devices WHERE device_id = ? AND credential_hash = ? AND status = 'pending' AND revoked_at IS NULL",
    )
      .bind(oldCredential.device_id, await sha256Hex(oldCredential.secret))
      .run()
  }

  /** 假等待响应（共识 7/11）：与真申请同构（UUID + 64hex + status=pending），不落任何库表 */
  const fakePending = (): Response =>
    okResponse({ device_id: crypto.randomUUID(), secret: generateSecret(), status: 'pending' }, 200, corsOrigin)

  // 码三路（#190 口径）：现役（retired_at NULL）→ 挂入双因子评估；已退役 / 不存在 → 假等待
  // （#190 建家收权：自助建家路径已删，码不存在并入盲口径，任意角色一致）
  const codeRow = await env.DB.prepare(
    'SELECT family_id, retired_at, passphrase FROM pairing_codes WHERE code = ?',
  )
    .bind(code)
    .first<{ family_id: string; retired_at: number | null; passphrase: string | null }>()

  let familyId: string
  let directEntry = false

  if (codeRow !== null && codeRow.retired_at === null) {
    familyId = codeRow.family_id
    // 直入判定（#190 双因子）：统计「active 未移除家长设备数」与「pending 数」
    // （共识 1/3：既有设备查询一律 status='active' 口径；pending 不是家庭成员）
    const counts = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' AND revoked_at IS NULL AND role = 'parent' THEN 1 ELSE 0 END) AS active_parent_n,
         SUM(CASE WHEN status = 'pending' AND revoked_at IS NULL THEN 1 ELSE 0 END) AS pending_n
       FROM devices WHERE family_id = ?`,
    )
      .bind(familyId)
      .first<{ active_parent_n: number | null; pending_n: number | null }>()
    const pendingN = counts?.pending_n ?? 0
    if ((counts?.active_parent_n ?? 0) === 0 && role === 'parent') {
      // 无现役家长设备 + 家长角色 → 双因子直入判定（人工配对低频场景，先查后插的微竞态接受）：
      // 口令缺失 / 空串 / 与库存值不符（库存同样归一小写；NULL 永不匹配）→ 假等待且不落 devices 行
      const storedPassphrase = codeRow.passphrase === null ? null : codeRow.passphrase.toLowerCase()
      if (passphraseInput === '' || storedPassphrase === null || passphraseInput !== storedPassphrase) {
        return fakePending()
      }
      // 码+口令对 → 直入 active（空家入驻与丢失全部家长设备后的恢复入口；#190 双因子）
      directEntry = true
    } else if (pendingN >= PAIR_MAX_PENDING_PER_FAMILY) {
      return fakePending() // 场景 J：真申请堆积超限 → 静默假等待
    }
  } else {
    // 已退役的旧码（场景 H）：重置只拦后续加入（#84）——对加入者即无效码 → 假等待；
    // 不存在的码（#190 建家收权后并入盲口径）：任意角色 → 假等待（自助建家已删，不落任何库表）
    return fakePending()
  }

  // 签发真凭据：secret 明文仅此一次返回，库只存摘要（ADR 0005 credential_hash）
  const deviceId = crypto.randomUUID()
  const secret = generateSecret()
  const credentialHash = await sha256Hex(secret)
  const status: 'pending' | 'active' = directEntry ? 'active' : 'pending'
  await env.DB.prepare(
    'INSERT INTO devices (device_id, family_id, name, role, credential_hash, paired_at, last_seen_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(deviceId, familyId, deviceName.trim(), role, credentialHash, Date.now(), Date.now(), status)
    .run()

  return okResponse({ device_id: deviceId, secret, status }, 200, corsOrigin)
}

/**
 * 申请状态轮询（#142）：唯一对 pending 凭据放行的端点。
 * GET /api/pair/status（Authorization: Bearer <device_id>:<secret>）→ { status: 'pending' | 'active' }。
 * 盲口径（共识 8）：查无此行 / 凭据损坏 / 无凭据 / 已移除 → 一律 pending——错码、被拒与真 pending
 * 构造上同一种表现。不走 authenticate()：它对未知行 401 且顺带刷 last_seen，
 * 两者都违反本端点口径（共识 15：pending 轮询不刷 last_seen）。
 */
export async function handlePairStatus(request: Request, env: Env, corsOrigin: string | null): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('method not allowed', 405, corsOrigin)
  }

  // 解析走共享 parseBearer（票 #254 归一）：坏格式 → null → 落 pending 兜底（盲口径不变）
  const credential = parseBearer(request)

  if (credential !== null) {
    const device = await env.DB.prepare(
      'SELECT status, credential_hash, revoked_at FROM devices WHERE device_id = ?',
    )
      .bind(credential.device_id)
      .first<{ status: 'pending' | 'active'; credential_hash: string; revoked_at: number | null }>()
    if (device !== null && device.revoked_at === null && (await sha256Hex(credential.secret)) === device.credential_hash) {
      return okResponse({ status: device.status }, 200, corsOrigin)
    }
  }
  return okResponse({ status: 'pending' }, 200, corsOrigin)
}
