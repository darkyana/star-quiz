// 快照 Cron 与回滚单测（票 #124 AC）：快照落库+内容含全域+30 天窗口清理 / 回滚端到端
// （写入 → 快照 → 篡改 → 回滚 → 全域等于快照）/ 题库空域回滚 / 门禁与家庭隔离。
import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import worker from '../src/index'
import type { SnapshotContent } from '../src/snapshot'
import { authHeaders, mockScheduledTrigger, seedDevice, seedFamily } from './helpers'

const BASE = 'http://example.com'
const DAY_MS = 24 * 60 * 60 * 1000
const T0 = 1_800_000_000_000

async function triggerScheduled(scheduledTime: number): Promise<void> {
  const { controller, ctx } = mockScheduledTrigger(scheduledTime)
  await worker.scheduled(controller, env, ctx)
}

/** 同步域全域代表性数据：每表至少一行，reward_items 额外一行墓碑（验证当前态过滤） */
async function seedSyncDomain(familyId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO star_entries (family_id, id, timestamp, type, amount, source, quiz_id, server_at) VALUES (?, 'se-1', 1000, 'earn', 5, 'quiz', 'q-1', 1800), (?, 'se-2', 2000, 'redeem', 3, 'manual', NULL, 1801)",
    ).bind(familyId, familyId),
    env.DB.prepare(
      "INSERT INTO question_results (family_id, question_id, answered_at, outcome, server_at) VALUES (?, 'q-1', '2026-09-01T10:00:00.000Z', 'correct', 1802)",
    ).bind(familyId),
    env.DB.prepare(
      "INSERT INTO word_appearances (family_id, word_id, appeared_at, server_at) VALUES (?, 'w-1', 1500, 1803)",
    ).bind(familyId),
    env.DB.prepare(
      "INSERT INTO reward_items (family_id, id, name, price, emoji, updated_at, updated_by, deleted, server_at) VALUES (?, 'r-1', '冰淇淋', 10, '🍦', 1600, 'parent', 0, 1804), (?, 'r-dead', '旧奖品', 8, NULL, 1500, 'parent', 1, 1805)",
    ).bind(familyId, familyId),
    env.DB.prepare(
      "INSERT INTO proposals (family_id, id, name, price, status, created_at, updated_at, description, parent_status, child_status, initiator, last_action_by, last_action_kind, deleted, updated_by, server_at) VALUES (?, 'p-1', '乐高', 50, 'discussing', 1400, 1600, '想要乐高', 'notAgreed', 'agreed', 'child', 'child', 'proposed', 0, 'child', 1806)",
    ).bind(familyId),
    env.DB.prepare(
      "INSERT INTO active_redemptions (family_id, id, reward_id, name, emoji, created_at, updated_at, updated_by, deleted, server_at) VALUES (?, 'ar-1', 'r-1', '冰淇淋', '🍦', 1700, 1700, 'parent', 0, 1807)",
    ).bind(familyId),
    env.DB.prepare(
      "INSERT INTO question_flags (family_id, question_id, flagged_at, updated_at, updated_by, deleted, server_at) VALUES (?, 'q-2', 1550, 1550, 'parent', 0, 1808)",
    ).bind(familyId),
    env.DB.prepare(
      "INSERT INTO question_banks (family_id, content, updated_at, updated_by, server_at) VALUES (?, '{\"version\":1,\"questions\":[]}', 1750, 'parent', 1809)",
    ).bind(familyId),
    env.DB.prepare(
      "INSERT INTO entry_visibility (family_id, entry_id, visible, updated_at, updated_by, server_at) VALUES (?, 'builtin-trivia', 0, 1650, 'parent', 1811)",
    ).bind(familyId),
  ])
}

async function latestSnapshot(familyId: string, takenAt: number): Promise<{ snapshot_id: string; content: SnapshotContent }> {
  const row = await env.DB.prepare(
    'SELECT snapshot_id, content FROM family_snapshots WHERE family_id = ? AND taken_at = ?',
  )
    .bind(familyId, takenAt)
    .first<{ snapshot_id: string; content: string }>()
  expect(row, '快照应已落库').not.toBeNull()
  return { snapshot_id: row!.snapshot_id, content: JSON.parse(row!.content) as SnapshotContent }
}

describe('每日快照 Cron（scheduled 直调）', () => {
  it('快照落库：内容含同步域 10 表全域当前态（墓碑行不进快照、设备凭据域不进快照）', async () => {
    const family = `fam-cron-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedSyncDomain(family)

    await triggerScheduled(T0)

    const { content } = await latestSnapshot(family, T0)
    expect(content.schema_version).toBe(1)
    expect(content.family_id).toBe(family)
    expect(Object.keys(content.tables).sort()).toEqual(
      [
        'active_redemptions', 'morale', 'proposals', 'question_banks', 'question_flags',
        'question_results', 'reward_items', 'star_entries', 'entry_visibility', 'word_appearances',
      ].sort(),
    )
    expect(content.tables.star_entries).toHaveLength(2)
    expect(content.tables.question_results).toHaveLength(1)
    expect(content.tables.word_appearances).toHaveLength(1)
    expect(content.tables.proposals).toHaveLength(1)
    expect(content.tables.active_redemptions).toHaveLength(1)
    expect(content.tables.question_flags).toHaveLength(1)
    expect(content.tables.question_banks).toHaveLength(1)
    expect(content.tables.entry_visibility).toEqual([{ family_id: family, entry_id: 'builtin-trivia', visible: 0, expires_at: null, updated_at: 1650, updated_by: 'parent', server_at: 1811 }])
    // LWW 当前态 = 活行：墓碑行 r-dead 被过滤，只余 r-1
    expect(content.tables.reward_items.map((r) => r.id)).toEqual(['r-1'])
  })

  it('30 天保留窗口：窗口外旧快照同批清理、窗口内留存、本次新快照保留', async () => {
    const family = `fam-window-${crypto.randomUUID()}`
    await seedFamily(family)
    const oldId = crypto.randomUUID()
    const edgeId = crypto.randomUUID()
    await env.DB.batch([
      // 31 天前（窗口外，应删）
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(family, oldId, T0 - 31 * DAY_MS, '{}'),
      // 29 天前（窗口内，应留）
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(family, edgeId, T0 - 29 * DAY_MS, '{}'),
    ])

    await triggerScheduled(T0)

    const kept = await env.DB.prepare('SELECT snapshot_id FROM family_snapshots WHERE family_id = ? ORDER BY taken_at')
      .bind(family)
      .all<{ snapshot_id: string }>()
    expect(kept.results.map((r) => r.snapshot_id)).toEqual([edgeId, expect.any(String)])
    expect(kept.results.some((r) => r.snapshot_id === oldId)).toBe(false)
  })

  it('多家庭：各家庭独立落快照，互不串', async () => {
    const familyA = `fam-multi-a-${crypto.randomUUID()}`
    const familyB = `fam-multi-b-${crypto.randomUUID()}`
    await seedFamily(familyA)
    await seedFamily(familyB)
    await seedSyncDomain(familyA)

    await triggerScheduled(T0)

    const snapA = await latestSnapshot(familyA, T0)
    const snapB = await latestSnapshot(familyB, T0)
    expect(snapA.content.tables.star_entries).toHaveLength(2)
    expect(snapB.content.tables.star_entries).toHaveLength(0) // B 家空态照落快照
    expect(snapA.snapshot_id).not.toBe(snapB.snapshot_id)
  })
})

describe('GET /api/snapshots（快照列表）', () => {
  it('parent 可见本家庭近 30 天快照：倒序 + 窗口外过滤 + 他家庭隔离', async () => {
    const family = `fam-list-${crypto.randomUUID()}`
    const other = `fam-list-o-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-pl', '家长 iPhone', 'parent')
    const now = Date.now()
    const oldId = crypto.randomUUID() // 31 天前：窗口外
    const id29 = crypto.randomUUID() // 29 天前：窗口内最早
    const id5 = crypto.randomUUID()
    const id1 = crypto.randomUUID() // 1 天前：最新
    const otherId = crypto.randomUUID() // 他家庭同时刻快照
    await env.DB.batch([
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(family, oldId, now - 31 * DAY_MS, '{}'),
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(family, id29, now - 29 * DAY_MS, '{}'),
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(family, id5, now - 5 * DAY_MS, '{}'),
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(family, id1, now - 1 * DAY_MS, '{}'),
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(other, otherId, now - 1 * DAY_MS, '{}'),
    ])

    const res = await SELF.fetch(`${BASE}/api/snapshots`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { snapshots: { snapshot_id: string; taken_at: number }[] }
    // 倒序（最新在前）；窗口过滤归服务端（31 天前的即便未被 Cron 清理也不可见）；他家庭不可见
    expect(body.snapshots.map((s) => s.snapshot_id)).toEqual([id1, id5, id29])
    expect(body.snapshots.map((s) => s.taken_at)).toEqual([now - 1 * DAY_MS, now - 5 * DAY_MS, now - 29 * DAY_MS])
    expect(body.snapshots.some((s) => s.snapshot_id === otherId)).toBe(false)
  })

  it('本家庭无快照 → 200 空列表（家长页空态）', async () => {
    const family = `fam-empty-l-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-pel', '家长 iPhone', 'parent')
    const res = await SELF.fetch(`${BASE}/api/snapshots`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ snapshots: [] })
  })

  it('门禁：无认证 401 / 孩子设备 403', async () => {
    const family = `fam-gate-l-${crypto.randomUUID()}`
    await seedFamily(family)
    const kid = await seedDevice(family, 'dev-kl', '孩子的 iPad', 'child')

    const noAuth = await SELF.fetch(`${BASE}/api/snapshots`)
    expect(noAuth.status).toBe(401)
    expect(await noAuth.json()).toEqual({ error: 'unauthorized' })

    const kidRes = await SELF.fetch(`${BASE}/api/snapshots`, { headers: authHeaders(kid.token) })
    expect(kidRes.status).toBe(403)
    expect(await kidRes.json()).toEqual({ error: 'forbidden' })
  })
})

describe('POST /api/snapshots/<id>/restore（回滚端到端）', () => {
  it('写入 → 快照 → 篡改 → 回滚 → 全域等于快照（以新 server_at 写回，快照外行打墓碑）', async () => {
    const family = `fam-restore-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedSyncDomain(family)
    const parent = await seedDevice(family, 'dev-pr', '家长 iPhone', 'parent')

    // 快照
    await triggerScheduled(T0)
    const { snapshot_id } = await latestSnapshot(family, T0)

    // 篡改：改活行值、新增快照外行、改题库整组
    await env.DB.batch([
      env.DB.prepare("UPDATE reward_items SET price = 999 WHERE family_id = ? AND id = 'r-1'").bind(family),
      env.DB.prepare(
        "INSERT INTO reward_items (family_id, id, name, price, emoji, updated_at, updated_by, deleted, server_at) VALUES (?, 'r-new', '篡改新增', 1, NULL, 2000, 'child', 0, 2000)",
      ).bind(family),
      env.DB.prepare(
        "INSERT INTO proposals (family_id, id, name, price, status, created_at, updated_at, description, parent_status, child_status, initiator, last_action_by, last_action_kind, deleted, updated_by, server_at) VALUES (?, 'p-new', '篡改提议', 2, 'discussing', 2000, 2000, 'x', 'notAgreed', 'notAgreed', 'child', 'child', 'proposed', 0, 'child', 2000)",
      ).bind(family),
      env.DB.prepare("UPDATE star_entries SET amount = 999 WHERE family_id = ? AND id = 'se-1'").bind(family),
      env.DB.prepare("UPDATE question_banks SET content = '{\"tampered\":true}' WHERE family_id = ?").bind(family),
    ])

    // 回滚
    const res = await SELF.fetch(`${BASE}/api/snapshots/${snapshot_id}/restore`, {
      method: 'POST',
      headers: authHeaders(parent.token),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, snapshot_id })

    // 兑换目录：原值恢复；快照外新行呈墓碑态（非物理删，LWW 世界可传播）
    const rewards = await env.DB.prepare('SELECT id, price, deleted FROM reward_items WHERE family_id = ? ORDER BY id')
      .bind(family)
      .all<{ id: string; price: number; deleted: number }>()
    expect(rewards.results).toEqual([
      { id: 'r-1', price: 10, deleted: 0 },
      { id: 'r-dead', price: 8, deleted: 1 },
      { id: 'r-new', price: 1, deleted: 1 },
    ])

    // 提议板：快照外新行墓碑、快照行保留
    const proposals = await env.DB.prepare('SELECT id, deleted FROM proposals WHERE family_id = ? ORDER BY id')
      .bind(family)
      .all<{ id: string; deleted: number }>()
    expect(proposals.results).toEqual([
      { id: 'p-1', deleted: 0 },
      { id: 'p-new', deleted: 1 },
    ])

    // 流水：篡改值恢复原值，server_at 打新（以新版本写入，不做 D1 时间旅行）
    const star = await env.DB.prepare("SELECT amount, server_at FROM star_entries WHERE family_id = ? AND id = 'se-1'")
      .bind(family)
      .first<{ amount: number; server_at: number }>()
    expect(star!.amount).toBe(5)
    expect(star!.server_at).toBeGreaterThan(1800)

    // 题库：整组恢复
    const bank = await env.DB.prepare('SELECT content FROM question_banks WHERE family_id = ?')
      .bind(family)
      .first<{ content: string }>()
    expect(bank!.content).toBe('{"version":1,"questions":[]}')
  })

  it('快照时该域为空 → 回滚把其后新增的行清出当前态（题库空域物理删特例）', async () => {
    const family = `fam-empty-${crypto.randomUUID()}`
    await seedFamily(family) // 不 seed 题库：快照时 question_banks 无行
    const parent = await seedDevice(family, 'dev-pe', '家长 iPhone', 'parent')

    await triggerScheduled(T0)
    const { snapshot_id } = await latestSnapshot(family, T0)

    // 快照后导入题库
    await env.DB.prepare('INSERT INTO question_banks (family_id, content, updated_at, updated_by, server_at) VALUES (?, ?, 2100, ?, 2101)')
      .bind(family, '{"version":2}', 'parent')
      .run()

    const res = await SELF.fetch(`${BASE}/api/snapshots/${snapshot_id}/restore`, {
      method: 'POST',
      headers: authHeaders(parent.token),
    })
    expect(res.status).toBe(200)
    const bank = await env.DB.prepare('SELECT COUNT(*) AS n FROM question_banks WHERE family_id = ?')
      .bind(family)
      .first<{ n: number }>()
    expect(bank!.n).toBe(0) // 该域回到快照时的空态
  })

  it('门禁与家庭隔离：无认证 401 / 他家庭 snapshot_id 404', async () => {
    const family = `fam-gate-a-${crypto.randomUUID()}`
    const other = `fam-gate-b-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-pg', '家长 iPhone', 'parent')
    await seedSyncDomain(family)
    await triggerScheduled(T0)
    const { snapshot_id } = await latestSnapshot(family, T0)

    const noAuth = await SELF.fetch(`${BASE}/api/snapshots/${snapshot_id}/restore`, { method: 'POST' })
    expect(noAuth.status).toBe(401)

    // 他家庭快照对本家庭 parent 不可见
    const otherSnapshot = await env.DB.prepare('SELECT snapshot_id FROM family_snapshots WHERE family_id = ?')
      .bind(other)
      .first<{ snapshot_id: string }>()
    if (otherSnapshot !== null) {
      const cross = await SELF.fetch(`${BASE}/api/snapshots/${otherSnapshot.snapshot_id}/restore`, {
        method: 'POST',
        headers: authHeaders(parent.token),
      })
      expect(cross.status).toBe(404)
    }

    // 本家庭不存在该 snapshot_id → 404
    const ghost = await SELF.fetch(`${BASE}/api/snapshots/${crypto.randomUUID()}/restore`, {
      method: 'POST',
      headers: authHeaders(parent.token),
    })
    expect(ghost.status).toBe(404)
  })
})
