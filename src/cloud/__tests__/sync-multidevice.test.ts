/**
 * 多设备模拟同步验收（#126，R-P1d 票面 AC）：内存云端（忠实 worker/src/sync.ts 语义）
 * + 两台设备（localStorage 快照交换模拟各自设备），断言端到端收敛：
 * 并发写同域并集 / 离线攒账恢复追平 / LWW 裁决 / 提议板修订即认同 / 题库整组胜 / 墓碑传播。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { init as initAppState, STORAGE_KEYS } from '../../composables/useDataInfra'
import {
  allLedger as readStars,
  writeLedger,
  grant,
  balance,
  rewards as readRewards,
  writeRewards,
} from '../../composables/useStarData'
import { morale, writeMorale, writeAllMorale, recentWords, writeRecentWords, questionResults, writeQuestionResults, questions as readQuestions, writeQuestions, writeFlagged, flagged as readFlagged } from '../../composables/useLearningData'
import { validateLearningImport, applyLearningImport } from '../../composables/useImport'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz, readSession } from '../../composables/useQuiz'
import { allProposals as readProposals, writeProposals, update, voidProposal, deleteProposal, create as createProposal } from '../../composables/useProposals'
import { allRecords as readRedemptions, writeRecords, complete } from '../../composables/useActiveRedemptions'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { readEntryVisibilityMap, writeEntryVisibilityValue } from '../../composables/useEntryVisibility'
import { readTriviaStarEarns, writeTriviaStarEarns, TRIVIA_STAR_TOGGLE_KEY } from '../../composables/useTriviaStarToggle'
import { adoptTriviaSet, triviaSetRef } from '../../data/trivia-set'
import { mulberry32 } from '../../utils/quizEngine'
import { startSync, __resetSyncForTests, __runCycleForTests, SYNC_DOMAINS } from '../sync'
import { pushSync } from '../api'
import type { ActiveRedemption, ProposalRecord, Question, StarEntry } from '../../types'

// #250 域表由同步引擎真实导出派生（消除手抄字面量；mock 不可能比引擎少域或多域）
const CLOUD_DOMAINS = SYNC_DOMAINS

type CloudRow = Record<string, unknown> & { server_at: number }

function createCloud() {
  const tables = new Map<string, Map<string, CloudRow>>()
  for (const d of CLOUD_DOMAINS) tables.set(d, new Map())
  // #268：server_at 忠实 worker/src/http.ts（Date.now() 毫秒，ADR 0005）。
  // 旧的小整数时钟（10_000 起）会让 noteServerAt 算出 ≈−1.7e12 的 clockOffset，
  // 之后所有 stamp() 坍缩到 1e4 量级，在 LWW 域永远输给取偏移前发出的真实时刻行。
  let clock = Date.now()
  let online = true
  let nextPushGate: (() => Promise<void>) | undefined

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

  const fetchHandler = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
      const gate = nextPushGate
      nextPushGate = undefined
      if (gate) await gate()
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
    fetchHandler,
    holdNextPush() {
      let release!: () => void
      let arrived!: () => void
      const waiting = new Promise<void>((resolve) => { arrived = resolve })
      const gate = new Promise<void>((resolve) => { release = resolve })
      nextPushGate = () => { arrived(); return gate }
      return { waiting, release }
    },
    reset(): void {
      fetchHandler.mockClear()
      tables.clear()
      for (const d of CLOUD_DOMAINS) tables.set(d, new Map())
      online = true
      nextPushGate = undefined
    },
    setOnline(v: boolean): void {
      online = v
    },
    snapshot(domain: string): CloudRow[] {
      return [...(tables.get(domain)?.values() ?? [])]
    },
  }
}

const cloud = createCloud()

// ===== 设备模拟（localStorage 快照交换；换位 = 该设备应用冷启动）=====

function stashDevice(): Record<string, string> {
  const snap = { ...localStorage } // 先存完整快照（含 sq_sync_* 同步状态），再复位
  __resetSyncForTests()
  localStorage.clear()
  return snap
}

function loadDevice(snap: Record<string, string>): void {
  __resetSyncForTests()
  localStorage.clear()
  for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v)
  startSync()
}

function bootDevice(cred: { id: string; role: 'parent' | 'child' }): void {
  localStorage.clear()
  initAppState()
  writeDeviceCredential({ device_id: cred.id, secret: 's1', role: cred.role, name: cred.id })
}

async function settle(): Promise<void> {
  await vi.waitFor(() => {
    const raw = localStorage.getItem('sq_sync_outbox')
    const parsed: Record<string, unknown> = raw === null ? {} : JSON.parse(raw)
    expect(Object.keys(parsed)).toHaveLength(0)
  })
  await new Promise((r) => setTimeout(r, 0))
}

function entry(id: string, timestamp: number): StarEntry {
  return { id, timestamp, type: 'earn', amount: 1, source: '答题得星', quizId: `quiz-${id}` }
}

function proposal(id: string, updatedAt: number, over: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id, name: '乐高', price: 100, status: 'discussing', createdAt: 1, updatedAt,
    description: '', parentStatus: 'notAgreed', childStatus: 'notAgreed',
    initiator: 'parent', lastActionBy: 'parent', lastActionKind: 'proposed', ...over,
  }
}

function bankQuestion(id: string): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: `w-${id}` }
}

beforeEach(() => {
  // 云端每测重置（首台 bootstrap 会把内置默认数据推上云，跨测试共享会污染裁决场景）
  cloud.reset()
  localStorage.clear()
  // 抑制换机留档下载副作用（多设备灌入时的自动导出走 blob stub）
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    void this.download
  })
  vi.stubGlobal('fetch', cloud.fetchHandler)
})

afterEach(() => {
  __resetSyncForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('临场状态按孩子往返', () => {
  it.each([0, 1, -1])('并发同孩记录级LWW：远端时间差%s，平手云端胜；其他孩子不受影响', async (delta) => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeMorale({ level: 2, lastRoundCorrect: 7, childId: 'default' })
    writeMorale({ level: 3, lastRoundCorrect: 10, childId: 'sibling' })
    startSync()
    await settle()
    cloud.setOnline(false)
    writeMorale({ level: 1, lastRoundCorrect: 4, childId: 'default' })
    await vi.waitFor(() => expect(cloud.fetchHandler.mock.calls.some(([, init]) => String(init?.body).includes('"last_round_correct":4'))).toBe(true))
    const request = [...cloud.fetchHandler.mock.calls].reverse().find(([, init]) => String(init?.body).includes('"last_round_correct":4'))!
    const pendingRow = JSON.parse(String(request[1]?.body)).morale[0]
    cloud.setOnline(true)
    // 另一设备的并发推送经公开HTTP客户端边界；时间以刚捕获的本机线协议行作同刻/前后刻对照。
    expect((await pushSync({ morale: [{ ...pendingRow, level: 3, last_round_correct: 9, updated_at: pendingRow.updated_at + delta, updated_by: 'dev-b' }] }, {
      credential: { device_id: 'dev-b', secret: 's1', role: 'child', name: 'B' },
    })).ok).toBe(true)
    await __runCycleForTests()
    await settle()
    const expected = delta < 0 ? { level: 1, lastRoundCorrect: 4, childId: 'default' } : { level: 3, lastRoundCorrect: 9, childId: 'default' }
    expect(morale()).toEqual(expected)
    expect(morale('sibling')).toEqual({ level: 3, lastRoundCorrect: 10, childId: 'sibling' })
    stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(morale()).toEqual(expected)
    expect(morale('sibling').level).toBe(3)
  })
  it('默认初始值不推；写入逐孩隔离，恢复待结算会话只更新默认孩子，删除也逐孩传播', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeQuestions([bankQuestion('000001')])
    startSync()
    await settle()
    expect(cloud.snapshot('morale')).toEqual([])
    writeMorale({ level: 3, lastRoundCorrect: 9, childId: 'sibling' })
    const session = startQuiz(() => 0.5)!
    answerQuiz(session.questions[0].answerIndex)
    finishQuiz()
    await settle()
    loadDevice(stashDevice())
    await settle()
    expect(settleQuiz()).toBe('settled')
    expect(settleQuiz()).toBe('idempotent')
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(morale()).toEqual({ level: 1, lastRoundCorrect: 1, childId: 'default' })
    expect(morale('sibling')).toEqual({ level: 3, lastRoundCorrect: 9, childId: 'sibling' })
    // 同孩显式重置成默认值是一次真实修改，不因与读取兜底相同而漏推。
    writeMorale({ level: 1, lastRoundCorrect: null, childId: 'default' })
    await settle()
    const b = stashDevice()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(morale()).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(morale('sibling').level).toBe(3)
    writeAllMorale([morale('sibling')])
    await settle()
    loadDevice(b)
    await __runCycleForTests()
    await settle()
    expect(morale()).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(morale('sibling').level).toBe(3)
    expect(cloud.snapshot('morale').find((r) => r.child_id === 'default')?.deleted).toBe(1)
  })
  it('公开写入在另一设备可见，默认初始档位不覆盖云端', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeMorale({ level: 3, lastRoundCorrect: 9, childId: 'default' })
    startSync()
    await settle()
    stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(morale()).toEqual({ level: 3, lastRoundCorrect: 9, childId: 'default' })
  })
})

describe('经济事实按孩子往返', () => {
  it('恢复待结算会话时另一孩子同quizId不挡入账，结算幂等且跨设备各归各孩', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeQuestions([bankQuestion('000001')])
    startSync()
    await settle()
    const session = startQuiz(() => 0.5)!
    writeLedger([{ ...entry('sibling-award', 1), childId: 'sibling', kind: 'interest', quizId: session.quizId, amount: 20 }])
    answerQuiz(session.questions[0].answerIndex)
    finishQuiz()
    await settle()
    const pending = stashDevice()
    loadDevice(pending)
    await __runCycleForTests()
    await settle()
    expect(readSession()?.status).toBe('pending')
    expect(settleQuiz()).toBe('settled')
    expect(settleQuiz()).toBe('idempotent')
    await settle()
    expect(balance()).toBe(4)
    stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(balance()).toBe(4)
    expect(readStars().filter((r) => r.childId === 'sibling')).toEqual([{ ...entry('sibling-award', 1), childId: 'sibling', kind: 'interest', quizId: session.quizId, amount: 20 }])
    expect(readStars().filter((r) => r.childId === 'default')).toHaveLength(2)
  })
  it('经济三域损坏重置后本地新写保留并回填全孩，另一设备没有误删除', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeLedger(['default', 'sibling'].map((childId) => ({ ...entry('same', 1), childId, kind: 'game' })))
    writeProposals(['default', 'sibling'].map((childId) => proposal('same', 1, { childId })))
    writeRecords(['default', 'sibling'].map((childId) => ({ id: 'same', childId, rewardId: 'r1', name: childId, emoji: '🎁', createdAt: 1 })))
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    const b = stashDevice()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    for (const key of [STORAGE_KEYS.stars, STORAGE_KEYS.proposals, STORAGE_KEYS.activeRedemptions]) localStorage.setItem(key, '{broken')
    expect(readStars()).toEqual([])
    expect(readProposals()).toEqual([])
    expect(readRedemptions()).toEqual([])
    grant({ amount: 3, reason: '重置后新奖励' })
    createProposal({ name: '重置后新提议', price: 3, description: '' })
    await __runCycleForTests()
    await settle()
    expect(readStars()).toHaveLength(3)
    expect(balance()).toBe(4)
    expect(readProposals()).toHaveLength(3)
    expect(readRedemptions().map((r) => r.childId)).toEqual(['default', 'sibling'])
    loadDevice(b)
    await __runCycleForTests()
    await settle()
    expect(readStars()).toHaveLength(3)
    expect(readStars().filter((r) => r.childId === 'sibling')).toHaveLength(1)
    expect(readProposals()).toHaveLength(3)
    expect(readRedemptions()).toHaveLength(2)
  })
  it('共享目录仅修改附加要求和移除要求都能往返，未新增兑换判定', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeRewards([{ id: 'r1', name: '共享', price: 5, requirement: { kind: 'game', amount: 2 } }])
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'parent' })
    startSync()
    await settle()
    // #268：LWW 严格新于才覆写（平手先写方胜），而 stamp 单调性仅在本机内成立；
    // 两台设备同毫秒写同一行会发出相同 updated_at，B 的编辑被云端静默拒绝。
    // 与文件内其他 LWW 用例同款约定：设备间写入留真实时间差。
    await new Promise((r) => setTimeout(r, 10))
    writeRewards([{ id: 'r1', name: '共享', price: 5, requirement: { kind: 'interest', amount: 7 } }])
    await settle()
    const b = stashDevice()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(readRewards()[0].requirement).toEqual({ kind: 'interest', amount: 7 })
    await new Promise((r) => setTimeout(r, 10)) // A 的移除版同理必须严格新于 B 的附加要求版
    writeRewards([{ id: 'r1', name: '共享', price: 5 }])
    await settle()
    loadDevice(b)
    await __runCycleForTests()
    await settle()
    expect(readRewards()).toEqual([{ id: 'r1', name: '共享', price: 5 }])
  })
  it('在途改名后撤回到原内容也必须传播，而不是被影子当成无变化', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeProposals([proposal('p1', 1)])
    startSync()
    await settle()
    const held = cloud.holdNextPush()
    writeProposals([proposal('p1', 2, { name: '临时改名' })])
    await held.waiting
    writeProposals([proposal('p1', 3)])
    held.release()
    await settle()
    stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(readProposals()[0].name).toBe('乐高')
  })
  it('默认孩子修订和删除跨设备传播而不影响同id另一孩子', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeProposals([proposal('p1', 1, { childId: 'sibling', name: '兄弟姐妹' }), proposal('p1', 1, { childId: 'default' })])
    writeRecords(['sibling', 'default'].flatMap((childId) => ['complete', 'abandon'].map((id) => ({ id, childId, rewardId: 'r1', name: childId, emoji: '🎁', createdAt: 1 }))))
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(update('p1', { name: '孩子修订', price: 9, description: '新版' }, 'child')).toBe(true)
    complete('complete')
    complete('abandon')
    await settle()
    const b = stashDevice()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(readProposals().find((r) => r.childId === 'default')).toMatchObject({ name: '孩子修订', childStatus: 'agreed', parentStatus: 'notAgreed', lastActionBy: 'child' })
    expect(readProposals().find((r) => r.childId === 'sibling')).toMatchObject({ name: '兄弟姐妹', childStatus: 'notAgreed' })
    expect(readRedemptions().map((r) => [r.childId, r.id])).toEqual([['sibling', 'complete'], ['sibling', 'abandon']])
    expect(voidProposal('p1')).toBe(true)
    expect(deleteProposal('p1')).toBe(true)
    await settle()
    loadDevice(b)
    await __runCycleForTests()
    await settle()
    expect(readProposals()).toHaveLength(1)
    expect(readProposals()[0]).toMatchObject({ childId: 'sibling', name: '兄弟姐妹' })
  })
  it('同实体第二次编辑发生在首个push在途时，旧ACK不能吞掉新版并最终在另一设备可见', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeProposals([proposal('p1', 1)])
    startSync()
    await settle()
    const held = cloud.holdNextPush()
    writeProposals([proposal('p1', 2, { name: '首版' })])
    await held.waiting
    writeProposals([proposal('p1', 3, { name: '最终版', childStatus: 'agreed', lastActionBy: 'child', lastActionKind: 'changed' })])
    held.release()
    await settle()
    stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(readProposals()[0]).toMatchObject({ name: '最终版', childStatus: 'agreed', lastActionBy: 'child', lastActionKind: 'changed' })
  })
  it('同标识流水与实体属于不同孩子，重复往返保留星种和共享目录附加要求', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeLedger([{ ...entry('same', 1), childId: 'default', kind: 'game' }, { ...entry('same', 1), childId: 'sibling', kind: 'interest' }])
    writeProposals([proposal('same', 1, { childId: 'default' }), proposal('same', 1, { childId: 'sibling', name: '另一孩子' })])
    writeRecords(['default', 'sibling'].map((childId) => ({ id: 'same', childId, rewardId: 'r1', name: childId, emoji: '🎁', createdAt: 1 })))
    writeRewards([{ id: 'r1', name: '共享', price: 5, requirement: { kind: 'game', amount: 2 } }])
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(readStars().map((r) => [r.childId, r.kind])).toEqual([['default', 'game'], ['sibling', 'interest']])
    expect(readProposals().map((r) => r.childId)).toEqual(['default', 'sibling'])
    expect(readRedemptions().map((r) => r.childId)).toEqual(['default', 'sibling'])
    expect(readRewards()).toEqual([{ id: 'r1', name: '共享', price: 5, requirement: { kind: 'game', amount: 2 } }])
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(readStars()).toHaveLength(2)
  })
})

describe('学习事实按孩子往返', () => {
  it('双设备重复往返后，每孩各有最近五次答题与去重新到旧三十词', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    for (const childId of ['default', 'sibling']) {
      writeQuestionResults({ q1: Array.from({ length: 7 }, (_, i) => ({ outcome: 'correct', timestamp: new Date(10000 - i).toISOString(), childId })) }, childId)
      writeRecentWords(Array.from({ length: 30 }, (_, i) => childId + i), childId)
    }
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(questionResults().q1.map((r) => r.timestamp)).toEqual([10000, 9999, 9998, 9997, 9996].map((n) => new Date(n).toISOString()))
    expect(questionResults('sibling').q1).toHaveLength(5)
    writeRecentWords(['new', 'default10', 'new', ...recentWords()])
    await settle()
    const b = stashDevice()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(questionResults().q1).toHaveLength(5)
    expect(questionResults('sibling').q1).toHaveLength(5)
    expect(recentWords()).toEqual(['new', 'default10', ...Array.from({ length: 29 }, (_, i) => 'default' + i).filter((w) => w !== 'default10')])
    expect(recentWords('sibling')).toEqual(Array.from({ length: 30 }, (_, i) => 'sibling' + i))
    const expected = recentWords()
    loadDevice(b)
    await __runCycleForTests()
    await settle()
    await __runCycleForTests()
    expect(recentWords()).toEqual(expected)
  })
  it('合法导入题号形似复合键也不与其他孩子碰撞，取消只影响目标题', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    const oddId = JSON.stringify(['sibling', 'q1'])
    const imported = validateLearningImport(JSON.stringify({ version: '3.0', questionPool: [bankQuestion(oddId), bankQuestion('q1')], flagged: { [oddId]: { flaggedAt: 1, childId: 'default' }, q1: { flaggedAt: 2, childId: 'sibling' } }, questionResults: {} }))
    if (!imported.ok) throw new Error(imported.reason)
    applyLearningImport(imported.data, 'overwrite')
    expect(readFlagged()[oddId]).toMatchObject({ flaggedAt: 1 })
    expect(readFlagged('sibling').q1).toMatchObject({ flaggedAt: 2 })
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(readFlagged()[oddId]).toMatchObject({ flaggedAt: 1 })
    expect(readFlagged('sibling').q1).toMatchObject({ flaggedAt: 2 })
    writeFlagged({})
    await settle()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(readFlagged()).toEqual({})
    expect(readFlagged('sibling').q1).toMatchObject({ flaggedAt: 2 })
  })
  it('三学习域损坏后新写保留、全孩回填，另一设备未被误墓碑化', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    for (const child of ['default', 'sibling']) {
      writeFlagged({ q1: { flaggedAt: 5 } }, child)
      writeQuestionResults({ q1: [{ outcome: 'correct', timestamp: '2026-09-07T00:00:00Z' }] }, child)
      writeRecentWords(['old'], child)
    }
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    const b = stashDevice()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    for (const key of [STORAGE_KEYS.flagged, STORAGE_KEYS.questionResults, STORAGE_KEYS.recentWords]) localStorage.setItem(key, '{broken')
    expect(readFlagged()).toEqual({})
    expect(questionResults()).toEqual({})
    expect(recentWords()).toEqual([])
    writeFlagged({ q2: { flaggedAt: 6 } })
    writeQuestionResults({ q2: [{ outcome: 'wrong', timestamp: '2026-09-08T00:00:00Z' }] })
    writeRecentWords(['new'])
    await __runCycleForTests()
    await settle()
    expect(Object.keys(readFlagged()).sort()).toEqual(['q1', 'q2'])
    expect(Object.keys(readFlagged('sibling'))).toEqual(['q1'])
    expect(Object.keys(questionResults()).sort()).toEqual(['q1', 'q2'])
    expect(questionResults('sibling').q1).toHaveLength(1)
    expect(recentWords()).toEqual(['new', 'old'])
    expect(recentWords('sibling')).toEqual(['old'])
    loadDevice(b)
    await __runCycleForTests()
    await settle()
    expect(Object.keys(readFlagged()).sort()).toEqual(['q1', 'q2'])
    expect(Object.keys(readFlagged('sibling'))).toEqual(['q1'])
    expect(Object.keys(questionResults()).sort()).toEqual(['q1', 'q2'])
    expect(recentWords()).toEqual(['new', 'old'])
    expect(recentWords('sibling')).toEqual(['old'])
  })
  it('重考清单内已有词经恢复结算传播最新出现，另一孩子清单不混入', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeQuestions([bankQuestion('000001')])
    writeRecentWords(['w-000001', 'older'])
    writeRecentWords(['sibling-only'], 'sibling')
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    writeRecentWords(['new-on-b', ...recentWords()])
    await settle()
    const b = stashDevice()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(recentWords()[0]).toBe('new-on-b')
    const session = startQuiz(() => 0.5)!
    answerQuiz(session.questions[0].answerIndex)
    finishQuiz()
    expect(readSession()?.status).toBe('pending')
    expect(settleQuiz()).toBe('settled')
    await settle()
    expect(settleQuiz()).toBe('idempotent')
    const after = stashDevice()
    loadDevice(b)
    await __runCycleForTests()
    await settle()
    expect(recentWords()).toEqual(['w-000001', 'new-on-b', 'older'])
    expect(recentWords('sibling')).toEqual(['sibling-only'])
    loadDevice(after)
    await __runCycleForTests()
    await settle()
    expect(recentWords()).toEqual(['w-000001', 'new-on-b', 'older'])
  })
  it('同题同刻两孩记录独立，默认孩子取消红旗不会删另一孩子', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeQuestionResults({ q1: [{ outcome: 'wrong', timestamp: '2026-09-07T00:00:00Z' }] })
    writeQuestionResults({ q1: [{ outcome: 'correct', timestamp: '2026-09-07T00:00:00Z', childId: 'sibling' }] }, 'sibling')
    writeFlagged({ q1: { flaggedAt: 5 } })
    writeFlagged({ q1: { flaggedAt: 6, childId: 'sibling' } }, 'sibling')
    startSync()
    await settle()
    const a = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(questionResults().q1).toEqual([{ outcome: 'wrong', timestamp: '2026-09-07T00:00:00Z', childId: 'default' }])
    expect(questionResults('sibling').q1).toEqual([{ outcome: 'correct', timestamp: '2026-09-07T00:00:00Z', childId: 'sibling' }])
    expect(readFlagged('sibling').q1).toMatchObject({ flaggedAt: 6, childId: 'sibling' })
    writeFlagged({})
    await settle()
    loadDevice(a)
    await __runCycleForTests()
    await settle()
    expect(readFlagged()).toEqual({})
    expect(readFlagged('sibling').q1).toMatchObject({ flaggedAt: 6, childId: 'sibling' })
  })
})

describe('多设备模拟：并发写同域（流水并集）', () => {
  it('A、B 各记各的答题流水 → 双端收敛为并集且按时间序（余额 Σ流水不变式天然自洽）', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeLedger([entry('a1', 100), entry('a2', 200)])
    startSync()
    await settle()

    const snapA = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync() // 换机灌入：云端流水覆盖本机（留档已 stub）
    await settle()
    expect(readStars().map((e) => e.id)).toEqual(['a1', 'a2'])

    // 真实写入语义 = 在灌入账本上追加（earnForQuiz append-only；整组替换丢条目属逃生舱操作，见交付记录 Spec 缺口）
    writeLedger([entry('a1', 100), entry('b1', 150), entry('a2', 200), entry('b2', 250)])
    await settle()

    const snapB = stashDevice()
    loadDevice(snapA) // 回到 A，冷启动拉合
    await __runCycleForTests()
    await settle()
    expect(readStars().map((e) => e.id)).toEqual(['a1', 'b1', 'a2', 'b2']) // 并集 + timestamp 升序

    loadDevice(snapB) // B 再拉合同样收敛
    await __runCycleForTests()
    await settle()
    expect(readStars().map((e) => e.id)).toEqual(['a1', 'b1', 'a2', 'b2'])
  })
})

describe('多设备模拟：LWW 裁决（并发编辑同一兑换项 + 离线攒账）', () => {
  it('A 离线改价攒账、B 在线后改 → updated_at 后写方胜，双端收敛同一行', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeRewards([{ id: 'r1', name: '冰淇淋', price: 5 }])
    startSync()
    await settle()

    // A 离线改价（攒账）
    cloud.setOnline(false)
    writeRewards([{ id: 'r1', name: '冰淇淋A版', price: 8 }])
    await new Promise((r) => setTimeout(r, 10))
    const snapA = stashDevice()

    // B 在线接管：灌入 + 更晚改价
    cloud.setOnline(true)
    bootDevice({ id: 'dev-b', role: 'parent' })
    writeRewards([{ id: 'r1', name: '冰淇淋', price: 5 }])
    startSync()
    await settle()
    await new Promise((r) => setTimeout(r, 30)) // 确保 B 编辑时刻晚于 A
    writeRewards([{ id: 'r1', name: '冰淇淋B版', price: 12 }])
    await settle()
    expect(cloud.snapshot('reward_items').map((r) => r['name'])).toEqual(['冰淇淋B版'])

    // A 恢复：攒账推送被云端按 updated_at 拒；拉合后 A 收敛到 B 版
    const snapB = stashDevice()
    loadDevice(snapA)
    await __runCycleForTests()
    await settle()
    expect(readRewards()).toEqual([{ id: 'r1', name: '冰淇淋B版', price: 12 }])

    loadDevice(snapB) // B 侧也一致
    await __runCycleForTests()
    expect(readRewards()).toEqual([{ id: 'r1', name: '冰淇淋B版', price: 12 }])
  })
})

describe('多设备模拟：提议板修订即认同', () => {
  it('B 修订（修订方自动同意、对方重置）→ A 拉取整行落地——后写方即修订方', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeProposals([proposal('p1', 1000, { childStatus: 'agreed', lastActionBy: 'child', lastActionKind: 'agreed' })])
    startSync()
    await settle()

    const snapA = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync() // 灌入
    await settle()
    expect(readProposals()[0].childStatus).toBe('agreed')

    // B 修订：改动方自动同意自己、对方重置（写侧联动——整行后写胜）
    await new Promise((r) => setTimeout(r, 20))
    writeProposals([proposal('p1', 5000, {
      price: 120, childStatus: 'agreed', parentStatus: 'notAgreed',
      lastActionBy: 'child', lastActionKind: 'changed',
    })])
    await settle()

    loadDevice(snapA) // A 冷启动拉合 → 看到 B 的修订版（家长需重新表态）
    await __runCycleForTests()
    await settle()
    expect(readProposals()).toHaveLength(1)
    expect(readProposals()[0]).toMatchObject({ price: 120, childStatus: 'agreed', parentStatus: 'notAgreed', lastActionBy: 'child' })
  })
})

describe('多设备模拟：题库整组胜', () => {
  it('两台家长设备先后导入题库 → 整组 LWW 后导入方胜，双端整组一致（不逐题合并）', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    writeQuestions([bankQuestion('000001'), bankQuestion('000002')])
    startSync()
    await settle()

    const snapA = stashDevice()
    bootDevice({ id: 'dev-b', role: 'parent' })
    startSync() // 灌入 A 的题库
    await settle()
    expect(readQuestions().map((q) => q.id)).toEqual(['000001', '000002'])

    await new Promise((r) => setTimeout(r, 20))
    writeQuestions([bankQuestion('100001'), bankQuestion('100002'), bankQuestion('100003')]) // B 整组重导
    await settle()

    loadDevice(snapA) // A 拉合 → 整组被 B 覆盖
    await __runCycleForTests()
    await settle()
    expect(readQuestions().map((q) => q.id)).toEqual(['100001', '100002', '100003'])
  })
})

describe('多设备模拟：惊喜入口显隐（#262 键控域，LWW 最后改动方胜）', () => {
  const ENTRY = 'builtin-trivia'

  it('未设置不推（默认隐藏）；家长开启 → 云端一行 → 孩子拉合显示；家长关闭 → 孩子再拉合隐藏', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    startSync()
    await settle()
    // 未设置（空记录）不是待推事实：云端无行，孩子端读出默认隐藏
    expect(cloud.snapshot('entry_visibility')).toEqual([])
    expect(readEntryVisibilityMap()).toEqual({})

    // 家长开启 → 写入即推，云端一行（visible=1，写者为本机设备）
    writeEntryVisibilityValue(ENTRY, true)
    await settle()
    expect(cloud.snapshot('entry_visibility')).toEqual([expect.objectContaining({ entry_id: ENTRY, visible: 1, updated_by: 'dev-a' })])

    // 孩子设备冷启动：bootstrap 云端有行 → 灌入开启态（waitFor 等落库）
    const snapA = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await vi.waitFor(() => expect(readEntryVisibilityMap()).toEqual({ [ENTRY]: true }))

    // 家长关闭（更晚时间戳胜）→ 孩子再拉合回隐藏
    const snapB = stashDevice()
    loadDevice(snapA)
    await __runCycleForTests()
    await settle()
    writeEntryVisibilityValue(ENTRY, false)
    await settle()
    expect(cloud.snapshot('entry_visibility')).toEqual([expect.objectContaining({ entry_id: ENTRY, visible: 0 })])
    loadDevice(snapB)
    await __runCycleForTests()
    await settle()
    expect(readEntryVisibilityMap()).toEqual({ [ENTRY]: false })
  })

  it('离线写入攒账不丢：恢复在线后推送成功且拉合另一设备生效', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    startSync()
    await settle()
    cloud.setOnline(false)
    writeEntryVisibilityValue(ENTRY, true)
    await new Promise((r) => setTimeout(r, 10))
    // 攒在 outbox 未丢
    const outbox = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncOutbox) ?? '{}')
    expect(outbox['entry_visibility']).toHaveLength(1)
    const snapA = stashDevice()

    cloud.setOnline(true)
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(readEntryVisibilityMap()).toEqual({}) // 开启尚未上云：孩子端保持未设置（默认隐藏）

    loadDevice(snapA) // 家长恢复在线：攒账推送成功
    await __runCycleForTests()
    await settle()
    expect(cloud.snapshot('entry_visibility')).toEqual([expect.objectContaining({ entry_id: ENTRY, visible: 1 })])

    // 新孩子设备冷启动：云端开启态已可拉到（离线攒账最终生效）
    stashDevice() // bootDevice 不重置引擎 started——先 stash 复位（既有用例同款模式）
    bootDevice({ id: 'dev-c', role: 'child' })
    startSync()
    await vi.waitFor(() => expect(readEntryVisibilityMap()).toEqual({ [ENTRY]: true }))
  })
})

describe('多设备模拟：惊喜得星开关（#290 搭入口显隐键控域，LWW 全家生效）', () => {
  const baseSetJson = JSON.parse(readFileSync(resolve(process.cwd(), 'public/trivia/current/set.json'), 'utf8')) as { category: string, book: string }
  /** 带规则现役题集（类别名 = 现役 set.json，scope 同源命中）；换主题用另一套类别名验证开关不重置 */
  const ruledSet = (): unknown => ({ ...baseSetJson, starRule: [{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }] })

  it('未设置不推（默认开）；家长关掉 → 云端一行 → 孩子设备拉合后开局零规则快照；换主题（换题集）开关不重置', async () => {
    adoptTriviaSet(ruledSet())
    const scope = { kind: 'trivia' as const, category: triviaSetRef.value!.category, book: triviaSetRef.value!.book }
    bootDevice({ id: 'dev-a', role: 'parent' })
    startSync()
    await settle()
    // 默认开 = 未设置 = 不是待推事实：云端无该键行，开局带规则快照
    expect(readTriviaStarEarns()).toBe(true)
    expect(cloud.snapshot('entry_visibility').some((r) => r.entry_id === TRIVIA_STAR_TOGGLE_KEY)).toBe(false)
    expect(startQuiz(mulberry32(1), scope)!.starRule).toBeDefined()

    // 家长关掉 → 写入即推，云端一行（visible=0）
    writeTriviaStarEarns(false)
    await settle()
    expect(cloud.snapshot('entry_visibility')).toEqual([expect.objectContaining({ entry_id: TRIVIA_STAR_TOGGLE_KEY, visible: 0, updated_by: 'dev-a' })])

    // 孩子设备拉合：开关关（全家一致），新开的轮零规则快照（孩子端对开关零感知，仅开局读取生效）
    const snapA = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await vi.waitFor(() => expect(readTriviaStarEarns()).toBe(false))
    expect(startQuiz(mulberry32(1), scope)!.starRule).toBeUndefined()

    // 换主题（App 升级换题集，类别名/分册全换）：开关键控入口不键控主题，关态保持不重置
    const swapped = { ...(ruledSet() as { category: string, book: string }), category: '新主题', book: '新分册' }
    adoptTriviaSet(swapped)
    expect(readTriviaStarEarns()).toBe(false)
    expect(startQuiz(mulberry32(1), { kind: 'trivia', category: '新主题', book: '新分册' })!.starRule).toBeUndefined()

    // 家长重新打开 → 孩子再拉合恢复产星
    loadDevice(snapA)
    await __runCycleForTests()
    await settle()
    writeTriviaStarEarns(true)
    await settle()
    expect(cloud.snapshot('entry_visibility')).toEqual([expect.objectContaining({ entry_id: TRIVIA_STAR_TOGGLE_KEY, visible: 1 })])
    stashDevice()
    bootDevice({ id: 'dev-c', role: 'child' })
    startSync()
    await vi.waitFor(() => expect(readTriviaStarEarns()).toBe(true))
  })
})

describe('多设备模拟：墓碑传播（核销兑换券 / 取消红旗）', () => {
  it('A 核销券 + 取消红旗 → B 拉合后本地同步消失（删除必须可传播）', async () => {
    bootDevice({ id: 'dev-a', role: 'parent' })
    const ticket: ActiveRedemption = { id: 'ar1', rewardId: 'r1', name: '冰淇淋', emoji: '🍦', createdAt: 1 }
    writeRecords([ticket])
    writeFlagged({ q1: { flaggedAt: 5 }, q2: { flaggedAt: 6 } })
    startSync()
    await settle()

    const snapA = stashDevice()
    bootDevice({ id: 'dev-b', role: 'child' })
    startSync()
    await settle()
    expect(readRedemptions()).toHaveLength(1)
    expect(Object.keys(readFlagged()).sort()).toEqual(['q1', 'q2'])

    const snapB = stashDevice()
    loadDevice(snapA) // A：核销 + 取消 q1 红旗（写入即推墓碑）
    writeRecords([]) // 核销/放弃 = 删记录
    writeFlagged({ q2: { flaggedAt: 6 } }) // 取消 q1
    await settle()

    loadDevice(snapB) // B 拉合 → 删除传播
    await __runCycleForTests()
    await settle()
    expect(readRedemptions()).toEqual([])
    expect(Object.keys(readFlagged())).toEqual(['q2'])
  })
})
