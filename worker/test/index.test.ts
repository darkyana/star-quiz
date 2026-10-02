import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { seedActiveCode } from './helpers'

// 骨架单测（票 #119）：healthz / readyz / CORS / D1 迁移幂等——不测任何同步业务语义。
const ALLOWED = 'https://starquiz.link' // 与 wrangler.jsonc vars 一致（#120 主站迁裸域）
const DENIED = 'https://evil.example'

describe('GET /healthz', () => {
  it('静态存活检查：200 + { ok: true }（不触 D1）', async () => {
    const res = await SELF.fetch('http://example.com/healthz')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('非 GET 方法 → 405', async () => {
    const res = await SELF.fetch('http://example.com/healthz', { method: 'POST' })
    expect(res.status).toBe(405)
  })
})

describe('GET /readyz', () => {
  it('对 D1 SELECT 1 通过（绑定与迁移就绪）→ 200 + { ok: true }', async () => {
    const res = await SELF.fetch('http://example.com/readyz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('迁移已应用：ADR 0005 基础表与 morale / entry_visibility 新域及独立匿名计数共 15 表全部建齐', async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all<{ name: string }>()
    // 排除 SQLite 内部表（sqlite_*）、D1 迁移账本（d1_migrations）与 D1 内部元数据（_cf_*）
    const names = result.results
      .map((row) => row.name)
      .filter((name) => !name.startsWith('sqlite_') && name !== 'd1_migrations' && !name.startsWith('_cf_'))
      .sort()
    expect(names).toEqual([
      'active_redemptions',
      'devices',
      'entry_visibility',
      'families',
      'family_snapshots',
      'morale',
      'onboarding_daily_counts',
      'pairing_codes',
      'proposals',
      'question_banks',
      'question_flags',
      'question_results',
      'reward_items',
      'star_entries',
      'word_appearances',
    ])
  })
})

describe('CORS（允许源 = env.ALLOWED_ORIGIN）', () => {
  it('允许源请求 → 响应回显 access-control-allow-origin', async () => {
    const res = await SELF.fetch('http://example.com/healthz', { headers: { origin: ALLOWED } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('非允许源 → 403 不放行，且无 CORS 头', async () => {
    const res = await SELF.fetch('http://example.com/healthz', { headers: { origin: DENIED } })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('OPTIONS 预检（允许源）→ 204 + Allow-Methods / Allow-Headers / Max-Age', async () => {
    const res = await SELF.fetch('http://example.com/healthz', {
      method: 'OPTIONS',
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
    expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type')
    expect(res.headers.get('access-control-max-age')).not.toBeNull()
  })

  it('OPTIONS 预检（非允许源）→ 403', async () => {
    const res = await SELF.fetch('http://example.com/healthz', {
      method: 'OPTIONS',
      headers: { origin: DENIED },
    })
    expect(res.status).toBe(403)
  })

  it('无 Origin（curl / 健康探测）→ 正常放行且无 CORS 头', async () => {
    const res = await SELF.fetch('http://example.com/readyz')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('D1 迁移（ADR 0005 定稿）', () => {
  it('迁移可重复应用（幂等）：applyD1Migrations 二次调用零变更 + SQL 重放仅容忍 ALTER 的 duplicate column', async () => {
    const { applyD1Migrations } = await import('cloudflare:test')
    // 迁移账本幂等：已应用 → 跳过（幂等性的权威保证）
    await applyD1Migrations(env.DB, env.D1_MIGRATIONS)
    // SQL 本体重放：0001 全语句 IF NOT EXISTS 可裸重放；0002 的 ALTER TABLE ADD COLUMN 在 SQLite
    // 无幂等形态，裸重放必 duplicate column——除这一类错误外任何重放报错都算失败（#142 口径适配）
    // 0003 起重建表不可裸重放（会丢孩子维度），幂等只由迁移账本保证。
    for (const migration of env.D1_MIGRATIONS.slice(0, 2)) {
      for (const query of migration.queries) {
        try {
          await env.DB.prepare(query).run()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          expect(message, `重放仅允许 duplicate column 错误，实际语句：${query}`).toContain('duplicate column')
        }
      }
    }
    const res = await SELF.fetch('http://example.com/readyz')
    expect(res.status).toBe(200)
  })

  it('迁移 0002：devices.status 列存在且默认 active，CHECK 约束拒绝非法值', async () => {
    // 既有口径回归：新列对既有查询无感（默认 active）
    const col = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('devices') WHERE name = 'status'",
    ).first<{ name: string }>()
    expect(col?.name).toBe('status')

    await env.DB.prepare('INSERT INTO families (family_id, created_at) VALUES (?, ?)').bind('f-mig-2', 1).run()
    const insertBad = env.DB.prepare(
      "INSERT INTO devices (device_id, family_id, name, role, credential_hash, paired_at, status) VALUES ('d-bad', 'f-mig-2', 'x', 'child', 'h', 1, 'ghost')",
    ).run()
    await expect(insertBad).rejects.toThrow()
  })
})

describe('路由兜底', () => {
  it('未知路径 → 404', async () => {
    const res = await SELF.fetch('http://example.com/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})

// ===== #142（R-129a）：申请状态轮询端点挂载与 pending 凭据 auth 门禁 =====

const PAIR_URL = 'http://example.com/api/pair'
const STATUS_URL = 'http://example.com/api/pair/status'

/** 随机 6 位数字码（家庭码格式，避免测试间撞码） */
function randomCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000))
}

/** 随机 IP（防爆破全提交计数在 isolate 内存跨测试持续，隔离计数维度） */
function randomIp(): string {
  return `198.51.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
}

/** 走真实 /api/pair 申请：返回响应体（200 契约：device_id / secret / status / server_at；passphrase 仅直入判定消费） */
async function applyPair(code: string, name: string, role: 'parent' | 'child', passphrase?: string): Promise<{
  device_id: string
  secret: string
  status: 'pending' | 'active'
}> {
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

/** #190 发码制建家前置：直插现役码+口令（运营方签发）→ 家长双因子直入（返回直入凭据） */
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

/** 造一个「真 pending 凭据」：家长直入建家 → 孩子凭同码申请（场景 B） */
async function seedPendingCredential(): Promise<{ device_id: string; secret: string }> {
  const { code } = await establishFamily()
  const child = await applyPair(code, '孩子平板', 'child')
  expect(child.status).toBe('pending')
  return { device_id: child.device_id, secret: child.secret }
}

describe('GET /api/pair/status（#142 申请状态轮询，盲口径）', () => {
  it('无凭据 / 未知 device_id / 坏 secret → 一律 200 pending（查无此行与真 pending 同构，共识 8）', async () => {
    const headerCases: Array<Record<string, string>> = [
      {},
      { authorization: 'Bearer 00000000-0000-0000-0000-000000000000:deadbeef' },
      { authorization: 'Bearer not-a-token' },
    ]
    for (const headers of headerCases) {
      const res = await SELF.fetch(STATUS_URL, { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; server_at: number }
      expect(body.status).toBe('pending')
      expect(body.server_at).toBeGreaterThan(0)
    }
  })

  it('真 pending 凭据 → 200 pending；行翻 active（模拟 #143 批准）后 → 200 active', async () => {
    const cred = await seedPendingCredential()
    const headers = { authorization: `Bearer ${cred.device_id}:${cred.secret}` }

    const pendingRes = await SELF.fetch(STATUS_URL, { headers })
    expect(pendingRes.status).toBe(200)
    expect(((await pendingRes.json()) as { status: string }).status).toBe('pending')

    await env.DB.prepare("UPDATE devices SET status = 'active' WHERE device_id = ?").bind(cred.device_id).run()
    const activeRes = await SELF.fetch(STATUS_URL, { headers })
    expect(activeRes.status).toBe(200)
    expect(((await activeRes.json()) as { status: string }).status).toBe('active')
  })

  it('pending 轮询不刷 last_seen_at（共识 15：轮询不是业务活动）', async () => {
    const cred = await seedPendingCredential()
    await env.DB.prepare('UPDATE devices SET last_seen_at = 12345 WHERE device_id = ?').bind(cred.device_id).run()
    await SELF.fetch(STATUS_URL, { headers: { authorization: `Bearer ${cred.device_id}:${cred.secret}` } })
    const row = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE device_id = ?').bind(cred.device_id)
      .first<{ last_seen_at: number }>()
    expect(row?.last_seen_at).toBe(12345)
  })

  it('非 GET 方法 → 405', async () => {
    const res = await SELF.fetch(STATUS_URL, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'method not allowed' })
  })
})

describe('pending 凭据 auth 门禁（#142：业务端点全拒，仅状态轮询可达）', () => {
  it('pending 凭据访问 /api/sync/pull 与 /api/devices → 401；/api/pair/status → 200 pending', async () => {
    const cred = await seedPendingCredential()
    const headers = { authorization: `Bearer ${cred.device_id}:${cred.secret}` }

    const pull = await SELF.fetch('http://example.com/api/sync/pull?since=0', { headers })
    expect(pull.status).toBe(401)
    expect(await pull.json()).toEqual({ error: 'unauthorized' })

    const devices = await SELF.fetch('http://example.com/api/devices', { headers })
    expect(devices.status).toBe(401)
    expect(await devices.json()).toEqual({ error: 'unauthorized' })

    const status = await SELF.fetch(STATUS_URL, { headers })
    expect(status.status).toBe(200)
    expect(((await status.json()) as { status: string }).status).toBe('pending')
  })

  it('active 凭据业务端点照常可达（既有行为回归）', async () => {
    const parent = await establishFamily()
    expect(parent.cred.status).toBe('active')
    const pull = await SELF.fetch('http://example.com/api/sync/pull?since=0', {
      headers: { authorization: `Bearer ${parent.cred.device_id}:${parent.cred.secret}` },
    })
    expect(pull.status).toBe(200)
  })
})
