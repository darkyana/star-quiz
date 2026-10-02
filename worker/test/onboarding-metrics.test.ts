import { env, createExecutionContext, createScheduledController } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { seedFamily } from './helpers'
import { ONBOARDING_EVENTS } from '../../shared/onboarding-metrics'

const origin = 'https://starquiz.link'
function send(body: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(new Request('https://api.starquiz.link/api/metrics/onboarding', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), env)
}
async function totals() {
  return (await env.DB.prepare('SELECT day, event, family_status, count FROM onboarding_daily_counts ORDER BY day, event, family_status').all()).results
}

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-16T15:59:59Z'))
  await env.DB.prepare('DELETE FROM onboarding_daily_counts').run()
})
afterEach(() => vi.restoreAllMocks())

describe('#310 anonymous onboarding aggregates', () => {
  it('telemetry cleanup failure does not suppress family backups', async () => {
    await seedFamily('metrics-isolation')
    await env.DB.prepare('ALTER TABLE onboarding_daily_counts RENAME TO unavailable_metrics').run()
    try {
      await worker.scheduled(createScheduledController({ scheduledTime: Date.now() }), env, createExecutionContext())
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM family_snapshots WHERE family_id = 'metrics-isolation'").first('n')).toBe(1)
    } finally {
      await env.DB.prepare('ALTER TABLE unavailable_metrics RENAME TO onboarding_daily_counts').run()
      await env.DB.prepare("DELETE FROM family_snapshots WHERE family_id = 'metrics-isolation'").run()
      await env.DB.prepare("DELETE FROM families WHERE family_id = 'metrics-isolation'").run()
    }
  })
  it.each([
    {}, null, [], { event: 'unknown', family_status: 'joined' },
    // #324 新事件的近失拼写仍在白名单外，须继续 400
    { event: 'guide_dismissed', family_status: 'joined' },
    { event: 'Guide_Archive', family_status: 'joined' },
    { event: 'guide_entry', family_status: 'unknown' },
    { event: 'guide_entry', family_status: 'joined', device_id: 'private' },
    { event: 'guide_entry', family_status: 'joined', count: 999 },
    { event: 'guide_entry', family_status: 'joined', day: '2020-01-01' },
  ])('rejects non-allowlisted payload %j without retaining it', async body => {
    expect((await send(body)).status).toBe(400)
    expect(await totals()).toEqual([])
  })
  it('rejects oversized, malformed, wrong-method and identified requests', async () => {
    expect((await send({ event: 'x'.repeat(513), family_status: 'joined' })).status).toBe(413)
    expect((await send({ event: 'guide_entry', family_status: 'joined' }, { authorization: 'Bearer private' })).status).toBe(400)
    expect((await send({ event: 'guide_entry', family_status: 'joined' }, { cookie: 'private=1' })).status).toBe(400)
    const malformed = new Request('https://api.starquiz.link/api/metrics/onboarding', { method: 'POST', body: '{' })
    expect((await worker.fetch(malformed, env)).status).toBe(400)
    expect((await worker.fetch(new Request('https://api.starquiz.link/api/metrics/onboarding'), env)).status).toBe(405)
    expect(await totals()).toEqual([])
  })
  it('counts concurrent clicks atomically and changes bucket at Beijing midnight', async () => {
    await Promise.all(Array.from({ length: 20 }, () => send({ event: 'quiz_start', family_status: 'unjoined' })))
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-09-16T16:00:00Z'))
    await send({ event: 'quiz_start', family_status: 'unjoined' })
    expect(await totals()).toEqual([
      { day: '2026-09-16', event: 'quiz_start', family_status: 'unjoined', count: 20 },
      { day: '2026-09-17', event: 'quiz_start', family_status: 'unjoined', count: 1 },
    ])
  })
  it('daily cron removes older than today plus 89 days even without any families', async () => {
    await env.DB.prepare("INSERT INTO onboarding_daily_counts VALUES ('2026-06-18','guide_back','unjoined',1), ('2026-06-19','guide_back','unjoined',2), ('2026-09-16','guide_back','joined',3)").run()
    await worker.scheduled(createScheduledController({ scheduledTime: Date.parse('2026-09-16T20:00:00Z') }), env, createExecutionContext())
    // Beijing date September17, inclusive oldest date June20: both June18/19 expire.
    expect(await totals()).toEqual([{ day: '2026-09-16', event: 'guide_back', family_status: 'joined', count: 3 }])
    await env.DB.prepare("INSERT INTO onboarding_daily_counts VALUES ('2026-06-20','guide_back','unjoined',4)").run()
    await worker.scheduled(createScheduledController({ scheduledTime: Date.parse('2026-09-16T20:00:00Z') }), env, createExecutionContext())
    expect((await totals())[0]).toEqual({ day: '2026-06-20', event: 'guide_back', family_status: 'unjoined', count: 4 })
  })
  it('accepts unauthenticated clicks and keeps only daily counts split by family status', async () => {
    expect((await send({ event: 'guide_entry', family_status: 'unjoined' })).status).toBe(204)
    expect((await send({ event: 'guide_entry', family_status: 'unjoined' })).status).toBe(204)
    expect((await send({ event: 'guide_entry', family_status: 'joined' })).status).toBe(204)
    expect(await totals()).toEqual([
      { day: '2026-09-16', event: 'guide_entry', family_status: 'joined', count: 1 },
      { day: '2026-09-16', event: 'guide_entry', family_status: 'unjoined', count: 2 },
    ])
  })
  it('#324 accepts exactly the shared whitelist constant, including the new guide events', async () => {
    for (const event of ONBOARDING_EVENTS) {
      expect((await send({ event, family_status: 'unjoined' })).status, event).toBe(204)
    }
    expect(await totals()).toEqual(ONBOARDING_EVENTS.slice().sort().map(event => (
      { day: '2026-09-16', event, family_status: 'unjoined', count: 1 }
    )))
    expect((await send({ event: 'guide_archives', family_status: 'unjoined' })).status).toBe(400)
    expect(await totals()).toHaveLength(ONBOARDING_EVENTS.length)
  })
})
