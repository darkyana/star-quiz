import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import worker from '../src/index'
import { authHeaders, mockScheduledTrigger, seedDevice, seedFamily } from './helpers'

const BASE = 'http://example.com'
type Rows = Record<string, Record<string, unknown>[]>
async function client() {
  const family = crypto.randomUUID()
  await seedFamily(family)
  const device = await seedDevice(family, crypto.randomUUID(), '家长', 'parent')
  const headers = { ...authHeaders(device.token), 'content-type': 'application/json' }
  return {
    family,
    restore: (id: string) => SELF.fetch(BASE + '/api/snapshots/' + id + '/restore', { method: 'POST', headers }),
    async snapshotId(): Promise<string> {
      const response = await SELF.fetch(BASE + '/api/snapshots', { headers })
      expect(response.status).toBe(200)
      const body = await response.json<{ snapshots: { snapshot_id: string }[] }>()
      return body.snapshots[0].snapshot_id
    },
    push: (body: Rows) => SELF.fetch(BASE + '/api/sync/push', { method: 'POST', headers, body: JSON.stringify(body) }),
    async pull(): Promise<Rows> {
      const response = await SELF.fetch(BASE + '/api/sync/pull?since=0', { headers })
      expect(response.status).toBe(200)
      return response.json()
    },
  }
}
function learningRows(): Rows {
  return {
    question_results: [{ question_id: 'q', answered_at: '2026-09-01T10:00:00.000Z', outcome: 'correct' }],
    word_appearances: [{ word_id: 'w', appeared_at: 1000 }],
    question_flags: [{ question_id: 'q', flagged_at: 1000, updated_at: 1000, updated_by: 'parent', deleted: 0 }],
  }
}

describe('孩子维度 push → pull（#178）', () => {
  it('不同孩子同题同词同时间并存，重复上传幂等且家庭不能伪造', async () => {
    const api = await client()
    const other = await client()
    const batch: Rows = {}
    for (const [domain, rows] of Object.entries(learningRows())) {
      batch[domain] = ['alice', 'bob'].map(child_id => ({ ...rows[0], child_id, family_id: other.family }))
    }
    expect((await api.push(batch)).status).toBe(200)
    const first = await api.pull()
    expect((await api.push(batch)).status).toBe(200)
    const again = await api.pull()
    const isolated = await other.pull()
    for (const domain of Object.keys(batch)) {
      expect(first[domain]).toHaveLength(2)
      expect(first[domain].map(row => row.child_id).sort()).toEqual(['alice', 'bob'])
      expect(again[domain]).toEqual(first[domain])
      expect(isolated[domain]).toEqual([])
      expect(first[domain][0]).not.toHaveProperty('family_id')
    }
  })

  it('取消一个孩子的红旗不跨孩，旧版本不能复活该旗', async () => {
    const api = await client()
    const row = learningRows().question_flags[0]
    expect((await api.push({ question_flags: ['alice', 'bob'].map(child_id => ({ ...row, child_id })) })).status).toBe(200)
    expect((await api.push({ question_flags: [{ ...row, child_id: 'alice', updated_at: 2000, deleted: 1 }] })).status).toBe(200)
    expect((await api.push({ question_flags: [{ ...row, child_id: 'alice' }] })).status).toBe(200)
    const rows = (await api.pull()).question_flags
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.child_id === 'alice')).toMatchObject({ deleted: 1, updated_at: 2000 })
    expect(rows.find(row => row.child_id === 'bob')).toMatchObject({ deleted: 0, updated_at: 1000 })
  })

  it('多孩快照恢复后 pull 保留各孩子行、快照外旗墓碑与后续流水', async () => {
    const api = await client()
    const batch: Rows = {}
    for (const [domain, rows] of Object.entries(learningRows())) {
      batch[domain] = ['alice', 'bob'].map(child_id => ({ ...rows[0], child_id }))
    }
    expect((await api.push(batch)).status).toBe(200)
    const trigger = mockScheduledTrigger(Date.now())
    await worker.scheduled(trigger.controller, env, trigger.ctx)
    const id = await api.snapshotId()
    const after: Rows = {}
    for (const [domain, rows] of Object.entries(learningRows())) {
      after[domain] = [{ ...rows[0], child_id: 'carol' }]
    }
    after.question_flags.push({ ...learningRows().question_flags[0], child_id: 'alice', deleted: 1, updated_at: 2000 })
    expect((await api.push(after)).status).toBe(200)
    expect((await api.restore(id)).status).toBe(200)
    const pulled = await api.pull()
    for (const domain of ['question_results', 'word_appearances']) {
      expect(pulled[domain].map(row => row.child_id).sort()).toEqual(['alice', 'bob', 'carol'])
    }
    expect(pulled.question_flags).toHaveLength(3)
    expect(pulled.question_flags.find(row => row.child_id === 'alice')).toMatchObject({ deleted: 0 })
    expect(pulled.question_flags.find(row => row.child_id === 'bob')).toMatchObject({ deleted: 0 })
    expect(pulled.question_flags.find(row => row.child_id === 'carol')).toMatchObject({ deleted: 1 })
  })

  it('旧快照无 child_id 仍可恢复到 default，非默认孩子流水不会被覆盖', async () => {
    const api = await client()
    const batch: Rows = {}
    for (const [domain, rows] of Object.entries(learningRows())) batch[domain] = [{ ...rows[0], child_id: 'alice' }]
    expect((await api.push(batch)).status).toBe(200)
    const tables: Rows = { star_entries: [], reward_items: [], proposals: [], active_redemptions: [], question_banks: [] }
    for (const [domain, rows] of Object.entries(learningRows())) {
      tables[domain] = rows.map(row => ({ ...row, family_id: api.family, server_at: 1800 }))
    }
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
      .bind(api.family, id, Date.now(), JSON.stringify({ schema_version: 1, family_id: api.family, taken_at: 1800, tables })).run()
    expect((await api.restore(id)).status).toBe(200)
    const pulled = await api.pull()
    for (const domain of Object.keys(learningRows())) {
      expect(pulled[domain]).toHaveLength(2)
      expect(pulled[domain].find(row => row.child_id === 'default')).toMatchObject({ ...learningRows()[domain][0], child_id: 'default', server_at: expect.any(Number) })
    }
    expect(pulled.question_flags.find(row => row.child_id === 'alice')).toMatchObject({ deleted: 1 })
  })

  it('快照显式非法孩子归属不能悄悄恢复成 default，失败不改当前态', async () => {
    const api = await client()
    expect((await api.push(learningRows())).status).toBe(200)
    const before = await api.pull()
    for (const child_id of [null, '', '   ', '\t\n', 7, true, {}, []]) {
      const id = crypto.randomUUID()
      await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
        .bind(api.family, id, Date.now(), JSON.stringify({ schema_version: 1, family_id: api.family, taken_at: 1800,
          tables: { question_flags: [{ ...learningRows().question_flags[0], family_id: api.family, child_id, server_at: 1800 }] },
        })).run()
      expect((await api.restore(id)).status).toBe(500)
    }
    const after = await api.pull()
    for (const domain of Object.keys(learningRows())) expect(after[domain]).toEqual(before[domain])
  })

  it('显式非法 child_id 拒绝整批写入而不偷偷归默认孩子', async () => {
    const api = await client()
    for (const domain of Object.keys(learningRows())) {
      for (const child_id of [null, '', '   ', '\t\n', 7, true, {}, []]) {
        const batch = learningRows()
        batch[domain] = [{ ...batch[domain][0], child_id }]
        expect((await api.push(batch)).status, domain + ': ' + JSON.stringify(child_id)).toBe(400)
      }
    }
    const pulled = await api.pull()
    for (const domain of Object.keys(learningRows())) expect(pulled[domain]).toEqual([])
  })
  it('旧客户端省略 child_id 的学习行归属默认孩子', async () => {
    const api = await client()
    const batch = learningRows()
    expect((await api.push(batch)).status).toBe(200)
    const pulled = await api.pull()
    for (const [domain, rows] of Object.entries(batch)) {
      expect(pulled[domain]).toEqual([{ ...rows[0], child_id: 'default', server_at: expect.any(Number) }])
    }
  })
})
