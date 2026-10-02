import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { PairRateLimiter, PAIR_MAX_SUBMISSIONS_PER_IP, PAIR_WINDOW_MS, PAIR_MAX_PENDING_PER_FAMILY } from '../src/pair'
import { seedActiveCode, seedFamily, seedPairingCode } from './helpers'

// 配对申请化单测（票 #142，R-129a；#190 R-130a 建家收权与双因子直入；前身 #123）：
// - #190 建家收权：码不存在 + 任意角色 → 假等待（「家长+新码→建家」自助路径已删，ADR 0007）
// - #190 双因子直入：现役码 + 无现役家长设备 + 家长角色 + 口令对 → active（空家入驻与恢复共用；
//   孩子设备健在、家长设备全丢时不再死锁）；码对+口令错/缺、码错+口令对 → 与真申请同构的假等待
// - 场景 B：有效码 + 孩子角色 → 真 pending 行（status=pending）
// - 场景 D/H + 孩子+新码 + 场景 J 超上限：假凭据同构响应，不落任何行
// - 防爆破（共识 10）：per-IP 全提交计数（10 次/15 分钟 → 429），与码对错无关；码级失败维度已废除。
// 注意：全提交计数器在 worker isolate 的模块内存中跨测试持续——用例一律用唯一 IP，互不串扰。

const PAIR_URL = 'http://example.com/api/pair'

/** 随机 6 位数字码（家庭码格式，避免测试间撞码） */
function randomCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000))
}

/** 随机 4 位小写字母口令（#190 家庭口令格式；确定性断言处用固定串 'abcd'/'zzzz'） */
function randomPassphrase(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => letters[b % 26]).join('')
}

/** 随机 IP：全提交计数与 IP 绑定，默认每次调用独立 IP 隔离计数 */
function randomIp(): string {
  return `198.51.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SECRET_RE = /^[0-9a-f]{64}$/

interface PairResponse {
  device_id: string
  secret: string
  status: 'pending' | 'active'
  server_at: number
}

/** 裸提交（不限响应状态），供非 200 断言；passphrase 传 undefined 即缺省字段（非字符串值原样入体，供盲口径用例） */
function postPair(code: string, name: string, role: 'parent' | 'child', ip = randomIp(), passphrase?: unknown): Promise<Response> {
  return SELF.fetch(PAIR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(passphrase === undefined ? { code, device_name: name, role } : { code, device_name: name, role, passphrase }),
  })
}

/** 申请 helper：断言 200 并返回响应体（新契约：device_id / secret / status / server_at；passphrase 仅直入判定消费） */
async function pairDevice(code: string, name: string, role: 'parent' | 'child', passphrase?: string, ip = randomIp()): Promise<PairResponse> {
  const res = await postPair(code, name, role, ip, passphrase)
  expect(res.status).toBe(200)
  return (await res.json()) as PairResponse
}

function bearer(cred: { device_id: string; secret: string }): Record<string, string> {
  return { authorization: `Bearer ${cred.device_id}:${cred.secret}` }
}

/** 响应同构形状（本票核心验收面）：字段集合 + 凭据形态 + 状态值；凭据值本身随机不比 */
function expectPairShape(body: PairResponse, status: 'pending' | 'active'): void {
  expect(Object.keys(body).sort()).toEqual(['device_id', 'secret', 'server_at', 'status'])
  expect(body.status).toBe(status)
  expect(body.device_id).toMatch(UUID_RE)
  expect(body.secret).toMatch(SECRET_RE)
  expect(body.server_at).toBeGreaterThan(0)
}

/** 全表计数（零落库断言用） */
async function countOf(table: 'devices' | 'families' | 'pairing_codes'): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n
}

/** 直插一个已退役（retired）配对码（含其家庭行，满足外键）——场景 H 用的确定性重置码 */
async function insertRetiredCode(code: string): Promise<void> {
  const familyId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO families (family_id, created_at) VALUES (?, ?)').bind(familyId, Date.now()),
    env.DB.prepare('INSERT INTO pairing_codes (code, family_id, issued_at, retired_at) VALUES (?, ?, ?, ?)')
      .bind(code, familyId, Date.now(), Date.now()),
  ])
}

/** #190 发码制建家前置：直插现役码+口令（运营方签发）→ 家长双因子直入，返回家长凭据 */
async function createFamilyWithParent(code: string, passphrase: string, name = '家长手机'): Promise<PairResponse> {
  await seedActiveCode(code, passphrase)
  return pairDevice(code, name, 'parent', passphrase)
}

describe('POST /api/pair 基础门禁', () => {
  it('非 POST 方法 → 405', async () => {
    const res = await SELF.fetch(PAIR_URL, { method: 'GET' })
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'method not allowed' })
  })

  it('入参校验：码非 6 位数字 / 设备名空 / 角色非法 / 坏 JSON → 400（发生在任何 DB 访问前，无存在性泄露）', async () => {
    for (const body of [
      JSON.stringify({ code: '12345', device_name: 'iPad', role: 'parent' }),
      JSON.stringify({ code: '12345x', device_name: 'iPad', role: 'parent' }),
      JSON.stringify({ code: '123456', device_name: '  ', role: 'parent' }),
      JSON.stringify({ code: '123456', device_name: 'iPad', role: 'guest' }),
      'not-json',
    ]) {
      const res = await postPair('123456', 'iPad', 'parent')
      void res
      const raw = await SELF.fetch(PAIR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': randomIp() },
        body,
      })
      expect(raw.status).toBe(400)
      expect(await raw.json()).toHaveProperty('error')
    }
  })
})

describe('#190 建家收权：码不存在 + 任意角色 → 假等待（原场景 A 自助建家路径已删，ADR 0007）', () => {
  it('家长角色 + 全新码 → 200 假等待 pending；families / pairing_codes / devices 零新增（不建家）', async () => {
    const before = { devices: await countOf('devices'), families: await countOf('families'), codes: await countOf('pairing_codes') }

    const cred = await pairDevice(randomCode(), '家长手机', 'parent')
    expectPairShape(cred, 'pending')

    expect(await countOf('devices')).toBe(before.devices)
    expect(await countOf('families')).toBe(before.families)
    expect(await countOf('pairing_codes')).toBe(before.codes)
  })

  it('与真申请逐字段同构（字段集合 / 状态值 / 凭据形态一致，不因「新码+家长」泄露可建家性）', async () => {
    // 真申请基准：运营方签发的现役码 + 孩子角色（场景 B）
    const code = randomCode()
    await seedActiveCode(code, randomPassphrase())
    const realPending = await pairDevice(code, '孩子平板', 'child')
    expectPairShape(realPending, 'pending')

    const fresh = await pairDevice(randomCode(), '家长手机', 'parent')
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(realPending).sort())
    expectPairShape(fresh, 'pending')
    expect(fresh.status).toBe(realPending.status)
    expect(fresh.device_id).not.toBe(realPending.device_id)
  })
})

describe('#190 双因子直入：无现役家长设备 + 家长角色 + 口令对（空家入驻与恢复共用）', () => {
  it('空家直入：码+口令对 → 200 status=active；库内 active 行只存摘要；该码为现役码', async () => {
    const code = randomCode()
    const cred = await createFamilyWithParent(code, randomPassphrase())

    expectPairShape(cred, 'active')

    const row = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?').bind(cred.device_id)
      .first<{ family_id: string; role: string; status: string; credential_hash: string; revoked_at: number | null }>()
    expect(row).not.toBeNull()
    expect(row!.role).toBe('parent')
    expect(row!.status).toBe('active')
    expect(row!.revoked_at).toBeNull()
    expect(row!.credential_hash).not.toBe(cred.secret) // 库存 SHA-256 摘要，非明文
    expect(row!.credential_hash).toHaveLength(64)

    const codeRow = await env.DB.prepare('SELECT family_id, retired_at FROM pairing_codes WHERE code = ?').bind(code)
      .first<{ family_id: string; retired_at: number | null }>()
    expect(codeRow!.family_id).toBe(row!.family_id)
    expect(codeRow!.retired_at).toBeNull()
  })

  it('恢复直入：家长设备全部移除后凭同码+口令再入 → 同家庭 active（丢失全部家长设备后的恢复入口回归）', async () => {
    const code = randomCode()
    const passphrase = randomPassphrase()
    const first = await createFamilyWithParent(code, passphrase)
    await env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').bind(Date.now(), first.device_id).run()

    const again = await pairDevice(code, '新家长手机', 'parent', passphrase)
    expectPairShape(again, 'active')
    const row = await env.DB.prepare('SELECT family_id, status FROM devices WHERE device_id = ?').bind(again.device_id)
      .first<{ family_id: string; status: string }>()
    expect(row!.status).toBe('active')
    expect(row!.family_id).toBe(
      (await env.DB.prepare('SELECT family_id FROM devices WHERE device_id = ?').bind(first.device_id)
        .first<{ family_id: string }>())!.family_id,
    )
  })

  it('孩子设备健在、家长设备全丢：家长凭码+口令仍直入（直入口径只看家长设备，不再死锁）', async () => {
    const code = randomCode()
    const passphrase = randomPassphrase()
    const parent = await createFamilyWithParent(code, passphrase)
    const child = await pairDevice(code, '孩子平板', 'child')
    expect(child.status).toBe('pending')
    await env.DB.prepare("UPDATE devices SET status = 'active' WHERE device_id = ?").bind(child.device_id).run()
    await env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').bind(Date.now(), parent.device_id).run()

    const recovered = await pairDevice(code, '恢复的家长手机', 'parent', passphrase)
    expectPairShape(recovered, 'active')
  })
})

describe('#190 双因子盲口径：码对+口令错/缺、码错+口令对 → 与真申请同构的假等待且零落库', () => {
  it('三种半错组合逐字段同构；devices / families / pairing_codes 零新增（不因口令格式单独报错）', async () => {
    // 真申请基准（场景 B：孩子凭运营方签发的现役码申请）
    const goodCode = randomCode()
    await seedActiveCode(goodCode, randomPassphrase())
    const realPending = await pairDevice(goodCode, '孩子平板', 'child')
    expectPairShape(realPending, 'pending')

    // 空家（无任何设备）现役码 + 确定性口令：直入判定的最小前置
    const emptyCode = randomCode()
    await seedActiveCode(emptyCode, 'abcd')

    const cases: Array<{ label: string; code: string; passphrase?: unknown }> = [
      { label: '码对+口令错', code: emptyCode, passphrase: 'zzzz' },
      { label: '码对+口令缺', code: emptyCode },
      { label: '码错+口令对', code: randomCode(), passphrase: 'abcd' },
    ]

    const before = { devices: await countOf('devices'), families: await countOf('families'), codes: await countOf('pairing_codes') }

    for (const { label, code, passphrase } of cases) {
      const res = await postPair(code, '任何设备', 'parent', undefined, passphrase)
      expect(res.status, label).toBe(200)
      const body = (await res.json()) as PairResponse
      // 同构断言：字段集合 / 凭据形态 / 状态值与真申请一致；假凭据不与真申请撞值（随机生成）
      expect(Object.keys(body).sort(), label).toEqual(Object.keys(realPending).sort())
      expectPairShape(body, 'pending')
      expect(body.status, label).toBe(realPending.status)
      expect(body.device_id, label).not.toBe(realPending.device_id)
    }

    // 零落库：直入分支口令不符不落 devices 行，更不建 families/pairing_codes
    expect(await countOf('devices'), 'devices 零新增').toBe(before.devices)
    expect(await countOf('families'), 'families 零新增').toBe(before.families)
    expect(await countOf('pairing_codes'), 'pairing_codes 零新增').toBe(before.codes)
  })

  it('口令归一小写比对：入参大写归一后与库存匹配 → 直入 active', async () => {
    const code = randomCode()
    await seedActiveCode(code, 'abcd')
    const cred = await pairDevice(code, '家长手机', 'parent', 'ABCD')
    expectPairShape(cred, 'active')
  })

  it('库内 NULL 口令（未设置态）永不匹配：码对 + 家长角色 + 任意口令 → 假等待不落行', async () => {
    const family = crypto.randomUUID()
    await seedFamily(family)
    const code = randomCode()
    await seedPairingCode(family, code, Date.now(), null, null)

    const res = await postPair(code, '家长手机', 'parent', undefined, 'abcd')
    expect(res.status).toBe(200)
    const body = (await res.json()) as PairResponse
    expectPairShape(body, 'pending')
    expect(await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(body.device_id).first()).toBeNull()
  })

  it('passphrase 非字符串（数字）→ 按缺失处理走盲口径（不 400、不落行）', async () => {
    const code = randomCode()
    await seedActiveCode(code, 'abcd')
    const res = await postPair(code, '家长手机', 'parent', undefined, 1234)
    expect(res.status).toBe(200)
    const body = (await res.json()) as PairResponse
    expectPairShape(body, 'pending')
    expect(await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(body.device_id).first()).toBeNull()
  })
})

describe('场景 B：有效码 + 孩子角色 → 真 pending 申请', () => {
  it('家长直入后孩子凭同码申请 → 200 status=pending；devices 落 pending 行且归属同一家庭', async () => {
    const code = randomCode()
    const parent = await createFamilyWithParent(code, randomPassphrase())
    const child = await pairDevice(code, '孩子平板', 'child')

    expectPairShape(child, 'pending')
    const row = await env.DB.prepare('SELECT family_id, status, revoked_at FROM devices WHERE device_id = ?')
      .bind(child.device_id)
      .first<{ family_id: string; status: string; revoked_at: number | null }>()
    expect(row!.status).toBe('pending')
    expect(row!.revoked_at).toBeNull()
    expect(row!.family_id).toBe(
      (await env.DB.prepare('SELECT family_id FROM devices WHERE device_id = ?').bind(parent.device_id)
        .first<{ family_id: string }>())!.family_id,
    )
  })

  it('家长角色申请已有 active 设备的家庭 → 同样 pending（共识 1：堵死自称家长绕过批准；#190：passphrase 仅直入口消费，错口令不改变申请语义）', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, 'abcd')
    const coParent = await pairDevice(code, '第二台家长设备', 'parent')
    expectPairShape(coParent, 'pending')
    const row = await env.DB.prepare('SELECT status FROM devices WHERE device_id = ?').bind(coParent.device_id)
      .first<{ status: string }>()
    expect(row!.status).toBe('pending')

    // #190 AC：有现役家长设备的家庭，passphrase 字段被忽略——带错口令的家长申请照常落真 pending 行
    const coParentWrongPass = await pairDevice(code, '第三台家长设备', 'parent', 'zzzz')
    expectPairShape(coParentWrongPass, 'pending')
    const wrongRow = await env.DB.prepare('SELECT status FROM devices WHERE device_id = ?').bind(coParentWrongPass.device_id)
      .first<{ status: string }>()
    expect(wrongRow!.status).toBe('pending')
  })
})

describe('存在性盲探测（本票核心验收）：错码 / 已重置码 / 孩子+新码 / 超上限 与真申请同构', () => {
  it('三种无效提交：200 + 假凭据 + pending；字段集合与真申请逐字段一致；不落任何行', async () => {
    // 先造一个真 pending 申请作为同构基准（场景 B）
    const goodCode = randomCode()
    await createFamilyWithParent(goodCode, randomPassphrase())
    const realPending = await pairDevice(goodCode, '孩子平板', 'child')
    expectPairShape(realPending, 'pending')

    const retiredCode = randomCode()
    await insertRetiredCode(retiredCode)

    const cases: Array<{ label: string; code: string; role: 'parent' | 'child' }> = [
      { label: '码打错（不存在）', code: randomCode(), role: 'child' },
      { label: '码已重置（retired）', code: retiredCode, role: 'child' },
      { label: '孩子角色 + 全新码', code: randomCode(), role: 'child' },
    ]

    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()
    const familiesBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM families').first<{ n: number }>()

    for (const { label, code, role } of cases) {
      const body = await pairDevice(code, '任何设备', role)
      // 同构断言：结构 / 状态码（pairDevice 内已断言 200）/ 字段集合 / 凭据形态 / 状态值与真申请一致
      expect(Object.keys(body).sort(), label).toEqual(Object.keys(realPending).sort())
      expectPairShape(body, 'pending')
      expect(body.status).toBe(realPending.status)
      // 假凭据不与真申请凭据撞值（随机生成）
      expect(body.device_id, label).not.toBe(realPending.device_id)
    }

    // 不落任何行：devices 与 families 计数零变化（错码不建家、假凭据不建行）
    const afterDevices = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()
    const afterFamilies = await env.DB.prepare('SELECT COUNT(*) AS n FROM families').first<{ n: number }>()
    expect(afterDevices!.n).toBe(before!.n)
    expect(afterFamilies!.n).toBe(familiesBefore!.n)
  })

  it('已退役码 + 家长角色 → 假等待：响应与真申请逐字段同构，devices 零新增（#190 直入口只认现役码）', async () => {
    // 真申请基准（场景 B）
    const goodCode = randomCode()
    await createFamilyWithParent(goodCode, randomPassphrase())
    const realPending = await pairDevice(goodCode, '孩子平板', 'child')
    expectPairShape(realPending, 'pending')

    const retiredCode = randomCode()
    await insertRetiredCode(retiredCode)

    const devicesBefore = await countOf('devices')
    const body = await pairDevice(retiredCode, '家长手机', 'parent')
    // 同构断言：字段集合 / 凭据形态（UUID + 64hex secret）/ 状态值与真申请一致
    expect(Object.keys(body).sort()).toEqual(Object.keys(realPending).sort())
    expectPairShape(body, 'pending')
    expect(body.status).toBe(realPending.status)
    expect(body.device_id).not.toBe(realPending.device_id)

    // 假凭据不落 devices 行（已退役码对家长角色同样无效，不因角色泄露码状态）
    expect(await countOf('devices')).toBe(devicesBefore)
    expect(await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(body.device_id).first()).toBeNull()
  })

  it(`场景 J：真申请堆积第 ${PAIR_MAX_PENDING_PER_FAMILY + 1} 条起 → 静默转假等待（同构 pending，不落行）`, async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    for (let i = 1; i <= PAIR_MAX_PENDING_PER_FAMILY; i++) {
      const body = await pairDevice(code, `孩子设备${i}`, 'child')
      expect(body.status).toBe('pending')
    }

    const overflow = await pairDevice(code, '第6个孩子', 'child')
    expectPairShape(overflow, 'pending') // 与真申请同构，不报错（报错即泄露码有效）

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM devices WHERE family_id = (SELECT family_id FROM pairing_codes WHERE code = ?) AND status = 'pending'",
    ).bind(code).first<{ n: number }>()
    expect(rows!.n).toBe(PAIR_MAX_PENDING_PER_FAMILY) // 第 6 条没落行
  })
})

describe('认证（Bearer device_id:secret，比对摘要；active 凭据既有口径回归）', () => {
  it('无 Authorization / 坏 secret / 未知 device_id → 401', async () => {
    const code = randomCode()
    const cred = await createFamilyWithParent(code, randomPassphrase())
    const PULL = 'http://example.com/api/sync/pull?since=0'

    const noAuth = await SELF.fetch(PULL)
    expect(noAuth.status).toBe(401)
    expect(await noAuth.json()).toEqual({ error: 'unauthorized' })

    const badSecret = await SELF.fetch(PULL, {
      headers: { authorization: `Bearer ${cred.device_id}:deadbeef` },
    })
    expect(badSecret.status).toBe(401)

    const unknownDevice = await SELF.fetch(PULL, {
      headers: { authorization: `Bearer 00000000-0000-0000-0000-000000000000:${cred.secret}` },
    })
    expect(unknownDevice.status).toBe(401)

    const okRes = await SELF.fetch(PULL, { headers: bearer(cred) })
    expect(okRes.status).toBe(200)
  })

  it('已移除设备（revoked_at 墓碑）凭据立即失效 → 401', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase()) // #190：双因子直入建家前置
    const child = await pairDevice(code, '孩子平板', 'child')
    await env.DB.prepare("UPDATE devices SET status = 'active' WHERE device_id = ?").bind(child.device_id).run()
    await env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').bind(Date.now(), child.device_id).run()

    const res = await SELF.fetch('http://example.com/api/sync/pull?since=0', { headers: bearer(child) })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('认证通过刷新 last_seen_at', async () => {
    const code = randomCode()
    const cred = await createFamilyWithParent(code, randomPassphrase())
    const before = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE device_id = ?').bind(cred.device_id)
      .first<{ last_seen_at: number }>()
    await new Promise((r) => setTimeout(r, 5))
    await SELF.fetch('http://example.com/api/sync/pull?since=0', { headers: bearer(cred) })
    const after = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE device_id = ?').bind(cred.device_id)
      .first<{ last_seen_at: number }>()
    expect(after!.last_seen_at).toBeGreaterThan(before!.last_seen_at)
  })
})

describe('防爆破（#142 口径：per-IP 全提交计数，与码对错无关）', () => {
  it('PairRateLimiter 状态机：窗口内 10 次 → 第 11 次拒绝并返回剩余毫秒；窗口滑动（旧记录过期）后放行', () => {
    const limiter = new PairRateLimiter()
    const ip = '203.0.113.77'
    const t0 = 1_000_000

    for (let i = 1; i <= PAIR_MAX_SUBMISSIONS_PER_IP; i++) {
      expect(limiter.recordSubmission(ip, t0 + i)).toBeNull() // 前 10 次：记数放行
    }

    // 第 11 次（窗口内）：拒绝，剩余等待 ≈ 首次提交 + 窗口 - 当前
    const remaining = limiter.recordSubmission(ip, t0 + 20)
    expect(remaining).not.toBeNull()
    expect(remaining!).toBeGreaterThan(0)
    expect(remaining!).toBeLessThanOrEqual(PAIR_WINDOW_MS)

    // 首次提交滑出窗口后：放行（计数窗口滑动）
    expect(limiter.recordSubmission(ip, t0 + 1 + PAIR_WINDOW_MS + 1)).toBeNull()
  })

  it('计数不分成败：失败与成功提交同样计数，码级失败维度已废除', () => {
    const limiter = new PairRateLimiter()
    const ip = '203.0.113.90'
    const t0 = 2_000_000
    // 5 次「失败」+ 5 次「成功」交替——同一 IP 同一计数（无 recordSuccess 清零通道）
    for (let i = 1; i <= PAIR_MAX_SUBMISSIONS_PER_IP; i++) {
      expect(limiter.recordSubmission(ip, t0 + i)).toBeNull()
    }
    expect(limiter.recordSubmission(ip, t0 + 11)).not.toBeNull()
  })

  it('集成：同 IP 第 11 次提交 → 429（正确码也拒，提示重试秒数）；不同 IP 互不影响', async () => {
    const ip = '203.0.113.78'
    const retired = '555011'
    await insertRetiredCode(retired)

    // 10 次提交混合形态：坏 JSON（400）× 2 + 重置码假等待（200）× 3 + 全新码假等待（200）× 2 + 错码（200）× 3
    const attempts: Array<() => Promise<Response>> = [
      () => SELF.fetch(PAIR_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: 'bad' }),
      () => SELF.fetch(PAIR_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: 'bad' }),
      ...Array.from({ length: 3 }, () => () => postPair(retired, '任何设备', 'child', ip)),
      ...Array.from({ length: 2 }, (_, i) => () => postPair(randomCode(), `家长手机${i}`, 'parent', ip)),
      ...Array.from({ length: 3 }, () => () => postPair(randomCode(), '任何设备', 'child', ip)),
    ]
    expect(attempts).toHaveLength(PAIR_MAX_SUBMISSIONS_PER_IP)
    for (const attempt of attempts) {
      const res = await attempt()
      expect([200, 400]).toContain(res.status)
    }

    // 第 11 次：全新码 + 家长角色（放行亦为假等待）→ 429，与码对错无关
    const blocked = await postPair(randomCode(), '再来一台', 'parent', ip)
    expect(blocked.status).toBe(429)
    const body = (await blocked.json()) as { error: string }
    expect(body.error).toContain('too many pairing attempts')
    expect(body.error).toMatch(/retry in \d+s/)

    // 不同 IP 不受牵连
    const other = await postPair(randomCode(), '别的 IP', 'parent', randomIp())
    expect(other.status).toBe(200)
  })

  it('429 期间不放大计数：持续提交维持 429（不续窗）', async () => {
    const ip = '203.0.113.79'
    for (let i = 0; i < PAIR_MAX_SUBMISSIONS_PER_IP; i++) {
      await postPair(randomCode(), '刷子', 'child', ip)
    }
    for (let i = 0; i < 3; i++) {
      const res = await postPair(randomCode(), '刷子', 'child', ip)
      expect(res.status).toBe(429)
    }
  })
})

// ===== #144（R-129c）等待页重新申请：替换语义 =====
// 带旧凭据提交（Authorization 头）：旧凭据匹配自己的真 pending 行 → 先删旧行、再按新申请
// 重新评估（伞票 #129 共识 14 / 场景 F）；旧凭据是假凭据（查无此行）→ 直接按新申请评估。
// 红线：响应与首申同构（错码重申请不得泄露存在性）；旧凭据仅能删自己对应的那一行 pending。

/** 重申请提交：POST /api/pair + 旧凭据 Authorization 头（#144 替换语义入口） */
function reapplyPair(
  cred: { device_id: string; secret: string },
  code: string,
  name: string,
  role: 'parent' | 'child',
  ip = randomIp(),
): Promise<Response> {
  return SELF.fetch(PAIR_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
      authorization: `Bearer ${cred.device_id}:${cred.secret}`,
    },
    body: JSON.stringify({ code, device_name: name, role }),
  })
}

describe('#144 重新申请替换：主路径（场景 F）', () => {
  it('对码改名重提：先删旧真 pending 行、再落新真行（新凭据新行，名字已更新）', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    const first = await pairDevice(code, '孩子平板', 'child')
    expect(first.status).toBe('pending')

    const res = await reapplyPair(first, code, '孩子的新平板', 'child')
    expect(res.status).toBe(200)
    const second = (await res.json()) as PairResponse
    expectPairShape(second, 'pending')
    expect(second.device_id).not.toBe(first.device_id) // 替换 = 新凭据新行，非原地改

    // 旧行已删；该家庭 pending 只剩新行且名字/角色为新申请值
    const oldRow = await env.DB.prepare('SELECT name FROM devices WHERE device_id = ?').bind(first.device_id)
      .first<{ name: string }>()
    expect(oldRow).toBeNull()
    const rows = await env.DB.prepare(
      "SELECT device_id, name, role FROM devices WHERE family_id = (SELECT family_id FROM pairing_codes WHERE code = ?) AND status = 'pending'",
    ).bind(code).all<{ device_id: string; name: string; role: string }>()
    expect(rows.results.map((r) => r.name)).toEqual(['孩子的新平板'])
    expect(rows.results[0]!.device_id).toBe(second.device_id)
    expect(rows.results[0]!.role).toBe('child')
  })

  it('改角色重提生效：孩子申请 → 重提家长角色 → 新行 role=parent（家长端将看到申请成为：家长设备）', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    const first = await pairDevice(code, '孩子平板', 'child')

    const res = await reapplyPair(first, code, '孩子平板', 'parent')
    expect(res.status).toBe(200)
    const second = (await res.json()) as PairResponse
    expectPairShape(second, 'pending')

    const row = await env.DB.prepare('SELECT role, status FROM devices WHERE device_id = ?').bind(second.device_id)
      .first<{ role: string; status: string }>()
    expect(row!.role).toBe('parent')
    expect(row!.status).toBe('pending')
    const oldRow = await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(first.device_id)
      .first<{ device_id: string }>()
    expect(oldRow).toBeNull() // 替换：旧行删
  })

  it('改码重提生效：换到另一有效码 → 新行落新家庭，旧家庭旧行删', async () => {
    const codeA = randomCode()
    const codeB = randomCode()
    const parentA = await createFamilyWithParent(codeA, randomPassphrase(), 'A 家长')
    await createFamilyWithParent(codeB, randomPassphrase(), 'B 家长')
    const first = await pairDevice(codeA, '孩子平板', 'child')
    const familyA = (await env.DB.prepare('SELECT family_id FROM devices WHERE device_id = ?').bind(parentA.device_id)
      .first<{ family_id: string }>())!.family_id

    const res = await reapplyPair(first, codeB, '孩子平板', 'child')
    expect(res.status).toBe(200)
    const second = (await res.json()) as PairResponse
    expectPairShape(second, 'pending')

    const newRow = await env.DB.prepare('SELECT family_id FROM devices WHERE device_id = ?').bind(second.device_id)
      .first<{ family_id: string }>()
    expect(newRow!.family_id).not.toBe(familyA) // 落在码 B 的新家庭
    const oldRow = await env.DB.prepare('SELECT family_id FROM devices WHERE device_id = ?').bind(first.device_id)
      .first<{ family_id: string }>()
    expect(oldRow).toBeNull() // 旧家庭旧行删
  })

  it('错码重申请：旧真行删 + 新假凭据；响应与首申错码逐字段同构（存在性盲探测红线）', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    const first = await pairDevice(code, '孩子平板', 'child')

    const firstWrong = await pairDevice(randomCode(), '任何设备', 'child') // 首申错码基准（假凭据）
    const res = await reapplyPair(first, randomCode(), '孩子平板', 'child') // 带旧凭据重申请，码仍错
    expect(res.status).toBe(200)
    const body = (await res.json()) as PairResponse
    // 同构断言扩展：字段集合 / 状态值 / 凭据形态与首申错码一致，不得泄露「旧行存在与否」
    expect(Object.keys(body).sort()).toEqual(Object.keys(firstWrong).sort())
    expectPairShape(body, 'pending')
    expect(body.status).toBe(firstWrong.status)

    // 旧真行已删；假凭据不落任何新行
    const oldRow = await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(first.device_id)
      .first<{ device_id: string }>()
    expect(oldRow).toBeNull()
    const newRow = await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(body.device_id)
      .first<{ device_id: string }>()
    expect(newRow).toBeNull()
  })

  it('旧凭据是假凭据（查无此行）：不删任何行，直接按新申请评估（对码 → 新真行，本地凭据覆盖）', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    const fake = await pairDevice(randomCode(), '孩子平板', 'child') // 错码首申 → 假凭据
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()

    const res = await reapplyPair(fake, code, '孩子平板', 'child')
    expect(res.status).toBe(200)
    const second = (await res.json()) as PairResponse
    expectPairShape(second, 'pending')

    // 新真行落库（对码评估成功，pending 归属该家庭）
    const row = await env.DB.prepare(
      'SELECT family_id, status FROM devices WHERE device_id = ?',
    ).bind(second.device_id).first<{ family_id: string; status: string }>()
    expect(row!.status).toBe('pending')
    expect(row!.family_id).toBe(
      (await env.DB.prepare(
        'SELECT family_id FROM pairing_codes WHERE code = ?',
      ).bind(code).first<{ family_id: string }>())!.family_id,
    )
    // 净增恰一行（假凭据无行可删，新申请一行）
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()
    expect(after!.n).toBe(before!.n + 1)
  })
})

describe('#144 重新申请替换：安全边界（旧凭据仅能删自己对应的那一行 pending）', () => {
  it('A 重申请不误删 B 的 pending 行：只有 A 自己的旧行被删，B 行原样', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    const a = await pairDevice(code, 'A 平板', 'child')
    const b = await pairDevice(code, 'B 平板', 'child')

    const res = await reapplyPair(a, randomCode(), 'A 平板', 'child') // A 错码重申请
    expect(res.status).toBe(200)
    expectPairShape((await res.json()) as PairResponse, 'pending')

    const aRow = await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(a.device_id)
      .first<{ device_id: string }>()
    expect(aRow).toBeNull() // A 自己的旧行删
    const bRow = await env.DB.prepare('SELECT device_id, status FROM devices WHERE device_id = ?').bind(b.device_id)
      .first<{ device_id: string; status: string }>()
    expect(bRow).not.toBeNull() // B 的行原样（他人凭据删不了别人的行）
    expect(bRow!.status).toBe('pending')
  })

  it('旧凭据是 active 行 → 不删（仅 pending 可替换）：active 行原样，按新申请评估', async () => {
    const code = randomCode()
    const parent = await createFamilyWithParent(code, randomPassphrase()) // active 凭据（双因子直入）

    const res = await reapplyPair(parent, randomCode(), '家长手机', 'child') // 带 active 凭据错码提交
    expect(res.status).toBe(200)
    expectPairShape((await res.json()) as PairResponse, 'pending')

    const row = await env.DB.prepare('SELECT status, revoked_at FROM devices WHERE device_id = ?').bind(parent.device_id)
      .first<{ status: string; revoked_at: number | null }>()
    expect(row!.status).toBe('active') // active 成员行不被替换路径误删
    expect(row!.revoked_at).toBeNull()
  })

  it('摘要不符 / 凭据损坏（Bearer 格式坏或 secret 错）→ 静默按无凭据首申评估，不删任何行', async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    const first = await pairDevice(code, '孩子平板', 'child')
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()

    // secret 错（摘要不匹配）+ 对码：不得删旧行，按新申请评估落新真行
    const res = await reapplyPair({ device_id: first.device_id, secret: 'deadbeef'.repeat(8) }, code, '孩子平板', 'child')
    expect(res.status).toBe(200)
    const body = (await res.json()) as PairResponse
    expectPairShape(body, 'pending')

    const oldRow = await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(first.device_id)
      .first<{ device_id: string }>()
    expect(oldRow).not.toBeNull() // 摘要不符：旧行原样
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()
    expect(after!.n).toBe(before!.n + 1) // 仅新申请一行
  })
})

describe('#144 重新申请替换：先删后评估（pending 名额随替换释放，场景 J 交互）', () => {
  it(`cap ${PAIR_MAX_PENDING_PER_FAMILY} 满后：带旧凭据重申请对码 → 名额已释放，新申请落真行（不转假等待）`, async () => {
    const code = randomCode()
    await createFamilyWithParent(code, randomPassphrase())
    const kids = []
    for (let i = 1; i <= PAIR_MAX_PENDING_PER_FAMILY; i++) {
      kids.push(await pairDevice(code, `孩子设备${i}`, 'child'))
    }
    // cap 已满：第 6 个无凭据新申请 → 假等待（不落行）
    const overflow = await pairDevice(code, '第6个孩子', 'child')
    expectPairShape(overflow, 'pending')

    // 满员后 1 号孩子带旧凭据对码重申请：先删旧行释放名额 → 新申请落真行
    const res = await reapplyPair(kids[0]!, code, '孩子设备1改名', 'child')
    expect(res.status).toBe(200)
    const renewed = (await res.json()) as PairResponse
    expectPairShape(renewed, 'pending')
    const row = await env.DB.prepare('SELECT status FROM devices WHERE device_id = ?').bind(renewed.device_id)
      .first<{ status: string }>()
    expect(row!.status).toBe('pending') // 落了真行（若先评估后删会转假等待）
    expect(row).not.toBeNull()

    // 家庭 pending 总数 = cap（5-1 旧 + 1 新替换 + 0 假等待）
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM devices WHERE family_id = (SELECT family_id FROM pairing_codes WHERE code = ?) AND status = 'pending'",
    ).bind(code).first<{ n: number }>()
    expect(count!.n).toBe(PAIR_MAX_PENDING_PER_FAMILY)
  })
})
