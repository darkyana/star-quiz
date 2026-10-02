// #262 入口显隐键控域（entry_visibility）同步单测：照旧 trivia_entry 单布尔域（#236）的测试形状。
// 逐入口键控 LWW（每家庭 × 每入口一行 visible 0/1）+ 无墓碑 + 家庭租户隔离 + 快照恢复（含旧快照缺域保守保留）。
import { expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../src/index'
import { createSyncClient, mockScheduledTrigger } from './helpers'

const TRIVIA_ENTRY_ID = 'builtin-trivia'
const GAME_ENTRY_ID = 'mini-garage-prototype'
const entry = (entry_id: string, visible: 0 | 1 = 1) => ({ entry_id, visible, updated_at: 20, updated_by: 'original' })

it('entry_visibility 往返保真，每家庭多行按入口 id 隔离，忽略伪造家庭归属', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  const other = await createSyncClient()
  expect((await a.push({ entry_visibility: [{ ...entry(TRIVIA_ENTRY_ID), family_id: other.family }] })).status).toBe(200)
  expect((await b.pull()).entry_visibility).toEqual([expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, visible: 1, updated_at: 20, updated_by: 'original', server_at: expect.any(Number) })])
  expect((await other.pull()).entry_visibility).toEqual([])
  // 同家庭第二行（另一入口）互不干扰；他家庭伪造归属被凭据改写，不串家庭
  expect((await other.push({ entry_visibility: [{ ...entry(GAME_ENTRY_ID) }] })).status).toBe(200)
  expect((await a.pull()).entry_visibility).toEqual([expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, visible: 1 })])
  expect((await b.push({ entry_visibility: [entry(GAME_ENTRY_ID, 0)] })).status).toBe(200)
  expect((await a.pull()).entry_visibility).toEqual(expect.arrayContaining([
    expect.objectContaining({ entry_id: GAME_ENTRY_ID, visible: 0 }),
    expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, visible: 1 }),
  ]))
  expect((await a.pull()).entry_visibility).toHaveLength(2)
})

it('entry_visibility LWW：仅严格新于库内才覆写（平手/更旧静默不动），增量游标只传新行', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  expect((await a.push({ entry_visibility: [entry(TRIVIA_ENTRY_ID)] })).status).toBe(200)
  const before = (await b.pull()).entry_visibility
  for (const updated_at of [10, 20]) {
    expect((await b.push({ entry_visibility: [{ ...entry(TRIVIA_ENTRY_ID, 0), updated_at, updated_by: 'late' }] })).status).toBe(200)
    expect((await a.pull()).entry_visibility).toEqual(before)
  }
  expect((await b.push({ entry_visibility: [{ ...entry(TRIVIA_ENTRY_ID, 0), updated_at: 30, updated_by: 'newer' }] })).status).toBe(200)
  const after = (await a.pull()).entry_visibility
  expect(after).toEqual([{ entry_id: TRIVIA_ENTRY_ID, visible: 0, expires_at: null, updated_at: 30, updated_by: 'newer', server_at: expect.any(Number) }])
  const serverAt = Number(after[0]!.server_at)
  expect((await a.pull(serverAt - 1)).entry_visibility).toEqual(after)
  expect((await a.pull(serverAt)).entry_visibility).toEqual([])
})

it('entry_visibility 非法行整包拒绝（wire boundary 拒绝亲和强制），合法行不受牵连', async () => {
  const api = await createSyncClient()
  const invalid: Record<string, unknown>[] = []
  for (const key of ['entry_id', 'visible', 'updated_at', 'updated_by']) {
    const missing: Record<string, unknown> = { ...entry(TRIVIA_ENTRY_ID) }
    delete missing[key]
    invalid.push(missing, { ...entry(TRIVIA_ENTRY_ID), [key]: null })
  }
  for (const entry_id of ['', '   ', 7, true, {}, []]) invalid.push({ ...entry(TRIVIA_ENTRY_ID), entry_id })
  for (const visible of [2, -1, 0.5, '0', true, {}, []]) invalid.push({ ...entry(TRIVIA_ENTRY_ID), visible })
  for (const updated_at of ['20', 1.5, true, {}, []]) invalid.push({ ...entry(TRIVIA_ENTRY_ID), updated_at })
  for (const updated_by of [7, true, {}, []]) invalid.push({ ...entry(TRIVIA_ENTRY_ID), updated_by })
  // #278 expires_at 可空（缺省/null 合法 = 非限时行）；出现时必须为正整数 epoch ms，非法整包拒绝
  for (const expires_at of ['20', 1.5, true, {}, [], 0, -5]) invalid.push({ ...entry(TRIVIA_ENTRY_ID), expires_at })
  for (const row of invalid) {
    expect((await api.push({ entry_visibility: [row] })).status, JSON.stringify(row)).toBe(400)
  }
  expect((await api.pull()).entry_visibility).toEqual([])
  expect((await api.push({ entry_visibility: [entry(TRIVIA_ENTRY_ID)] })).status).toBe(200)
  expect((await api.pull()).entry_visibility).toEqual([expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID })])
})

// #278 限时通道：expires_at 往返保真、含新字段行的 LWW 与影子（快照）覆写、旧行（缺新字段）零变化
it('expires_at 往返保真（限时行 LWW 覆写含到期改写；非限时行照旧 NULL）', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  const timed = (entry_id: string, expires_at: number, visible: 0 | 1 = 1, updated_at = 20) => ({ ...entry(entry_id, visible), updated_at, expires_at })

  // 非限时行：不带 expires_at 推 → 拉 NULL（旧行为零变化）
  expect((await a.push({ entry_visibility: [entry(TRIVIA_ENTRY_ID)] })).status).toBe(200)
  expect((await b.pull()).entry_visibility).toEqual([expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, expires_at: null })])

  // 限时行：expires_at 往返保真；他设备可见同一到期时间戳
  expect((await b.push({ entry_visibility: [timed(TRIVIA_ENTRY_ID, 1_800_000_000_000, 1, 25)] })).status).toBe(200)
  expect((await a.pull()).entry_visibility).toEqual([
    { entry_id: TRIVIA_ENTRY_ID, visible: 1, expires_at: 1_800_000_000_000, updated_at: 25, updated_by: 'original', server_at: expect.any(Number) },
  ])

  // 含新字段行的 LWW：仅严格新于库内才整行覆写（含 expires_at 改写）；平手/更旧静默不动
  expect((await b.push({ entry_visibility: [timed(TRIVIA_ENTRY_ID, 1_900_000_000_000, 1, 30)] })).status).toBe(200)
  expect((await a.pull()).entry_visibility).toEqual([
    expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, expires_at: 1_900_000_000_000 }),
  ])
  expect((await b.push({ entry_visibility: [timed(TRIVIA_ENTRY_ID, 1_700_000_000_000, 0, 25)] })).status).toBe(200)
  expect((await a.pull()).entry_visibility).toEqual([
    expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, visible: 1, expires_at: 1_900_000_000_000 }),
  ])
})

it('每日快照含 expires_at 且回滚保真；旧快照缺新字段照常恢复', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  expect((await a.push({ entry_visibility: [{ ...entry(TRIVIA_ENTRY_ID), expires_at: 1_800_000_000_000 }] })).status).toBe(200)
  const trigger = mockScheduledTrigger(Date.now())
  await worker.scheduled(trigger.controller, env, trigger.ctx)
  const id = await a.snapshotId()

  // 快照后改写 → 回滚恢复限时行（expires_at 保真）
  expect((await b.push({ entry_visibility: [entry(TRIVIA_ENTRY_ID, 0)] })).status).toBe(200)
  expect((await a.restore(id)).status).toBe(200)
  expect((await b.pull()).entry_visibility).toEqual([
    { entry_id: TRIVIA_ENTRY_ID, visible: 1, expires_at: 1_800_000_000_000, updated_at: 20, updated_by: 'original', server_at: expect.any(Number) },
  ])

  // 旧快照（#278 前拍，行缺 expires_at）：照常恢复（缺新字段 ≠ 坏包）
  const oldId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
    .bind(a.family, oldId, Date.now(), JSON.stringify({
      schema_version: 1, family_id: a.family, taken_at: 1,
      tables: { entry_visibility: [{ family_id: a.family, entry_id: TRIVIA_ENTRY_ID, visible: 0, updated_at: 15, updated_by: 'old', server_at: 16 }] },
    })).run()
  expect((await a.restore(oldId)).status).toBe(200)
  expect((await b.pull()).entry_visibility).toEqual([
    expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, visible: 0, expires_at: null }),
  ])
})

it('每日快照保真恢复显隐行；旧快照缺域保留当前态，显式空数组清空（回未设置默认隐藏）', async () => {
  const a = await createSyncClient()
  const b = await createSyncClient(a.family, true)
  expect((await a.push({ entry_visibility: [entry(TRIVIA_ENTRY_ID, 0)] })).status).toBe(200)
  const trigger = mockScheduledTrigger(Date.now())
  await worker.scheduled(trigger.controller, env, trigger.ctx)
  const id = await a.snapshotId()

  // 快照后家长重开 → 回滚恢复关闭态
  expect((await b.push({ entry_visibility: [{ ...entry(TRIVIA_ENTRY_ID, 1), updated_at: 40, updated_by: 'after' }] })).status).toBe(200)
  expect((await a.restore(id)).status).toBe(200)
  expect((await b.pull()).entry_visibility).toEqual([expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, visible: 0 })])

  // 旧快照（#262 前拍，无 entry_visibility 键）：显隐保留当前态（缺域 ≠ 清空）
  const oldId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
    .bind(a.family, oldId, Date.now(), JSON.stringify({ schema_version: 1, family_id: a.family, taken_at: 1, tables: {} })).run()
  expect((await a.restore(oldId)).status).toBe(200)
  expect((await b.pull()).entry_visibility).toEqual([expect.objectContaining({ entry_id: TRIVIA_ENTRY_ID, visible: 0 })])

  // 显式空数组：清空（物理删 = 回未设置默认隐藏）
  const emptyId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
    .bind(a.family, emptyId, Date.now(), JSON.stringify({ schema_version: 1, family_id: a.family, taken_at: 1, tables: { entry_visibility: [] } })).run()
  expect((await a.restore(emptyId)).status).toBe(200)
  expect((await b.pull()).entry_visibility).toEqual([])
})
