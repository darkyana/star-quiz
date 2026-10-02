/**
 * 云端同步推拉 API 封装单测（#126，R-P1d）：fetch mock 按真实契约（worker/src/sync.ts + http.ts）驱动，
 * 断言请求形状（Bearer 头、body 域行、since 查询串）与结果归一（server_at、永不 reject）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { bearerHeaders, pushSync, pullSync, fetchSyncCapabilities, SYNC_PROTOCOL_REQUIRED } from '../api'
import type { DeviceCredential } from '../../composables/useDeviceCredential'

const cred: DeviceCredential = { device_id: 'dev-1', secret: 's3cret', role: 'parent', name: '家长手机' }

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bearerHeaders', () => {
  it('拼 Bearer device_id:secret 认证头（与 worker/src/auth.ts 解析协议对齐）', () => {
    expect(bearerHeaders(cred)).toEqual({ authorization: 'Bearer dev-1:s3cret' })
  })
})

describe('pushSync', () => {
  it('POST {base}/api/sync/push：Bearer + JSON body（按域行数组）；200 → serverAt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, server_at: 12345 }, 200))
    vi.stubGlobal('fetch', fetchMock)

    const result = await pushSync(
      { star_entries: [{ id: 's1', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }] },
      { credential: cred },
    )
    expect(result).toEqual({ ok: true, serverAt: 12345 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.starquiz.link/api/sync/push')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer dev-1:s3cret',
      'content-type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      star_entries: [{ id: 's1', timestamp: 1, type: 'earn', amount: 1, source: '答题得星' }],
    })
  })

  it('fetch 抛错 → network；400/401/403 → error；非 JSON → error（永不 reject）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await pushSync({}, { credential: cred })).toEqual({ ok: false, kind: 'network' })

    for (const status of [400, 401, 403, 500]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, status)))
      expect(await pushSync({}, { credential: cred })).toEqual({ ok: false, kind: 'error' })
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway', { status: 502 })))
    expect(await pushSync({}, { credential: cred })).toEqual({ ok: false, kind: 'error' })
  })
})

describe('fetchSyncCapabilities（#174 能力探测）', () => {
  it('GET {base}/api/sync/capabilities：Bearer；200 → 协议版本', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, sync_protocol: 2 }, 200))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchSyncCapabilities({ credential: cred })
    expect(result).toEqual({ ok: true, protocol: 2 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.starquiz.link/api/sync/capabilities')
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({ authorization: 'Bearer dev-1:s3cret' })
    expect(SYNC_PROTOCOL_REQUIRED).toBeGreaterThanOrEqual(2)
  })

  it('旧 Worker 404 / 协议字段缺失或非数 → error；fetch 抛错 → network（永不 reject）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)))
    expect(await fetchSyncCapabilities({ credential: cred })).toEqual({ ok: false, kind: 'error' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200)))
    expect(await fetchSyncCapabilities({ credential: cred })).toEqual({ ok: false, kind: 'error' })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await fetchSyncCapabilities({ credential: cred })).toEqual({ ok: false, kind: 'network' })
  })
})

describe('pullSync', () => {
  it('GET {base}/api/sync/pull?since=<ms>：Bearer；200 → domains 剥离 server_at + serverAt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { star_entries: [{ id: 's1', timestamp: 1, type: 'earn', amount: 1, source: '答题得星', server_at: 99 }], server_at: 200 },
        200,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await pullSync(150, { credential: cred, apiBase: 'http://localhost:8787' })
    expect(result).toEqual({
      ok: true,
      serverAt: 200,
      domains: { star_entries: [{ id: 's1', timestamp: 1, type: 'earn', amount: 1, source: '答题得星', server_at: 99 }] },
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8787/api/sync/pull?since=150')
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({ authorization: 'Bearer dev-1:s3cret' })
  })

  it('缺域 / 空域响应也归一为 domains 对象；8 域齐全时逐域透传', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ server_at: 1 }, 200)))
    const empty = await pullSync(0, { credential: cred })
    expect(empty).toEqual({ ok: true, serverAt: 1, domains: {} })

    const full = jsonResponse(
      {
        star_entries: [], question_results: [], word_appearances: [], reward_items: [],
        proposals: [], active_redemptions: [], question_flags: [], question_banks: [], server_at: 7,
      },
      200,
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(full))
    const r = await pullSync(0, { credential: cred })
    expect(r.ok && Object.keys(r.domains)).toHaveLength(8)
  })

  it('fetch 抛错 → network；400/401 → error；非 JSON → error（永不 reject）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await pullSync(0, { credential: cred })).toEqual({ ok: false, kind: 'network' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))
    expect(await pullSync(0, { credential: cred })).toEqual({ ok: false, kind: 'error' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })))
    expect(await pullSync(0, { credential: cred })).toEqual({ ok: false, kind: 'error' })
  })
})
