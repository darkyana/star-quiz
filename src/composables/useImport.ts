// 导入编排模块（架构评审 20260829 候选 2，与 useExport 对称）：管「校验 + 落库」两段，
// 页面只保留浏览器交互（读文件、弹二次确认、提示显示）。术语见 CONTEXT.md（学习文件 / 经济文件 / 追加导入）。
// 校验段转接 utils/importExport 契约层纯函数（语义归口，校验规则仍单点在契约层）；
// 落库段收口三条铁律：原子拒绝（校验 / 追加溢出失败零写入）、覆盖 / 追加双模式显式选择（R21 / B12，无默认无预选）、
// 追加只增量题库（R36 REQ-R36-4：红旗 / 答题记录 / 兑换项一律不动）；覆盖 = 三键整体替换。
// #170 落库全部改走 useDataInfra commit 多键原子捆（捆前值哨兵留存，中途被杀启动回滚），
// 不再逐键裸循环写；沿既有存储口径直写 localStorage（F5：不得抽象适配层）。

import type { LearningExport, EconomyExport } from '../types'
import {
  validateLearningImport,
  validateEconomyImport,
  validateLearningPasteImport,
  type ImportValidationCode,
} from '../utils/importExport'
import { mergeAppendQuestions } from '../utils/importMerge'
import { commit, recoverUnfinishedCommit, STORAGE_KEYS } from './useDataInfra'
import { questions, writeQuestions } from './useLearningData'
import { copy } from '../copy'

/** 学习文件导入模式（REQ-R21-1-1 双模式显式选择）：overwrite = 三键整体替换 / append = 只增量题库 */
export type LearningImportMode = 'overwrite' | 'append'

// ===== 校验段（转接契约层：字段级校验、原子拒绝、孤儿清理、版本断代白名单）=====

export { validateLearningImport, validateEconomyImport, validateLearningPasteImport }
export type { ImportValidationCode }

/**
 * #172 导入错误内部码（用户不可见）：
 * 文件坏 file-corrupt / 版本不支持 version-unsupported / 校验不过 invalid（三类出自契约层校验）
 * + 写失败 write-failed（落库段，#170 commit 原语回滚已恢复原状）。
 * #212 粘贴导入扩一档：no-json = 粘贴剥壳失败（仅粘贴导入产生）。
 * 前三类共用一档用户文案，写失败单列一档（票内 Desired behavior 原文），no-json 单列一档（#212 票面唯一新增反馈文案）。
 */
export type ImportErrorCode = ImportValidationCode | 'write-failed'

/** #172 两档用户文案映射（#212 起 no-json 扩第三档）：校验失败 → 「文件未通过检查…」；写失败 → 「已恢复原状…」；粘贴剥壳失败 → 「未在粘贴内容中找到有效 JSON」（copy.ts 单一事实源） */
export function importErrorText(code: ImportErrorCode): string {
  if (code === 'write-failed') return copy.parent.importFailWrite
  if (code === 'no-json') return copy.parent.importPasteNoJson
  return copy.parent.importFailChecked
}

/** #172 落库写失败统一收口：检出并回滚 #170 未完成写捆（同步恢复捆前值），返回写失败结果 */
function handleWriteFailure(cause: unknown): { ok: false; code: 'write-failed'; reason: string } {
  recoverUnfinishedCommit()
  const reason = cause instanceof Error ? cause.message : String(cause)
  console.warn(`[star-quiz] 导入落库写失败，已回滚到导入前状态（原因：${reason}）`)
  return { ok: false, code: 'write-failed', reason }
}

// ===== 落库段（#170 改走 commit 捆）=====

/**
 * 学习文件落库（R21 REQ-R21-2 / REQ-R21-3 + R36 REQ-R36-4）：
 * overwrite = 题池 / 红旗 / 逐题记录三键一个 commit 捆整体替换（questionResults 已由校验器做孤儿清理），不碰兑换项；
 * append = mergeAppendQuestions 重编号后只写题池（单键，无捆），红旗 / 答题记录 / 兑换项一律不动；
 * 追加溢出 → { ok: false, code, reason }（#172 归入校验不过档；整次原子拒绝、零写入）；
 * #172 写失败（如存储满）→ 捕获后经 recoverUnfinishedCommit 同步回滚，返回 write-failed（页面出写失败档文案）。
 */
export function applyLearningImport(
  data: LearningExport,
  mode: LearningImportMode,
): { ok: true } | { ok: false; code: ImportErrorCode; reason: string } {
  if (mode === 'overwrite') {
    try {
      commit([
        { key: STORAGE_KEYS.questions, value: data.questionPool },
        { key: STORAGE_KEYS.flagged, value: data.flagged },
        { key: STORAGE_KEYS.questionResults, value: data.questionResults },
      ])
      return { ok: true }
    } catch (cause) {
      return handleWriteFailure(cause)
    }
  }
  const merged = mergeAppendQuestions(questions(), data.questionPool)
  if (!merged.ok) return { ok: false, code: 'invalid', reason: merged.reason }
  try {
    writeQuestions(merged.data)
  } catch (cause) {
    return handleWriteFailure(cause)
  }
  return { ok: true }
}

/**
 * 经济文件落库（R36 REQ-R36-5 + R32 REQ-R32-8-4 + #75 R-72-3：覆盖式导入，无追加概念）：
 * 四键整体替换为文件值，按 #170 拆两捆——捆 A 兑换目录＋提议板、捆 B 星星流水＋进行中兑换。
 * #172 起返回结果：写失败（任一捆抛异常）→ 回滚进行中捆并返回 write-failed，页面出写失败档文案。
 */
export function applyEconomyImport(
  data: EconomyExport,
): { ok: true } | { ok: false; code: 'write-failed'; reason: string } {
  try {
    commit([
      { key: STORAGE_KEYS.rewards, value: data.rewards },
      { key: STORAGE_KEYS.proposals, value: data.proposals },
    ])
  } catch (cause) {
    return handleWriteFailure(cause)
  }
  try {
    commit([
      { key: STORAGE_KEYS.stars, value: data.starLedger },
      { key: STORAGE_KEYS.activeRedemptions, value: data.activeRedemptions },
    ])
  } catch (cause) {
    return handleWriteFailure(cause)
  }
  return { ok: true }
}
