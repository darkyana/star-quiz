import { applyD1Migrations, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import worker from '../src/index'
import { sha256Hex } from '../src/auth'

it('真实旧经济行迁移后 HTTP pull 保留全部字段并补默认，迁移账本重放不损失同 id 新孩子', async () => {
  const db = env.LEGACY_DB
  await applyD1Migrations(db, env.D1_MIGRATIONS.slice(0, 3))
  await db.batch([
    db.prepare("INSERT INTO families VALUES ('economy-family', 1)"),
    db.prepare("INSERT INTO devices (device_id, family_id, name, role, credential_hash, paired_at) VALUES ('economy-device', 'economy-family', '家长', 'parent', ?, 2)").bind(await sha256Hex('secret')),
    db.prepare("INSERT INTO star_entries VALUES ('economy-family', 's', 10, 'earn', 4, '奖励', 'quiz', 123)"),
    db.prepare("INSERT INTO reward_items VALUES ('economy-family', 'r', '书', 5, '📚', 20, 'original', 1, 124)"),
    db.prepare("INSERT INTO proposals VALUES ('economy-family', 'p', '书', 5, 'voided', 10, 20, '描述', 'agreed', 'notAgreed', 'child', 'parent', 'changed', 1, 'original', 125)"),
    db.prepare("INSERT INTO active_redemptions VALUES ('economy-family', 'a', 'r', '书', '📚', 10, 20, 'original', 1, 126)"),
  ])
  await applyD1Migrations(db, env.D1_MIGRATIONS)
  const headers = { authorization: 'Bearer economy-device:secret', 'content-type': 'application/json' }
  const runtime = { ...env, DB: db }
  async function pull() {
    const res = await worker.fetch(new Request('http://example.com/api/sync/pull?since=0', { headers }), runtime)
    expect(res.status).toBe(200)
    return res.json<Record<string, Record<string, unknown>[]>>()
  }
  const migrated = await pull()
  expect(migrated.star_entries).toEqual([{ id: 's', child_id: 'default', kind: 'main', timestamp: 10, type: 'earn', amount: 4, source: '奖励', quiz_id: 'quiz', server_at: 123 }])
  expect(migrated.reward_items).toEqual([{ id: 'r', name: '书', price: 5, emoji: '📚', requirement: null, updated_at: 20, updated_by: 'original', deleted: 1, server_at: 124 }])
  expect(migrated.proposals).toEqual([{ id: 'p', child_id: 'default', name: '书', price: 5, status: 'voided', created_at: 10, updated_at: 20, description: '描述', parent_status: 'agreed', child_status: 'notAgreed', initiator: 'child', last_action_by: 'parent', last_action_kind: 'changed', deleted: 1, updated_by: 'original', emoji: null, server_at: 125 }])
  expect(migrated.active_redemptions).toEqual([{ id: 'a', child_id: 'default', reward_id: 'r', name: '书', emoji: '📚', created_at: 10, updated_at: 20, updated_by: 'original', deleted: 1, server_at: 126 }])
  const batch = Object.fromEntries(['star_entries', 'proposals', 'active_redemptions'].map(domain => [domain, [{ ...migrated[domain][0], child_id: 'second' }]]))
  const res = await worker.fetch(new Request('http://example.com/api/sync/push', { method: 'POST', headers, body: JSON.stringify(batch) }), runtime)
  expect(res.status).toBe(200)
  const before = await pull()
  await applyD1Migrations(db, env.D1_MIGRATIONS)
  const replayed = await pull()
  for (const domain of ['star_entries', 'reward_items', 'proposals', 'active_redemptions']) expect(replayed[domain]).toEqual(before[domain])
  for (const domain of Object.keys(batch)) {
    expect(before[domain]).toHaveLength(2)
    expect(before[domain].find(row => row.child_id === 'default')).toEqual(migrated[domain][0])
  }
})
