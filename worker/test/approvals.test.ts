import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { authHeaders, seedActiveCode, seedDevice, seedFamily } from './helpers'

// 家长端批准闭环单测（票 #143，R-129b；伞票 #129 场景 B/C/E/G/J）：
// - GET  /api/devices/pending            批准列表（名字/申请角色/申请时间；不采集展示 IP，共识 16）
// - POST /api/devices/<id>/approve       批准 = pending 行翻 active（场景 C）
// - POST /api/devices/<id>/reject        拒绝 = 删行（场景 E；无 rejected 状态残留）
// 全部校验请求者为 active 家长设备（authenticate 挡 pending 401 + requireParent 挡孩子 403）；
// 并发处理同一条申请：后到者 409「这条申请刚被处理过」（共识 5）。

const BASE = 'http://example.com'

/** 直插一条 pending 申请行（构造性用例；链路用例走真实 /api/pair） */
async function seedPending(
  familyId: string,
  deviceId: string,
  name: string,
  role: 'parent' | 'child',
): Promise<void> {
  await seedDevice(familyId, deviceId, name, role)
  await env.DB.prepare("UPDATE devices SET status = 'pending' WHERE device_id = ?").bind(deviceId).run()
}

describe('GET /api/devices/pending（批准列表）', () => {
  it('家长可见本家庭 pending 申请：名字 / 申请角色 / 申请时间（paired_at）；active、revoked、他家庭不入列', async () => {
    const family = `fam-ap-list-${crypto.randomUUID()}`
    const other = `fam-ap-other-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-ap-p1', '家长 iPhone', 'parent')
    await seedPending(family, 'dev-ap-k1', '孩子的 iPad', 'child')
    await seedPending(family, 'dev-ap-p2', '第二台家长手机', 'parent')
    await seedDevice(family, 'dev-ap-active', '已在家的设备', 'child') // active 不入列
    await env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').bind(1_234, 'dev-ap-k1').run()
    await seedPending(other, 'dev-ap-b1', '别家申请', 'child') // 他家庭隔离

    const res = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      requests: { device_id: string; name: string; role: string; paired_at: number }[]
    }
    // revoked 的 pending 申请也不入列（它已不是待批准的申请）
    expect(body.requests.map((r) => r.device_id)).toEqual(['dev-ap-p2'])
    expect(body.requests[0]).toMatchObject({ name: '第二台家长手机', role: 'parent' })
    expect(typeof body.requests[0]!.paired_at).toBe('number')
  })

  it('响应行只有 名字/角色/时间 三展示字段（不采集展示 IP，共识 16）', async () => {
    const family = `fam-ap-shape-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-ap-p3', '家长手机', 'parent')
    await seedPending(family, 'dev-ap-k3', '孩子的平板', 'child')

    const res = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: authHeaders(parent.token) })
    const body = (await res.json()) as { requests: Record<string, unknown>[] }
    expect(body.requests).toHaveLength(1)
    expect(Object.keys(body.requests[0]!).sort()).toEqual(['device_id', 'name', 'paired_at', 'role'])
    expect(JSON.stringify(body)).not.toMatch(/ip/i)
  })

  it('门禁：无认证 401 / 孩子设备 403 / pending 凭据 401（端点校验 active 家长，不依赖 UI 不可达）', async () => {
    const family = `fam-ap-gate-${crypto.randomUUID()}`
    await seedFamily(family)
    const kid = await seedDevice(family, 'dev-ap-k4', '孩子的 iPad', 'child')
    await seedPending(family, 'dev-ap-k5', '等待中的申请', 'child')

    const noAuth = await SELF.fetch(`${BASE}/api/devices/pending`)
    expect(noAuth.status).toBe(401)
    expect(await noAuth.json()).toEqual({ error: 'unauthorized' })

    const asKid = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: authHeaders(kid.token) })
    expect(asKid.status).toBe(403)
    expect(await asKid.json()).toEqual({ error: 'forbidden' })

    // pending 凭据（等待中的申请设备自称家长也不行）：authenticate 挡在 401
    const asPending = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: authHeaders('dev-ap-k5:tok-dev-ap-k5') })
    expect(asPending.status).toBe(401)
  })

  it('无待批准申请 → 200 { requests: [] }（前端空态依据）', async () => {
    const family = `fam-ap-empty-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-ap-p4', '家长手机', 'parent')
    const res = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ requests: [] })
  })
})

describe('POST /api/devices/<id>/approve（批准 = 行翻 active，场景 C）', () => {
  it('家长批准 → 行翻 active；孩子端状态轮询即刻见 active（≤5 秒轮询发现进家）', async () => {
    const family = `fam-ap-ok-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-ap-p5', '家长手机', 'parent')
    await seedPending(family, 'dev-ap-k6', '孩子的平板', 'child')

    const res = await SELF.fetch(`${BASE}/api/devices/dev-ap-k6/approve`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, device_id: 'dev-ap-k6' })

    const row = await env.DB.prepare('SELECT status, revoked_at FROM devices WHERE device_id = ?')
      .bind('dev-ap-k6')
      .first<{ status: string; revoked_at: number | null }>()
    expect(row!.status).toBe('active')
    expect(row!.revoked_at).toBeNull()

    // 孩子端轮询（盲口径端点）发现 active
    const poll = await SELF.fetch(`${BASE}/api/pair/status`, {
      headers: authHeaders('dev-ap-k6:tok-dev-ap-k6'),
    })
    expect(await poll.json()).toMatchObject({ status: 'active' })
  })

  it('家长角色申请批准后即共同家长：凭据可过家长门禁（场景 G）', async () => {
    const family = `fam-ap-co-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-ap-p6', '家长手机', 'parent')
    await seedPending(family, 'dev-ap-p7', '第二台家长手机', 'parent')

    const res = await SELF.fetch(`${BASE}/api/devices/dev-ap-p7/approve`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)

    // 新共同家长：家长门禁端点 200（approve 前同请求 403/401——approve 前 pending 凭据被 authenticate 挡 401）
    const asCoParent = await SELF.fetch(`${BASE}/api/devices`, { headers: authHeaders('dev-ap-p7:tok-dev-ap-p7') })
    expect(asCoParent.status).toBe(200)
  })

  it('门禁：无认证 401 / 孩子设备 403 / pending 凭据 401；目标不存在或他家庭 → 404（家庭隔离）', async () => {
    const family = `fam-ap-g2-${crypto.randomUUID()}`
    const other = `fam-ap-g2o-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-ap-p8', '家长手机', 'parent')
    const kid = await seedDevice(family, 'dev-ap-k7', '孩子的平板', 'child')
    await seedPending(family, 'dev-ap-k8', '等待中的申请', 'child')
    await seedPending(other, 'dev-ap-b2', '别家申请', 'child')

    const noAuth = await SELF.fetch(`${BASE}/api/devices/dev-ap-k8/approve`, { method: 'POST' })
    expect(noAuth.status).toBe(401)

    const asKid = await SELF.fetch(`${BASE}/api/devices/dev-ap-k8/approve`, { method: 'POST', headers: authHeaders(kid.token) })
    expect(asKid.status).toBe(403)

    const asPending = await SELF.fetch(`${BASE}/api/devices/dev-ap-k8/approve`, {
      method: 'POST',
      headers: authHeaders('dev-ap-k8:tok-dev-ap-k8'),
    })
    expect(asPending.status).toBe(401)

    const ghost = await SELF.fetch(`${BASE}/api/devices/dev-ghost/approve`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(ghost.status).toBe(404)

    const cross = await SELF.fetch(`${BASE}/api/devices/dev-ap-b2/approve`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(cross.status).toBe(404)
    const otherRow = await env.DB.prepare('SELECT status FROM devices WHERE device_id = ?')
      .bind('dev-ap-b2')
      .first<{ status: string }>()
    expect(otherRow!.status).toBe('pending') // 他家庭行未被改动
  })

  it('并发后到：申请已被另一家长批准（行已 active）→ 409「刚被处理过」', async () => {
    const family = `fam-ap-409-${crypto.randomUUID()}`
    await seedFamily(family)
    const parentA = await seedDevice(family, 'dev-ap-pa', '家长手机 A', 'parent')
    const parentB = await seedDevice(family, 'dev-ap-pb', '家长手机 B', 'parent')
    await seedPending(family, 'dev-ap-k9', '孩子的平板', 'child')

    const first = await SELF.fetch(`${BASE}/api/devices/dev-ap-k9/approve`, { method: 'POST', headers: authHeaders(parentA.token) })
    expect(first.status).toBe(200)

    const second = await SELF.fetch(`${BASE}/api/devices/dev-ap-k9/approve`, { method: 'POST', headers: authHeaders(parentB.token) })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: expect.stringContaining('already') })
  })

  it('非 POST 方法 → 405', async () => {
    const family = `fam-ap-m-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-ap-p9', '家长手机', 'parent')
    const res = await SELF.fetch(`${BASE}/api/devices/dev-x/approve`, { method: 'GET', headers: authHeaders(parent.token) })
    expect(res.status).toBe(405)
  })
})

describe('POST /api/devices/<id>/reject（拒绝 = 删行，场景 E）', () => {
  it('家长拒绝 → 行删除（无 rejected 状态残留：库里查无此行）', async () => {
    const family = `fam-rj-ok-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-rj-p1', '家长手机', 'parent')
    await seedPending(family, 'dev-rj-k1', '孩子的平板', 'child')

    const res = await SELF.fetch(`${BASE}/api/devices/dev-rj-k1/reject`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, device_id: 'dev-rj-k1' })

    const row = await env.DB.prepare('SELECT status FROM devices WHERE device_id = ?')
      .bind('dev-rj-k1')
      .first<{ status: string }>()
    expect(row).toBeNull() // 删行：不是打状态戳，行本身不存在
  })

  it('拒绝后孩子端无任何变化：同凭据轮询仍 pending（与错码/查无此行构造上同构，共识 8-9）', async () => {
    const family = `fam-rj-blind-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-rj-p2', '家长手机', 'parent')
    await seedPending(family, 'dev-rj-k2', '孩子的平板', 'child')
    const cred = { authorization: 'Bearer dev-rj-k2:tok-dev-rj-k2' }

    const before = await SELF.fetch(`${BASE}/api/pair/status`, { headers: cred })
    expect(await before.json()).toMatchObject({ status: 'pending' })

    await SELF.fetch(`${BASE}/api/devices/dev-rj-k2/reject`, { method: 'POST', headers: authHeaders(parent.token) })

    const after = await SELF.fetch(`${BASE}/api/pair/status`, { headers: cred })
    expect(after.status).toBe(200)
    expect(await after.json()).toMatchObject({ status: 'pending' }) // 被拒后仍是 pending：永不告知被拒
  })

  it('门禁与隔离：无认证 401 / 孩子设备 403 / pending 凭据 401 / 不存在或他家庭 404（他家庭行原样）', async () => {
    const family = `fam-rj-g-${crypto.randomUUID()}`
    const other = `fam-rj-go-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-rj-p3', '家长手机', 'parent')
    const kid = await seedDevice(family, 'dev-rj-k3', '孩子的平板', 'child')
    await seedPending(family, 'dev-rj-k4', '等待中的申请', 'child')
    await seedPending(other, 'dev-rj-b1', '别家申请', 'child')

    expect((await SELF.fetch(`${BASE}/api/devices/dev-rj-k4/reject`, { method: 'POST' })).status).toBe(401)
    expect(
      (await SELF.fetch(`${BASE}/api/devices/dev-rj-k4/reject`, { method: 'POST', headers: authHeaders(kid.token) })).status,
    ).toBe(403)
    expect(
      (
        await SELF.fetch(`${BASE}/api/devices/dev-rj-k4/reject`, {
          method: 'POST',
          headers: authHeaders('dev-rj-k4:tok-dev-rj-k4'),
        })
      ).status,
    ).toBe(401)
    expect(
      (await SELF.fetch(`${BASE}/api/devices/dev-ghost/reject`, { method: 'POST', headers: authHeaders(parent.token) })).status,
    ).toBe(404)
    expect(
      (await SELF.fetch(`${BASE}/api/devices/dev-rj-b1/reject`, { method: 'POST', headers: authHeaders(parent.token) })).status,
    ).toBe(404)

    const otherRow = await env.DB.prepare('SELECT status FROM devices WHERE device_id = ?')
      .bind('dev-rj-b1')
      .first<{ status: string }>()
    expect(otherRow!.status).toBe('pending') // 他家庭行未被删
  })

  it('并发后到：申请已被处理（批准或拒绝）→ 409「刚被处理过」', async () => {
    const family = `fam-rj-409-${crypto.randomUUID()}`
    await seedFamily(family)
    const parentA = await seedDevice(family, 'dev-rj-pa', '家长手机 A', 'parent')
    const parentB = await seedDevice(family, 'dev-rj-pb', '家长手机 B', 'parent')

    // 双家长先后拒绝同一条：后者 409（行已删）
    await seedPending(family, 'dev-rj-k5', '孩子的平板', 'child')
    const rejectFirst = await SELF.fetch(`${BASE}/api/devices/dev-rj-k5/reject`, { method: 'POST', headers: authHeaders(parentA.token) })
    expect(rejectFirst.status).toBe(200)
    const rejectSecond = await SELF.fetch(`${BASE}/api/devices/dev-rj-k5/reject`, { method: 'POST', headers: authHeaders(parentB.token) })
    expect(rejectSecond.status).toBe(404) // 行已删：查无此行 → 404（与不存在同形，删行语义下无「已处理」可辨）

    // 一家长批准、另一家长随后拒绝同一条：后者 409（行已 active，不能再拒）
    await seedPending(family, 'dev-rj-k6', '另一台平板', 'child')
    await SELF.fetch(`${BASE}/api/devices/dev-rj-k6/approve`, { method: 'POST', headers: authHeaders(parentA.token) })
    const rejectApproved = await SELF.fetch(`${BASE}/api/devices/dev-rj-k6/reject`, { method: 'POST', headers: authHeaders(parentB.token) })
    expect(rejectApproved.status).toBe(409)
    expect(await rejectApproved.json()).toMatchObject({ error: expect.stringContaining('already') })
    const stillActive = await env.DB.prepare('SELECT status FROM devices WHERE device_id = ?')
      .bind('dev-rj-k6')
      .first<{ status: string }>()
    expect(stillActive!.status).toBe('active') // 已批准成员不被拒绝路径误删
  })

  it('非 POST 方法 → 405', async () => {
    const family = `fam-rj-m-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-rj-p9', '家长手机', 'parent')
    const res = await SELF.fetch(`${BASE}/api/devices/dev-x/reject`, { method: 'GET', headers: authHeaders(parent.token) })
    expect(res.status).toBe(405)
  })
})

// ===== 全链路与既有口径回归（走真实 /api/pair 申请，场景 B/C/E/G/J 服务端路径）=====

const PAIR_URL = 'http://example.com/api/pair'

/** 随机 IP：配对全提交计数在 isolate 内存跨测试持续，每次调用独立 IP 隔离计数 */
function randomIp(): string {
  return `198.51.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
}

function randomCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000))
}

/** 走真实 /api/pair 申请：断言 200 并返回凭据（device_id / secret / status；passphrase 仅直入判定消费） */
async function applyPair(
  code: string,
  name: string,
  role: 'parent' | 'child',
  passphrase?: string,
): Promise<{ device_id: string; secret: string; status: 'pending' | 'active' }> {
  const res = await SELF.fetch(PAIR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': randomIp() },
    body: JSON.stringify(passphrase === undefined ? { code, device_name: name, role } : { code, device_name: name, role, passphrase }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { device_id: string; secret: string; status: 'pending' | 'active' }
}

/** 随机 4 位小写字母口令（#190 家庭口令格式） */
function randomPassphrase(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => letters[b % 26]).join('')
}

/** #190 发码制建家前置：直插现役码+口令（运营方签发）→ 家长双因子直入；code/passphrase 供后续同码申请 */
async function establishFamily(name = '家长手机'): Promise<{
  code: string
  passphrase: string
  cred: { device_id: string; secret: string; status: 'pending' | 'active' }
}> {
  const code = randomCode()
  const passphrase = randomPassphrase()
  await seedActiveCode(code, passphrase)
  return { code, passphrase, cred: await applyPair(code, name, 'parent', passphrase) }
}

describe('批准闭环全链路（场景 B→C：申请 → 列表 → 批准 → 轮询发现）', () => {
  it('孩子真实申请落列表 → 家长批准 → 批准列表消失 + 设备名册出现 + 孩子轮询见 active', async () => {
    const { code, cred: parent } = await establishFamily()
    const child = await applyPair(code, '孩子的平板', 'child')
    expect(child.status).toBe('pending')
    const parentAuth = { authorization: `Bearer ${parent.device_id}:${parent.secret}` }

    // 场景 B：申请出现在批准列表（名字/角色/时间）
    const listRes = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    const listBody = (await listRes.json()) as { requests: { device_id: string; name: string; role: string }[] }
    expect(listBody.requests.map((r) => r.device_id)).toEqual([child.device_id])
    expect(listBody.requests[0]).toMatchObject({ name: '孩子的平板', role: 'child' })
    // pending 不入设备名册（#142 口径回归）
    const rosterBefore = await SELF.fetch(`${BASE}/api/devices`, { headers: parentAuth })
    const rosterBeforeBody = (await rosterBefore.json()) as { devices: { device_id: string }[] }
    expect(rosterBeforeBody.devices.some((d) => d.device_id === child.device_id)).toBe(false)

    // 场景 C：批准 → 列表消失 + 名册出现 + 孩子轮询 active
    const approve = await SELF.fetch(`${BASE}/api/devices/${child.device_id}/approve`, { method: 'POST', headers: parentAuth })
    expect(approve.status).toBe(200)

    const listAfter = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    expect(await listAfter.json()).toMatchObject({ requests: [] })

    const rosterAfter = await SELF.fetch(`${BASE}/api/devices`, { headers: parentAuth })
    const rosterAfterBody = (await rosterAfter.json()) as { devices: { device_id: string }[] }
    expect(rosterAfterBody.devices.some((d) => d.device_id === child.device_id)).toBe(true)

    const poll = await SELF.fetch(`${BASE}/api/pair/status`, {
      headers: { authorization: `Bearer ${child.device_id}:${child.secret}` },
    })
    expect(await poll.json()).toMatchObject({ status: 'active' })
  })

  it('场景 G：家长角色申请带角色入列，批准即添加共同家长（可出示家庭码）', async () => {
    const { code, cred: parent } = await establishFamily()
    const coParent = await applyPair(code, '第二台家长手机', 'parent')
    expect(coParent.status).toBe('pending')
    const parentAuth = { authorization: `Bearer ${parent.device_id}:${parent.secret}` }

    const list = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    const listBody = (await list.json()) as { requests: { device_id: string; role: string }[] }
    expect(listBody.requests[0]).toMatchObject({ device_id: coParent.device_id, role: 'parent' })

    const approve = await SELF.fetch(`${BASE}/api/devices/${coParent.device_id}/approve`, { method: 'POST', headers: parentAuth })
    expect(approve.status).toBe(200)

    // 共同家长可过家长门禁：出示家庭码 200
    const codeRes = await SELF.fetch(`${BASE}/api/family-code`, {
      headers: { authorization: `Bearer ${coParent.device_id}:${coParent.secret}` },
    })
    expect(codeRes.status).toBe(200)
  })
})

describe('cap5 可见面（场景 J 家长列表侧）与恢复受理', () => {
  it('每家庭真 pending ≤ 5：第 6 条申请静默假等待（同构 pending），家长列表最多 5 条', async () => {
    const { code, cred: parent } = await establishFamily()
    const parentAuth = { authorization: `Bearer ${parent.device_id}:${parent.secret}` }

    for (let i = 1; i <= 5; i++) {
      const body = await applyPair(code, `孩子设备${i}`, 'child')
      expect(body.status).toBe('pending')
    }
    const overflow = await applyPair(code, '第6个孩子', 'child')
    expect(overflow.status).toBe('pending') // 静默假等待（同构，不报错）
    expect(overflow.device_id).toMatch(/^[0-9a-f-]{36}$/) // 假凭据也是 UUID 形态

    const list = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    const listBody = (await list.json()) as { requests: { name: string }[] }
    expect(listBody.requests).toHaveLength(5)
    expect(listBody.requests.some((r) => r.name === '第6个孩子')).toBe(false) // 假等待零污染列表
  })

  it('清完恢复受理：拒绝一条后，新申请重新落行进列表', async () => {
    const { code, cred: parent } = await establishFamily()
    const parentAuth = { authorization: `Bearer ${parent.device_id}:${parent.secret}` }

    for (let i = 1; i <= 5; i++) {
      await applyPair(code, `孩子设备${i}`, 'child')
    }
    const blocked = await applyPair(code, '被堵的第6个', 'child')
    // 阻塞期间落库行数不变（假等待）：列表仍 5 条
    const listFull = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    const listFullBody = (await listFull.json()) as { requests: { device_id: string }[] }
    expect(listFullBody.requests).toHaveLength(5)

    // 拒绝第一条 → 腾出名额 → 新申请重新受理
    const first = listFullBody.requests[0]!.device_id
    const reject = await SELF.fetch(`${BASE}/api/devices/${first}/reject`, { method: 'POST', headers: parentAuth })
    expect(reject.status).toBe(200)

    const revived = await applyPair(code, '恢复后的新申请', 'child')
    expect(revived.status).toBe('pending') // 恢复受理：新申请重新落真 pending 行
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM devices WHERE family_id = (SELECT family_id FROM pairing_codes WHERE code = ?) AND status = 'pending'",
    ).bind(code).first<{ n: number }>()
    expect(rows!.n).toBe(5) // 新申请落了行（4 旧 + 1 新）
    const listAfter = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    const listAfterBody = (await listAfter.json()) as { requests: { name: string }[] }
    expect(listAfterBody.requests.some((r) => r.name === '恢复后的新申请')).toBe(true)
    expect(blocked.status).toBe('pending') // 语义参照：假等待响应形态
  })
})

describe('pending 不入名册 / 不计首台家长判定（#142 口径回归）', () => {
  it('家庭只有 pending 设备（零 active）+ 家长角色新申请 → 仍直入 active（首台判定只看 active；#190 口令对前置）', async () => {
    const { code, passphrase, cred: first } = await establishFamily()
    // 人为把首台家长降为 pending 构造「零 active + 有 pending」家庭（如家长被移除后的中间态）
    await env.DB.prepare("UPDATE devices SET status = 'pending' WHERE device_id = ?").bind(first.device_id).run()

    const again = await applyPair(code, '恢复的家长手机', 'parent', passphrase)
    expect(again.status).toBe('active') // pending 不计首台判定：零现役家长 + 家长角色 + 口令对 → 直入
  })

  it('seed 构造回归：pending 行不出现在 GET /api/devices 名册', async () => {
    const family = `fam-roster-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-ro-p1', '家长手机', 'parent')
    await seedPending(family, 'dev-ro-k1', '等待中的申请', 'child')

    const res = await SELF.fetch(`${BASE}/api/devices`, { headers: authHeaders(parent.token) })
    const body = (await res.json()) as { devices: { device_id: string }[] }
    expect(body.devices.map((d) => d.device_id)).toEqual(['dev-ro-p1'])
  })
})

describe('#144 重新申请替换后的家长列表可见面（场景 F：列表始终只剩最新一条）', () => {
  it('孩子申请 → 带旧凭据重申请：批准列表旧申请被替换，只剩最新一条（名字/角色为新申请值）', async () => {
    const { code, cred: parent } = await establishFamily()
    const parentAuth = { authorization: `Bearer ${parent.device_id}:${parent.secret}` }
    const first = await applyPair(code, '孩子的旧平板', 'child')
    expect(first.status).toBe('pending')

    // 重申请（改名）：带旧凭据 Authorization 头提交 /api/pair
    const reapply = await SELF.fetch(PAIR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': randomIp(),
        authorization: `Bearer ${first.device_id}:${first.secret}`,
      },
      body: JSON.stringify({ code, device_name: '孩子的新平板', role: 'child' }),
    })
    expect(reapply.status).toBe(200)
    const renewed = (await reapply.json()) as { device_id: string; status: 'pending' | 'active' }
    expect(renewed.status).toBe('pending')

    // #143 端点零改动：批准列表只剩最新一条
    const list = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { requests: { device_id: string; name: string; role: string }[] }
    expect(body.requests).toHaveLength(1)
    expect(body.requests[0]).toMatchObject({ device_id: renewed.device_id, name: '孩子的新平板', role: 'child' })
  })

  it('重申请转假等待（错码）：批准列表清空（旧行删、假凭据零污染，场景 D×F）', async () => {
    const { code, cred: parent } = await establishFamily()
    const parentAuth = { authorization: `Bearer ${parent.device_id}:${parent.secret}` }
    const first = await applyPair(code, '孩子的平板', 'child')

    const reapply = await SELF.fetch(PAIR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': randomIp(),
        authorization: `Bearer ${first.device_id}:${first.secret}`,
      },
      body: JSON.stringify({ code: randomCode(), device_name: '孩子的平板', role: 'child' }), // 码打错
    })
    expect(reapply.status).toBe(200)
    expect(((await reapply.json()) as { status: string }).status).toBe('pending') // 假等待同构

    const list = await SELF.fetch(`${BASE}/api/devices/pending`, { headers: parentAuth })
    expect(await list.json()).toMatchObject({ requests: [] }) // 旧申请消失，假凭据不落列表
  })
})
