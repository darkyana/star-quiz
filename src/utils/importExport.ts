// 导入导出纯函数（Spec §3.4 校验规则表 / §3.5 版本演进 / REQ-2；R36 导出契约 2.0 拆分）
// 序列化与校验均为纯函数：不触碰 localStorage、不触发下载（T4 useExport 负责 IO 侧）。
// 导入校验为原子拒绝（D4 扩展至兑换项 + E2）：任一字段非法 → 整文件拒绝，不写任何数据。

import type { Question, StarEntry, RewardItem, LearningExport, EconomyExport, FlaggedState, QuestionResultsState, ProposalRecord, ActiveRedemption, StarKind } from '../types'
import { DEFAULT_CHILD_ID, DEFAULT_QUESTION_CATEGORY, DEFAULT_QUESTION_BOOK, DEFAULT_STAR_KIND } from '../types'
import { isBuiltinTriviaId } from './questionBank'
import { copy } from '../copy'

type ValidationOk<T> = { ok: true; data: T }

/**
 * #172 校验失败内部错误码（用户不可见，供上层出两档文案）：
 * file-corrupt = 文件坏（JSON 解析失败 / 根不是对象）；version-unsupported = 版本不支持（含 1.x 断代）；invalid = 字段校验不过。
 * 写失败（write-failed）只发生在落库段（useImport），不在校验层出现。
 * #212 粘贴导入新增一档：no-json = 粘贴剥壳失败（无可剥内容，仅粘贴导入产生，文件导入不出此档）。
 */
export type ImportValidationCode = 'file-corrupt' | 'version-unsupported' | 'invalid' | 'no-json'

type ValidationFail = { ok: false; reason: string; code: ImportValidationCode }
type Validation<T> = ValidationOk<T> | ValidationFail

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseObject(raw: string): { ok: true; value: Record<string, unknown> } | ValidationFail {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '不是合法 JSON', code: 'file-corrupt' }
  }
  if (!isObject(parsed)) {
    return { ok: false, reason: '不是合法 JSON', code: 'file-corrupt' }
  }
  return { ok: true, value: parsed }
}

// ===== 字段级校验器（§3.4 字段约束表；可选字段不判非法）=====

// #173（8→9 断代）：type 加 trivia；wordId 变可选（惊喜题无词归属）；新增可选大类/分册两字段
const QUESTION_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  { field: 'id', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'type', check: (v) => v === 'zh2en' || v === 'en2zh' || v === 'cloze' || v === 'trivia' },
  { field: 'prompt', check: (v) => typeof v === 'string' && v.length > 0 },
  {
    field: 'options',
    check: (v) => Array.isArray(v) && v.length === 4 && v.every((o) => typeof o === 'string'),
  },
  { field: 'answerIndex', check: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3 },
]

// 可选字段（存在才校验）：wordId 非空串；大类/分册非空串（缺省物理补学科初始归类）
const QUESTION_OPTIONAL_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  { field: 'wordId', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'category', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'book', check: (v) => typeof v === 'string' && v.length > 0 },
]

const REWARD_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  { field: 'id', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'name', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'price', check: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0 },
]

// #173 星种附加要求（可选字段，存在才校验）：kind 三枚举 + amount 正整数
function validateRewardRequirement(v: unknown): boolean {
  if (v === undefined) return true
  if (typeof v !== 'object' || v === null) return false
  const kind = (v as { kind?: unknown }).kind
  const amount = (v as { amount?: unknown }).amount
  return (kind === 'main' || kind === 'game' || kind === 'interest') && typeof amount === 'number' && Number.isInteger(amount) && amount > 0
}

const STAR_ENTRY_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  { field: 'id', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'timestamp', check: (v) => typeof v === 'number' },
  { field: 'type', check: (v) => v === 'earn' || v === 'redeem' },
  { field: 'amount', check: (v) => typeof v === 'number' && v > 0 },
  { field: 'source', check: (v) => typeof v === 'string' && v.length > 0 },
]

// #173 星种/孩子归属（可选字段，存在才校验）：kind 三枚举；childId 非空串
const STAR_OPTIONAL_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  { field: 'kind', check: (v) => v === 'main' || v === 'game' || v === 'interest' },
  { field: 'childId', check: (v) => typeof v === 'string' && v.length > 0 },
]

// 旧文件可缺孩子维度；一旦提供，所有行统一要求非空字符串，不能默默接受错类型。
const CHILD_ID_FIELD = { field: 'childId', check: (v: unknown) => v === undefined || (typeof v === 'string' && v.length > 0) }

// R27（REQ-R27-5-4）：逐题答题记录元素字段——outcome 三态枚举 + timestamp ISO 字符串
const QUESTION_RESULT_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  CHILD_ID_FIELD,
  { field: 'outcome', check: (v) => v === 'correct' || v === 'wrong' || v === 'skipped' },
  { field: 'timestamp', check: (v) => typeof v === 'string' },
]

// 红旗条目字段（R36 REQ-R36-4 起；#69 老板拍板删 correct 后仅校验 flaggedAt 时间戳 number）：
// 旧备份条目含 correct 照常通过（向后兼容，不做未知字段校验）
const FLAGGED_ENTRY_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  { field: 'flaggedAt', check: (v) => typeof v === 'number' },
  CHILD_ID_FIELD,
  { field: 'questionId', check: (v) => v === undefined || (typeof v === 'string' && v.length > 0) },
]

// R32（REQ-R32-8-3）：提议元素字段——落盘口径 ProposalRecord（10 字段，不含派生字段 publishState）
const PROPOSAL_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  CHILD_ID_FIELD,
  { field: 'id', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'name', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'price', check: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0 },
  { field: 'status', check: (v) => v === 'discussing' || v === 'agreed' || v === 'published' || v === 'voided' },
  { field: 'createdAt', check: (v) => typeof v === 'number' },
  { field: 'updatedAt', check: (v) => typeof v === 'number' },
  { field: 'description', check: (v) => typeof v === 'string' },
  { field: 'parentStatus', check: (v) => v === 'agreed' || v === 'notAgreed' },
  { field: 'childStatus', check: (v) => v === 'agreed' || v === 'notAgreed' },
  { field: 'initiator', check: (v) => v === 'parent' || v === 'child' },
]

// #75（R-72-3）：进行中兑换元素字段——对齐 ActiveRedemption（兑换项快照 5 字段；emoji 必填非空串，
// 建档侧 create 恒写入兜底值，不采用可选兜底口径）
const ACTIVE_REDEMPTION_FIELDS: Array<{ field: string; check: (v: unknown) => boolean }> = [
  CHILD_ID_FIELD,
  { field: 'id', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'rewardId', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'name', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'emoji', check: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'createdAt', check: (v) => typeof v === 'number' },
]

/** R36（REQ-R36-4）：flagged 结构校验——整体非对象（含字段缺失）/ 某题条目缺字段或类型错 → 原子拒绝（null = 通过） */
function validateFlaggedField(v: unknown): string | null {
  if (!isObject(v)) return 'flagged 必须是对象'
  for (const [questionId, entry] of Object.entries(v)) {
    for (const { field, check } of FLAGGED_ENTRY_FIELDS) {
      if (!isObject(entry) || !check(entry[field])) {
        return `flagged ${questionId}：缺少字段 ${field} 或类型错误`
      }
    }
  }
  return null
}

function validateArray<T>(
  arr: unknown,
  section: string,
  fields: Array<{ field: string; check: (v: unknown) => boolean }>,
  optionalFields: Array<{ field: string; check: (v: unknown) => boolean }> = [],
): Validation<T[]> {
  if (!Array.isArray(arr)) {
    return { ok: false, reason: `缺少 ${section} 数组`, code: 'invalid' }
  }
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    for (const { field, check } of fields) {
      if (!isObject(item) || !check(item[field])) {
        return { ok: false, reason: `${section} 第 ${i + 1} 条：缺少字段 ${field} 或类型错误`, code: 'invalid' }
      }
    }
    for (const { field, check } of optionalFields) {
      if (isObject(item) && item[field] !== undefined && !check(item[field])) {
        return { ok: false, reason: `${section} 第 ${i + 1} 条：字段 ${field} 类型错误`, code: 'invalid' }
      }
    }
  }
  return { ok: true, data: arr as T[] }
}

// ===== 序列化（导出，R36 两组 2.0 契约）=====

/** 学习文件（REQ-R36-1；#173 升位）：version '3.0' + exportedAt + questionPool（带大类/分册）+ flagged + questionResults（行带 childId）全量快照（含孤儿不过滤） */
export function buildLearningExport(
  questionPool: Question[],
  flagged: FlaggedState,
  questionResults: QuestionResultsState,
  now: string,
): LearningExport {
  // 迁移前备份/旧云端行也可能缺新字段；只补导出副本，不写回源数据。
  return {
    version: '3.0', exportedAt: now,
    questionPool: questionPool.map((q) => ({ ...q, category: q.category ?? DEFAULT_QUESTION_CATEGORY, book: q.book ?? DEFAULT_QUESTION_BOOK })),
    flagged: Object.fromEntries(Object.entries(flagged).map(([id, row]) => [id, { ...row, childId: row.childId ?? DEFAULT_CHILD_ID }])),
    questionResults: Object.fromEntries(Object.entries(questionResults).map(([id, rows]) => [id, rows.map((r) => ({ ...r, childId: r.childId ?? DEFAULT_CHILD_ID }))])),
  }
}

/** 经济文件（REQ-R36-2 / R32 REQ-R32-8-1 / #75 R-72-3 / #299）：version '2.4' + rewards + proposals
 *  （sq_proposals 全量真实数据，含终态提议；#299 起提议可选 emoji 原样随导——无 emoji 不落键）+ starLedger + activeRedemptions */
export function buildEconomyExport(
  rewards: RewardItem[],
  proposals: ProposalRecord[],
  starLedger: StarEntry[],
  activeRedemptions: ActiveRedemption[],
  now: string,
): EconomyExport {
  return {
    version: '2.4', exportedAt: now, rewards,
    proposals: proposals.map((p) => ({ ...p, childId: p.childId ?? DEFAULT_CHILD_ID })),
    starLedger: starLedger.map((s) => ({ ...s, childId: s.childId ?? DEFAULT_CHILD_ID, kind: s.kind ?? DEFAULT_STAR_KIND })),
    activeRedemptions: activeRedemptions.map((r) => ({ ...r, childId: r.childId ?? DEFAULT_CHILD_ID })),
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 文件名时间戳用本地时间（YYYYMMDD-HHmmss）；exportedAt 用 ISO 8601——同源不同格式 */
export function formatExportFilename(kind: 'learning' | 'economy', now: Date): string {
  const stamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    '-',
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('')
  return `star-quiz-${kind}-${stamp}.json`
}

// ===== 导入辅助校验器（difficulty 规则 / 记录校验 / 孤儿清理，两组导入共用）=====

/** difficulty 可选校验 + 缺省物理补 3（R24 REQ-R24-1-4）：缺省补 3；1/2/3 之外 → 原子拒绝。
 *  #173：大类/分册缺省物理补学科初始归类（wordId 可空兼容惊喜题，wordId 不补值） */
function applyDifficultyRule(pool: unknown): string | null {
  if (!Array.isArray(pool)) return null
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i]
    if (!isObject(item)) continue
    const d = item.difficulty
    if (d === undefined) {
      item.difficulty = 3
    } else if (d !== 1 && d !== 2 && d !== 3) {
      return `questionPool 第 ${i + 1} 条：difficulty 必须是 1/2/3`
    }
    if (item.category === undefined) item.category = DEFAULT_QUESTION_CATEGORY
    if (item.book === undefined) item.book = DEFAULT_QUESTION_BOOK
  }
  return null
}

/** R27（REQ-R27-5-4）：questionResults 字段类型校验——整体非对象 / 某题值非数组 / 元素缺 outcome 或 timestamp / outcome 不在三态枚举 → 原子拒绝（null = 通过） */
function validateQuestionResultsField(v: unknown): string | null {
  if (!isObject(v)) return 'questionResults 必须是对象'
  for (const [questionId, entries] of Object.entries(v)) {
    if (!Array.isArray(entries)) return `questionResults ${questionId}：记录必须是数组`
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]
      for (const { field, check } of QUESTION_RESULT_FIELDS) {
        if (!isObject(item) || !check(item[field])) {
          return `questionResults ${questionId} 第 ${i + 1} 条：缺少字段 ${field} 或类型错误`
        }
      }
    }
  }
  return null
}

/** R27（REQ-R27-5-3）：孤儿清理——删除 questionId 不在（新）题池的全部条目；题在保留，逐字不动 */
function filterOrphanResults(results: QuestionResultsState, poolIds: Set<string>): QuestionResultsState {
  const kept: QuestionResultsState = {}
  for (const [questionId, entries] of Object.entries(results)) {
    if (poolIds.has(questionId)) kept[questionId] = entries
  }
  return kept
}

// ===== 导入校验（原子拒绝，R36 两组 2.0 契约，REQ-R36-3/4/5）=====

/** R36（REQ-R36-3）→ R32（REQ-R32-8-2/8-5）→ #75（R-72-3）→ #173（8→9 断代升位）版本白名单按组拆分：
 * 经济 ['2.0','2.1','2.2','2.3','2.4']（#299 扩 '2.4'），学习 ['2.0','3.0']。
 * 2.0 / 2.1 经济文件长期可导入（proposals / activeRedemptions 按版本兜底转换）；
 * #173 前的上一版文件（学习 2.0 / 经济 ≤2.2）兼容导入，新字段按默认补齐（childId=默认孩子、kind=主星、大类/分册=学科初始归类）。 */
const ECONOMY_SUPPORTED_VERSIONS = ['2.0', '2.1', '2.2', '2.3', '2.4']
const LEARNING_SUPPORTED_VERSIONS = ['2.0', '3.0']

/** 1.x 断代名单（老板拍板 D2）：一律拒绝并提示版本过旧 */
const LEGACY_VERSIONS = ['1.0', '1.1', '1.2']

/** 两组共用的版本判定：缺 version / 非字符串 → 结构错误；1.x → 版本过旧；其余 → 不支持 */
function checkVersion(value: Record<string, unknown>, supported: string[]): ValidationFail | null {
  if (typeof value.version !== 'string') return { ok: false, reason: '缺少 version 字段', code: 'invalid' }
  if (supported.includes(value.version)) return null
  if (LEGACY_VERSIONS.includes(value.version)) {
    // R36（REQ-R36-3）：文案以 copy.ts 槽位为唯一事实源
    return { ok: false, reason: copy.parent.importVersionTooOld, code: 'version-unsupported' }
  }
  return { ok: false, reason: '不支持的导出版本', code: 'version-unsupported' }
}

export function validateLearningImport(raw: string): Validation<LearningExport> {
  const parsed = parseObject(raw)
  if (!parsed.ok) return parsed
  const value = parsed.value
  const versionFail = checkVersion(value, LEARNING_SUPPORTED_VERSIONS)
  if (versionFail) return versionFail
  const qp = validateArray<Question>(value.questionPool, 'questionPool', QUESTION_FIELDS, QUESTION_OPTIONAL_FIELDS)
  if (!qp.ok) return qp
  // #234：9 号段（9xxxxx）为内置题集保留段，学习文件整次拒绝（与追加溢出整次拒绝同性质，校验层纯函数零写入）
  for (let i = 0; i < qp.data.length; i++) {
    const id = qp.data[i].id
    if (isBuiltinTriviaId(id)) {
      return { ok: false, reason: `questionPool 第 ${i + 1} 条：序号 ${id} 属内置题集保留段（9xxxxx），不能导入`, code: 'invalid' }
    }
  }
  const difficultyFail = applyDifficultyRule(value.questionPool)
  if (difficultyFail) return { ok: false, reason: difficultyFail, code: 'invalid' }
  // R36（REQ-R36-4，自主决策 #3）：2.0 缺字段即非法——flagged / questionResults 缺失与显式非法同等拒绝，无 1.x 兜底
  const flaggedFail = validateFlaggedField(value.flagged)
  if (flaggedFail) return { ok: false, reason: flaggedFail, code: 'invalid' }
  // #173：2.0 文件红旗条目无 childId → 物理补默认孩子（3.0 文件已有值不动）
  const flaggedData = value.flagged as unknown as FlaggedState
  for (const entry of Object.values(flaggedData)) {
    if (entry.childId === undefined) entry.childId = DEFAULT_CHILD_ID
  }
  const qrFail = validateQuestionResultsField(value.questionResults)
  if (qrFail) return { ok: false, reason: qrFail, code: 'invalid' }
  // #173：2.0 文件逐题记录无 childId → 物理补默认孩子（3.0 文件已有值不动）
  for (const records of Object.values(value.questionResults as unknown as QuestionResultsState)) {
    for (const record of records) {
      if (record.childId === undefined) record.childId = DEFAULT_CHILD_ID
    }
  }
  // R36（REQ-R36-4 覆盖模式）：孤儿清理——文件记录中 questionId 不在文件题池的条目删除，题在逐字保留
  const questionResults = filterOrphanResults(
    value.questionResults as unknown as QuestionResultsState,
    new Set(qp.data.map((q) => q.id)),
  )
  return {
    ok: true,
    data: {
      version: '3.0',
      exportedAt: String(value.exportedAt ?? ''),
      questionPool: qp.data,
      flagged: flaggedData,
      questionResults,
    },
  }
}

// ===== 粘贴导入剥壳（#212，拆自 #137，二次 grill 决议 2026-09-08 拍死四规则，勿「修复」）=====

/**
 * 剥壳规则①②：从粘贴原文提取候选 JSON 文本。
 * ① 先找 ``` 代码块取内容，多个取第一个（懒惰匹配首个闭合围栏；未闭合围栏不算代码块 → 落规则②）；
 * ② 无代码块取第一个 `{` 到最后一个 `}` 的子串。
 * 无可剥内容（空白 / 纯解释文字无花括号）返回 null → no-json。
 */
function extractPasteCandidate(raw: string): string | null {
  const fenced = raw.match(/```[^\n]*\n([\s\S]*?)```/)
  if (fenced) return fenced[1]
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end < start) return null
  return raw.slice(start, end + 1)
}

/**
 * #212 粘贴导入契约层单一接缝（剥壳 → 解析 → 校验收口）：输入粘贴原文，输出与 validateLearningImport 同形 Validation。
 * 规则③④：剥壳成功后零修复——parse 失败原样走 validateLearningImport 的 file-corrupt 档（与文件导入同口径），
 * 不回落 `{…}` 兜底；已知边界（老板接受）：双段独立 JSON 无代码块 → 贪心子串含解释文字 → 必拒。
 */
export function validateLearningPasteImport(raw: string): Validation<LearningExport> {
  const candidate = extractPasteCandidate(raw)
  if (candidate === null) {
    return { ok: false, reason: copy.parent.importPasteNoJson, code: 'no-json' }
  }
  return validateLearningImport(candidate)
}

export function validateEconomyImport(raw: string): Validation<EconomyExport> {
  const parsed = parseObject(raw)
  if (!parsed.ok) return parsed
  const value = parsed.value
  const versionFail = checkVersion(value, ECONOMY_SUPPORTED_VERSIONS)
  if (versionFail) return versionFail
  const rw = validateArray<RewardItem>(value.rewards, 'rewards', REWARD_FIELDS)
  if (!rw.ok) return rw
  // #173：星种附加要求为可选字段，存在才校验（非法 → 原子拒绝）
  for (let i = 0; i < rw.data.length; i++) {
    if (!validateRewardRequirement((rw.data[i] as unknown as Record<string, unknown>).requirement)) {
      return { ok: false, reason: `rewards 第 ${i + 1} 条：requirement 必须是 { kind: 'main'|'game'|'interest', amount: 正整数 }`, code: 'invalid' }
    }
  }
  // R32（REQ-R32-8-2/8-3）→ #75（R-72-3）：proposals 按版本分流——2.1/2.2 逐元素原子校验（落盘口径 ProposalRecord）；
  // 2.0 无条件兜底 []（忽略文件值，自主决策 #7 暂定）
  // #63（2026-08-30）：最后动作归因字段为可选（旧导出文件合法缺失），导入时 backfill by=initiator / kind=proposed
  let proposals: ProposalRecord[]
  if (value.version !== '2.0') {
    const pr = validateArray<ProposalRecord>(value.proposals, 'proposals', PROPOSAL_FIELDS)
    if (!pr.ok) return pr
    // #304（#299）：emoji 为可选宽进字段——非字符串/空串按缺省处理（剔除键，读取侧兜底 🎁），不整次拒绝
    proposals = pr.data.map((raw) => {
      const row = raw as typeof raw & { emoji?: unknown }
      const emoji = typeof row.emoji === 'string' && row.emoji.length > 0 ? row.emoji : undefined
      const { emoji: _invalidEmoji, ...rest } = row
      return {
        ...rest,
        ...(emoji !== undefined ? { emoji } : {}),
        lastActionBy: row.lastActionBy ?? row.initiator,
        lastActionKind: row.lastActionKind ?? ('proposed' as const),
        // #173：2.2 及更早文件无 childId → 补默认孩子
        childId: (row as unknown as { childId?: string }).childId ?? DEFAULT_CHILD_ID,
      }
    })
  } else {
    proposals = []
  }
  // #75（R-72-3）：activeRedemptions 按版本分流——2.2 及以后逐元素原子校验（兑换项快照 5 字段，条目非法整文件拒绝；emoji 必填非空串不动）；
  // 2.0/2.1 无条件兜底 []（忽略文件值，对齐 proposals 2.0 兜底先例——旧文件缺 key 不报错）
  let activeRedemptions: ActiveRedemption[]
  if (value.version !== '2.0' && value.version !== '2.1') {
    const ar = validateArray<ActiveRedemption>(value.activeRedemptions, 'activeRedemptions', ACTIVE_REDEMPTION_FIELDS)
    if (!ar.ok) return ar
    // #173：2.2 文件无 childId → 补默认孩子（emoji 必填校验不动）
    activeRedemptions = ar.data.map((r) => ({ ...r, childId: (r as unknown as { childId?: string }).childId ?? DEFAULT_CHILD_ID }))
  } else {
    activeRedemptions = []
  }
  const sl = validateArray<StarEntry>(value.starLedger, 'starLedger', STAR_ENTRY_FIELDS, STAR_OPTIONAL_FIELDS)
  if (!sl.ok) return sl
  // #173：2.2 及更早文件流水无 kind / childId → 物理补主星 + 默认孩子（2.3 及以后文件已有值不动）
  const starLedger = sl.data.map((e) => {
    const row = e as unknown as { kind?: StarKind; childId?: string }
    return { ...e, kind: row.kind ?? DEFAULT_STAR_KIND, childId: row.childId ?? DEFAULT_CHILD_ID }
  })
  return {
    ok: true,
    data: {
      version: value.version as EconomyExport['version'],
      exportedAt: String(value.exportedAt ?? ''),
      rewards: rw.data,
      proposals,
      starLedger,
      activeRedemptions,
    },
  }
}
