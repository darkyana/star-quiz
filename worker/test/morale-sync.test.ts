import { expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../src/index'
import { createSyncClient, mockScheduledTrigger } from './helpers'

const morale = { child_id: 'default', level: 2, last_round_correct: null, updated_at: 20, updated_by: 'original', deleted: 0 }

it('morale 往返保真，每家庭按孩子唯一，忽略伪造家庭归属', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  const other = await createSyncClient()
  expect((await a.push({ morale: [
    { ...morale, family_id: other.family },
    { ...morale, child_id: 'second', level: 3, last_round_correct: 10 },
  ] })).status).toBe(200)
  expect((await b.pull()).morale).toEqual([
    { ...morale, server_at: expect.any(Number) },
    { ...morale, child_id: 'second', level: 3, last_round_correct: 10, server_at: expect.any(Number) },
  ])
  expect((await other.pull()).morale).toEqual([])
  expect((await other.push({ morale: [{ ...morale, level: 1, last_round_correct: 0 }] })).status).toBe(200)
  expect((await a.pull()).morale).toHaveLength(2)
  expect((await other.pull()).morale).toEqual([{ ...morale, level: 1, last_round_correct: 0, server_at: expect.any(Number) }])
})

it('morale LWW 平手云端胜、旧行不复活墓碑，增量仅传播指定孩子', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  expect((await a.push({ morale: [morale, { ...morale, child_id: 'second' }] })).status).toBe(200)
  const before = (await b.pull()).morale
  for (const updated_at of [10, 20]) {
    expect((await b.push({ morale: [{ ...morale, level: 3, last_round_correct: 9, updated_at, updated_by: 'zzz' }] })).status).toBe(200)
    expect((await a.pull()).morale).toEqual(before)
  }
  expect((await b.push({ morale: [{ ...morale, updated_at: 30, level: 1, deleted: 1 }] })).status).toBe(200)
  expect((await a.push({ morale: [morale] })).status).toBe(200)
  const after = (await a.pull()).morale
  const tombstone = after.find(row => row.child_id === 'default')!
  expect(tombstone).toMatchObject({ ...morale, updated_at: 30, level: 1, deleted: 1 })
  expect(after.find(row => row.child_id === 'second')).toEqual(before.find(row => row.child_id === 'second'))
  expect((await a.pull(Number(tombstone.server_at) - 1)).morale).toContainEqual(tombstone)
  expect((await a.pull(Number(tombstone.server_at))).morale).toEqual([])
})

it('每日快照保真恢复各孩子 morale、墓碑化快照后孩子，其他家庭不变', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  const other = await createSyncClient()
  const second = { ...morale, child_id: 'second', level: 3, last_round_correct: 10 }
  expect((await a.push({ morale: [morale, second] })).status).toBe(200)
  expect((await other.push({ morale: [{ ...morale, level: 1 }] })).status).toBe(200)
  const isolated = (await other.pull()).morale
  const trigger = mockScheduledTrigger(Date.now())
  await worker.scheduled(trigger.controller, env, trigger.ctx)
  const id = await a.snapshotId()
  expect((await other.restore(id)).status).toBe(404)
  expect((await b.push({ morale: [
    { ...morale, level: 3, updated_at: 40 },
    { ...second, deleted: 1, updated_at: 40 },
    { ...morale, child_id: 'third' },
  ] })).status).toBe(200)
  expect((await a.restore(id)).status).toBe(200)
  const restored = (await b.pull()).morale
  expect(restored).toHaveLength(3)
  expect(restored.find(row => row.child_id === 'default')).toEqual({ ...morale, server_at: expect.any(Number) })
  expect(restored.find(row => row.child_id === 'second')).toEqual({ ...second, server_at: expect.any(Number) })
  expect(restored.find(row => row.child_id === 'third')).toMatchObject({ deleted: 1 })
  expect((await other.pull()).morale).toEqual(isolated)
})

it('旧快照缺失 morale 保留整个域（含墓碑与游标），显式空数组才清空活行', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  expect((await a.push({ morale: [morale, { ...morale, child_id: 'second', deleted: 1 }] })).status).toBe(200)
  const before = (await b.pull()).morale
  const oldId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
    .bind(a.family, oldId, Date.now(), JSON.stringify({ schema_version: 1, family_id: a.family, taken_at: 1, tables: {} })).run()
  expect((await a.restore(oldId)).status).toBe(200)
  expect((await b.pull()).morale).toEqual(before)
  const emptyId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
    .bind(a.family, emptyId, Date.now(), JSON.stringify({ schema_version: 1, family_id: a.family, taken_at: 1, tables: { morale: [] } })).run()
  expect((await a.restore(emptyId)).status).toBe(200)
  const after = (await b.pull()).morale
  expect(after.find(row => row.child_id === 'default')).toMatchObject({ deleted: 1 })
  expect(after.find(row => row.child_id === 'second')).toEqual(before.find(row => row.child_id === 'second'))
})

it('新域快照缺失孩子不是 legacy 默认，恢复失败保持原态', async () => {
  const a = await createSyncClient()
  expect((await a.push({ morale: [morale] })).status).toBe(200)
  const before = (await a.pull()).morale
  for (const child_id of [undefined, null, '', '  ', 7]) {
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
      .bind(a.family, id, Date.now(), JSON.stringify({ schema_version: 1, family_id: a.family, taken_at: 1,
        tables: { morale: [{ ...morale, level: 3, child_id, family_id: a.family, server_at: 1 }] },
      })).run()
    expect((await a.restore(id)).status).toBe(500)
    expect((await a.pull()).morale).toEqual(before)
  }
})

it('morale 非法字段拒绝整包写入，必填孩子不补 legacy 默认', async () => {
  const api = await createSyncClient()
  const invalid: Record<string, unknown>[] = []
  for (const key of ['child_id', 'level', 'updated_at', 'updated_by', 'deleted']) {
    const missing: Record<string, unknown> = { ...morale }
    delete missing[key]
    invalid.push(missing, { ...morale, [key]: null })
  }
  for (const child_id of ['', '  ', 7, true, {}, []]) invalid.push({ ...morale, child_id })
  for (const level of [0, 4, 1.5, '2', true, {}, []]) invalid.push({ ...morale, level })
  for (const last_round_correct of [-1, 11, 2.5, '3', true, {}, []]) invalid.push({ ...morale, last_round_correct })
  for (const deleted of [-1, 2, 0.5, '0', true, {}, []]) invalid.push({ ...morale, deleted })
  for (const updated_at of ['20', true, {}, []]) invalid.push({ ...morale, updated_at })
  for (const updated_by of [7, true, {}, []]) invalid.push({ ...morale, updated_by })
  for (const row of invalid) {
    expect((await api.push({ morale: [{ ...morale, child_id: 'valid' }, row] })).status, JSON.stringify(row)).toBe(400)
  }
  expect((await api.pull()).morale).toEqual([])
  const optional: Record<string, unknown> = { ...morale }
  delete optional.last_round_correct
  expect((await api.push({ morale: [optional] })).status).toBe(200)
  expect((await api.pull()).morale).toEqual([{ ...morale, server_at: expect.any(Number) }])
})
