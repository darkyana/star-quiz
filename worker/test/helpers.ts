// 测试造数助手（票 #124）：直插 ADR 0005 定稿表结构，凭据摘要与生产同口径（SHA-256）。
import { SELF, env } from 'cloudflare:test'
import { expect } from 'vitest'
import { sha256Hex } from '../src/auth'

export interface SeededDevice {
  device_id: string
  family_id: string
  role: 'parent' | 'child'
  token: string
}

let pairedAtSeq = 1_000

export async function seedFamily(familyId: string): Promise<void> {
  await env.DB.prepare('INSERT INTO families (family_id, created_at) VALUES (?, ?)')
    .bind(familyId, 1)
    .run()
}

export async function seedDevice(
  familyId: string,
  deviceId: string,
  name: string,
  role: 'parent' | 'child',
  options: { revokedAt?: number } = {},
): Promise<SeededDevice> {
  // 统一凭据协议（#123）：Bearer <device_id>:<secret>，库存摘要只哈希 secret 部分
  const secret = `tok-${deviceId}`
  const token = `${deviceId}:${secret}`
  await env.DB.prepare(
    'INSERT INTO devices (device_id, family_id, name, role, credential_hash, paired_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
  )
    .bind(deviceId, familyId, name, role, await sha256Hex(secret), pairedAtSeq++, options.revokedAt ?? null)
    .run()
  return { device_id: deviceId, family_id: familyId, role, token }
}

export async function seedPairingCode(
  familyId: string,
  code: string,
  issuedAt: number,
  retiredAt: number | null = null,
  passphrase: string | null = null,
): Promise<void> {
  await env.DB.prepare('INSERT INTO pairing_codes (code, family_id, issued_at, retired_at, passphrase) VALUES (?, ?, ?, ?, ?)')
    .bind(code, familyId, issuedAt, retiredAt, passphrase)
    .run()
}

/** #190 发码制（ADR 0007）：直插现役码+口令（模拟运营方建家成对签发）——双因子直入用例的确定性前置 */
export async function seedActiveCode(code: string, passphrase: string): Promise<void> {
  const familyId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO families (family_id, created_at) VALUES (?, ?)').bind(familyId, Date.now()),
    env.DB.prepare('INSERT INTO pairing_codes (code, family_id, issued_at, passphrase) VALUES (?, ?, ?, ?)')
      .bind(code, familyId, Date.now(), passphrase),
  ])
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

/** scheduled 直调用的 controller / ctx mock（vitest-pool-workers 内不跑真 Cron）；仅实现被用到的成员 */
export function mockScheduledTrigger(scheduledTime: number): { controller: ScheduledController; ctx: ExecutionContext } {
  return {
    controller: { cron: '0 20 * * *', scheduledTime, noRetry: () => {} } as ScheduledController,
    ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
  }
}

/** 通过公开同步/快照端点观察设备结果；认证与家庭准备只在此处维护。 */
export type SyncTestRows = Record<string, Record<string, unknown>[]>
export async function createSyncClient(family = crypto.randomUUID(), existing = false) {
  if (!existing) await seedFamily(family)
  const device = await seedDevice(family, crypto.randomUUID(), '设备', 'parent')
  const headers = { ...authHeaders(device.token), 'content-type': 'application/json' }
  return {
    family,
    push: (rows: SyncTestRows) => SELF.fetch('http://example.com/api/sync/push', { method: 'POST', headers, body: JSON.stringify(rows) }),
    restore: (id: string) => SELF.fetch('http://example.com/api/snapshots/' + id + '/restore', { method: 'POST', headers }),
    async snapshotId() {
      const res = await SELF.fetch('http://example.com/api/snapshots', { headers })
      const body = await res.json<{ snapshots: { snapshot_id: string }[] }>()
      return body.snapshots[0].snapshot_id
    },
    async pull(since = 0): Promise<SyncTestRows> {
      const res = await SELF.fetch('http://example.com/api/sync/pull?since=' + since, { headers })
      expect(res.status).toBe(200)
      return res.json()
    },
  }
}
