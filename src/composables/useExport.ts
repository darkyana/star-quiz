// 导出流程（Spec REQ-2 / REQ-3 / REQ-4）：序列化 + 文件名 + Blob 下载 + writeLastExport
// 任一导出成功 → 写入本次 exportedAt（ISO 8601）到 sq_last_export；导入不写该键（§6 D6）。
// 文件名时间戳 = 本地时间（YYYYMMDD-HHmmss）；exportedAt = ISO 8601——同源不同格式。

import { buildLearningExport, buildEconomyExport, formatExportFilename } from '../utils/importExport'
import { writeLastExport } from './useDataInfra'
import { readDeviceCredential } from './useDeviceCredential'
import { questions, allFlagged as flagged, allQuestionResults as questionResults } from './useLearningData'
import { rewards, allLedger as ledger } from './useStarData'
import { allProposals as proposals } from './useProposals'
import { allRecords as activeRedemptions } from './useActiveRedemptions'

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 学习文件导出（R36 REQ-R36-1：题库 + 红旗 + 答题记录，LearningExport '2.0'）：返回写入 sq_last_export 的 exportedAt
 *  函数名沿用 downloadDataExport（数据管理入口导出动作未变；文件名前缀 star-quiz-learning-） */
export function downloadDataExport(now: Date = new Date()): string {
  const exportedAt = now.toISOString()
  downloadJson(
    formatExportFilename('learning', now),
    buildLearningExport(questions(), flagged(), questionResults(), exportedAt),
  )
  writeLastExport(exportedAt)
  return exportedAt
}

/** 经济文件导出（R36 REQ-R36-2 / R32 REQ-R32-8-1 / #75 R-72-3：兑换项 + 提议板全量 + 流水 + 进行中兑换，EconomyExport '2.2'）：返回写入 sq_last_export 的 exportedAt */
export function downloadLedgerExport(now: Date = new Date()): string {
  const exportedAt = now.toISOString()
  downloadJson(
    formatExportFilename('economy', now),
    buildEconomyExport(rewards(), proposals(), ledger(), activeRedemptions(), exportedAt),
  )
  writeLastExport(exportedAt)
  return exportedAt
}

/**
 * 迁移前全量备份动作（REQ-1.5）：学习 + 经济两文件各导出一次。
 * 注册者原为学习域 useLearningData，为剪除 useLearningData ⇄ useExport 循环依赖上移组合根
 * （main.ts 经 registerMigrationBackup 注入 useDataInfra 槽位，架构评审 20260829）；
 * 备份是兜底保险，单个下载失败不阻断迁移（data-migration.md 约束 3）。
 */
export function runMigrationBackup(): void {
  try {
    downloadDataExport()
  } catch (cause) {
    // #169 机器自用路径补日志：备份是兜底保险，失败不阻断迁移（data-migration.md 约束 3）
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 迁移前备份失败（学习文件，不阻断迁移，原因：${reason}）`)
  }
  try {
    downloadLedgerExport()
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 迁移前备份失败（经济文件，不阻断迁移，原因：${reason}）`)
  }
}

/**
 * #172 导入前自动备份联动（按配对状态分流）：
 * 未配对设备（无设备凭据键，数据无云端兜底）→ 导入确认前自动下载学习 + 经济两份全量备份文件；
 * 已配对设备 → 不弹文件（云端有兜底）。备份是兜底保险，单个下载失败不阻断导入（沿迁移前备份口径各留日志）。
 */
export function autoBackupBeforeImport(): void {
  if (readDeviceCredential() !== null) return
  try {
    downloadDataExport()
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 导入前自动备份失败（学习文件，不阻断导入，原因：${reason}）`)
  }
  try {
    downloadLedgerExport()
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 导入前自动备份失败（经济文件，不阻断导入，原因：${reason}）`)
  }
}
