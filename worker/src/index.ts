// 同步 Worker 骨架（票 #119 P0 地基，ADR 0005）：健康检查路由 + 面向 PWA 域的 CORS。
// 同步核心业务端点在 pair.ts / sync.ts（票 #123）；管理与备份路由在 admin.ts / snapshot.ts + scheduled 每日快照 Cron（票 #124）。

import { handleAdmin } from './admin'
import { handleOnboardingMetric } from './onboarding-metrics'
import { scheduled } from './cron'
import type { Env } from './env'
import { jsonResponse } from './http'
import { handlePair, handlePairStatus } from './pair'
import { handleSnapshotRoutes } from './snapshot'
import { handlePush, handlePull, handleCapabilities } from './sync'

/** Origin 判定：无 Origin（curl/健康探测）放行且不加 CORS 头；有 Origin 则须与 ALLOWED_ORIGIN 精确一致 */
function corsCheck(request: Request, env: Env): { allowed: boolean; origin: string | null } {
  const origin = request.headers.get('origin')
  if (origin === null) return { allowed: true, origin: null }
  return { allowed: origin === env.ALLOWED_ORIGIN, origin }
}

function preflightResponse(origin: string | null): Response {
  const headers = new Headers()
  if (origin !== null) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
    headers.set('access-control-allow-headers', 'Content-Type, Authorization')
    headers.set('access-control-max-age', '86400')
    headers.set('vary', 'Origin')
  }
  return new Response(null, { status: 204, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsCheck(request, env)
    if (!cors.allowed) {
      return jsonResponse({ error: 'origin not allowed' }, 403, null)
    }

    if (request.method === 'OPTIONS') {
      return preflightResponse(cors.origin)
    }

    const { pathname } = new URL(request.url)

    // 静态存活检查：不触 D1，进程活着即 200
    if (pathname === '/healthz') {
      if (request.method !== 'GET') return jsonResponse({ error: 'method not allowed' }, 405, cors.origin)
      return jsonResponse({ ok: true }, 200, cors.origin)
    }

    // 就绪检查：对 D1 SELECT 1，验证绑定与迁移已应用
    if (pathname === '/readyz') {
      if (request.method !== 'GET') return jsonResponse({ error: 'method not allowed' }, 405, cors.origin)
      try {
        await env.DB.prepare('SELECT 1 AS ok').first()
        return jsonResponse({ ok: true }, 200, cors.origin)
      } catch {
        return jsonResponse({ ok: false, error: 'd1 unavailable' }, 503, cors.origin)
      }
    }

    if (pathname === '/api/metrics/onboarding') {
      return handleOnboardingMetric(request, env, cors.origin)
    }

    // 同步核心端点（票 #123）：配对免认证（配对即获取凭据）；推拉走内部认证
    if (pathname === '/api/pair') {
      return handlePair(request, env, cors.origin)
    }
    // 申请状态轮询（#142）：唯一对 pending 凭据放行的端点（盲口径见 pair.ts handlePairStatus）
    if (pathname === '/api/pair/status') {
      return handlePairStatus(request, env, cors.origin)
    }
    if (pathname === '/api/sync/push') {
      return handlePush(request, env, cors.origin)
    }
    if (pathname === '/api/sync/pull') {
      return handlePull(request, env, cors.origin)
    }
    // 能力探测（#174 版本不兼容防护）：客户端首次交换前问协议版本，旧 Worker 无此端点
    if (pathname === '/api/sync/capabilities') {
      return handleCapabilities(request, env, cors.origin)
    }

    // /api 管理与备份路由（#124）：各模块自匹配，未命中回落 404
    if (pathname.startsWith('/api/')) {
      const adminResponse = await handleAdmin(request, env, cors.origin, pathname)
      if (adminResponse !== null) return adminResponse
      const snapshotResponse = await handleSnapshotRoutes(request, env, cors.origin, pathname)
      if (snapshotResponse !== null) return snapshotResponse
    }

    return jsonResponse({ error: 'not found' }, 404, cors.origin)
  },
  scheduled,
}
