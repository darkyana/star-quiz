import { beijingDay, ONBOARDING_EVENTS } from '../../shared/onboarding-metrics'
import type { Env } from './env'

const MAX_BODY_BYTES = 512

/** Independent of device/family auth: only anonymous counters reach D1. */
export async function handleOnboardingMetric(request: Request, env: Env, origin: string | null): Promise<Response> {
  const respond = (status: number) => new Response(null, {
    status,
    headers: { 'cache-control': 'no-store', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) },
  })
  if (request.method !== 'POST') return respond(405)
  if (request.headers.has('authorization') || request.headers.has('cookie')) return respond(400)
  const reader = request.body?.getReader()
  if (!reader) return respond(400)
  let body: unknown
  try {
    let size = 0
    let text = ''
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return respond(413)
      }
      text += decoder.decode(value, { stream: true })
    }
    body = JSON.parse(text + decoder.decode())
  } catch {
    return respond(400)
  } finally {
    reader.releaseLock()
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return respond(400)
  const payload = body as Record<string, unknown>
  if (Object.keys(payload).length !== 2 ||
      !ONBOARDING_EVENTS.some(event => event === payload.event) ||
      (payload.family_status !== 'joined' && payload.family_status !== 'unjoined')) return respond(400)
  try {
    await env.DB.prepare(`INSERT INTO onboarding_daily_counts (day, event, family_status, count)
      VALUES (?, ?, ?, 1) ON CONFLICT(day, event, family_status) DO UPDATE SET count = count + 1`)
      .bind(beijingDay(Date.now()), payload.event, payload.family_status).run()
  } catch {
    // No request/error logging: errors can contain request data. Client drops failures.
    return respond(503)
  }
  return respond(204)
}
