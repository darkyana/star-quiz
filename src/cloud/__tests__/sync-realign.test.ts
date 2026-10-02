// #174 T-本次 8→9 数据升级保障·切片2：断代一次性同步重对齐（重基线）。
// 场景：已配对设备带着 v8 本地数据与旧增量游标升级到 v9——不清理 bootstrapped（避免云端覆盖本机领先），
// 而是走一次性、幂等、可重试的全域对齐：保留本机未同步新增/修改/删除，与云端按既有分域合并规则汇合。
// 与 #171 损坏对账语义区分（键不同、日志不同），但复用「全量拉 + 影子重建 + 补推」思路。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init as initAppState, STORAGE_KEYS } from '../../composables/useDataInfra'
import { allLedger as readStars, rewards as readRewards } from '../../composables/useStarData'
import { flagged as readFlagged } from '../../composables/useLearningData'
import { allProposals as readProposals } from '../../composables/useProposals'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { startSync, __resetSyncForTests, __runCycleForTests, SYNC_REALIGN_KEY, SYNC_DOMAINS } from '../sync'
// 迁移链实现与业务键初始值由各域模块注册（与生产同构）
import '../../composables/useStarData'
import '../../composables/useLearningData'
import '../../composables/useProposals'
import type { StarEntry, RewardItem } from '../../types'

// #250 域表由同步引擎真实导出派生（消除手抄字面量；修复九域漂移：entry_visibility 前身曾缺席）
const CLOUD_DOMAINS = SYNC_DOMAINS

type CloudRow = Record<string, unknown> & { server_at: number }

function createCloud() {
  const tables = new Map<string, Map<string, CloudRow>>()
  for (const d of CLOUD_DOMAINS) tables.set(d, new Map())
  let clock = 10_000
  let online = true

  const identityOf = (domain: string, row: Record<string, unknown>): string => {
    if (['star_entries', 'proposals', 'active_redemptions'].includes(domain)) return JSON.stringify([row['child_id'] ?? 'default', row['id']])
    if (domain === 'question_results') return JSON.stringify([row['child_id'] ?? 'default', row['question_id'], row['answered_at']])
    if (domain === 'word_appearances') return JSON.stringify([row['child_id'] ?? 'default', row['word_id'], row['appeared_at']])
    if (domain === 'question_flags') return JSON.stringify([row['child_id'] ?? 'default', row['question_id']])
    if (domain === 'morale') return String(row['child_id'])
    if (domain === 'question_banks') return 'bank'
    if (domain === 'entry_visibility') return String(row['entry_id'])
    return String(row['id'])
  }

  const applyPush = (domain: string, row: Record<string, unknown>): void => {
    const table = tables.get(domain)!
    const id = identityOf(domain, row)
    const existing = table.get(id)
    if (existing === undefined) {
      table.set(id, { ...row, server_at: ++clock })
      return
    }
    const lww = !['star_entries', 'question_results', 'word_appearances'].includes(domain)
    if (lww && Number(row['updated_at']) > Number(existing['updated_at'])) {
      table.set(id, { ...row, server_at: ++clock })
    }
  }

  const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (!online) throw new TypeError('fetch failed')
    if (u.endsWith('/api/sync/capabilities')) {
      // #174 能力探测：新契约（协议版本 6 = #303 起 proposals 含 emoji 列）
      return json({ ok: true, sync_protocol: 6 })
    }
    if (u.endsWith('/api/sync/push')) {
      const body = JSON.parse(String(init?.body)) as Record<string, Array<Record<string, unknown>>>
      for (const [domain, rows] of Object.entries(body)) for (const row of rows) applyPush(domain, row)
      return json({ ok: true, server_at: ++clock })
    }
    if (u.includes('/api/sync/pull')) {
      const since = Number(/since=(-?\d+)/.exec(u)?.[1] ?? '0')
      const domains: Record<string, CloudRow[]> = {}
      for (const d of CLOUD_DOMAINS) {
        const rows = [...(tables.get(d)?.values() ?? [])].filter((r) => r.server_at > since)
        if (rows.length > 0) domains[d] = rows
      }
      return json({ ...domains, server_at: ++clock })
    }
    return json({ error: 'not found' }, 404)
  })

  return {
    fetchSpy,
    setOnline(v: boolean): void {
      online = v
    },
    seed(domain: string, rows: Array<Record<string, unknown>>): void {
      for (const row of rows) applyPush(domain, row)
    },
    snapshot(domain: string): CloudRow[] {
      return [...(tables.get(domain)?.values() ?? [])]
    },
  }
}

const cloud = createCloud()

function oldEntry(id: string, timestamp: number): StarEntry {
  return { id, timestamp, type: 'earn', amount: 2, source: '答题得星', quizId: `quiz-${id}` }
}

/** v8 已配对设备现场：版本 8 + 旧形状数据 + 同步引擎键（游标/影子/已基线）+ 离线攒下的 outbox */
function seedV8Device(over: Partial<Record<string, string>> = {}): void {
  localStorage.clear()
  localStorage.setItem(STORAGE_KEYS.dataVersion, '8')
  localStorage.setItem('sq_stars', JSON.stringify([oldEntry('s1', 1000)]))
  localStorage.setItem('sq_rewards', JSON.stringify([{ id: 'r1', name: '旧名', price: 5 } as RewardItem]))
  localStorage.setItem('sq_flagged', JSON.stringify({}))
  localStorage.setItem('sq_proposals', JSON.stringify([]))
  localStorage.setItem(STORAGE_KEYS.syncCursor, JSON.stringify(10500))
  localStorage.setItem(STORAGE_KEYS.syncBootstrapped, JSON.stringify(true))
  localStorage.setItem(
    STORAGE_KEYS.syncShadow,
    JSON.stringify({
      star_entries: [oldEntry('s1', 1000)],
      reward_items: [{ id: 'r1', name: '旧名', price: 5, updated_at: 100, updated_by: 'dev-a', deleted: 0 }],
      flagged: [{ question_id: 'q9', flagged_at: 1, updated_at: 1, updated_by: 'dev-a', deleted: 0 }],
    }),
  )
  // 离线攒账（v8 线协议：无 child_id/kind）：新增流水 s2 + 改价 r1（后写胜）
  localStorage.setItem(
    STORAGE_KEYS.syncOutbox,
    JSON.stringify({
      star_entries: [{ id: 's2', timestamp: 2000, type: 'earn', amount: 3, source: '答题得星', quiz_id: 'quiz-s2' }],
      reward_items: [{ id: 'r1', name: '新名', price: 8, updated_at: 200, updated_by: 'dev-a', deleted: 0 }],
    }),
  )
  writeDeviceCredential({ device_id: 'dev-a', secret: 's1', role: 'parent', name: '家长设备' })
  for (const [k, v] of Object.entries(over)) localStorage.setItem(k, v as string)
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', cloud.fetchSpy)
})

afterEach(() => {
  __resetSyncForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

function realignFlag(): boolean {
  return JSON.parse(localStorage.getItem(SYNC_REALIGN_KEY) ?? 'null') === true
}

describe('#174 断代一次性同步重对齐', () => {
  it('升级置标记：v8 → init 迁移到 9 的同时 sq_sync_realign 置 true；全新安装与已 9 版设备不置', () => {
    seedV8Device()
    initAppState()
    expect(localStorage.getItem(STORAGE_KEYS.dataVersion)).toBe('9')
    expect(realignFlag()).toBe(true)

    localStorage.clear()
    initAppState() // 全新安装
    expect(realignFlag()).toBe(false)

    localStorage.clear()
    localStorage.setItem(STORAGE_KEYS.dataVersion, '9')
    localStorage.setItem('sq_stars', JSON.stringify([oldEntry('s1', 1)]))
    initAppState() // 已 9 版
    expect(realignFlag()).toBe(false)
  })

  it('双端各有未同步数据 → 升级 → 重对齐：并集/LWW/墓碑各按既有规则收敛，无丢失无重复', async () => {
    // 云端 v8 时代已同步行（无 child_id/kind = 迁移后 D1 补默认值的形态）+ 他机后写 + 已删除红旗墓碑
    cloud.seed('star_entries', [{ id: 's0', timestamp: 500, type: 'earn', amount: 1, source: '他机', quiz_id: 'q0' }])
    cloud.seed('reward_items', [{ id: 'r1', name: '云端名', price: 6, updated_at: 150, updated_by: 'dev-b', deleted: 0 }])
    cloud.seed('question_flags', [{ question_id: 'q9', flagged_at: 1, updated_at: 300, updated_by: 'dev-b', deleted: 1 }])

    seedV8Device()
    initAppState() // 升级：迁移 + 重对齐标记
    startSync()
    await __runCycleForTests()
    await vi.waitFor(() => {
      const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
      expect(Object.keys(outbox)).toHaveLength(0)
    })

    // 重对齐完成：标记清 false（幂等凭据）
    expect(realignFlag()).toBe(false)
    // 星星流水并集：云端 s0 + 本机 s1/s2，全带默认孩子与主星星种，无重复
    expect(readStars().map((e) => e.id).sort()).toEqual(['s0', 's1', 's2'])
    expect(readStars().every((e) => e.childId === 'default' && e.kind === 'main')).toBe(true)
    expect(cloud.snapshot('star_entries')).toHaveLength(3)
    // LWW：本机 outbox 改价（updated_at 200）胜云端（150），双端同价
    expect(readRewards()).toEqual([{ id: 'r1', name: '新名', price: 8 }])
    expect(cloud.snapshot('reward_items')[0]['name']).toBe('新名')
    // 墓碑不误恢复：q9 已删除，本机不复活；也不产生新行
    expect(readFlagged()).toEqual({})
    expect(cloud.snapshot('question_flags')).toHaveLength(1)
    expect(readProposals()).toEqual([])
  })

  it('断网时重对齐不半套应用：标记保持 true；重连后下个周期完成并清标记', async () => {
    cloud.seed('star_entries', [{ id: 's0', timestamp: 500, type: 'earn', amount: 1, source: '他机', quiz_id: 'q0' }])
    seedV8Device()
    initAppState()
    cloud.setOnline(false)
    startSync()
    await __runCycleForTests()
    expect(realignFlag()).toBe(true)
    // 本机数据保持迁移后一致态，未被半套应用
    expect(readStars().map((e) => e.id)).toEqual(['s1'])

    cloud.setOnline(true)
    await __runCycleForTests()
    await vi.waitFor(() => {
      const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
      expect(Object.keys(outbox)).toHaveLength(0)
    })
    expect(realignFlag()).toBe(false)
    expect(readStars().map((e) => e.id).sort()).toEqual(['s0', 's1', 's2'])
  })

  it('重复执行不重放不重复记账：对齐完成后追加周期，云行数与本地态稳定，游标推进走增量', async () => {
    cloud.seed('star_entries', [{ id: 's0', timestamp: 500, type: 'earn', amount: 1, source: '他机', quiz_id: 'q0' }])
    seedV8Device()
    initAppState()
    startSync()
    await __runCycleForTests()
    await vi.waitFor(() => {
      const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
      expect(Object.keys(outbox)).toHaveLength(0)
    })
    const cloudStars = cloud.snapshot('star_entries').length
    const localStars = JSON.stringify(readStars())
    const fullPulls = cloud.fetchSpy.mock.calls.filter(([u]) => String(u).includes('since=0')).length

    await __runCycleForTests()
    await __runCycleForTests()

    expect(cloud.snapshot('star_entries')).toHaveLength(cloudStars)
    expect(JSON.stringify(readStars())).toBe(localStars)
    expect(realignFlag()).toBe(false)
    // 对齐完成后不再全量拉（since=0 不再增长）
    expect(cloud.fetchSpy.mock.calls.filter(([u]) => String(u).includes('since=0')).length).toBe(fullPulls)
  })
})
