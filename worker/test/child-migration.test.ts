import { applyD1Migrations, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import worker from '../src/index'
import { sha256Hex } from '../src/auth'

it('真实 0001/0002 旧行经 0003 后 pull 全字段保真，重应用账本不损失新孩子行', async () => {
  const db = env.LEGACY_DB
  await applyD1Migrations(db, env.D1_MIGRATIONS.slice(0, 2))
  await db.batch([
    db.prepare("INSERT INTO families VALUES ('legacy-family', 1)"),
    db.prepare("INSERT INTO devices (device_id, family_id, name, role, credential_hash, paired_at) VALUES ('legacy-device', 'legacy-family', '家长', 'parent', ?, 2)").bind(await sha256Hex('secret')),
    db.prepare("INSERT INTO question_results VALUES ('legacy-family', 'q', '2026-09-01T10:00:00.000Z', 'wrong', 123)"),
    db.prepare("INSERT INTO word_appearances VALUES ('legacy-family', 'w', 456, 124)"),
    db.prepare("INSERT INTO question_flags VALUES ('legacy-family', 'q', 456, 789, 'original-device', 1, 125)"),
  ])
  await applyD1Migrations(db, env.D1_MIGRATIONS)
  const headers = { authorization: 'Bearer legacy-device:secret', 'content-type': 'application/json' }
  const runtime = { ...env, DB: db }
  async function pull() {
    const response = await worker.fetch(new Request('http://example.com/api/sync/pull?since=0', { headers }), runtime)
    expect(response.status).toBe(200)
    return response.json<Record<string, Record<string, unknown>[]>>()
  }
  const migrated = await pull()
  expect(migrated.question_results).toEqual([{ child_id: 'default', question_id: 'q', answered_at: '2026-09-01T10:00:00.000Z', outcome: 'wrong', server_at: 123 }])
  expect(migrated.word_appearances).toEqual([{ child_id: 'default', word_id: 'w', appeared_at: 456, server_at: 124 }])
  expect(migrated.question_flags).toEqual([{ child_id: 'default', question_id: 'q', flagged_at: 456, updated_at: 789, updated_by: 'original-device', deleted: 1, server_at: 125 }])
  const batch: Record<string, Record<string, unknown>[]> = {}
  for (const domain of ['question_results', 'word_appearances', 'question_flags']) {
    batch[domain] = [{ ...migrated[domain][0], child_id: 'second-child' }]
  }
  const pushed = await worker.fetch(new Request('http://example.com/api/sync/push', { method: 'POST', headers, body: JSON.stringify(batch) }), runtime)
  expect(pushed.status).toBe(200)
  const beforeReplay = await pull()
  await applyD1Migrations(db, env.D1_MIGRATIONS)
  const replayed = await pull()
  for (const domain of Object.keys(batch)) {
    expect(replayed[domain]).toEqual(beforeReplay[domain])
    expect(replayed[domain]).toHaveLength(2)
    expect(replayed[domain].find(row => row.child_id === 'default')).toEqual(migrated[domain][0])
  }
})
