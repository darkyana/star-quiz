/**
 * 同步引擎单测（#126，R-P1d）：fetch mock = 忠实于 worker/src/sync.ts 语义的内存云端
 * （流水 DO NOTHING 幂等 / LWW 严格大于覆写 / pull since=server_at 游标 + server_at）。
 * 覆盖：未配对零网络、首台全量上云、写入即推、断网攒账重试、
 * 换机灌入+自动留档、题库家长单写客户端门禁、冷启动增量游标。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init as initAppState } from '../../composables/useDataInfra'
import {
  ledger as readStars,
  writeLedger,
  rewards as readRewards,
  writeRewards,
} from '../../composables/useStarData'
import { writeQuestions, writeFlagged, morale, writeMorale } from '../../composables/useLearningData'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { readEntryVisibilityMap, writeEntryVisibilityValue } from '../../composables/useEntryVisibility'
import {
  startSync,
  onPaired,
  __resetSyncForTests,
  __runCycleForTests,
  SYNC_OUTBOX_KEY,
  SYNC_SHADOW_KEY,
  SYNC_CURSOR_KEY,
  SYNC_BOOTSTRAPPED_KEY,
  SYNC_DOMAINS,
} from '../sync'
import type { StarEntry, RewardItem, Question } from '../../types'

// ===== 内存云端 double（忠实 worker/src/sync.ts 语义）=====

// #250 域表由同步引擎真实导出派生（消除手抄字面量；mock 不可能比引擎少域或多域，
// 修复八域漂移：morale / entry_visibility（前身）曾缺席导致两域静默跳过）
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
      // #174 能力探测：新契约（协议版本 4 = #262 起含 entry_visibility 键控域）
      return json({ ok: true, sync_protocol: 6 })
    }
    if (u.endsWith('/api/sync/push')) {
      const body = JSON.parse(String(init?.body)) as Record<string, Array<Record<string, unknown>>>
      for (const [domain, rows] of Object.entries(body)) for (const row of rows) applyPush(domain, row)
      return json({ ok: true, server_at: ++clock })
    }
    if (u.includes('/api/sync/pull')) {
      // 不用 new URL 解析（下载 stub 会替换全局 URL 对象）
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

// ===== 留档下载 stub（沿 24-test-mode 惯例）=====

let capturedBlobs: Blob[] = []

function stubDownload(): void {
  capturedBlobs = []
  const createObjectURLSpy = vi.fn((b: Blob) => {
    capturedBlobs.push(b)
    return 'blob:mock-url'
  })
  vi.stubGlobal('URL', { createObjectURL: createObjectURLSpy, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    void this.download
  })
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
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

/** 等待引擎静默：outbox 清空且无在途请求 */
async function waitForDrain(): Promise<void> {
  await vi.waitFor(() => {
    expect(Object.keys(outbox())).toHaveLength(0)
  })
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

afterEach(() => {
  __resetSyncForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

// ===== 未配对零网络 =====

describe('未配对零网络（#125 挂载零请求口径延续）', () => {
  it('无 sq_device_credential：startSync + 本地写入 → 零 fetch', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    startSync()
    writeLedger([entry('s1')])
    writeRewards([reward('r1', '改名')])
    await new Promise((r) => setTimeout(r, 20))
    expect(cloud.fetchSpy).not.toHaveBeenCalled()
  })
})

// ===== 首台设备：云端全空 → 全量上云、无留档 =====

describe('首台设备 bootstrap：云端全空', () => {
  it('无灌入无留档（零 blob）；本机全量推上云；游标与完成标记落盘', async () => {
    const cloud = createCloud()
    stubDownload()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeLedger([entry('s1'), entry('s2')])
    writeRewards([reward('r1', '菠萝油')])
    writeFlagged({ q1: { flaggedAt: 123 } })
    seedCredential()

    startSync()
    await waitForDrain()

    expect(capturedBlobs).toHaveLength(0) // 首台云端为空：无留档
    expect(cloud.snapshot('star_entries')).toHaveLength(2)
    expect(cloud.snapshot('reward_items')).toHaveLength(1)
    expect(cloud.snapshot('question_flags')).toHaveLength(1)
    expect(localStorage.getItem(SYNC_BOOTSTRAPPED_KEY)).toBe('true')
    expect(Number(localStorage.getItem(SYNC_CURSOR_KEY))).toBeGreaterThan(0)
  })
})

// ===== 写入即推 =====

describe('写入即推：本地任何落库后推该域增量', () => {
  it('bootstrap 后 writeLedger 新增 → 只推 star_entries 新条目增量；重复写不重推', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeLedger([entry('s1')])
    seedCredential()
    startSync()
    await waitForDrain()
    const pushesAfterBootstrap = cloud.fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/api/sync/push')).length
    expect(pushesAfterBootstrap).toBeGreaterThan(0)

    writeLedger([entry('s1'), entry('s3')])
    await waitForDrain()
    const pushCalls = cloud.fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/api/sync/push'))
    const lastBody = JSON.parse(String(pushCalls[pushCalls.length - 1]?.[1]?.body)) as Record<string, unknown[]>
    expect(lastBody['star_entries']).toEqual([
      { id: 's3', child_id: 'default', kind: 'main', timestamp: 1000, type: 'earn', amount: 2, source: '答题得星', quiz_id: 'quiz-s3' },
    ])
    expect(Object.keys(lastBody)).toEqual(['star_entries']) // 只推该域

    // 无新增的写入（幂等写）不触发网络
    const before = cloud.fetchSpy.mock.calls.length
    writeLedger([entry('s1'), entry('s3')])
    await new Promise((r) => setTimeout(r, 10))
    expect(cloud.fetchSpy.mock.calls.length).toBe(before)
  })

  it('兑换项改名走 LWW：推 reward_items 行（带 updated_at/updated_by/deleted）', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeRewards([reward('r1', '旧名')])
    seedCredential()
    startSync()
    await waitForDrain()

    writeRewards([reward('r1', '新名')])
    await waitForDrain()
    const rows = cloud.snapshot('reward_items')
    expect(rows).toHaveLength(1)
    expect(rows[0]['name']).toBe('新名')
    expect(rows[0]['updated_by']).toBe('dev-parent')
    expect(rows[0]['deleted']).toBe(0)
  })
})

// ===== 断网攒账重试 =====

describe('失败静默攒账：断网写入攒着，恢复后追平', () => {
  it('断网期写入零弹错零阻塞；恢复后一次推齐全部攒账增量（离线攒账恢复追平）', async () => {
    const cloud = createCloud()
    cloud.setOnline(false)
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeLedger([entry('s1')])
    seedCredential()
    startSync()
    await new Promise((r) => setTimeout(r, 20))
    // 断网：冷启动拉失败静默；本地写入不受任何影响
    writeLedger([entry('s1'), entry('s2')])
    writeRewards([reward('r1', '断网改名')])
    await new Promise((r) => setTimeout(r, 20))
    expect(outbox()['star_entries']).toHaveLength(2) // 攒账持久化（跨"重启"不丢）
    expect(outbox()['reward_items']).toHaveLength(1)

    // 恢复：下次写入触发重试，推齐攒账
    cloud.setOnline(true)
    writeLedger([entry('s1'), entry('s2'), entry('s3')])
    await waitForDrain()
    expect(cloud.snapshot('star_entries').map((r) => r['id']).sort()).toEqual(['s1', 's2', 's3'])
    expect(cloud.snapshot('reward_items')[0]['name']).toBe('断网改名')
    // 冷启动（重启等价）：bootstrap 补跑完成，首同步标记落盘
    await __runCycleForTests()
    expect(localStorage.getItem(SYNC_BOOTSTRAPPED_KEY)).toBe('true')
  })
})

// ===== 换机云端为准 =====

describe('换机首次同步：云端为准灌入 + 自动留档', () => {
  it('云端非空 → 覆盖前双文件自动留档（含本机全量数据）→ 本机被云端覆盖；云端空域保留本机并推上', async () => {
    const cloud = createCloud()
    stubDownload()
    cloud.seed('star_entries', [
      { id: 'cloud-s1', timestamp: 5000, type: 'earn', amount: 7, source: '答题得星' },
    ])
    cloud.seed('reward_items', [
      { id: 'r-cloud', name: '云端奖品', price: 9, updated_at: 8888, updated_by: 'dev-a', deleted: 0 },
    ])
    vi.stubGlobal('fetch', cloud.fetchSpy)

    // 本机旧数据（换机前的本地态）
    writeLedger([entry('local-s1', 100)])
    writeRewards([reward('r-local', '本机奖品')])
    writeFlagged({ qLocal: { flaggedAt: 1 } })
    seedCredential()

    startSync()
    await waitForDrain()

    // 留档：学习 + 经济两文件，内容为覆盖前本机全量数据
    expect(capturedBlobs).toHaveLength(2)
    const [learning, economy] = await Promise.all(capturedBlobs.map(readBlob))
    const learningPayload = JSON.parse(learning)
    const economyPayload = JSON.parse(economy)
    expect(learningPayload.flagged).toEqual({ qLocal: { flaggedAt: 1, childId: 'default' } })
    expect(economyPayload.starLedger).toEqual([{ ...entry('local-s1', 100), childId: 'default', kind: 'main' }])
    expect(economyPayload.rewards).toEqual([reward('r-local', '本机奖品')])

    // 灌入：云端为准（流水并集落地 / LWW 覆写）；云端空域（红旗）保留本机并推上
    expect(readStars().map((e) => e.id)).toEqual(['cloud-s1'])
    expect(readRewards()).toEqual([{ id: 'r-cloud', name: '云端奖品', price: 9 }])
    await vi.waitFor(() => {
      expect(cloud.snapshot('question_flags')).toHaveLength(1)
    })
    expect(localStorage.getItem(SYNC_BOOTSTRAPPED_KEY)).toBe('true')
  })

  it('配对成功挂钩（onPaired）：宏任务延迟首启，云端灌入不阻塞配对返回', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    cloud.seed('star_entries', [
      { id: 'cloud-s1', timestamp: 5000, type: 'earn', amount: 7, source: '答题得星' },
    ])
    writeLedger([])
    seedCredential()
    startSync() // 引擎已启动（无凭据时启动空转）
    expect(readStars()).toEqual([])
    onPaired()
    await vi.waitFor(() => {
      expect(readStars().map((e) => e.id)).toEqual(['cloud-s1'])
    })
  })
})

// ===== 题库家长单写（客户端口径） =====

describe('题库家长单写：客户端同口径（child 不推 question_banks）', () => {
  it('child 角色导入题库 → 零 question_banks 推送；parent 角色推整组', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential('child')
    startSync()
    await waitForDrain()

    writeQuestions([bankQuestion('000001'), bankQuestion('000002')])
    await new Promise((r) => setTimeout(r, 20))
    expect(cloud.snapshot('question_banks')).toHaveLength(0)
    const pushes = cloud.fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/api/sync/push'))
    for (const call of pushes) {
      expect(JSON.parse(String(call[1]?.body))['question_banks']).toBeUndefined()
    }
  })

  it('parent 角色导入题库 → 整组一行上云；拉侧孩子设备整组落地', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    writeQuestions([bankQuestion('000001')])
    seedCredential('parent')
    startSync()
    await waitForDrain()
    const rows = cloud.snapshot('question_banks')
    expect(rows).toHaveLength(1)
    expect((rows[0]['content'] as Question[]).map((q) => q.id)).toEqual(['000001'])

    // 再导入新整组（最后导入方胜）→ 云端整组替换
    writeQuestions([bankQuestion('000001'), bankQuestion('000002')])
    await waitForDrain()
    const rows2 = cloud.snapshot('question_banks')
    expect(rows2).toHaveLength(1)
    expect((rows2[0]['content'] as Question[]).map((q) => q.id)).toEqual(['000001', '000002'])
    expect(Number(rows2[0]['updated_at'])).toBeGreaterThan(Number(rows[0]['updated_at']))
  })
})

// ===== #250 八域漂移修复：缺席两域回到覆盖 =====

describe('#250 十域拉平：morale（临场状态）与 entry_visibility（入口显隐，#262 键控）', () => {
  it('morale 写入即推：增量推 morale 域行（身份 = child_id，带 updated_at/updated_by）', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync()
    await waitForDrain()

    writeMorale({ level: 2, lastRoundCorrect: 7, childId: 'default' })
    await waitForDrain()
    const rows = cloud.snapshot('morale')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ child_id: 'default', level: 2, last_round_correct: 7, updated_by: 'dev-parent' })
  })

  it('entry_visibility 开关写入即推：键控域行（entry_id + visible 0/1）上云', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync()
    await waitForDrain()

    writeEntryVisibilityValue('builtin-trivia', false)
    await waitForDrain()
    expect(cloud.snapshot('entry_visibility')).toEqual([expect.objectContaining({ entry_id: 'builtin-trivia', visible: 0, updated_by: 'dev-parent' })])
  })

  it('拉侧灌入：云端 morale / entry_visibility 行在空本机设备落地', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    cloud.seed('morale', [
      { child_id: 'default', level: 3, last_round_correct: 5, updated_at: 8888, updated_by: 'dev-a', deleted: 0 },
    ])
    cloud.seed('entry_visibility', [
      { entry_id: 'builtin-trivia', visible: 0, updated_at: 8889, updated_by: 'dev-a' },
    ])
    seedCredential()
    startSync()
    await waitForDrain()
    expect(morale()).toEqual({ level: 3, lastRoundCorrect: 5, childId: 'default' })
    expect(readEntryVisibilityMap()).toEqual({ 'builtin-trivia': false })
  })
})

// ===== 冷启动增量游标 =====

describe('冷启动拉合：since 游标推进', () => {
  it('第二次周期 pull 用上次 server_at——已读批次不再返回（请求 URL 断言）', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    cloud.seed('star_entries', [
      { id: 'cloud-s1', timestamp: 5000, type: 'earn', amount: 7, source: '答题得星' },
    ])
    seedCredential()
    startSync()
    await waitForDrain()
    expect(readStars().map((e) => e.id)).toEqual(['cloud-s1'])
    const cursor = Number(localStorage.getItem(SYNC_CURSOR_KEY))

    await __runCycleForTests()
    const pulls = cloud.fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/sync/pull'))
    const lastPull = String(pulls[pulls.length - 1]?.[0])
    expect(lastPull.endsWith(`/api/sync/pull?since=${cursor}`)).toBe(true)
  })
})

// ===== #169 机器自用键（引擎四键）损坏：保留回退 + 补日志 =====

describe('#169 引擎键损坏：readJson 回退默认值 + console.warn 含键名与原因', () => {
  it('sq_sync_shadow 损坏 → 回退空影子上云全量推 + warn 不抛错（行为语义不变）', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    cloud.seed('star_entries', [
      { id: 'cloud-s1', timestamp: 5000, type: 'earn', amount: 7, source: '答题得星' },
    ])
    writeLedger([entry('s1')])
    seedCredential()
    localStorage.setItem(SYNC_SHADOW_KEY, '{broken shadow')

    startSync()
    await waitForDrain()

    // 损坏影子回退空 → 云端有行触发留档灌入，云端条目落地（回退语义不变）
    expect(readStars().map((e) => e.id)).toContain('cloud-s1')
    const messages = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('sq_sync_shadow') && m.includes('已回退默认值'))).toBe(true)
  })
})
