// 业务端点共享的 JSON 响应工具（票 #123）。
// 约定：成功响应一律携带 server_at（服务器时间戳，Date.now() 毫秒，ADR 0005）；
// 错误结构统一 { error: string }（票内 Brief Key interfaces）。

export function jsonResponse(body: unknown, status: number, corsOrigin: string | null): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' })
  if (corsOrigin !== null) {
    headers.set('access-control-allow-origin', corsOrigin)
    headers.set('vary', 'Origin')
  }
  return new Response(JSON.stringify(body), { status, headers })
}

/** 错误响应：统一 { error } 结构 */
export function errorResponse(error: string, status: number, corsOrigin: string | null): Response {
  return jsonResponse({ error }, status, corsOrigin)
}

/** 成功响应：注入 server_at（Worker 接收/响应时刻，毫秒） */
export function okResponse(body: Record<string, unknown>, status: number, corsOrigin: string | null): Response {
  return jsonResponse({ ...body, server_at: Date.now() }, status, corsOrigin)
}
