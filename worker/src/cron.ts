// 每日快照 Cron（票 #124，ADR 0002「误操作的后悔药」/ ADR 0005 保留窗口 ×30 天）：
// 对每个家庭读取同步域全域当前态（batch 单事务一致视图）拼 JSON 落 family_snapshots，
// 同批 DELETE 30 天窗口外旧快照。schedule 见 wrangler.jsonc triggers.crons。
import { stateSelects, SNAPSHOT_RETENTION_MS, SYNC_TABLE_NAMES, type SnapshotContent } from './snapshot'
import type { Env } from './env'
import { oldestMetricsDay } from '../../shared/onboarding-metrics'

/** Cron Triggers 入口（测试直接调用导出的 scheduled，不跑 wrangler dev） */
export async function scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  const now = controller.scheduledTime
  const cutoff = now - SNAPSHOT_RETENTION_MS
  // Global anonymous totals are independent of families (including an empty installation).
  try {
    await env.DB.prepare('DELETE FROM onboarding_daily_counts WHERE day < ?').bind(oldestMetricsDay(now)).run()
  } catch {
    // Best-effort metrics must not suppress existing family backups. No raw error logging.
    // The next daily run retries cleanup; exports independently enforce the 90-date window.
  }

  const families = await env.DB.prepare('SELECT family_id FROM families').all<{ family_id: string }>()
  for (const { family_id } of families.results) {
    // 读：单事务一致视图取全域当前态
    const reads = await env.DB.batch(stateSelects(env.DB, family_id))
    const tables = {} as SnapshotContent['tables']
    for (const [index, table] of SYNC_TABLE_NAMES.entries()) {
      tables[table] = (reads[index]!.results as Record<string, unknown>[]) ?? []
    }
    const content: SnapshotContent = {
      schema_version: 1,
      family_id,
      taken_at: now,
      tables,
    }

    // 写：快照落库 + 窗口外清理同批原子（snapshot_id 全表唯一由 UUID 承载）
    await env.DB.batch([
      env.DB.prepare('INSERT INTO family_snapshots (family_id, snapshot_id, taken_at, content) VALUES (?, ?, ?, ?)').bind(
        family_id,
        crypto.randomUUID(),
        now,
        JSON.stringify(content),
      ),
      env.DB.prepare('DELETE FROM family_snapshots WHERE family_id = ? AND taken_at < ?').bind(family_id, cutoff),
    ])
  }
}
