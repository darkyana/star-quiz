// #174 T-本次 8→9 数据升级保障·切片3：同步协议版本不兼容防护（能力探测）。
// 升级后的客户端不得与不兼容旧 Worker 继续交换数据（新前端推旧库会被拒/丢字段）：
// 引擎在首次交换前探测 GET /api/sync/capabilities；协议版本不足或探测不到端点（旧 Worker 404）→
// 零推零拉（outbox 攒着不丢）、本地数据与配对不动、横幅明确提示；Worker 升级后下个周期自动恢复。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init as initAppState, STORAGE_KEYS } from '../../composables/useDataInfra'
import { allLedger as readStars, writeLedger } from '../../composables/useStarData'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { startSync, __resetSyncForTests, __runCycleForTests } from '../sync'
import { syncProtocolIncompatible, __resetSafetyNoticeForTests } from '../../composables/useSafetyNotice'
// 迁移链实现与业务键初始值由各域模块注册（与生产同构）
import '../../composables/useStarData'
import '../../composables/useLearningData'
import '../../composables/useProposals'
import type { StarEntry } from '../../types'

type CloudRow = Record<string, unknown> & { server_at: number }

function createCloud(protocol: number | null, authRejected = false) {
  const starRows = new Map<string, CloudRow>()
  let clock = 10_000
  const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (u.endsWith('/api/sync/capabilities')) {
      if (authRejected) return json({ error: 'unauthorized' }, 401)
      if (protocol === null) return json({ error: 'not found' }, 404)
      return json({ ok: true, sync_protocol: protocol })
    }
    if (u.endsWith('/api/sync/push')) {
      const body = JSON.parse(String(init?.body)) as Record<string, Array<Record<string, unknown>>>
      for (const row of body['star_entries'] ?? []) starRows.set(String(row['id']), { ...row, server_at: ++clock })
      return json({ ok: true, server_at: ++clock })
    }
    if (u.includes('/api/sync/pull')) {
      return json({ star_entries: [...starRows.values()], server_at: ++clock })
    }
    return json({ error: 'not found' }, 404)
  })
  return {
    fetchSpy,
    setProtocol(p: number | null): void {
      protocol = p
    },
    setAuthRejected(v: boolean): void {
      authRejected = v
    },
    stars(): CloudRow[] {
      return [...starRows.values()]
    },
  }
}

function entry(id: string, timestamp: number): StarEntry {
  return { id, timestamp, type: 'earn', amount: 1, source: '答题得星', quizId: `quiz-${id}` }
}

function bootPairedDevice(): void {
  localStorage.clear()
  initAppState()
  writeDeviceCredential({ device_id: 'dev-a', secret: 's1', role: 'parent', name: '家长设备' })
}

beforeEach(() => {
  localStorage.clear()
  __resetSafetyNoticeForTests()
})

afterEach(() => {
  __resetSyncForTests()
  __resetSafetyNoticeForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('#174 同步协议不兼容防护', () => {
  it('旧 Worker（无能力端点，404）：零推零拉，outbox 攒着不丢，数据与配对不动，横幅提示', async () => {
    const cloud = createCloud(null)
    vi.stubGlobal('fetch', cloud.fetchSpy)
    bootPairedDevice()
    startSync()
    writeLedger([entry('s1', 1)]) // 写入即推：先攒进 outbox，推前被协议闸门拦下
    await __runCycleForTests()
    await new Promise((r) => setTimeout(r, 0))

    // 只有能力探测请求，没有任何推拉交换
    const exchanges = cloud.fetchSpy.mock.calls.filter(([u]) => {
      const s = String(u)
      return s.endsWith('/api/sync/push') || s.includes('/api/sync/pull')
    })
    expect(exchanges).toHaveLength(0)
    // outbox 攒着不丢、数据与凭据不动
    const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
    expect(outbox['star_entries']).toHaveLength(1)
    expect(readStars()).toHaveLength(1)
    expect(localStorage.getItem(STORAGE_KEYS.deviceCredential)).not.toBeNull()
    expect(cloud.stars()).toHaveLength(0)
    expect(syncProtocolIncompatible.value).toBe(true)
  })

  it('能力探测 401（凭据未被云端认可）：零推零拉但不是版本结论——不置不兼容横幅，攒账等重试', async () => {
    const cloud = createCloud(6, true)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', cloud.fetchSpy)
    bootPairedDevice()
    startSync()
    writeLedger([entry('s1', 1)]) // 写入即推：先攒进 outbox，推前被协议闸门拦下
    await __runCycleForTests()
    await new Promise((r) => setTimeout(r, 0))

    // 没有任何推拉交换、outbox 攒着不丢
    const exchanges = cloud.fetchSpy.mock.calls.filter(([u]) => {
      const s = String(u)
      return s.endsWith('/api/sync/push') || s.includes('/api/sync/pull')
    })
    expect(exchanges).toHaveLength(0)
    const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
    expect(outbox['star_entries']).toHaveLength(1)
    expect(cloud.stars()).toHaveLength(0)
    // 401 ≠ 版本不兼容：不横幅、不动配对（区别于 404/协议过旧）
    expect(syncProtocolIncompatible.value).toBe(false)
    expect(localStorage.getItem(STORAGE_KEYS.deviceCredential)).not.toBeNull()

    // 云端恢复认可凭据（如重新授权）后，下个周期自动恢复交换
    cloud.setAuthRejected(false)
    await __runCycleForTests()
    await vi.waitFor(() => expect(cloud.stars()).toHaveLength(1))
  })

  it('协议版本过旧（1 < 6）：同样阻断', async () => {
    const cloud = createCloud(1)
    vi.stubGlobal('fetch', cloud.fetchSpy)
    bootPairedDevice()
    writeLedger([entry('s1', 1)])
    startSync()
    await __runCycleForTests()
    await new Promise((r) => setTimeout(r, 0))
    expect(cloud.stars()).toHaveLength(0)
    expect(syncProtocolIncompatible.value).toBe(true)
  })

  it('兼容（协议 6，#303 起 proposals 带 emoji）：正常推拉收口，不提示', async () => {
    const cloud = createCloud(6)
    vi.stubGlobal('fetch', cloud.fetchSpy)
    bootPairedDevice()
    writeLedger([entry('s1', 1)])
    startSync()
    await __runCycleForTests()
    await vi.waitFor(() => {
      const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
      expect(Object.keys(outbox)).toHaveLength(0)
    })
    expect(cloud.stars()).toHaveLength(1)
    expect(syncProtocolIncompatible.value).toBe(false)
  })

  it('Worker 升级后自动恢复同步（不要求重新配对、不清数据）', async () => {
    const cloud = createCloud(null)
    vi.stubGlobal('fetch', cloud.fetchSpy)
    bootPairedDevice()
    startSync()
    writeLedger([entry('s1', 1)])
    await __runCycleForTests()
    expect(syncProtocolIncompatible.value).toBe(true)

    cloud.setProtocol(6) // 部署侧 Worker 升级到位（#303 起 proposals 带 emoji）
    await __runCycleForTests()
    await vi.waitFor(() => {
      const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
      expect(Object.keys(outbox)).toHaveLength(0)
    })
    expect(cloud.stars()).toHaveLength(1)
    expect(readStars()).toHaveLength(1)
    expect(localStorage.getItem(STORAGE_KEYS.deviceCredential)).not.toBeNull()
  })

  it('探测断网：不误报不兼容（未知 ≠ 不兼容），攒账等重连', async () => {
    const cloud = createCloud(6)
    vi.stubGlobal('fetch', cloud.fetchSpy)
    bootPairedDevice()
    startSync()
    writeLedger([entry('s1', 1)])
    cloud.fetchSpy.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
    await __runCycleForTests()
    expect(syncProtocolIncompatible.value).toBe(false)
    const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
    expect(outbox['star_entries']).toHaveLength(1)
  })
})
