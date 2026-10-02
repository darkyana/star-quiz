// 设备凭据认证（票 #123，#84 配对域）：Bearer <device_id>:<secret> → 查 devices 比对 SHA-256 摘要。
// 库内只存摘要（credential_hash）；已移除设备（revoked_at 墓碑）凭据立即失效 → 401。
// 认证通过顺带刷新 last_seen_at（认证自然行为；设备名册展示端点归 #124）。
// 票 #254 收口：Bearer 解析与家长门禁归一本模块——「device_id:secret」格式知识只在此处。

import type { Env } from './env'
import { errorResponse } from './http'

/** 认证通过的设备上下文：family_id 由凭据反查，后续一切读写按它过滤（家庭租户边界，ADR 0005） */
export interface AuthedDevice {
  device_id: string
  family_id: string
  role: 'parent' | 'child'
}

/**
 * Bearer 凭据解析（唯一持有「device_id:secret」格式知识，票 #254 三份归一）：
 * Authorization 缺失 / 非 Bearer 前缀 / 无冒号或空 device_id 段 → null。
 * 只做格式拆分不查库不刷 last_seen——pair.ts 两处有意绕过 authenticate 的特例共用本函数。
 */
export function parseBearer(request: Request): { device_id: string; secret: string } | null {
  const header = request.headers.get('authorization')
  if (header === null || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length)
  const sep = token.indexOf(':')
  if (sep <= 0) return null
  return { device_id: token.slice(0, sep), secret: token.slice(sep + 1) }
}

/** SHA-256 摘要（hex 小写）——与配对签发时的 credential_hash 同一算法 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 认证：解析 Authorization: Bearer <device_id>:<secret> 并比对摘要。
 * 失败（缺失/格式错/未知设备/已移除/摘要不符）返回 401 响应；成功返回设备上下文。
 */
export async function authenticate(
  request: Request,
  env: Env,
  corsOrigin: string | null,
): Promise<{ ok: true; device: AuthedDevice } | { ok: false; response: Response }> {
  const credential = parseBearer(request)
  if (credential === null) {
    return { ok: false, response: errorResponse('unauthorized', 401, corsOrigin) }
  }
  const { device_id: deviceId, secret } = credential

  const device = await env.DB.prepare(
    'SELECT device_id, family_id, role, credential_hash, revoked_at, status FROM devices WHERE device_id = ?',
  )
    .bind(deviceId)
    .first<{ device_id: string; family_id: string; role: 'parent' | 'child'; credential_hash: string; revoked_at: number | null; status: 'pending' | 'active' }>()

  // 未知设备 / 已移除（revoked_at 墓碑）/ pending（#142：申请未批准，挡在一切业务端点外，
  // 仅状态轮询可达——pair.ts handlePairStatus 不走本门）/ 摘要不符 → 同一 401，不区分文案（不泄露哪一步错了）
  if (
    device === null ||
    device.revoked_at !== null ||
    device.status !== 'active' ||
    (await sha256Hex(secret)) !== device.credential_hash
  ) {
    return { ok: false, response: errorResponse('unauthorized', 401, corsOrigin) }
  }

  // last_seen_at 刷新：认证自然行为，不构成 #124 设备管理范围
  await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
    .bind(Date.now(), deviceId)
    .run()

  return { ok: true, device: { device_id: device.device_id, family_id: device.family_id, role: device.role } }
}

/**
 * 家长设备门禁（票 #254 自 admin 上移归一）：认证未过 → 401（原样透传 authenticate 的现成响应），
 * 孩子设备 → 403（家长页/设备管理/家庭码/快照为孩子设备构造上不可达）；成功返回家长设备上下文。
 */
export async function requireParent(
  request: Request,
  env: Env,
  corsOrigin: string | null,
): Promise<{ device: AuthedDevice } | { response: Response }> {
  const result = await authenticate(request, env, corsOrigin)
  if (!result.ok) {
    return { response: result.response }
  }
  if (result.device.role !== 'parent') {
    return { response: errorResponse('forbidden', 403, corsOrigin) }
  }
  return { device: result.device }
}
