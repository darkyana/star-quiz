/**
 * 云端 API 薄封装单测（#125 起家，#142 R-129a 申请化契约）：fetch mock 按真实契约
 * （worker/src/pair.ts + http.ts）驱动，断言请求形状与结果归一；base 解析（默认生产 / 显式覆盖）。
 * #142 新契约：成功响应携带 status（pending 假等待/真申请 · active 直入）；
 * 429 解析 retry 秒数（限流文案「X 分钟后再试」数据源）；新增申请状态轮询 fetchPairStatus。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { pairDevice, fetchPairStatus, fetchFamilyCode, DEFAULT_API_BASE } from '../api'
import type { DeviceCredential } from '../../composables/useDeviceCredential'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const CRED: DeviceCredential = { device_id: 'dev-1', secret: 's1', role: 'child', name: '孩子平板' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pairDevice：请求形状', () => {
  it('POST {base}/api/pair，body 为 { code, device_name, role } 契约形状', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ device_id: 'dev-1', secret: 's1', status: 'pending', server_at: 1 }, 200))
    vi.stubGlobal('fetch', fetchMock)

    const result = await pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent' })
    expect(result).toEqual({ ok: true, deviceId: 'dev-1', secret: 's1', status: 'pending' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/api/pair`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ code: '123456', device_name: '家长手机', role: 'parent' })
  })

  it('#192 双因子：input.passphrase 有值 → body 携带 passphrase；缺省/空串 → 请求体与旧契约逐字段一致', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ device_id: 'dev-1', secret: 's1', status: 'pending', server_at: 1 }, 200))
    vi.stubGlobal('fetch', fetchMock)

    await pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent', passphrase: 'abcd' })
    const [withPwUrl, withPwInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(withPwUrl).toBe(`${DEFAULT_API_BASE}/api/pair`)
    expect(JSON.parse(withPwInit.body as string)).toEqual({
      code: '123456',
      device_name: '家长手机',
      role: 'parent',
      passphrase: 'abcd',
    })

    await pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent' })
    await pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent', passphrase: '' })
    for (const i of [1, 2]) {
      const [, init] = fetchMock.mock.calls[i] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({ code: '123456', device_name: '家长手机', role: 'parent' })
    }
  })

  it('默认 base 为生产 API 域 https://api.starquiz.link；opts.apiBase 显式覆盖（本地验证通道）', async () => {
    expect(DEFAULT_API_BASE).toBe('https://api.starquiz.link')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ device_id: 'dev-1', secret: 's1', status: 'active', server_at: 1 }, 200))
    vi.stubGlobal('fetch', fetchMock)

    await pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent' }, { apiBase: 'http://localhost:8787' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8787/api/pair')
  })

  it('#144 重申请：带 previousCredential → Authorization 头携带旧凭据（服务端替换语义入口）；不带 → 无该头（首申形态不变）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ device_id: 'dev-2', secret: 's2', status: 'pending', server_at: 1 }, 200))
    vi.stubGlobal('fetch', fetchMock)

    await pairDevice({ code: '654321', deviceName: '孩子平板', role: 'child', previousCredential: CRED })
    const [, reapplyInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((reapplyInit.headers as Record<string, string>).authorization).toBe('Bearer dev-1:s1')
    expect(JSON.parse(reapplyInit.body as string)).toEqual({ code: '654321', device_name: '孩子平板', role: 'child' })

    await pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent' })
    const [, firstInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect((firstInit.headers as Record<string, string>).authorization).toBeUndefined()
  })
})

describe('fetchFamilyCode：首页「当前家庭」字段取现役家庭码（任何已配对设备，2026-09-09；契约 worker GET /api/family）', () => {
  it('GET {base}/api/family 带 Bearer 凭据头；200 { code } → ok:true（只回码不回口令）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: '123456' }, 200))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFamilyCode({ credential: CRED })
    expect(result).toEqual({ ok: true, code: '123456' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/api/family`)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer dev-1:s1')
  })

  it('401 → auth（凭据失效，页面隐藏字段）；fetch 抛错 → network；非 200 / 形状非法 → error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))
    expect(await fetchFamilyCode({ credential: CRED })).toEqual({ ok: false, kind: 'auth' })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await fetchFamilyCode({ credential: CRED })).toEqual({ ok: false, kind: 'network' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'no active family code' }, 404)))
    expect(await fetchFamilyCode({ credential: CRED })).toEqual({ ok: false, kind: 'error' })

    // 200 但 code 缺失 / 非 6 位数字 → 形状非法 → error
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ device_id: 'dev-1' }, 200)))
    expect(await fetchFamilyCode({ credential: CRED })).toEqual({ ok: false, kind: 'error' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'abc' }, 200)))
    expect(await fetchFamilyCode({ credential: CRED })).toEqual({ ok: false, kind: 'error' })
  })

  it('opts.apiBase 显式覆盖（本地验证通道）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: '654321' }, 200))
    vi.stubGlobal('fetch', fetchMock)
    await fetchFamilyCode({ credential: CRED, apiBase: 'http://localhost:8787' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8787/api/family')
  })
})

describe('pairDevice：成功与失败归一（对照 worker/src/pair.ts #142 契约）', () => {
  async function callWith(res: Response): Promise<ReturnType<typeof pairDevice>> {
    const fetchMock = vi.fn().mockResolvedValue(res)
    vi.stubGlobal('fetch', fetchMock)
    return pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent' })
  }

  it('200 status=pending（真申请与假等待同构，客户端不区分）→ ok + pending', async () => {
    const result = await callWith(jsonResponse({ device_id: 'dev-9', secret: 'x'.repeat(64), status: 'pending', server_at: 2 }, 200))
    expect(result).toEqual({ ok: true, deviceId: 'dev-9', secret: 'x'.repeat(64), status: 'pending' })
  })

  it('200 status=active（建家直入）→ ok + active', async () => {
    const result = await callWith(jsonResponse({ device_id: 'dev-a', secret: 'y'.repeat(64), status: 'active', server_at: 3 }, 200))
    expect(result).toEqual({ ok: true, deviceId: 'dev-a', secret: 'y'.repeat(64), status: 'active' })
  })

  it('429 限流 → locked + retrySeconds（从 error 串解析重试秒数）', async () => {
    const result = await callWith(jsonResponse({ error: 'too many pairing attempts, retry in 900s' }, 429))
    expect(result).toEqual({ ok: false, kind: 'locked', retrySeconds: 900 })
  })

  it('429 限流但 error 串无可解析秒数 → locked（retrySeconds 缺省，页面按窗口上限兜底）', async () => {
    const result = await callWith(jsonResponse({ error: 'slow down' }, 429))
    expect(result).toEqual({ ok: false, kind: 'locked' })
  })

  it('400 格式校验错（服务端兜底；客户端已前置拦截）→ unknown（不存在码错类别的细分文案）', async () => {
    for (const error of ['invalid pairing code', 'invalid device name', 'invalid role', 'invalid json body']) {
      expect(await callWith(jsonResponse({ error }, 400))).toEqual({ ok: false, kind: 'unknown' })
    }
  })

  it('fetch 抛错（断网 / DNS / 超时）→ network，且不抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const result = await pairDevice({ code: '123456', deviceName: '家长手机', role: 'parent' })
    expect(result).toEqual({ ok: false, kind: 'network' })
  })

  it('非 JSON 响应体 / 200 缺凭据或状态字段 → unknown', async () => {
    const notJson = new Response('gateway html', { status: 502 })
    expect(await callWith(notJson)).toEqual({ ok: false, kind: 'unknown' })

    expect(await callWith(jsonResponse({ device_id: 'dev-1', secret: 's1', server_at: 1 }, 200))).toEqual({
      ok: false,
      kind: 'unknown',
    })
  })
})

describe('fetchPairStatus：申请状态轮询（#142，GET /api/pair/status）', () => {
  it('GET {base}/api/pair/status，携带 Bearer 凭据头；200 pending → ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'pending', server_at: 1 }, 200))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPairStatus(CRED)
    expect(result).toEqual({ ok: true, status: 'pending' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_API_BASE}/api/pair/status`)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer dev-1:s1')
  })

  it('200 active（家长已批准）→ ok + active', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'active', server_at: 1 }, 200)))
    expect(await fetchPairStatus(CRED)).toEqual({ ok: true, status: 'active' })
  })

  it('apiBase 显式覆盖生效', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'pending', server_at: 1 }, 200))
    vi.stubGlobal('fetch', fetchMock)
    await fetchPairStatus(CRED, { apiBase: 'http://localhost:8787' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8787/api/pair/status')
  })

  it('fetch 抛错 → network；非 JSON / 非 200 / 状态值非法 → error（等待页两种失败都无限重试）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await fetchPairStatus(CRED)).toEqual({ ok: false, kind: 'network' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway html', { status: 502 })))
    expect(await fetchPairStatus(CRED)).toEqual({ ok: false, kind: 'error' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ghost' }, 200)))
    expect(await fetchPairStatus(CRED)).toEqual({ ok: false, kind: 'error' })
  })
})
