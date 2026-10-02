// 管理端点（票 #124，ADR 0005 / CONTEXT.md 设备角色域）：全部需认证 + 家长设备（孩子设备 403）。
// - GET  /api/devices                本家庭设备名册（名字/角色/paired_at/last_seen/是否已移除）
// - POST /api/devices/<id>/revoke    移除设备 = revoked_at 打戳（断云不擦本机数据，墓碑防凭据复用）
// - POST /api/devices/revoked/delete 清除已移除设备 = 硬删本家庭全部墓碑行（幂等；ADR 0012 墓碑可硬删）
// - GET  /api/family-code            出示现役家庭码 + 现役口令（未设置 → passphrase: null 明确未设置态，#190）
// - POST /api/family-code/reset      现役码 retired_at 打戳 + 新码+新口令成对签发（只拦后续加入，已配对设备不受影响，#190）
// 例外（2026-09-09 老板拍板）：GET /api/family 任何已配对（active）设备可达（首页页脚「当前家庭」字段常显家庭码，
// 原「码平时不显示」放宽为已配对设备可见；只回码不回口令——口令仍是家长直入第二因子，仍仅 /api/family-code 出示）。
// 批准闭环（票 #143，伞票 #129 共识 4-5/9/13/16）：
// - GET  /api/devices/pending          等家长批准的申请列表（名字/申请角色/申请时间；不采集展示 IP）
// - POST /api/devices/<id>/approve     批准 = pending 行翻 active（孩子端 ≤5 秒轮询发现进家）
// - POST /api/devices/<id>/reject      拒绝 = 删行（无 rejected 状态残留；孩子端表现与错码同构）
import { authenticate, requireParent } from './auth'
import type { Env } from './env'
import { errorResponse, jsonResponse, okResponse } from './http'

function generateCode(): string {
  // 6 位数字（pairing_codes CHECK 约束），crypto 随机拒绝取模偏差
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}

/** 4 位小写 a-z 家庭口令（#190 双因子钥匙对，与家庭码成对签发/轮换）：逐位拒绝采样消除取模偏差 */
function generatePassphrase(): string {
  let passphrase = ''
  while (passphrase.length < 4) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]!
    if (byte < 234) passphrase += String.fromCharCode(97 + (byte % 26)) // 234 = 26×9：拒绝 234..255 消除取模偏差
  }
  return passphrase
}

/** /api 管理路由；不匹配返回 null（回落 index.ts 兜底 404） */
export async function handleAdmin(request: Request, env: Env, corsOrigin: string | null, pathname: string): Promise<Response | null> {
  const method = request.method

  if (pathname === '/api/devices') {
    if (method !== 'GET') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    const result = await env.DB.prepare(
      // status='active' 口径（#142 共识 3）：pending 申请不是家庭成员，不进名册（批准入口归 #143）
      'SELECT device_id, name, role, paired_at, last_seen_at, revoked_at FROM devices WHERE family_id = ? AND status = \'active\' ORDER BY paired_at',
    )
      .bind(guard.device.family_id)
      .all<{ device_id: string; name: string; role: string; paired_at: number; last_seen_at: number | null; revoked_at: number | null }>()
    return okResponse(
      {
        devices: result.results.map((row) => ({
          device_id: row.device_id,
          name: row.name,
          role: row.role,
          paired_at: row.paired_at,
          last_seen_at: row.last_seen_at,
          revoked: row.revoked_at !== null,
        })),
      },
      200,
      corsOrigin,
    )
  }

  if (pathname === '/api/devices/pending') {
    if (method !== 'GET') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    // 等家长批准的申请（#143）：pending 未移除的本家庭行；只回 名字/申请角色/申请时间（paired_at
    // 即申请落行时刻）——不采集展示 IP（共识 16，构造保证：devices 表本无 IP 列，配对端点不落 IP）。
    const result = await env.DB.prepare(
      "SELECT device_id, name, role, paired_at FROM devices WHERE family_id = ? AND status = 'pending' AND revoked_at IS NULL ORDER BY paired_at",
    )
      .bind(guard.device.family_id)
      .all<{ device_id: string; name: string; role: string; paired_at: number }>()
    return okResponse(
      {
        requests: result.results.map((row) => ({
          device_id: row.device_id,
          name: row.name,
          role: row.role,
          paired_at: row.paired_at,
        })),
      },
      200,
      corsOrigin,
    )
  }

  const approveMatch = /^\/api\/devices\/([^/]+)\/approve$/.exec(pathname)
  if (approveMatch !== null) {
    if (method !== 'POST') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    const targetId = decodeURIComponent(approveMatch[1]!)
    // 批准 = pending 行翻 active（场景 C）：先查行区分 404（不存在/他家庭）与 409（已非 pending），
    // 再条件 UPDATE 收并发窗口——两家长同时点批准，后提交者的 UPDATE 命中 0 行 → 同样 409（共识 5）。
    const row = await env.DB.prepare('SELECT status, revoked_at FROM devices WHERE device_id = ? AND family_id = ?')
      .bind(targetId, guard.device.family_id)
      .first<{ status: 'pending' | 'active'; revoked_at: number | null }>()
    if (row === null) {
      return jsonResponse({ error: 'not found' }, 404, corsOrigin)
    }
    if (row.status !== 'pending' || row.revoked_at !== null) {
      return jsonResponse({ error: 'request already handled' }, 409, corsOrigin)
    }
    const result = await env.DB.prepare(
      "UPDATE devices SET status = 'active' WHERE device_id = ? AND family_id = ? AND status = 'pending' AND revoked_at IS NULL",
    )
      .bind(targetId, guard.device.family_id)
      .run()
    if (result.meta.changes === 0) {
      return jsonResponse({ error: 'request already handled' }, 409, corsOrigin)
    }
    return okResponse({ ok: true, device_id: targetId }, 200, corsOrigin)
  }

  const rejectMatch = /^\/api\/devices\/([^/]+)\/reject$/.exec(pathname)
  if (rejectMatch !== null) {
    if (method !== 'POST') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    const targetId = decodeURIComponent(rejectMatch[1]!)
    // 拒绝 = 删行（共识 9：无 rejected 状态残留，孩子端查无此行与错码构造上同构——
    // handlePairStatus 查无此行一律 pending，被拒者永不知被拒）。先查行区分
    // 404（不存在/他家庭/已被并发拒绝删行）与 409（行还在但已 active——已被批准，不能删）。
    const row = await env.DB.prepare('SELECT status, revoked_at FROM devices WHERE device_id = ? AND family_id = ?')
      .bind(targetId, guard.device.family_id)
      .first<{ status: 'pending' | 'active'; revoked_at: number | null }>()
    if (row === null) {
      return jsonResponse({ error: 'not found' }, 404, corsOrigin)
    }
    if (row.status !== 'pending' || row.revoked_at !== null) {
      return jsonResponse({ error: 'request already handled' }, 409, corsOrigin)
    }
    // 条件 DELETE 收并发窗口：两家长同时拒绝，后提交者命中 0 行 → 404（行已删，与不存在同形）
    const result = await env.DB.prepare(
      "DELETE FROM devices WHERE device_id = ? AND family_id = ? AND status = 'pending' AND revoked_at IS NULL",
    )
      .bind(targetId, guard.device.family_id)
      .run()
    if (result.meta.changes === 0) {
      return jsonResponse({ error: 'not found' }, 404, corsOrigin)
    }
    return okResponse({ ok: true, device_id: targetId }, 200, corsOrigin)
  }

  const revokeMatch = /^\/api\/devices\/([^/]+)\/revoke$/.exec(pathname)
  if (revokeMatch !== null) {
    if (method !== 'POST') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    const targetId = decodeURIComponent(revokeMatch[1]!)
    // 移除 = revoked_at 打戳（COALESCE 保持已移除设备的原打戳时刻，幂等）；
    // 目标不属于本家庭 → 404（家庭隔离，跨家庭设备不可见）。断云不擦本机数据。
    const result = await env.DB.prepare(
      'UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ? AND family_id = ?',
    )
      .bind(Date.now(), targetId, guard.device.family_id)
      .run()
    if (result.meta.changes === 0) {
      return jsonResponse({ error: 'not found' }, 404, corsOrigin)
    }
    return okResponse({ ok: true, device_id: targetId }, 200, corsOrigin)
  }

  // 清除已移除设备（ADR 0012 墓碑可硬删）：一条 SQL 硬删本家庭全部墓碑行——
  // 仅 revoked_at IS NOT NULL（现役设备构造上不可删）；幂等（无墓碑 → deleted: 0 亦 200，
  // 两家长并发后到安全）；未知设备行与墓碑认证同为 401，删除不弱化防凭据复用。
  if (pathname === '/api/devices/revoked/delete') {
    if (method !== 'POST') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    const result = await env.DB.prepare('DELETE FROM devices WHERE family_id = ? AND revoked_at IS NOT NULL')
      .bind(guard.device.family_id)
      .run()
    return okResponse({ ok: true, deleted: result.meta.changes }, 200, corsOrigin)
  }

  // 首页「当前家庭」字段（2026-09-09）：任何已配对（active）设备可查现役家庭码，只回码不回口令——
  // authenticate 已挡未认证 / pending 申请 / 已移除墓碑（同一 401 不区分文案）；家庭外构造上不可见
  if (pathname === '/api/family') {
    if (method !== 'GET') return errorResponse('method not allowed', 405, corsOrigin)
    const auth = await authenticate(request, env, corsOrigin)
    if (!auth.ok) return auth.response
    const code = await env.DB.prepare(
      'SELECT code FROM pairing_codes WHERE family_id = ? AND retired_at IS NULL ORDER BY issued_at DESC LIMIT 1',
    )
      .bind(auth.device.family_id)
      .first<{ code: string }>()
    if (code === null) {
      return jsonResponse({ error: 'no active family code' }, 404, corsOrigin)
    }
    return okResponse({ code: code.code }, 200, corsOrigin)
  }

  if (pathname === '/api/family-code') {
    if (method !== 'GET') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    // #190：出示现役码同时返回现役口令（同表明文同口径，ADR 0007 钥匙对）；
    // 口令未设置（存量 NULL）→ 原样返回 null =「明确未设置态」
    const code = await env.DB.prepare(
      'SELECT code, passphrase FROM pairing_codes WHERE family_id = ? AND retired_at IS NULL ORDER BY issued_at DESC LIMIT 1',
    )
      .bind(guard.device.family_id)
      .first<{ code: string; passphrase: string | null }>()
    if (code === null) {
      return jsonResponse({ error: 'no active family code' }, 404, corsOrigin)
    }
    return okResponse({ code: code.code, passphrase: code.passphrase }, 200, corsOrigin)
  }

  if (pathname === '/api/family-code/reset') {
    if (method !== 'POST') return errorResponse('method not allowed', 405, corsOrigin)
    const guard = await requireParent(request, env, corsOrigin)
    if ('response' in guard) return guard.response
    // 重置 = 现役码打戳 + 新码+新口令成对签发（#190 双因子钥匙对成对轮换），同一 batch 原子完成；
    // code 全服唯一（PK），撞号（概率 10^-6 级）则整批回滚换号重试（口令一并重新生成，无妨）。
    // 已配对设备凭据与码无关，不受影响。
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateCode()
      const passphrase = generatePassphrase()
      try {
        await env.DB.batch([
          env.DB.prepare('UPDATE pairing_codes SET retired_at = ? WHERE family_id = ? AND retired_at IS NULL').bind(
            Date.now(),
            guard.device.family_id,
          ),
          env.DB.prepare('INSERT INTO pairing_codes (code, family_id, issued_at, passphrase) VALUES (?, ?, ?, ?)').bind(
            code,
            guard.device.family_id,
            Date.now(),
            passphrase,
          ),
        ])
        return okResponse({ code, passphrase }, 200, corsOrigin)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('UNIQUE')) continue // 撞号：换号重试
        return jsonResponse({ error: 'family code reset failed' }, 500, corsOrigin)
      }
    }
    return jsonResponse({ error: 'family code reset failed' }, 500, corsOrigin)
  }

  return null
}
