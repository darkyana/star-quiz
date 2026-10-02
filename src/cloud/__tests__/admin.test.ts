/**
 * 管理端点封装单测（#127，R-P1e）：六函数对 worker 契约的解析与错误归一——
 * 成功路径（Bearer 头 = device_id:secret）/ 各状态码类别化（401 unpaired / 403 forbidden / 404 not-found）/
 * 断网归一 network / 非 JSON 归一 unknown / 本地无凭据零请求直接 unpaired（断网零退化）。
 * 服务端契约见 worker/src/admin.ts + worker/src/snapshot.ts（#124）；永不 reject。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listDevices,
  revokeDevice,
  deleteRevokedDevices,
  showFamilyCode,
  resetFamilyCode,
  listSnapshots,
  restoreSnapshot,
  listPairRequests,
  approvePairRequest,
  rejectPairRequest,
} from '../admin'
import { readDeviceCredential, writeDeviceCredential, DEVICE_CREDENTIAL_KEY } from '../../composables/useDeviceCredential'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** worker GET /api/devices 响应形状（#124 admin.test.ts 同构） */
function devicesBody(): { devices: unknown[] } {
  return {
    devices: [
      { device_id: 'dev-1', name: '家长手机', role: 'parent', paired_at: 1, last_seen_at: 2, revoked: false },
      { device_id: 'dev-k', name: '孩子平板', role: 'child', paired_at: 3, last_seen_at: null, revoked: true },
    ],
  }
}

beforeEach(() => {
  localStorage.clear()
  writeDeviceCredential({ device_id: 'dev-1', secret: 'sec-1', role: 'parent', name: '家长手机' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('#127 管理端点：认证头与成功路径', () => {
  it('listDevices：Bearer 头 = Bearer dev-1:sec-1，200 解析设备名册', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(devicesBody(), 200))
    vi.stubGlobal('fetch', fetchMock)
    const result = await listDevices()
    expect(result).toEqual({ ok: true, devices: devicesBody().devices })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer dev-1:sec-1' })
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/devices')
  })

  it('revokeDevice：路径含目标 id（URI 编码），200 { ok: true } → ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, device_id: 'dev k' }, 200))
    vi.stubGlobal('fetch', fetchMock)
    const result = await revokeDevice('dev k')
    expect(result).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/devices/dev%20k/revoke')
  })

  it('showFamilyCode：200 { code: 6 位, passphrase } → 出示（#192：口令随码成对返回；null = 明确未设置态）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: '123456', passphrase: 'abcd' }, 200)))
    expect(await showFamilyCode()).toEqual({ ok: true, code: '123456', passphrase: 'abcd' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: '123456', passphrase: null }, 200)))
    expect(await showFamilyCode()).toEqual({ ok: true, code: '123456', passphrase: null })
  })

  it('resetFamilyCode：200 { code, passphrase } → 新码+新口令成对轮换（#192）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: '654321', passphrase: 'wxyz' }, 200)))
    expect(await resetFamilyCode()).toEqual({ ok: true, code: '654321', passphrase: 'wxyz' })
  })

  it('listSnapshots：200 { snapshots } → 快照列表（时间点）', async () => {
    const body = { snapshots: [{ snapshot_id: 'snap-1', taken_at: 1800 }, { snapshot_id: 'snap-2', taken_at: 1900 }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, 200)))
    expect(await listSnapshots()).toEqual({ ok: true, snapshots: body.snapshots })
  })

  it('restoreSnapshot：200 { ok: true, snapshot_id } → ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true, snapshot_id: 'snap-1' }, 200)))
    expect(await restoreSnapshot('snap-1')).toEqual({ ok: true })
  })

  it('deleteRevokedDevices：POST /api/devices/revoked/delete，200 { ok: true, deleted } → 删除数随响应返回', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, deleted: 2 }, 200))
    vi.stubGlobal('fetch', fetchMock)
    expect(await deleteRevokedDevices()).toEqual({ ok: true, deleted: 2 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/devices/revoked/delete')
    expect(init.method).toBe('POST')
  })
})

describe('#127 管理端点：错误类别归一（永不 reject）', () => {
  it.each([
    [401, 'unpaired'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [500, 'unknown'],
  ] as const)('GET /api/devices 状态 %i → %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, status)))
    expect(await listDevices()).toEqual({ ok: false, kind })
  })

  it('revokeDevice 他家庭/不存在 404 → not-found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)))
    expect(await revokeDevice('dev-ghost')).toEqual({ ok: false, kind: 'not-found' })
  })

  it('deleteRevokedDevices：404 → not-found；200 但形状非法（缺 deleted）→ unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)))
    expect(await deleteRevokedDevices()).toEqual({ ok: false, kind: 'not-found' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200)))
    expect(await deleteRevokedDevices()).toEqual({ ok: false, kind: 'unknown' })
  })

  it('restoreSnapshot 他家庭快照 404 → not-found；500 → unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)))
    expect(await restoreSnapshot('snap-x')).toEqual({ ok: false, kind: 'not-found' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'restore failed' }, 500)))
    expect(await restoreSnapshot('snap-x')).toEqual({ ok: false, kind: 'unknown' })
  })

  it('fetch 抛错（断网）→ network（七函数同口径）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await listDevices()).toEqual({ ok: false, kind: 'network' })
    expect(await revokeDevice('d')).toEqual({ ok: false, kind: 'network' })
    expect(await deleteRevokedDevices()).toEqual({ ok: false, kind: 'network' })
    expect(await showFamilyCode()).toEqual({ ok: false, kind: 'network' })
    expect(await resetFamilyCode()).toEqual({ ok: false, kind: 'network' })
    expect(await listSnapshots()).toEqual({ ok: false, kind: 'network' })
    expect(await restoreSnapshot('s')).toEqual({ ok: false, kind: 'network' })
  })

  it('非 JSON 响应 → unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))
    expect(await listDevices()).toEqual({ ok: false, kind: 'unknown' })
  })

  it('200 但形状非法 → unknown（family-code 非 6 位数字 / 缺 passphrase 字段 / devices 行缺字段）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'abc12' }, 200)))
    expect(await showFamilyCode()).toEqual({ ok: false, kind: 'unknown' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: '123456' }, 200)))
    expect(await showFamilyCode()).toEqual({ ok: false, kind: 'unknown' }) // #192：passphrase 非 null 非串（旧 worker 形态）→ 形状非法
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ devices: [{ device_id: 'x' }] }, 200)))
    expect(await listDevices()).toEqual({ ok: false, kind: 'unknown' })
  })

  it('本地无凭据（未配对）→ unpaired 且零网络请求', async () => {
    localStorage.removeItem(DEVICE_CREDENTIAL_KEY)
    expect(readDeviceCredential()).toBeNull()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await listDevices()).toEqual({ ok: false, kind: 'unpaired' })
    expect(await revokeDevice('d')).toEqual({ ok: false, kind: 'unpaired' })
    expect(await deleteRevokedDevices()).toEqual({ ok: false, kind: 'unpaired' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('#143 批准闭环：申请列表 / 批准 / 拒绝', () => {
  const requestsBody = (): { requests: unknown[] } => ({
    requests: [
      { device_id: 'dev-k', name: '孩子的平板', role: 'child', paired_at: 123 },
      { device_id: 'dev-p2', name: '第二台家长手机', role: 'parent', paired_at: 456 },
    ],
  })

  it('listPairRequests：Bearer 头 + 200 解析申请列表（名字/角色/申请时间）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(requestsBody(), 200))
    vi.stubGlobal('fetch', fetchMock)
    const result = await listPairRequests()
    expect(result).toEqual({ ok: true, requests: requestsBody().requests })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/devices/pending')
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ authorization: 'Bearer dev-1:sec-1' })
  })

  it('approvePairRequest：路径含目标 id，POST 200 { ok: true } → ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, device_id: 'dev-k' }, 200))
    vi.stubGlobal('fetch', fetchMock)
    expect(await approvePairRequest('dev-k')).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/devices/dev-k/approve')
    expect(init.method).toBe('POST')
  })

  it('rejectPairRequest：路径含目标 id，POST 200 { ok: true } → ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, device_id: 'dev-k' }, 200))
    vi.stubGlobal('fetch', fetchMock)
    expect(await rejectPairRequest('dev-k')).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/devices/dev-k/reject')
    expect(init.method).toBe('POST')
  })

  it('并发后到归一 conflict：409（已被批准/已被处理）与 404（行已被并发拒绝删掉）同归「刚被处理过」', async () => {
    // Response body 只能读一次：mockImplementation 每次调用生成全新 Response
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ error: 'request already handled' }, 409)))
    expect(await approvePairRequest('dev-k')).toEqual({ ok: false, kind: 'conflict' })
    expect(await rejectPairRequest('dev-k')).toEqual({ ok: false, kind: 'conflict' })

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ error: 'not found' }, 404)))
    expect(await approvePairRequest('dev-k')).toEqual({ ok: false, kind: 'conflict' })
    expect(await rejectPairRequest('dev-k')).toEqual({ ok: false, kind: 'conflict' })
  })

  it('门禁与断网同既有口径：401 unpaired / 403 forbidden / 500 unknown / 断网 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ error: 'unauthorized' }, 401)))
    expect(await listPairRequests()).toEqual({ ok: false, kind: 'unpaired' })
    expect(await approvePairRequest('d')).toEqual({ ok: false, kind: 'unpaired' })

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ error: 'forbidden' }, 403)))
    expect(await rejectPairRequest('d')).toEqual({ ok: false, kind: 'forbidden' })

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ error: 'x' }, 500)))
    expect(await listPairRequests()).toEqual({ ok: false, kind: 'unknown' })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await approvePairRequest('d')).toEqual({ ok: false, kind: 'network' })
    expect(await rejectPairRequest('d')).toEqual({ ok: false, kind: 'network' })
  })

  it('200 但形状非法 → unknown（requests 行缺字段 / approve 缺 ok）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ requests: [{ device_id: 'x' }] }, 200)))
    expect(await listPairRequests()).toEqual({ ok: false, kind: 'unknown' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ device_id: 'x' }, 200)))
    expect(await approvePairRequest('d')).toEqual({ ok: false, kind: 'unknown' })
  })

  it('本地无凭据 → unpaired 且零网络请求（三函数）', async () => {
    localStorage.removeItem(DEVICE_CREDENTIAL_KEY)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await listPairRequests()).toEqual({ ok: false, kind: 'unpaired' })
    expect(await approvePairRequest('d')).toEqual({ ok: false, kind: 'unpaired' })
    expect(await rejectPairRequest('d')).toEqual({ ok: false, kind: 'unpaired' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
