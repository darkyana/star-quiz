// 管理端点单测（票 #124 AC）：parent 门禁（孩子设备 403）/家庭隔离/移除即 401/重置只拦后续加入/last_seen 刷新。
import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { authHeaders, seedDevice, seedFamily, seedPairingCode } from './helpers'

const BASE = 'http://example.com'

async function devicesOf(familyId: string): Promise<{ device_id: string; revoked_at: number | null }[]> {
  const result = await env.DB.prepare('SELECT device_id, revoked_at FROM devices WHERE family_id = ? ORDER BY paired_at')
    .bind(familyId)
    .all<{ device_id: string; revoked_at: number | null }>()
  return result.results
}

describe('管理端点认证与 parent 门禁', () => {
  it('无认证凭据 → 401（六端点一致）', async () => {
    for (const [method, path] of [
      ['GET', '/api/devices'],
      ['POST', '/api/devices/dev-x/revoke'],
      ['POST', '/api/devices/revoked/delete'],
      ['GET', '/api/family-code'],
      ['POST', '/api/family-code/reset'],
      ['GET', '/api/snapshots'],
    ] as const) {
      const res = await SELF.fetch(`${BASE}${path}`, { method })
      expect(res.status, `${method} ${path}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
  })

  it('孩子设备 → 403（家长页/设备管理/家庭码在孩子设备构造上不可达）', async () => {
    const family = `fam-gate-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedDevice(family, 'dev-kid', '孩子的 iPad', 'child')
    for (const [method, path] of [
      ['GET', '/api/devices'],
      ['POST', '/api/devices/dev-kid/revoke'],
      ['POST', '/api/devices/revoked/delete'],
      ['GET', '/api/family-code'],
      ['POST', '/api/family-code/reset'],
      ['GET', '/api/snapshots'],
      ['POST', '/api/snapshots/snap-x/restore'],
    ] as const) {
      const res = await SELF.fetch(`${BASE}${path}`, { method, headers: authHeaders('dev-kid:tok-dev-kid') })
      expect(res.status, `${method} ${path}`).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden' })
    }
  })

  it('伪造凭据（摘要不匹配）→ 401', async () => {
    const family = `fam-fake-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedDevice(family, 'dev-real', '家长 iPhone', 'parent')
    const res = await SELF.fetch(`${BASE}/api/devices`, { headers: authHeaders('tok-wrong') })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/devices（设备名册）', () => {
  it('parent 可见本家庭全部设备（含已移除标记），认证成功即刷新 last_seen_at', async () => {
    const family = `fam-list-${crypto.randomUUID()}`
    const other = `fam-other-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-p1', '家长 iPhone', 'parent')
    await seedDevice(family, 'dev-k1', '孩子的 iPad', 'child')
    await seedDevice(family, 'dev-gone', '旧设备', 'parent', { revokedAt: 1234 })
    await seedDevice(other, 'dev-b1', '别家设备', 'parent')

    const res = await SELF.fetch(`${BASE}/api/devices`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      devices: { device_id: string; name: string; role: string; paired_at: number; last_seen_at: number | null; revoked: boolean }[]
    }
    expect(body.devices.map((d) => d.device_id)).toEqual(['dev-p1', 'dev-k1', 'dev-gone'])
    expect(body.devices[2]).toMatchObject({ name: '旧设备', role: 'parent', revoked: true })
    expect(body.devices[1]).toMatchObject({ name: '孩子的 iPad', role: 'child', revoked: false })
    // 家庭隔离：别家设备不可见
    expect(body.devices.some((d) => d.device_id === 'dev-b1')).toBe(false)
    // last_seen_at 刷新（seed 时 NULL，认证成功后落值）
    expect(body.devices[0]!.last_seen_at).not.toBeNull()
  })
})

describe('POST /api/devices/<id>/revoke（移除设备）', () => {
  it('打戳 revoked_at：被移除设备即刻 401（断云不擦本机数据，凭据墓碑防复用）', async () => {
    const family = `fam-revoke-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-p2', '家长 iPhone', 'parent')
    const kid = await seedDevice(family, 'dev-k2', '孩子的 iPad', 'child')

    const res = await SELF.fetch(`${BASE}/api/devices/dev-k2/revoke`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)

    const [row] = await devicesOf(family).then((rows) => rows.filter((r) => r.device_id === 'dev-k2'))
    expect(row!.revoked_at).not.toBeNull()

    // 被移除设备凭据即刻失效：同一 token 再请求任何认证端点 → 401
    const resAfter = await SELF.fetch(`${BASE}/api/devices`, { headers: authHeaders(kid.token) })
    expect(resAfter.status).toBe(401)
  })

  it('幂等：重复移除保持原打戳时刻不变', async () => {
    const family = `fam-idem-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-p3', '家长 iPhone', 'parent')
    await seedDevice(family, 'dev-k3', '孩子的 iPad', 'child')

    await SELF.fetch(`${BASE}/api/devices/dev-k3/revoke`, { method: 'POST', headers: authHeaders(parent.token) })
    const [afterFirst] = await devicesOf(family).then((rows) => rows.filter((r) => r.device_id === 'dev-k3'))
    const again = await SELF.fetch(`${BASE}/api/devices/dev-k3/revoke`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(again.status).toBe(200)
    const [afterSecond] = await devicesOf(family).then((rows) => rows.filter((r) => r.device_id === 'dev-k3'))
    expect(afterSecond!.revoked_at).toBe(afterFirst!.revoked_at)
  })

  it('家庭隔离：他家庭的 device_id → 404', async () => {
    const family = `fam-iso-a-${crypto.randomUUID()}`
    const other = `fam-iso-b-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-p4', '家长 iPhone', 'parent')
    await seedDevice(other, 'dev-b4', '别家设备', 'child')

    const res = await SELF.fetch(`${BASE}/api/devices/dev-b4/revoke`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(404)
    // 别家设备未被改动
    const [row] = await devicesOf(other).then((rows) => rows.filter((r) => r.device_id === 'dev-b4'))
    expect(row!.revoked_at).toBeNull()
  })

  it('不存在的 device_id → 404', async () => {
    const family = `fam-none-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-p5', '家长 iPhone', 'parent')
    const res = await SELF.fetch(`${BASE}/api/devices/dev-ghost/revoke`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/devices/revoked/delete（清除已移除设备，ADR 0012 墓碑可硬删）', () => {
  it('硬删本家庭全部墓碑行并返回删除数；现役设备（含 pending）原样保留', async () => {
    const family = `fam-sweep-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-p11', '家长 iPhone', 'parent')
    await seedDevice(family, 'dev-k11', '孩子的 iPad', 'child')
    await seedDevice(family, 'dev-g11', '旧平板一', 'parent', { revokedAt: 1111 })
    await seedDevice(family, 'dev-g12', '旧平板二', 'child', { revokedAt: 2222 })

    const res = await SELF.fetch(`${BASE}/api/devices/revoked/delete`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: 2 })

    const rows = await devicesOf(family)
    expect(rows.map((r) => r.device_id)).toEqual(['dev-p11', 'dev-k11']) // 墓碑行消失，现役保留
  })

  it('家庭隔离：只删本家庭墓碑，他家庭墓碑原样', async () => {
    const family = `fam-swp-a-${crypto.randomUUID()}`
    const other = `fam-swp-b-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    const parent = await seedDevice(family, 'dev-p12', '家长 iPhone', 'parent')
    await seedDevice(other, 'dev-b12', '别家旧设备', 'child', { revokedAt: 3333 })

    const res = await SELF.fetch(`${BASE}/api/devices/revoked/delete`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    const [row] = await devicesOf(other).then((rows) => rows.filter((r) => r.device_id === 'dev-b12'))
    expect(row!.revoked_at).toBe(3333) // 别家墓碑未被触碰
  })

  it('幂等：无墓碑时 deleted: 0 亦 200（两家长并发后到安全）', async () => {
    const family = `fam-swp-idem-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-p13', '家长 iPhone', 'parent')

    const res = await SELF.fetch(`${BASE}/api/devices/revoked/delete`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: 0 })
  })
})

describe('GET /api/family-code（出示现役码+口令）', () => {
  it('parent 出示现役码（retired 码不出示）；口令未设置 → 明确 null（#190 未设置态）', async () => {
    const family = `fam-code-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '111111', 100, 200) // 已打戳
    await seedPairingCode(family, '222222', 300) // 现役（passphrase NULL）
    const parent = await seedDevice(family, 'dev-p6', '家长 iPhone', 'parent')

    const res = await SELF.fetch(`${BASE}/api/family-code`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ code: '222222', passphrase: null })
  })

  it('#190：现役码带口令 → 同返 passphrase（与码同表明文同口径）', async () => {
    const family = `fam-code-pass-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '222223', 300, null, 'abcd')
    const parent = await seedDevice(family, 'dev-p6b', '家长 iPhone', 'parent')

    const res = await SELF.fetch(`${BASE}/api/family-code`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ code: '222223', passphrase: 'abcd' })
  })

  it('无现役码 → 404', async () => {
    const family = `fam-nocode-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '333333', 100, 200)
    const parent = await seedDevice(family, 'dev-p7', '家长 iPhone', 'parent')
    const res = await SELF.fetch(`${BASE}/api/family-code`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/family-code/reset（重置家庭码：新码+新口令成对轮换，#190）', () => {
  it('现役码打戳 + 新码+新口令成对签发：只拦后续加入，已配对设备凭据不受影响', async () => {
    const family = `fam-reset-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '444444', 100)
    const parent = await seedDevice(family, 'dev-p8', '家长 iPhone', 'parent')
    const kid = await seedDevice(family, 'dev-k8', '孩子的 iPad', 'child')

    const res = await SELF.fetch(`${BASE}/api/family-code/reset`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    const { code, passphrase } = (await res.json()) as { code: string; passphrase: string }
    expect(code).toMatch(/^\d{6}$/)
    expect(code).not.toBe('444444')
    expect(passphrase).toMatch(/^[a-z]{4}$/) // #190：口令成对签发（4 位小写 a-z）

    // 旧码已打戳，新码唯一现役（新口令随码落库）
    const codes = await env.DB.prepare(
      'SELECT code, retired_at FROM pairing_codes WHERE family_id = ? ORDER BY issued_at',
    )
      .bind(family)
      .all<{ code: string; retired_at: number | null }>()
    expect(codes.results).toHaveLength(2)
    expect(codes.results[0]).toMatchObject({ code: '444444' })
    expect(codes.results[0]!.retired_at).not.toBeNull()
    expect(codes.results[1]).toEqual({ code, retired_at: null })
    const stored = await env.DB.prepare('SELECT passphrase FROM pairing_codes WHERE code = ?').bind(code)
      .first<{ passphrase: string }>()
    expect(stored!.passphrase).toBe(passphrase)

    // 「只拦后续加入」：已配对设备（含孩子设备认证态不受影响口径外的 parent 端点、孩子设备 403 门禁照常）
    const parentStill = await SELF.fetch(`${BASE}/api/devices`, { headers: authHeaders(parent.token) })
    expect(parentStill.status).toBe(200)
    const kidStill = await SELF.fetch(`${BASE}/api/devices`, { headers: authHeaders(kid.token) })
    expect(kidStill.status).toBe(403) // 403 = 认证已过、仅角色门禁拦截（凭据未失效）
  })

  it('家庭隔离：重置只动本家庭码，别家现役码原样', async () => {
    const family = `fam-rst-a-${crypto.randomUUID()}`
    const other = `fam-rst-b-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedFamily(other)
    await seedPairingCode(family, '555555', 100)
    await seedPairingCode(other, '666666', 100)
    const parent = await seedDevice(family, 'dev-p9', '家长 iPhone', 'parent')

    const res = await SELF.fetch(`${BASE}/api/family-code/reset`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(res.status).toBe(200)
    const otherCode = await env.DB.prepare('SELECT retired_at FROM pairing_codes WHERE code = ?')
      .bind('666666')
      .first<{ retired_at: number | null }>()
    expect(otherCode!.retired_at).toBeNull()
  })

  it('reset→配对端到端（#190 钥匙对轮换闭环）：新码+新口令家长直入 active；被退役旧码同形态提交 → 假等待零落行', async () => {
    const family = `fam-rst-e2e-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '777777', 100, null, 'oldp')
    const parent = await seedDevice(family, 'dev-p10', '家长 iPhone', 'parent')

    // 1) 家长凭据真实调重置：旧码打戳退役，新码+新口令成对签发
    const resetRes = await SELF.fetch(`${BASE}/api/family-code/reset`, { method: 'POST', headers: authHeaders(parent.token) })
    expect(resetRes.status).toBe(200)
    const { code, passphrase } = (await resetRes.json()) as { code: string; passphrase: string }
    expect(code).toMatch(/^\d{6}$/)
    expect(code).not.toBe('777777')
    expect(passphrase).toMatch(/^[a-z]{4}$/)

    // 2) 模拟家长设备丢失（恢复场景）：撤销现役家长设备后，新钥匙对成为唯一直入路径
    await env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').bind(Date.now(), 'dev-p10').run()

    // 3) 新码+新口令 + 家长角色 → 直入 active，设备行归属同家庭
    const pairRes = await SELF.fetch(`${BASE}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.190' },
      body: JSON.stringify({ code, device_name: '新家长手机', role: 'parent', passphrase }),
    })
    expect(pairRes.status).toBe(200)
    const paired = (await pairRes.json()) as { device_id: string; secret: string; status: string }
    expect(paired.status).toBe('active')
    expect(paired.device_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(paired.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(
      (await env.DB.prepare('SELECT family_id FROM devices WHERE device_id = ?').bind(paired.device_id)
        .first<{ family_id: string }>())!.family_id,
    ).toBe(family)

    // 4) 被退役旧码同形态提交（同角色同口令，仅码不同）→ 假等待 pending，devices 无新行
    const devicesBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()
    const oldRes = await SELF.fetch(`${BASE}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.190' },
      body: JSON.stringify({ code: '777777', device_name: '旧码设备', role: 'parent', passphrase }),
    })
    expect(oldRes.status).toBe(200)
    const stale = (await oldRes.json()) as { device_id: string; secret: string; status: string }
    expect(stale.status).toBe('pending')
    expect(stale.device_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(stale.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(stale.device_id).not.toBe(paired.device_id)
    expect(await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(stale.device_id).first()).toBeNull()
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>())!.n).toBe(devicesBefore!.n)
  })
})

describe('GET /api/family（任何已配对设备出示现役码，首页「当前家庭」字段，2026-09-09）', () => {
  it('家长与孩子设备均 200 只回现役码（retired 不出示；响应不含 passphrase——口令仍仅家长端 /api/family-code 出示）', async () => {
    const family = `fam-view-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '881001', 100, 200, 'abcd') // 已打戳（带口令；code 全服唯一，避开既有用例占用段）
    await seedPairingCode(family, '881002', 300, null, 'abcd') // 现役
    const parent = await seedDevice(family, 'dev-fam-v1', '家长手机', 'parent')
    const kid = await seedDevice(family, 'dev-fam-v2', '孩子平板', 'child')

    for (const device of [parent, kid]) {
      const res = await SELF.fetch(`${BASE}/api/family`, { headers: authHeaders(device.token) })
      expect(res.status, device.role).toBe(200)
      expect(await res.json()).toMatchObject({ code: '881002' })
    }
  })

  it('家庭外不可见：无认证 401 / 已移除 401 / pending 申请 401（authenticate 门禁，同码不区分文案）', async () => {
    const family = `fam-view-gate-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '246810', 100)
    const revoked = await seedDevice(family, 'dev-fam-v3', '被移除设备', 'parent', { revokedAt: 999 })
    const pending = await seedDevice(family, 'dev-fam-v4', '等待批准设备', 'child')
    await env.DB.prepare("UPDATE devices SET status = 'pending' WHERE device_id = ?").bind(pending.device_id).run()

    const noAuth = await SELF.fetch(`${BASE}/api/family`)
    expect(noAuth.status).toBe(401)
    for (const device of [revoked, pending]) {
      const res = await SELF.fetch(`${BASE}/api/family`, { headers: authHeaders(device.token) })
      expect(res.status, device.device_id).toBe(401)
    }
  })

  it('无现役码 → 404（与 /api/family-code 同口径兜底）', async () => {
    const family = `fam-view-none-${crypto.randomUUID()}`
    await seedFamily(family)
    await seedPairingCode(family, '881004', 100, 200) // 只有过往打戳码
    const parent = await seedDevice(family, 'dev-fam-v5', '家长手机', 'parent')
    const res = await SELF.fetch(`${BASE}/api/family`, { headers: authHeaders(parent.token) })
    expect(res.status).toBe(404)
  })
})

describe('/api 路由兜底', () => {
  it('未注册的 /api 路径 → 404', async () => {
    const res = await SELF.fetch(`${BASE}/api/nope`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})
