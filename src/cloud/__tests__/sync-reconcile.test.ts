// #171 T-损坏对账铁律（#67 T1）端到端测试：参与同步键损坏重置 → 域标脏禁推
//（增量与全量推送均阻断、outbox 不攒墓碑）→ 下周期复用基线通道全量对账（影子有而本地无回填、
// 本地新写保留）→ 重建影子、解除禁推 → 增量恢复正常；正门删除/修改不误恢复。
// fetch mock 沿 sync.test.ts 的内存云端 double（忠实 worker/src/sync.ts 语义）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init as initAppState, readValue, STORAGE_KEYS } from '../../composables/useDataInfra'
import {
  ledger as readStars,
  writeLedger,
  rewards as readRewards,
  writeRewards,
} from '../../composables/useStarData'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { morale, writeMorale, writeAllMorale, questions, writeQuestions } from '../../composables/useLearningData'
import {
  startSync,
  __resetSyncForTests,
  __runCycleForTests,
  SYNC_OUTBOX_KEY,
  SYNC_RECONCILE_KEY,
  SYNC_DOMAINS,
} from '../sync'
import type { StarEntry, RewardItem, Question } from '../../types'
import { pullSync } from '../api'

// ===== 内存云端 double（与 sync.test.ts 同口径）=====

// #250 域表由同步引擎真实导出派生（消除手抄字面量；修复九域漂移：entry_visibility 前身曾缺席）
const CLOUD_DOMAINS = SYNC_DOMAINS

type CloudRow = Record<string, unknown> & { server_at: number }

function createCloud() {
  const tables = new Map<string, Map<string, CloudRow>>()
  for (const d of CLOUD_DOMAINS) tables.set(d, new Map())
  let clock = 10_000
  let online = true

  const identityOf = (domain: string, row: Record<string, unknown>): string => {
    if (domain === 'star_entries') return String(row['id'])
    if (domain === 'question_results') return `${row['question_id']}|${row['answered_at']}`
    if (domain === 'word_appearances') return `${row['word_id']}|${row['appeared_at']}`
    if (domain === 'question_flags') return String(row['question_id'])
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

// ===== 数据工厂 =====

function entry(id: string, timestamp = 1000): StarEntry {
  return { id, timestamp, type: 'earn', amount: 2, source: '答题得星', quizId: `quiz-${id}` }
}

function reward(id: string, name = '奖励'): RewardItem {
  return { id, name, price: 3 }
}

function bankQuestion(id: string): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: `w-${id}` }
}

function seedCredential(role: 'parent' | 'child' = 'parent'): void {
  writeDeviceCredential({ device_id: `dev-${role}`, secret: 's1', role, name: `${role}手机` })
}

function outbox(): Record<string, unknown[]> {
  const raw = localStorage.getItem(SYNC_OUTBOX_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown[]>)
}

function pendingReconcile(): string[] {
  const raw = localStorage.getItem(SYNC_RECONCILE_KEY)
  return raw === null ? [] : (JSON.parse(raw) as string[])
}

async function waitForDrain(): Promise<void> {
  await vi.waitFor(() => {
    expect(Object.keys(outbox())).toHaveLength(0)
  })
  await new Promise((r) => setTimeout(r, 0))
}

const originalWarn = console.warn
let warnSpy: ReturnType<typeof vi.spyOn>

function warns(): string[] {
  return warnSpy.mock.calls.map((c) => String(c[0]))
}

/** 制造损坏重置：写坏键 → 走受跟踪读路径（readValue 三态兜底重置并触发 #169 钩子） */
function corruptAndReset(key: string): void {
  localStorage.setItem(key, '{broken json')
  readValue<unknown>(key as never)
}

beforeEach(() => {
  localStorage.clear()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  initAppState()
})

afterEach(() => {
  __resetSyncForTests()
  console.warn = originalWarn
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('#180 临场状态损坏对账', () => {
  async function remoteRows(domain: string): Promise<Array<Record<string, unknown>>> {
    const response = await pullSync(0, { credential: { device_id: 'dev-parent', secret: 's1', role: 'parent', name: 'parent手机' } })
    if (!response.ok) throw new Error('公开拉取失败：' + response.kind)
    return response.domains[domain] ?? []
  }

  function moralePushes(cloud: ReturnType<typeof createCloud>): number {
    return cloud.fetchSpy.mock.calls.filter(([url, init]) =>
      String(url).endsWith('/api/sync/push') && 'morale' in JSON.parse(String(init?.body))).length
  }

  it('真实重启后恢复未确认编辑；对账失败期间其他域可推，临场状态仍禁推', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    writeMorale({ childId: 'default', level: 2, lastRoundCorrect: 7 })
    startSync()
    await vi.waitFor(async () => expect((await remoteRows('morale'))[0]).toMatchObject({ level: 2, last_round_correct: 7 }))
    cloud.setOnline(false)
    writeMorale({ childId: 'default', level: 3, lastRoundCorrect: 9 })
    await vi.waitFor(() => expect(cloud.fetchSpy.mock.calls.some(([, init]) => String(init?.body).includes('"last_round_correct":9'))).toBe(true))
    const device = { ...localStorage }
    __resetSyncForTests()
    for (const [key, value] of Object.entries(device)) localStorage.setItem(key, value)
    corruptAndReset(STORAGE_KEYS.morale)
    const attemptedBeforeRecovery = moralePushes(cloud)
    startSync()
    writeMorale({ childId: 'new-child', level: 2, lastRoundCorrect: 8 })
    await __runCycleForTests()
    expect(moralePushes(cloud)).toBe(attemptedBeforeRecovery)
    cloud.setOnline(true)
    writeRewards([reward('wake', '唤醒其他域推送')])
    await vi.waitFor(async () => expect((await remoteRows('reward_items')).some((row) => row.id === 'wake')).toBe(true))
    expect((await remoteRows('morale'))[0]).toMatchObject({ level: 2, last_round_correct: 7, deleted: 0 })
    await __runCycleForTests()
    await vi.waitFor(async () => {
      expect(morale()).toEqual({ childId: 'default', level: 3, lastRoundCorrect: 9 })
      expect(morale('new-child')).toEqual({ childId: 'new-child', level: 2, lastRoundCorrect: 8 })
      const rows = await remoteRows('morale')
      expect(rows.find((row) => row.child_id === 'default')).toMatchObject({ level: 3, last_round_correct: 9 })
      expect(rows).toHaveLength(2)
    })
    writeMorale({ childId: 'default', level: 1, lastRoundCorrect: 4 })
    await vi.waitFor(async () => expect((await remoteRows('morale')).find((row) => row.child_id === 'default')).toMatchObject({ level: 1, last_round_correct: 4 }))
  })

  it.each([false, true])('损坏重置后断网失败不推；恢复回填并保留新孩，后续修改和删除正常（启动前=%s）', async (beforeStart) => {
    const cloud = createCloud()
    cloud.seed('morale', [
      { child_id: 'default', level: 3, last_round_correct: 9, updated_at: 1000, updated_by: 'a', deleted: 0 },
      { child_id: 'sibling', level: 2, last_round_correct: 7, updated_at: 1000, updated_by: 'a', deleted: 0 },
    ])
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync()
    await vi.waitFor(() => expect(morale().level).toBe(3))
    if (beforeStart) __resetSyncForTests()
    corruptAndReset(STORAGE_KEYS.morale)
    cloud.setOnline(false)
    const attemptedBeforeRecovery = moralePushes(cloud)
    if (beforeStart) startSync()
    writeMorale({ childId: 'new-child', level: 2, lastRoundCorrect: 8 })
    await __runCycleForTests()
    expect(moralePushes(cloud)).toBe(attemptedBeforeRecovery)
    cloud.setOnline(true)
    writeRewards([reward('wake', '其他域仍可推送')])
    await vi.waitFor(async () => expect((await remoteRows('reward_items')).some((row) => row.id === 'wake')).toBe(true))
    expect((await remoteRows('morale')).map((row) => [row.child_id, row.deleted, row.level])).toEqual([['default', 0, 3], ['sibling', 0, 2]])
    await __runCycleForTests()
    await vi.waitFor(async () => {
      expect(morale()).toEqual({ childId: 'default', level: 3, lastRoundCorrect: 9 })
      expect(morale('sibling')).toEqual({ childId: 'sibling', level: 2, lastRoundCorrect: 7 })
      expect(morale('new-child')).toEqual({ childId: 'new-child', level: 2, lastRoundCorrect: 8 })
      expect(await remoteRows('morale')).toHaveLength(3)
    })
    writeMorale({ childId: 'default', level: 1, lastRoundCorrect: 3 })
    await vi.waitFor(async () => expect((await remoteRows('morale')).find((row) => row.child_id === 'default')).toMatchObject({ level: 1, last_round_correct: 3, deleted: 0 }))
    writeAllMorale([morale('default'), morale('new-child')])
    await vi.waitFor(async () => expect((await remoteRows('morale')).find((row) => row.child_id === 'sibling')?.deleted).toBe(1))
    await __runCycleForTests()
    expect(morale('sibling')).toEqual({ childId: 'sibling', level: 1, lastRoundCorrect: null })
  })
})

// ===== 端到端注入场景（票内验收主线）=====

describe('#171 注入场景：损坏重置 → 写入 → 未墓碑化 → 回填 → 解除 → 增量恢复', () => {
  it('reward_items（LWW 域）全链路：重置后写入不墓碑化云端；对账回填+本地新写保留；解除后增量正常', async () => {
    const cloud = createCloud()
    cloud.seed('reward_items', [
      { id: 'r1', name: '云端奖励', price: 5, updated_at: 1000, updated_by: 'dev-a', deleted: 0 },
      { id: 'r2', name: '云端奖励2', price: 6, updated_at: 1000, updated_by: 'dev-a', deleted: 0 },
    ])
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync() // bootstrap：云端为准灌入 r1/r2，影子建立
    await waitForDrain()
    expect(readRewards().map((r) => r.id).sort()).toEqual(['r1', 'r2'])

    // ① 制造损坏重置（走受跟踪读路径 → #169 钩子 → #171 域标脏禁推）
    corruptAndReset(STORAGE_KEYS.rewards)
    expect(pendingReconcile()).toEqual(['reward_items'])
    expect(warns().some((m) => m.includes('sq_rewards') && m.includes('标脏禁推'))).toBe(true)

    // ② 本域写入：禁推——不 diff 不攒 outbox（防墓碑）、零推送
    writeRewards([reward('r-new', '崩溃后新写')])
    await new Promise((r) => setTimeout(r, 20))
    expect(outbox()['reward_items']).toBeUndefined()
    const pushesSoFar = cloud.fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/api/sync/push')).length

    // ③ 云端未被墓碑化：两行原封不动、零 deleted
    const cloudRows = cloud.snapshot('reward_items')
    expect(cloudRows.filter((r) => r['id'] === 'r1' || r['id'] === 'r2')).toHaveLength(2)
    expect(cloudRows.every((r) => r['deleted'] === 0)).toBe(true)

    // ④ 对账：回填 r1/r2（影子有而本地无），本地新写 r-new 保留；解除禁推并补推新行
    await __runCycleForTests()
    await waitForDrain()
    expect(readRewards().map((r) => r.id).sort()).toEqual(['r-new', 'r1', 'r2'])
    expect(pendingReconcile()).toEqual([])
    expect(warns().some((m) => m.includes('reward_items') && m.includes('回填 2 行'))).toBe(true)
    expect(warns().some((m) => m.includes('影子已重建') && m.includes('解除禁推'))).toBe(true)
    // 补推的是新行 r-new，不是墓碑：云端三行全部 deleted=0
    const cloudAfter = cloud.snapshot('reward_items')
    expect(cloudAfter.every((r) => r['deleted'] === 0)).toBe(true)
    expect(cloudAfter.map((r) => r['id']).sort()).toEqual(['r-new', 'r1', 'r2'])
    expect(cloud.fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/api/sync/push')).length).toBeGreaterThan(pushesSoFar)

    // ⑤ 解除后增量恢复正常：普通改名照常上云
    writeRewards([reward('r1', '改名'), reward('r2', '云端奖励2'), reward('r-new', '崩溃后新写')])
    await waitForDrain()
    expect(cloud.snapshot('reward_items').find((r) => r['id'] === 'r1')?.['name']).toBe('改名')
  })

  it('star_entries（流水域）重置 → 回填云端全量并保留本地新账；无墓碑风险链路同样成立', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeLedger([entry('s1')])
    seedCredential()
    startSync()
    await waitForDrain()
    expect(cloud.snapshot('star_entries')).toHaveLength(1)

    corruptAndReset(STORAGE_KEYS.stars)
    expect(pendingReconcile()).toEqual(['star_entries'])
    writeLedger([entry('s-new')])
    await new Promise((r) => setTimeout(r, 20))
    expect(outbox()['star_entries']).toBeUndefined()

    await __runCycleForTests()
    await waitForDrain()
    expect(readStars().map((e) => e.id).sort()).toEqual(['s-new', 's1'])
    expect(cloud.snapshot('star_entries').map((r) => r['id']).sort()).toEqual(['s-new', 's1'])
    expect(pendingReconcile()).toEqual([])
  })

  it('question_banks：重置后本地新导入整组保留（不被云端旧组覆写），解除禁推后补推上云', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeQuestions([bankQuestion('000001')])
    seedCredential('parent')
    startSync()
    await waitForDrain()
    expect(cloud.snapshot('question_banks')).toHaveLength(1)

    corruptAndReset(STORAGE_KEYS.questions)
    expect(pendingReconcile()).toEqual(['question_banks'])
    // 重置回空池后家长重新导入新整组（本地新写）：禁推期间不推
    writeQuestions([bankQuestion('000001'), bankQuestion('000002')])
    await new Promise((r) => setTimeout(r, 20))
    expect(cloud.snapshot('question_banks')).toHaveLength(1)

    await __runCycleForTests()
    await waitForDrain()
    // 本地新导入保留（非空且与影子不同 → 本地为最新），解除后补推整组
    expect(questions().map((q) => q.id)).toEqual(['000001', '000002'])
    expect(pendingReconcile()).toEqual([])
    expect(cloud.snapshot('question_banks')).toHaveLength(1)
    expect((cloud.snapshot('question_banks')[0]['content'] as Array<{ id: string }>).map((q) => q.id)).toEqual([
      '000001',
      '000002',
    ])
  })

  it('对账拉取失败（断网）→ 保持禁推不墓碑化；恢复后下周期对账成功', async () => {
    const cloud = createCloud()
    cloud.seed('reward_items', [
      { id: 'r1', name: '云端奖励', price: 5, updated_at: 1000, updated_by: 'dev-a', deleted: 0 },
    ])
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync()
    await waitForDrain()

    corruptAndReset(STORAGE_KEYS.rewards)
    writeRewards([])
    cloud.setOnline(false)
    await __runCycleForTests() // 对账拉失败：静默保持禁推
    expect(pendingReconcile()).toEqual(['reward_items'])
    expect(cloud.snapshot('reward_items').every((r) => r['deleted'] === 0)).toBe(true)

    cloud.setOnline(true)
    await __runCycleForTests()
    await waitForDrain()
    expect(pendingReconcile()).toEqual([])
    expect(readRewards().map((r) => r.id)).toEqual(['r1'])
    expect(cloud.snapshot('reward_items').every((r) => r['deleted'] === 0)).toBe(true)
  })

  it('云端该域为空 → 无可回填：影子重建空基线、解除禁推（本地空态即真相）', async () => {
    const cloud = createCloud()
    cloud.seed('reward_items', [
      { id: 'r1', name: '云端奖励', price: 5, updated_at: 1000, updated_by: 'dev-a', deleted: 0 },
    ])
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync() // bootstrap：云端灌入 reward_items；star_entries 云端为空、本机也为空
    await waitForDrain()

    corruptAndReset(STORAGE_KEYS.stars) // 重置回默认空数组：影子（空）与本地一致，但流程照走
    await __runCycleForTests()
    await waitForDrain()
    expect(pendingReconcile()).toEqual([])
    expect(warns().some((m) => m.includes('云端无数据') && m.includes('star_entries'))).toBe(true)
    expect(cloud.snapshot('star_entries')).toHaveLength(0)
    // 解除后增量正常：新账照常上云
    writeLedger([entry('s1')])
    await waitForDrain()
    expect(cloud.snapshot('star_entries').map((r) => r['id'])).toEqual(['s1'])
  })
})

// ===== 引擎启动前损坏（init/早期读取）：事件台账补挂 =====

describe('#171 引擎启动前的损坏重置：事件台账补挂（#67 R2-1 注册回调时序盲区）', () => {
  it('引擎未启动时损坏 → startSync 从台账取事件标脏 → 首轮对账回填不墓碑化', async () => {
    const cloud = createCloud()
    cloud.seed('reward_items', [
      { id: 'r1', name: '云端奖励', price: 5, updated_at: 1000, updated_by: 'dev-a', deleted: 0 },
    ])
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync()
    await waitForDrain()
    __resetSyncForTests() // 模拟引擎未启动窗口

    corruptAndReset(STORAGE_KEYS.rewards) // 此时无已注册钩子，事件只入台账
    writeRewards([])
    await new Promise((r) => setTimeout(r, 20))
    expect(cloud.snapshot('reward_items').every((r) => r['deleted'] === 0)).toBe(true)

    startSync() // 启动补挂：台账事件 → 标脏禁推 → 首轮周期对账
    await waitForDrain()
    expect(pendingReconcile()).toEqual([])
    expect(readRewards().map((r) => r.id)).toEqual(['r1'])
    expect(cloud.snapshot('reward_items').every((r) => r['deleted'] === 0)).toBe(true)
  })
})

// ===== 正门删除 / 修改回归：不触发误恢复 =====

describe('#171 正门删除/修改回归：走受跟踪写路径的正常变更不被对账误恢复', () => {
  it('正常删除（writeRewards 移除行）→ 墓碑上云；后续周期不复活', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeRewards([reward('r1'), reward('r2')])
    seedCredential()
    startSync()
    await waitForDrain()
    expect(cloud.snapshot('reward_items')).toHaveLength(2)

    writeRewards([reward('r2')]) // 正门删除 r1
    await waitForDrain()
    const r1 = cloud.snapshot('reward_items').find((r) => r['id'] === 'r1')
    expect(r1?.['deleted']).toBe(1)

    await __runCycleForTests() // 再跑周期：无对账介入、无复活
    await waitForDrain()
    expect(readRewards().map((r) => r.id)).toEqual(['r2'])
    expect(cloud.snapshot('reward_items').find((r) => r['id'] === 'r1')?.['deleted']).toBe(1)
    expect(pendingReconcile()).toEqual([])
  })

  it('正常修改（LWW 改名）→ 云端更新；后续周期不被回滚', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeRewards([reward('r1', '旧名')])
    seedCredential()
    startSync()
    await waitForDrain()

    writeRewards([reward('r1', '新名')])
    await waitForDrain()
    expect(cloud.snapshot('reward_items').find((r) => r['id'] === 'r1')?.['name']).toBe('新名')

    await __runCycleForTests()
    await waitForDrain()
    expect(readRewards()[0].name).toBe('新名')
    expect(cloud.snapshot('reward_items').find((r) => r['id'] === 'r1')?.['name']).toBe('新名')
  })
})

// ===== 全量推送阻断（bootstrap 路径）=====

describe('#171 全量推送同样阻断：未 bootstrap 设备损坏重置后，基线上云不携带墓碑', () => {
  it('云端空 + 本机损坏重置 → bootstrap 全量推被阻断 → 对账（云端空）影子重建后本机全量推', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeRewards([reward('r1', '本机数据')])
    seedCredential()

    corruptAndReset(STORAGE_KEYS.rewards) // 引擎未启动：事件入台账
    startSync() // 首轮：bootstrap（r 域推被阻断）→ 对账（云端空：影子空基线 + 全量补推）
    await waitForDrain()

    expect(pendingReconcile()).toEqual([])
    const rows = cloud.snapshot('reward_items')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r['deleted'] === 0)).toBe(true)
  })
})
