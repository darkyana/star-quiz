import { expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../src/index'
import { createSyncClient, mockScheduledTrigger, type SyncTestRows as Rows } from './helpers'

function economyRows(): Rows {
  return {
    star_entries: [{ id: 's', timestamp: 10, type: 'earn', amount: 4, source: '奖励', quiz_id: 'quiz' }],
    proposals: [{ id: 'p', name: '书', price: 5, status: 'discussing', created_at: 10, updated_at: 20, description: '描述', parent_status: 'agreed', child_status: 'notAgreed', initiator: 'child', last_action_by: 'parent', last_action_kind: 'changed', deleted: 0, updated_by: 'original' }],
    active_redemptions: [{ id: 'a', reward_id: 'r', name: '书', emoji: '📚', created_at: 10, updated_at: 20, updated_by: 'original', deleted: 0 }],
  }
}
const reward = { id: 'r', name: '书', price: 5, emoji: '📚', updated_at: 20, updated_by: 'original', deleted: 0 }

it('双设备往返保真星种及共享附加要求：默认孩子与其他孩子同 id 并存，重推幂等且家庭隔离', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  const other = await createSyncClient()
  const batch: Rows = {}
  for (const [domain, rows] of Object.entries(economyRows())) {
    batch[domain] = ['default', 'second'].map(child_id => ({ ...rows[0], child_id, family_id: other.family, ...(domain === 'star_entries' ? { kind: child_id === 'default' ? 'game' : 'interest' } : {}) }))
  }
  batch.reward_items = [{ ...reward, requirement: { kind: 'game', amount: 3 }, child_id: 'ignored' }]
  expect((await a.push(batch)).status).toBe(200)
  const first = await b.pull()
  expect((await b.push(batch)).status).toBe(200)
  const again = await a.pull()
  for (const domain of Object.keys(batch)) expect(again[domain]).toEqual(first[domain])
  for (const domain of Object.keys(economyRows())) {
    expect(first[domain]).toHaveLength(2)
    expect(first[domain].map(row => row.child_id).sort()).toEqual(['default', 'second'])
    expect(first[domain][0]).not.toHaveProperty('family_id')
  }
  expect(first.star_entries.map(row => row.kind).sort()).toEqual(['game', 'interest'])
  expect(first.reward_items).toEqual([{ ...reward, requirement: { kind: 'game', amount: 3 }, server_at: expect.any(Number) }])
  const isolated = await other.pull()
  for (const domain of Object.keys(batch)) expect(isolated[domain]).toEqual([])
  expect((await b.push({ reward_items: [{ ...reward, updated_at: 30, requirement: null }] })).status).toBe(200)
  expect((await a.pull()).reward_items).toEqual([{ ...reward, updated_at: 30, requirement: null, server_at: expect.any(Number) }])
})

it('双设备删除只影响指定孩子，旧行重传不复活且增量 pull 传播墓碑', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  const rows = economyRows()
  const batch: Rows = {}
  for (const [domain, entries] of Object.entries(rows)) batch[domain] = ['default', 'second'].map(child_id => ({ ...entries[0], child_id }))
  expect((await a.push(batch)).status).toBe(200)
  const baseline = await b.pull()
  for (const domain of ['proposals', 'active_redemptions']) {
    expect((await b.push({ [domain]: [{ ...rows[domain][0], child_id: 'default', deleted: 1, updated_at: 50 }] })).status).toBe(200)
    expect((await a.push({ [domain]: [rows[domain][0]] })).status).toBe(200)
  }
  const pulled = await a.pull()
  for (const domain of ['proposals', 'active_redemptions']) {
    expect(pulled[domain]).toHaveLength(2)
    expect(pulled[domain].find(row => row.child_id === 'default')).toMatchObject({ deleted: 1, updated_at: 50 })
    expect(pulled[domain].find(row => row.child_id === 'second')).toEqual(baseline[domain].find(row => row.child_id === 'second'))
    const delta = await a.pull(Number(baseline[domain][0].server_at) - 1)
    expect(delta[domain]).toContainEqual(expect.objectContaining({ child_id: 'default', deleted: 1, updated_at: 50 }))
  }
  expect(pulled.star_entries).toEqual(baseline.star_entries)
  expect(pulled.star_entries.every(row => row.kind === 'main')).toBe(true)
})

it('经济行显式非法孩子、星种和非法 requirement 拒绝整批且不污染其他域', async () => {
  const api = await createSyncClient()
  const invalid: Rows[] = []
  for (const domain of Object.keys(economyRows())) {
    for (const child_id of [null, '', '  ', '\t\n', 7, true, {}, []]) invalid.push({ [domain]: [{ ...economyRows()[domain][0], child_id }] })
  }
  for (const kind of [null, '', 'other', 7, true, {}, []]) invalid.push({ star_entries: [{ ...economyRows().star_entries[0], kind }] })
  for (const requirement of ['{"kind":"game","amount":3}', [], 7, true, {}, { kind: 'bogus', amount: 1 }, { kind: 'game' }, ...[0, -1, 1.5, '3', null].map(amount => ({ kind: 'game', amount }))]) invalid.push({ reward_items: [{ ...reward, requirement }] })
  for (const batch of invalid) {
    expect((await api.push({ ...economyRows(), ...batch })).status, JSON.stringify(batch)).toBe(400)
  }
  const pulled = await api.pull()
  for (const domain of [...Object.keys(economyRows()), 'reward_items']) expect(pulled[domain]).toEqual([])
})

it('多孩经济快照恢复保真星种和附加要求：快照后流水并集、快照外实体墓碑可被另一设备拉取', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  const batch: Rows = {}
  for (const [domain, rows] of Object.entries(economyRows())) batch[domain] = ['default', 'second'].map(child_id => ({ ...rows[0], child_id, ...(domain === 'star_entries' ? { kind: child_id === 'default' ? 'game' : 'interest' } : {}) }))
  batch.reward_items = [{ ...reward, requirement: { kind: 'interest', amount: 8 } }]
  expect((await a.push(batch)).status).toBe(200)
  const trigger = mockScheduledTrigger(Date.now())
  await worker.scheduled(trigger.controller, env, trigger.ctx)
  const id = await a.snapshotId()
  const after: Rows = {}
  for (const [domain, rows] of Object.entries(economyRows())) after[domain] = [{ ...rows[0], child_id: 'third', ...(domain === 'star_entries' ? { kind: 'game' } : {}) }]
  after.reward_items = [{ ...reward, requirement: null, updated_at: 50 }]
  after.proposals.push({ ...economyRows().proposals[0], child_id: 'second', deleted: 1, updated_at: 50 })
  expect((await b.push(after)).status).toBe(200)
  expect((await a.restore(id)).status).toBe(200)
  const pulled = await b.pull()
  expect(pulled.star_entries).toHaveLength(3)
  expect(pulled.star_entries.find(row => row.child_id === 'default')).toMatchObject({ kind: 'game' })
  expect(pulled.star_entries.find(row => row.child_id === 'second')).toMatchObject({ kind: 'interest' })
  expect(pulled.star_entries.find(row => row.child_id === 'third')).toMatchObject({ kind: 'game' })
  for (const domain of ['proposals', 'active_redemptions']) {
    expect(pulled[domain]).toHaveLength(3)
    for (const child_id of ['default', 'second']) expect(pulled[domain].find(row => row.child_id === child_id)).toMatchObject({ ...economyRows()[domain][0], child_id })
    expect(pulled[domain].find(row => row.child_id === 'third')).toMatchObject({ deleted: 1 })
  }
  expect(pulled.reward_items).toEqual([{ ...reward, requirement: { kind: 'interest', amount: 8 }, server_at: expect.any(Number) }])
})

it('旧经济快照省略新增字段仍恢复 default/main/null，不覆盖其他孩子同 id 流水', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  expect((await b.push({ star_entries: [{ ...economyRows().star_entries[0], child_id: 'second', kind: 'interest' }] })).status).toBe(200)
  const tables: Rows = { ...economyRows(), reward_items: [{ ...reward }] }
  for (const rows of Object.values(tables)) for (const row of rows) Object.assign(row, { family_id: a.family, server_at: 1 })
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
    .bind(a.family, id, Date.now(), JSON.stringify({ schema_version: 1, family_id: a.family, taken_at: 1, tables })).run()
  expect((await a.restore(id)).status).toBe(200)
  const pulled = await b.pull()
  expect(pulled.star_entries).toHaveLength(2)
  expect(pulled.star_entries.find(row => row.child_id === 'second')).toMatchObject({ kind: 'interest' })
  for (const domain of Object.keys(economyRows())) expect(pulled[domain].find(row => row.child_id === 'default')).toMatchObject({ ...economyRows()[domain][0], child_id: 'default' })
  expect(pulled.star_entries.find(row => row.child_id === 'default')).toMatchObject({ kind: 'main' })
  expect(pulled.reward_items).toEqual([{ ...reward, emoji: '📚', requirement: null, server_at: expect.any(Number) }])
})

it('快照显式非法经济孩子或星种不会悄悄补默认，失败保持原态', async () => {
  const api = await createSyncClient()
  expect((await api.push(economyRows())).status).toBe(200)
  const before = await api.pull()
  const invalid: Rows[] = []
  for (const domain of Object.keys(economyRows())) for (const child_id of [null, '', '  ', 7, true, {}, []]) invalid.push({ [domain]: [{ ...economyRows()[domain][0], child_id }] })
  for (const kind of [null, '', 'other', 7, true, {}, []]) invalid.push({ star_entries: [{ ...economyRows().star_entries[0], kind }] })
  for (const tables of invalid) {
    for (const rows of Object.values(tables)) for (const row of rows) Object.assign(row, { family_id: api.family, server_at: 1 })
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
      .bind(api.family, id, Date.now(), JSON.stringify({ schema_version: 1, family_id: api.family, taken_at: 1, tables })).run()
    expect((await api.restore(id)).status, JSON.stringify(tables)).toBe(500)
  }
  const after = await api.pull()
  for (const domain of Object.keys(economyRows())) expect(after[domain]).toEqual(before[domain])
})
