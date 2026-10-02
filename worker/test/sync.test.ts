import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { seedActiveCode } from './helpers'

// 同步推拉端点单测（票 #123，ADR 0002 分域语义 / ADR 0005 库表）：认证 401、推拉幂等（库零变化）、
// LWW updated_at 裁决、流水主键并集、跨家庭隔离、题库家长单写门禁、since 增量游标。

const PUSH_URL = 'http://example.com/api/sync/push'
const pullUrl = (since: number) => `http://example.com/api/sync/pull?since=${since}`

/** 随机 6 位数字码 */
function randomCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000))
}

/** 随机 4 位小写字母口令（#190 家庭口令格式） */
function randomPassphrase(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => letters[b % 26]).join('')
}

interface PairSuccess {
  device_id: string
  secret: string
  server_at: number
}

async function pairDevice(code: string, name: string, role: 'parent' | 'child', passphrase?: string): Promise<PairSuccess> {
  const res = await SELF.fetch('http://example.com/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 255)}` },
    body: JSON.stringify(passphrase === undefined ? { code, device_name: name, role } : { code, device_name: name, role, passphrase }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as PairSuccess
}

/** #190 发码制建家前置：直插现役码+口令（运营方签发）→ 家长双因子直入；code/passphrase 供后续同码申请 */
async function establishFamily(name = '家长手机'): Promise<{ code: string; passphrase: string } & PairSuccess> {
  const code = randomCode()
  const passphrase = randomPassphrase()
  await seedActiveCode(code, passphrase)
  return { code, passphrase, ...(await pairDevice(code, name, 'parent', passphrase)) }
}

function bearer(cred: PairSuccess): Record<string, string> {
  return { authorization: `Bearer ${cred.device_id}:${cred.secret}`, 'content-type': 'application/json' }
}

async function push(cred: PairSuccess, body: unknown): Promise<Response> {
  return SELF.fetch(PUSH_URL, { method: 'POST', headers: bearer(cred), body: JSON.stringify(body) })
}

async function pull(cred: PairSuccess, since: number): Promise<Response> {
  return SELF.fetch(pullUrl(since), { headers: bearer(cred) })
}

/** 八域样本行（列对齐 ADR 0005 表结构；时间戳毫秒） */
function sampleBatch(): Record<string, unknown[]> {
  return {
    star_entries: [
      { id: 'se-1', timestamp: 1700000000000, type: 'earn', amount: 3, source: 'quiz', quiz_id: 'q-1' },
      { id: 'se-2', timestamp: 1700000000100, type: 'redeem', amount: 10, source: 'redemption' },
    ],
    question_results: [
      { question_id: 'q-1', answered_at: '2026-09-01T10:00:00.000Z', outcome: 'correct' },
      { question_id: 'q-2', answered_at: '2026-09-01T10:00:01.000Z', outcome: 'wrong' },
    ],
    word_appearances: [{ word_id: 'w-1', appeared_at: 1700000002000 }],
    reward_items: [
      { id: 'r-1', name: '冰淇淋', price: 10, emoji: '🍦', updated_at: 1700000003000, updated_by: 'parent', deleted: 0 },
    ],
    proposals: [
      {
        id: 'p-1', name: '乐高', price: 100, status: 'discussing',
        created_at: 1700000004000, updated_at: 1700000004000, description: '想要一盒',
        parent_status: 'notAgreed', child_status: 'agreed', initiator: 'child',
        last_action_by: 'child', last_action_kind: 'proposed', deleted: 0, updated_by: 'child', emoji: '🍕',
      },
    ],
    active_redemptions: [
      { id: 'ar-1', reward_id: 'r-1', name: '冰淇淋', emoji: '🍦', created_at: 1700000005000, updated_at: 1700000005000, updated_by: 'parent', deleted: 0 },
    ],
    question_flags: [
      { question_id: 'q-3', flagged_at: 1700000006000, updated_at: 1700000006000, updated_by: 'child', deleted: 0 },
    ],
    question_banks: [
      { content: { version: 1, generatedAt: '2026-09-01', questions: [{ id: 'q-1', word: 'apple' }] }, updated_at: 1700000007000, updated_by: 'parent' },
    ],
  }
}

/** 8 张同步域表全行快照（幂等断言用） */
async function dbSnapshot(): Promise<Record<string, unknown[]>> {
  const tables = [
    'star_entries', 'question_results', 'word_appearances', 'reward_items',
    'proposals', 'active_redemptions', 'question_flags', 'question_banks',
  ]
  const snap: Record<string, unknown[]> = {}
  for (const t of tables) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all()
    snap[t] = results.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return snap
}

describe('GET /api/sync/capabilities（#174 协议版本能力探测）', () => {
  it('未认证 → 401；非 GET → 405', async () => {
    const noAuth = await SELF.fetch('http://example.com/api/sync/capabilities')
    expect(noAuth.status).toBe(401)

    const cred = await establishFamily()
    const wrongMethod = await SELF.fetch('http://example.com/api/sync/capabilities', {
      method: 'POST', headers: bearer(cred), body: '{}',
    })
    expect(wrongMethod.status).toBe(405)
  })

  it('认证通过 → 200 + 当前同步协议版本（客户端据此判定新旧 Worker 兼容性）', async () => {
    const cred = await establishFamily()
    const res = await SELF.fetch('http://example.com/api/sync/capabilities', { headers: bearer(cred) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; sync_protocol: number }
    expect(body.ok).toBe(true)
    expect(body.sync_protocol).toBeGreaterThanOrEqual(2)
  })
})

describe('POST /api/sync/push 基础', () => {
  it('未认证 → 401；非 POST → 405', async () => {
    const noAuth = await SELF.fetch(PUSH_URL, { method: 'POST', body: '{}' })
    expect(noAuth.status).toBe(401)

    const cred = await establishFamily()
    const wrongMethod = await SELF.fetch(PUSH_URL, { method: 'GET', headers: bearer(cred) })
    expect(wrongMethod.status).toBe(405)
  })

  it('body 非 JSON 对象 / 未知域 / 缺必填列 / 值域违例 → 400', async () => {
    const cred = await establishFamily()

    const badJson = await SELF.fetch(PUSH_URL, {
      method: 'POST', headers: bearer(cred), body: 'not json',
    })
    expect(badJson.status).toBe(400)

    const unknownDomain = await push(cred, { star_entrues: [] })
    expect(unknownDomain.status).toBe(400)
    expect(await unknownDomain.json()).toEqual({ error: 'unknown domain: star_entrues' })

    const missingField = await push(cred, { star_entries: [{ id: 'x', type: 'earn' }] })
    expect(missingField.status).toBe(400)

    const constraintViolation = await push(cred, { star_entries: [{ id: 'x', timestamp: 1, type: 'earn', amount: -5, source: 's' }] })
    expect(constraintViolation.status).toBe(400)
  })
})

describe('POST /api/sync/push 幂等（ADR 0002 并集/LWW，ADR 0003 薄同步）', () => {
  it('同一批数据重复推送：库内零变化（行与 server_at 完全一致）', async () => {
    const cred = await establishFamily()
    const batch = sampleBatch()

    const first = await push(cred, batch)
    expect(first.status).toBe(200)
    expect(((await first.json()) as { ok: boolean; server_at: number }).ok).toBe(true)

    const afterFirst = await dbSnapshot()
    // 稍等确保 Date.now() 已前进——若实现错误地覆写 server_at，两次快照必然不同
    await new Promise((r) => setTimeout(r, 5))
    const second = await push(cred, batch)
    expect(second.status).toBe(200)
    expect(await dbSnapshot()).toEqual(afterFirst)
  })

  it('#303 proposals.emoji 可空可选：省略合法（落 NULL）、携带时保真入库；不在必填清单', async () => {
    const cred = await establishFamily()
    const base = { id: 'p-e1', name: '旱冰鞋', price: 30, status: 'discussing', created_at: 100, updated_at: 100, description: '', parent_status: 'notAgreed', child_status: 'notAgreed', initiator: 'child', last_action_by: 'child', last_action_kind: 'proposed', deleted: 0, updated_by: 'child' }

    // 省略 emoji（旧客户端形状）→ 200，库内 NULL（存量行不受影响）
    const omitted = await push(cred, { proposals: [{ ...base }] })
    expect(omitted.status).toBe(200)
    let row = await env.DB.prepare('SELECT emoji FROM proposals WHERE id = ?').bind('p-e1').first<{ emoji: string | null }>()
    expect(row!.emoji).toBeNull()

    // 更新 updated_at 携带 emoji → LWW 覆写保真入库
    await push(cred, { proposals: [{ ...base, updated_at: 200, emoji: '🛼' }] })
    row = await env.DB.prepare('SELECT emoji FROM proposals WHERE id = ?').bind('p-e1').first<{ emoji: string | null }>()
    expect(row!.emoji).toBe('🛼')

    // 拉取行含 emoji 列（NULL 行原样返回 null，客户端读取侧兜底）
    const res = await pull(cred, 0)
    const body = (await res.json()) as Record<string, unknown>
    const proposals = body['proposals'] as Array<Record<string, unknown>>
    expect(proposals[0]['emoji']).toBe('🛼')
  })

  it('LWW 实体：更旧 updated_at 不覆写，更新者胜；流水：同主键重复上传不增行', async () => {
    const cred = await establishFamily()

    // v2（updated_at=2000）先入库
    await push(cred, { reward_items: [{ id: 'r-9', name: 'v2', price: 5, updated_at: 2000, updated_by: 'parent', deleted: 0 }] })
    // v1（updated_at=1000，更旧）到达 → 拒绝覆写
    await push(cred, { reward_items: [{ id: 'r-9', name: 'v1', price: 5, updated_at: 1000, updated_by: 'parent', deleted: 0 }] })
    let row = await env.DB.prepare('SELECT name, updated_at, server_at FROM reward_items WHERE id = ?').bind('r-9')
      .first<{ name: string; updated_at: number; server_at: number }>()
    expect(row!.name).toBe('v2')
    expect(row!.updated_at).toBe(2000)
    const serverAtV2 = row!.server_at

    // v3（updated_at=3000，更新）→ 覆写且 server_at 游标刷新
    await new Promise((r) => setTimeout(r, 5))
    await push(cred, { reward_items: [{ id: 'r-9', name: 'v3', price: 5, updated_at: 3000, updated_by: 'parent', deleted: 0 }] })
    row = await env.DB.prepare('SELECT name, updated_at, server_at FROM reward_items WHERE id = ?').bind('r-9')
      .first<{ name: string; updated_at: number; server_at: number }>()
    expect(row!.name).toBe('v3')
    expect(row!.server_at).toBeGreaterThan(serverAtV2)

    // 流水：同 (family, id) 重复上传 → 恒一行（并集去重）
    const entry = { id: 'se-9', timestamp: 1700000099000, type: 'earn', amount: 1, source: 'quiz' }
    await push(cred, { star_entries: [entry] })
    await push(cred, { star_entries: [{ ...entry, amount: 99 }] }) // 同主键不同内容也不覆写
    const { results } = await env.DB.prepare('SELECT amount FROM star_entries WHERE id = ?').bind('se-9').all<{ amount: number }>()
    expect(results).toHaveLength(1)
    expect(results[0].amount).toBe(1)
  })
})

describe('题库角色门禁（家长单写，ADR 0002）', () => {
  it('孩子设备推题库 → 403；推其他域 → 200', async () => {
    const { code } = await establishFamily()
    const child = await pairDevice(code, '孩子平板', 'child')
    // #142 起孩子申请落 pending（业务端点全拒）；本用例测的是通过认证后的角色门禁，
    // 故模拟 #143 家长批准（行翻 active），断言意图不变（403 角色门禁而非 401 申请门禁）
    await env.DB.prepare("UPDATE devices SET status = 'active' WHERE device_id = ?").bind(child.device_id).run()

    const denied = await push(child, {
      question_banks: [{ content: { version: 1 }, updated_at: 1, updated_by: 'child' }],
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'question bank push requires a parent device' })

    const allowed = await push(child, { star_entries: [{ id: 'se-c1', timestamp: 1, type: 'earn', amount: 1, source: 'quiz' }] })
    expect(allowed.status).toBe(200)
  })

  it('家长设备推题库 → 200', async () => {
    const parent = await establishFamily()
    const res = await push(parent, {
      question_banks: [{ content: { version: 1, questions: [] }, updated_at: 1, updated_by: 'parent' }],
    })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/sync/pull 增量拉取', () => {
  it('since=0 全量（冷启动）；响应带 server_at 与全部 8 域；题库 content 还原为 JSON 对象', async () => {
    const cred = await establishFamily()
    await push(cred, sampleBatch())

    const res = await pull(cred, 0)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown> & { server_at: number }
    expect(body.server_at).toBeGreaterThan(0)
    expect((body['star_entries'] as unknown[]).length).toBe(2)
    expect((body['question_results'] as unknown[]).length).toBe(2)
    expect((body['word_appearances'] as unknown[]).length).toBe(1)
    expect((body['reward_items'] as unknown[]).length).toBe(1)
    expect((body['proposals'] as unknown[]).length).toBe(1)
    expect((body['active_redemptions'] as unknown[]).length).toBe(1)
    expect((body['question_flags'] as unknown[]).length).toBe(1)
    const banks = body['question_banks'] as Array<{ content: unknown; updated_by: string }>
    expect(banks).toHaveLength(1)
    expect(banks[0].content).toEqual({ version: 1, generatedAt: '2026-09-01', questions: [{ id: 'q-1', word: 'apple' }] })
    expect(banks[0].updated_by).toBe('parent')
    // 行不带 family_id（租户键不外泄）
    expect((body['star_entries'] as Array<Record<string, unknown>>)[0]).not.toHaveProperty('family_id')
  })

  it('since=上次 server_at → 空集；新推送后 → 只含新行', async () => {
    const cred = await establishFamily()
    await push(cred, { star_entries: [{ id: 'se-a', timestamp: 1, type: 'earn', amount: 1, source: 'quiz' }] })

    const firstPull = (await (await pull(cred, 0)).json()) as { star_entries: unknown[]; server_at: number }
    expect(firstPull.star_entries.length).toBe(1)

    // 游标 = 该批 server_at → 已读批次不再返回（严格大于）
    const entryRow = await env.DB.prepare('SELECT server_at FROM star_entries WHERE id = ?').bind('se-a')
      .first<{ server_at: number }>()
    const empty = (await (await pull(cred, entryRow!.server_at)).json()) as { star_entries: unknown[] }
    expect(empty.star_entries).toEqual([])

    // 新行（server_at 更新）→ 增量可见
    await new Promise((r) => setTimeout(r, 5))
    await push(cred, { star_entries: [{ id: 'se-b', timestamp: 2, type: 'earn', amount: 2, source: 'quiz' }] })
    const incremental = (await (await pull(cred, entryRow!.server_at)).json()) as { star_entries: Array<{ id: string }> }
    expect(incremental.star_entries.map((r) => r.id)).toEqual(['se-b'])
  })

  it('since 缺失/非法 → 400；非 GET → 405', async () => {
    const cred = await establishFamily()
    expect((await SELF.fetch('http://example.com/api/sync/pull', { headers: bearer(cred) })).status).toBe(400)
    expect((await SELF.fetch('http://example.com/api/sync/pull?since=abc', { headers: bearer(cred) })).status).toBe(400)
    expect((await SELF.fetch('http://example.com/api/sync/pull?since=0', { method: 'POST', headers: bearer(cred) })).status).toBe(405)
  })
})

describe('跨家庭隔离（家庭租户边界，ADR 0005）', () => {
  it('家庭 B 拉不到家庭 A 的任何行；同主键各行其是互不覆写', async () => {
    const credA = await establishFamily('A 家长')
    const credB = await establishFamily('B 家长')

    await push(credA, { reward_items: [{ id: 'shared-id', name: 'A 的奖品', price: 5, updated_at: 2000, updated_by: 'parent', deleted: 0 }] })
    await push(credB, { reward_items: [{ id: 'shared-id', name: 'B 的奖品', price: 8, updated_at: 3000, updated_by: 'parent', deleted: 0 }] })

    const pullA = (await (await pull(credA, 0)).json()) as { reward_items: Array<{ name: string }> }
    const pullB = (await (await pull(credB, 0)).json()) as { reward_items: Array<{ name: string }> }
    expect(pullA.reward_items.map((r) => r.name)).toEqual(['A 的奖品'])
    expect(pullB.reward_items.map((r) => r.name)).toEqual(['B 的奖品'])

    const { results } = await env.DB.prepare('SELECT family_id, name FROM reward_items WHERE id = ?').bind('shared-id')
      .all<{ family_id: string; name: string }>()
    expect(results).toHaveLength(2) // 复合主键 family_id 打头：两行并存
  })
})
