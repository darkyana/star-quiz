import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { authHeaders, seedDevice, seedFamily, seedPairingCode } from './helpers'

// 公共约定护栏（票 #254）：防三样手抄回潮——
// 1. 「错方法一律 405」：历史上管理/快照类端点把方法检查并进路由条件、错方法落兜底 404，收口后逐端点锁定；
// 2. 「成功响应一律带 server_at」（http.ts okResponse 约定）：遍历全部 /api 成功端点断言；
// 3. 家长门禁归一（auth.ts requireParent）：快照端点鉴权不回归（未配对 401 / 孩子 403 / 家长放行）。

const BASE = 'http://example.com'

function randomIp(): string {
  return `198.51.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
}

describe('方法错误一律 405（收口前落 404 的漂移端点逐端点锁定，无凭据即达方法检查）', () => {
  it.each([
    ['POST', '/api/devices'],
    ['POST', '/api/devices/pending'],
    ['GET', '/api/devices/dev-x/revoke'],
    ['GET', '/api/devices/revoked/delete'],
    ['POST', '/api/family'],
    ['POST', '/api/family-code'],
    ['GET', '/api/family-code/reset'],
    ['POST', '/api/snapshots'],
    ['GET', '/api/snapshots/snap-x/restore'],
  ] as const)('%s %s → 405', async (method, path) => {
    const res = await SELF.fetch(`${BASE}${path}`, { method })
    expect(res.status, `${method} ${path}`).toBe(405)
    expect(await res.json()).toEqual({ error: 'method not allowed' })
  })
})

describe('全部 /api 成功响应统一携带 server_at（okResponse 约定护栏，防手抄 jsonResponse 回潮）', () => {
  it('端点清单式遍历：16 个 /api 成功响应均带数值型 server_at', async () => {
    // 前置：一个家庭（家长 + 孩子 + 两条待批准申请 + 现役码 + 一条可回滚快照）
    const family = `fam-conv-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-conv-p', '家长手机', 'parent')
    await seedDevice(family, 'dev-conv-k', '孩子平板', 'child')
    for (const id of ['dev-conv-a1', 'dev-conv-a2']) {
      await seedDevice(family, id, '等待中的申请', 'child')
      await env.DB.prepare("UPDATE devices SET status = 'pending' WHERE device_id = ?").bind(id).run()
    }
    await seedPairingCode(family, '990101', 100)
    const snapshotId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
      .bind(family, snapshotId, 1000, JSON.stringify({ schema_version: 1, family_id: family, taken_at: 1000, tables: {} }))
      .run()

    const parentHeaders = { ...authHeaders(parent.token), 'content-type': 'application/json' }
    const requests: Array<[string, string, Record<string, string> | undefined, string | undefined]> = [
      ['POST', '/api/pair', { 'content-type': 'application/json', 'cf-connecting-ip': randomIp() }, JSON.stringify({ code: '123456', device_name: '护栏', role: 'child' })],
      ['GET', '/api/pair/status', undefined, undefined],
      ['POST', '/api/sync/push', parentHeaders, '{}'],
      ['GET', '/api/sync/pull?since=0', authHeaders(parent.token), undefined],
      ['GET', '/api/sync/capabilities', authHeaders(parent.token), undefined],
      ['GET', '/api/devices', authHeaders(parent.token), undefined],
      ['GET', '/api/devices/pending', authHeaders(parent.token), undefined],
      ['POST', '/api/devices/dev-conv-a1/approve', authHeaders(parent.token), undefined],
      ['POST', '/api/devices/dev-conv-a2/reject', authHeaders(parent.token), undefined],
      ['POST', '/api/devices/dev-conv-k/revoke', authHeaders(parent.token), undefined],
      ['POST', '/api/devices/revoked/delete', authHeaders(parent.token), undefined],
      ['GET', '/api/family', authHeaders(parent.token), undefined],
      ['GET', '/api/family-code', authHeaders(parent.token), undefined],
      ['POST', '/api/family-code/reset', authHeaders(parent.token), undefined],
      ['GET', '/api/snapshots', authHeaders(parent.token), undefined],
      ['POST', `/api/snapshots/${snapshotId}/restore`, authHeaders(parent.token), undefined],
    ]

    for (const [method, path, headers, body] of requests) {
      const res = await SELF.fetch(`${BASE}${path}`, { method, headers, body })
      expect(res.status, `${method} ${path}`).toBe(200)
      const parsed = (await res.json()) as { server_at?: unknown }
      expect(typeof parsed.server_at, `${method} ${path} 成功响应应带 server_at`).toBe('number')
      expect((parsed.server_at as number)).toBeGreaterThan(0)
    }
  })
})

describe('家长门禁归一（auth.ts requireParent）后快照端点鉴权不回归', () => {
  it('GET /api/snapshots：未配对 401 / 孩子 403 / 家长放行 200', async () => {
    const family = `fam-conv-g-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-conv-gp', '家长手机', 'parent')
    const kid = await seedDevice(family, 'dev-conv-gk', '孩子平板', 'child')

    const noAuth = await SELF.fetch(`${BASE}/api/snapshots`)
    expect(noAuth.status).toBe(401)
    expect(await noAuth.json()).toEqual({ error: 'unauthorized' })

    const asKid = await SELF.fetch(`${BASE}/api/snapshots`, { headers: authHeaders(kid.token) })
    expect(asKid.status).toBe(403)
    expect(await asKid.json()).toEqual({ error: 'forbidden' })

    const asParent = await SELF.fetch(`${BASE}/api/snapshots`, { headers: authHeaders(parent.token) })
    expect(asParent.status).toBe(200)
  })

  it('POST /api/snapshots/<id>/restore：未配对 401 / 孩子 403 / 家长放行（快照存在则 200）', async () => {
    const family = `fam-conv-r-${crypto.randomUUID()}`
    await seedFamily(family)
    const parent = await seedDevice(family, 'dev-conv-rp', '家长手机', 'parent')
    const kid = await seedDevice(family, 'dev-conv-rk', '孩子平板', 'child')
    const snapshotId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)')
      .bind(family, snapshotId, 1000, JSON.stringify({ schema_version: 1, family_id: family, taken_at: 1000, tables: {} }))
      .run()

    const noAuth = await SELF.fetch(`${BASE}/api/snapshots/${snapshotId}/restore`, { method: 'POST' })
    expect(noAuth.status).toBe(401)
    expect(await noAuth.json()).toEqual({ error: 'unauthorized' })

    const asKid = await SELF.fetch(`${BASE}/api/snapshots/${snapshotId}/restore`, {
      method: 'POST',
      headers: authHeaders(kid.token),
    })
    expect(asKid.status).toBe(403)
    expect(await asKid.json()).toEqual({ error: 'forbidden' })

    const asParent = await SELF.fetch(`${BASE}/api/snapshots/${snapshotId}/restore`, {
      method: 'POST',
      headers: authHeaders(parent.token),
    })
    expect(asParent.status).toBe(200)
  })
})
