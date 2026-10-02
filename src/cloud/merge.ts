// 分域合并器（#126，R-P1d）：9 域 diff / merge 纯函数——ADR 0002 合并语义 / ADR 0005 域映射蓝本。
// 纯函数零副作用：不触 localStorage、不触网络；时间戳与写者由调用方注入（写入时刻取真实钟）。
// 影子（shadow）= 上次确认交换后的域状态基线：推侧 diff 基准 + 拉侧 LWW 裁决基准
// （拉侧裁决用 known = 影子 ∪ outbox，outbox 为本机更新真相，由引擎预合并传入）。
// 平手裁决：updated_at 相等 → 云端行胜（与 worker 侧「严格大于才覆写」互补，凑成收敛闭环；
// 同记录同刻无 id 字典序可分，退化为确定性云端胜——见票内交付记录 Spec 缺口清单）。

import type {
  MoraleState,
  ActiveRedemption,
  WordAppearance,
  FlaggedState,
  ProposalRecord,
  Question,
  QuestionResultsState,
  RewardItem,
  StarEntry,
  EntryVisibilityMap,
  EntryVisibilityValue,
} from '../types'
import { DEFAULT_CHILD_ID, DEFAULT_STAR_KIND, isTimedEntryVisibilityValue } from '../types'
import { latestWordEvents, wordEventsOf } from '../utils/recentWords'
import { flagKey, flagQuestionId, flagEntry } from '../utils/learningIdentity'
import { PROPOSAL_EMOJI_DEFAULT } from '../utils/proposalState'

/** 同步 10 域（对齐 worker/src/sync.ts DOMAINS，#180 新增临场状态，#262 trivia_entry → 键控 entry_visibility） */
export type SyncDomain =
  | 'star_entries'
  | 'question_results'
  | 'word_appearances'
  | 'reward_items'
  | 'proposals'
  | 'active_redemptions'
  | 'question_flags'
  | 'question_banks'
  | 'morale'
  | 'entry_visibility'

// ===== 云端行类型（snake_case，列对齐 worker DOMAINS.columns）=====

export interface StarEntryRow {
  kind?: StarEntry['kind']
  child_id?: string
  id: string
  timestamp: number
  type: 'earn' | 'redeem'
  amount: number
  source: string
  quiz_id?: string
}

export interface QuestionResultRow {
  child_id?: string
  question_id: string
  answered_at: string // ISO 8601（本地 QuestionResult.timestamp 同口径）
  outcome: 'correct' | 'wrong' | 'skipped'
}

export interface WordAppearanceRow {
  child_id?: string
  word_id: string
  appeared_at: number
}

export interface RewardItemRow {
  requirement?: RewardItem['requirement'] | null
  id: string
  name: string
  price: number
  emoji?: string
  updated_at: number
  updated_by: string
  deleted: 0 | 1
}

export interface ProposalRow {
  child_id?: string
  id: string
  name: string
  price: number
  status: ProposalRecord['status']
  created_at: number
  updated_at: number
  description: string
  parent_status: ProposalRecord['parentStatus']
  child_status: ProposalRecord['childStatus']
  initiator: ProposalRecord['initiator']
  last_action_by: ProposalRecord['lastActionBy']
  last_action_kind: ProposalRecord['lastActionKind']
  emoji?: string
  updated_by: string
  deleted: 0 | 1
}

export interface ActiveRedemptionRow {
  child_id?: string
  id: string
  reward_id: string
  name: string
  emoji: string
  created_at: number
  updated_at: number
  updated_by: string
  deleted: 0 | 1
}

export interface QuestionFlagRow {
  child_id?: string
  question_id: string
  flagged_at: number
  updated_at: number
  updated_by: string
  deleted: 0 | 1
}

export interface QuestionBankRow {
  content: Question[] // 每家庭一行整组（worker 侧 stringify/parse 往返）
  updated_at: number
  updated_by: string
}

// ===== 工具 =====

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** JSON tuple avoids collisions when either identifier contains punctuation. */
function economyKey(row: { id: string; childId?: string; child_id?: string }): string {
  return JSON.stringify([row.childId ?? row.child_id ?? DEFAULT_CHILD_ID, row.id])
}

const NEG_INF = Number.NEGATIVE_INFINITY

/** 本地逐题记录滚动窗口（types 契约：每题最近 5 次，index 0 = 最新） */
const RESULTS_WINDOW = 5

/** 出词软去重窗口轮数（quizEngine：lastSeq ≥ seq − 2 视为窗口内） */

// ===== ① star_entries：纯追加流水，id 并集幂等 =====

function starRowOf(e: StarEntry): StarEntryRow {
  return {
    id: e.id,
    child_id: e.childId ?? DEFAULT_CHILD_ID,
    kind: e.kind ?? DEFAULT_STAR_KIND,
    timestamp: e.timestamp,
    type: e.type,
    amount: e.amount,
    source: e.source,
    ...(e.quizId !== undefined ? { quiz_id: e.quizId } : {}),
  }
}

function starEntryOf(row: StarEntryRow): StarEntry {
  return {
    id: row.id,
    childId: row.child_id ?? DEFAULT_CHILD_ID,
    kind: row.kind ?? DEFAULT_STAR_KIND,
    timestamp: row.timestamp,
    type: row.type,
    amount: row.amount,
    source: row.source,
    ...(row.quiz_id !== undefined ? { quizId: row.quiz_id } : {}),
  }
}

/** 推侧增量：影子外条目成行（append-only 语义下增量恒为新增条目） */
export function diffStarEntries(current: StarEntry[], shadow: StarEntry[]): StarEntryRow[] {
  const known = new Set(shadow.map(economyKey))
  return current.filter((e) => !known.has(economyKey(e))).map(starRowOf)
}

/** 拉侧并集：按 id 幂等去重，合并结果按 timestamp 升序稳定排序（展示序与时间序一致） */
export function mergeStarEntries(
  local: StarEntry[],
  rows: StarEntryRow[],
): { next: StarEntry[]; changed: boolean } {
  const have = new Set(local.map(economyKey))
  const added = rows.filter((r) => {
    const key = economyKey(r)
    if (have.has(key)) return false
    have.add(key)
    return true
  }).map(starEntryOf)
  if (added.length === 0) return { next: local, changed: false }
  const next = [...local, ...added].sort((a, b) => a.timestamp - b.timestamp)
  return { next, changed: true }
}

// ===== ② question_results：纯追加流水，(question_id, answered_at) 并集 + 本地 5 次窗口 =====

export function diffQuestionResults(
  current: QuestionResultsState,
  shadow: QuestionResultsState,
): QuestionResultRow[] {
  const rows: QuestionResultRow[] = []
  for (const [qid, records] of Object.entries(current)) {
    const known = new Set((shadow[qid] ?? []).map((r) => JSON.stringify([r.childId ?? DEFAULT_CHILD_ID, r.timestamp])))
    for (const r of records) {
      if (!known.has(JSON.stringify([r.childId ?? DEFAULT_CHILD_ID, r.timestamp]))) rows.push({ child_id: r.childId ?? DEFAULT_CHILD_ID, question_id: qid, answered_at: r.timestamp, outcome: r.outcome })
    }
  }
  return rows
}

/** 拉侧并集：身份 (qid, answered_at) 幂等；新记录按 answered_at 降序归位并裁回 5 条（云端全量、本地窗口派生） */
export function mergeQuestionResults(
  local: QuestionResultsState,
  rows: QuestionResultRow[],
): { next: QuestionResultsState; changed: boolean } {
  const next: QuestionResultsState = {}
  let changed = false
  for (const [qid, records] of Object.entries(local)) {
    next[qid] = [...records]
  }
  for (const row of rows) {
    const list = next[row.question_id] ?? []
    if (list.some((r) => r.timestamp === row.answered_at && (r.childId ?? DEFAULT_CHILD_ID) === (row.child_id ?? DEFAULT_CHILD_ID))) continue
    next[row.question_id] = [{ outcome: row.outcome, timestamp: row.answered_at, childId: row.child_id ?? DEFAULT_CHILD_ID }, ...list].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
    )
    changed = true
  }
  if (!changed) return { next: local, changed: false }
  for (const qid of Object.keys(next)) {
    const counts = new Map<string, number>()
    next[qid] = next[qid].filter((r) => {
      const child = r.childId ?? DEFAULT_CHILD_ID
      const count = (counts.get(child) ?? 0) + 1
      counts.set(child, count)
      return count <= RESULTS_WINDOW
    })
  }
  return { next, changed: true }
}

// ===== ③ word_appearances：按孩子的出现事件并集，清单为每孩最新30词 =====

/** 事件化同步：身份含孩子与出现时刻，重考已有词同样成行。 */
export function diffWordAppearances(current: WordAppearance[], shadow: WordAppearance[] | string[]): WordAppearanceRow[] {
  const known = new Set(wordEventsOf(shadow).map((r) => JSON.stringify([r.childId, r.wordId, r.appearedAt])))
  return current.filter((r) => !known.has(JSON.stringify([r.childId, r.wordId, r.appearedAt])))
    .map((r) => ({ child_id: r.childId, word_id: r.wordId, appeared_at: r.appearedAt }))
}

export function mergeWordAppearances(local: WordAppearance[], rows: WordAppearanceRow[]): { next: WordAppearance[]; changed: boolean } {
  const next = latestWordEvents([...local, ...rows.map((r) => ({ childId: r.child_id ?? DEFAULT_CHILD_ID, wordId: r.word_id, appearedAt: r.appeared_at }))])
  return { next, changed: !jsonEq(local, next) }
}

// ===== ④ reward_items：记录级 LWW + deleted 墓碑 =====

function rewardRowOf(item: RewardItem, now: number, by: string): RewardItemRow {
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    requirement: item.requirement ?? null,
    ...(item.emoji !== undefined ? { emoji: item.emoji } : {}),
    updated_at: now,
    updated_by: by,
    deleted: 0,
  }
}

function rewardContentEqual(s: RewardItemRow, item: RewardItem): boolean {
  return s.name === item.name && s.price === item.price && (s.emoji ?? undefined) === (item.emoji ?? undefined)
    && (s.requirement?.kind ?? null) === (item.requirement?.kind ?? null)
    && (s.requirement?.amount ?? null) === (item.requirement?.amount ?? null)
}

/** 推侧增量：新增/内容变更成行（updated_at = 注入时刻）；影子有而当前无 → 墓碑；已墓碑不重复出 */
export function diffRewardItems(
  current: RewardItem[],
  shadow: RewardItemRow[],
  now: number,
  by: string,
): RewardItemRow[] {
  const shadowById = new Map(shadow.map((r) => [r.id, r]))
  const currentIds = new Set(current.map((i) => i.id))
  const rows: RewardItemRow[] = []
  for (const item of current) {
    const s = shadowById.get(item.id)
    if (s !== undefined && s.deleted === 0 && rewardContentEqual(s, item)) continue
    rows.push(rewardRowOf(item, now, by))
  }
  for (const s of shadow) {
    if (s.deleted === 0 && !currentIds.has(s.id)) {
      rows.push({ ...s, updated_at: now, updated_by: by, deleted: 1 })
    }
  }
  return rows
}

/** 拉侧 LWW：row.updated_at ≥ known（≥ = 平手云端胜）才落地——墓碑删本地行，活行整行覆写 */
export function mergeRewardItems(
  local: RewardItem[],
  rows: RewardItemRow[],
  known: RewardItemRow[],
): { next: RewardItem[]; nextShadow: RewardItemRow[]; changed: boolean; appliedRows: RewardItemRow[] } {
  const knownById = new Map(known.map((r) => [r.id, r]))
  const next = local.map((i) => ({ ...i }))
  const nextShadow = known.map((r) => ({ ...r }))
  const appliedRows: RewardItemRow[] = []
  let changed = false
  for (const row of rows) {
    const k = knownById.get(row.id)
    if (row.updated_at < (k?.updated_at ?? NEG_INF)) continue
    appliedRows.push(row)
    const kIdx = nextShadow.findIndex((r) => r.id === row.id)
    if (kIdx === -1) nextShadow.push({ ...row })
    else nextShadow[kIdx] = { ...row }
    if (row.deleted === 1) {
      const before = next.length
      const filtered = next.filter((i) => i.id !== row.id)
      if (filtered.length !== before) {
        next.length = 0
        next.push(...filtered)
        changed = true
      }
    } else {
      const item: RewardItem = {
        id: row.id,
        name: row.name,
        price: row.price,
        ...(row.requirement != null ? { requirement: { ...row.requirement } } : {}),
        ...(row.emoji !== undefined ? { emoji: row.emoji } : {}),
      }
      const idx = next.findIndex((i) => i.id === row.id)
      if (idx === -1) {
        next.push(item)
        changed = true
      } else if (!rewardContentEqual({ ...row, deleted: 0 }, next[idx])) {
        next[idx] = item
        changed = true
      }
    }
  }
  return { next, nextShadow, changed, appliedRows }
}

// ===== ⑤ proposals：记录级 LWW × 修订即认同（整行后写胜）+ 墓碑 =====

function proposalRowOf(p: ProposalRecord, now: number, by: string, deleted: 0 | 1 = 0): ProposalRow {
  return {
    id: p.id,
    child_id: p.childId ?? DEFAULT_CHILD_ID,
    name: p.name,
    price: p.price,
    status: p.status,
    created_at: p.createdAt,
    updated_at: now,
    description: p.description,
    parent_status: p.parentStatus,
    child_status: p.childStatus,
    initiator: p.initiator,
    last_action_by: p.lastActionBy,
    last_action_kind: p.lastActionKind,
    // #303 可选：无 emoji 不落键、保真传递（省略 → worker 落 NULL），与 T2 落盘口径一致
    ...(p.emoji !== undefined ? { emoji: p.emoji } : {}),
    updated_by: by,
    deleted,
  }
}

function proposalContentEqual(s: ProposalRow, p: ProposalRecord): boolean {
  return (
    s.name === p.name &&
    s.price === p.price &&
    s.status === p.status &&
    s.created_at === p.createdAt &&
    s.description === p.description &&
    s.parent_status === p.parentStatus &&
    s.child_status === p.childStatus &&
    s.initiator === p.initiator &&
    s.last_action_by === p.lastActionBy &&
    s.last_action_kind === p.lastActionKind &&
    // #303：emoji 按规范化后比较（NULL/缺省 ≡ 🎁，与 T2 读取兜底出口同口径）——仅实质改 emoji 产生待推 diff
    (s.emoji ?? PROPOSAL_EMOJI_DEFAULT) === (p.emoji ?? PROPOSAL_EMOJI_DEFAULT)
  )
}

function proposalRecordOf(row: ProposalRow): ProposalRecord {
  return {
    id: row.id,
    childId: row.child_id ?? DEFAULT_CHILD_ID,
    name: row.name,
    price: row.price,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    description: row.description,
    parentStatus: row.parent_status,
    childStatus: row.child_status,
    initiator: row.initiator,
    lastActionBy: row.last_action_by,
    lastActionKind: row.last_action_kind,
    // #303 可选：云端 NULL 行不落 emoji 键，读取侧统一兜底 🎁（proposalEmoji）
    ...(row.emoji !== undefined && row.emoji !== null ? { emoji: row.emoji } : {}),
  }
}

export function diffProposals(
  current: ProposalRecord[],
  shadow: ProposalRow[],
  now: number,
  by: string,
): ProposalRow[] {
  const shadowById = new Map(shadow.map((r) => [economyKey(r), r]))
  const currentIds = new Set(current.map(economyKey))
  const rows: ProposalRow[] = []
  for (const p of current) {
    const s = shadowById.get(economyKey(p))
    if (s !== undefined && s.deleted === 0 && proposalContentEqual(s, p)) continue
    rows.push(proposalRowOf(p, now, by))
  }
  for (const s of shadow) {
    if (s.deleted === 0 && !currentIds.has(economyKey(s))) {
      rows.push({ ...s, updated_at: now, updated_by: by, deleted: 1 })
    }
  }
  return rows
}

export function mergeProposals(
  local: ProposalRecord[],
  rows: ProposalRow[],
  known: ProposalRow[],
): { next: ProposalRecord[]; nextShadow: ProposalRow[]; changed: boolean; appliedRows: ProposalRow[] } {
  const knownById = new Map(known.map((r) => [economyKey(r), r]))
  const next = local.map((p) => ({ ...p }))
  const nextShadow = known.map((r) => ({ ...r }))
  const appliedRows: ProposalRow[] = []
  let changed = false
  for (const row of rows) {
    const k = knownById.get(economyKey(row))
    if (row.updated_at < (k?.updated_at ?? NEG_INF)) continue
    appliedRows.push(row)
    const kIdx = nextShadow.findIndex((r) => economyKey(r) === economyKey(row))
    if (kIdx === -1) nextShadow.push({ ...row })
    else nextShadow[kIdx] = { ...row }
    if (row.deleted === 1) {
      const before = next.length
      const filtered = next.filter((p) => economyKey(p) !== economyKey(row))
      if (filtered.length !== before) {
        next.length = 0
        next.push(...filtered)
        changed = true
      }
    } else {
      const record = proposalRecordOf(row)
      const idx = next.findIndex((p) => economyKey(p) === economyKey(row))
      if (idx === -1) {
        next.push(record)
        changed = true
      } else if (!proposalContentEqual({ ...row, deleted: 0 }, next[idx])) {
        next[idx] = record
        changed = true
      }
    }
  }
  return { next, nextShadow, changed, appliedRows }
}

// ===== ⑥ active_redemptions：记录级 LWW + 核销/放弃墓碑 =====

function redemptionRowOf(r: ActiveRedemption, now: number, by: string): ActiveRedemptionRow {
  return {
    id: r.id,
    child_id: r.childId ?? DEFAULT_CHILD_ID,
    reward_id: r.rewardId,
    name: r.name,
    emoji: r.emoji,
    created_at: r.createdAt,
    updated_at: now,
    updated_by: by,
    deleted: 0,
  }
}

function redemptionContentEqual(s: ActiveRedemptionRow, r: ActiveRedemption): boolean {
  return s.reward_id === r.rewardId && s.name === r.name && s.emoji === r.emoji && s.created_at === r.createdAt
}

export function diffActiveRedemptions(
  current: ActiveRedemption[],
  shadow: ActiveRedemptionRow[],
  now: number,
  by: string,
): ActiveRedemptionRow[] {
  const shadowById = new Map(shadow.map((r) => [economyKey(r), r]))
  const currentIds = new Set(current.map(economyKey))
  const rows: ActiveRedemptionRow[] = []
  for (const r of current) {
    const s = shadowById.get(economyKey(r))
    if (s !== undefined && s.deleted === 0 && redemptionContentEqual(s, r)) continue
    rows.push(redemptionRowOf(r, now, by))
  }
  for (const s of shadow) {
    if (s.deleted === 0 && !currentIds.has(economyKey(s))) {
      rows.push({ ...s, updated_at: now, updated_by: by, deleted: 1 })
    }
  }
  return rows
}

export function mergeActiveRedemptions(
  local: ActiveRedemption[],
  rows: ActiveRedemptionRow[],
  known: ActiveRedemptionRow[],
): { next: ActiveRedemption[]; nextShadow: ActiveRedemptionRow[]; changed: boolean; appliedRows: ActiveRedemptionRow[] } {
  const knownById = new Map(known.map((r) => [economyKey(r), r]))
  const next = local.map((r) => ({ ...r }))
  const nextShadow = known.map((r) => ({ ...r }))
  const appliedRows: ActiveRedemptionRow[] = []
  let changed = false
  for (const row of rows) {
    const k = knownById.get(economyKey(row))
    if (row.updated_at < (k?.updated_at ?? NEG_INF)) continue
    appliedRows.push(row)
    const kIdx = nextShadow.findIndex((r) => economyKey(r) === economyKey(row))
    if (kIdx === -1) nextShadow.push({ ...row })
    else nextShadow[kIdx] = { ...row }
    if (row.deleted === 1) {
      const before = next.length
      const filtered = next.filter((r) => economyKey(r) !== economyKey(row))
      if (filtered.length !== before) {
        next.length = 0
        next.push(...filtered)
        changed = true
      }
    } else {
      const record: ActiveRedemption = {
        id: row.id,
        childId: row.child_id ?? DEFAULT_CHILD_ID,
        rewardId: row.reward_id,
        name: row.name,
        emoji: row.emoji,
        createdAt: row.created_at,
      }
      const idx = next.findIndex((r) => economyKey(r) === economyKey(row))
      if (idx === -1) {
        next.push(record)
        changed = true
      } else if (!redemptionContentEqual({ ...row, deleted: 0 }, next[idx])) {
        next[idx] = record
        changed = true
      }
    }
  }
  return { next, nextShadow, changed, appliedRows }
}

// ===== ⑦ question_flags：记录级 LWW + 取消标记墓碑（map 形态本地键） =====

export function diffQuestionFlags(
  current: FlaggedState,
  shadow: QuestionFlagRow[],
  now: number,
  by: string,
): QuestionFlagRow[] {
  const shadowById = new Map(shadow.map((r) => [flagKey(r.question_id, r.child_id), r]))
  const rows: QuestionFlagRow[] = []
  for (const [qid, entry] of Object.entries(current)) {
    const s = shadowById.get(qid)
    if (s !== undefined && s.deleted === 0 && s.flagged_at === entry.flaggedAt) continue
    rows.push({ child_id: entry.childId ?? DEFAULT_CHILD_ID, question_id: flagQuestionId(qid, entry), flagged_at: entry.flaggedAt, updated_at: now, updated_by: by, deleted: 0 })
  }
  for (const s of shadow) {
    if (s.deleted === 0 && current[flagKey(s.question_id, s.child_id)] === undefined) {
      rows.push({ ...s, updated_at: now, updated_by: by, deleted: 1 })
    }
  }
  return rows
}

export function mergeQuestionFlags(
  local: FlaggedState,
  rows: QuestionFlagRow[],
  known: QuestionFlagRow[],
): { next: FlaggedState; nextShadow: QuestionFlagRow[]; changed: boolean; appliedRows: QuestionFlagRow[] } {
  const knownById = new Map(known.map((r) => [flagKey(r.question_id, r.child_id), r]))
  const next: FlaggedState = { ...local }
  const nextShadow = known.map((r) => ({ ...r }))
  const appliedRows: QuestionFlagRow[] = []
  let changed = false
  for (const row of rows) {
    const key = flagKey(row.question_id, row.child_id)
    const k = knownById.get(key)
    if (row.updated_at < (k?.updated_at ?? NEG_INF)) continue
    appliedRows.push(row)
    const kIdx = nextShadow.findIndex((r) => flagKey(r.question_id, r.child_id) === key)
    if (kIdx === -1) nextShadow.push({ ...row })
    else nextShadow[kIdx] = { ...row }
    if (row.deleted === 1) {
      if (next[key] !== undefined) {
        delete next[key]
        changed = true
      }
    } else {
      const cur = next[key]
      if (cur === undefined || cur.flaggedAt !== row.flagged_at) {
        next[key] = flagEntry(row.question_id, { flaggedAt: row.flagged_at, childId: row.child_id ?? DEFAULT_CHILD_ID })
        changed = true
      }
    }
  }
  return { next, nextShadow, changed, appliedRows }
}

// ===== ⑧ question_banks：整组 LWW（最后导入方胜，家长单写） =====

export function diffQuestionBanks(
  current: Question[],
  shadow: QuestionBankRow | null,
  now: number,
  by: string,
): QuestionBankRow[] {
  if (shadow !== null && jsonEq(shadow.content, current)) return []
  return [{ content: current, updated_at: now, updated_by: by }]
}

export function mergeQuestionBanks(
  local: Question[],
  row: QuestionBankRow | undefined,
  known: QuestionBankRow | null,
): { next: Question[]; nextShadow: QuestionBankRow | null; changed: boolean; applied: boolean } {
  if (row === undefined) return { next: local, nextShadow: known, changed: false, applied: false }
  if (known !== null && row.updated_at < known.updated_at) {
    return { next: local, nextShadow: known, changed: false, applied: false }
  }
  const changed = !jsonEq(row.content, local)
  return { next: row.content, nextShadow: row, changed, applied: true }
}

// ===== morale：每孩一条临场状态，沿用记录级 LWW（平手云端胜） =====

export interface MoraleRow {
  child_id: string
  level: MoraleState['level']
  last_round_correct: number | null
  updated_at: number
  updated_by: string
  deleted: 0 | 1
}

export function diffMorale(current: MoraleState[], shadow: MoraleRow[], now: number, by: string): MoraleRow[] {
  const rows: MoraleRow[] = []
  const ids = new Set(current.map((m) => m.childId ?? DEFAULT_CHILD_ID))
  for (const m of current) {
    const child_id = m.childId ?? DEFAULT_CHILD_ID
    const previous = shadow.find((r) => r.child_id === child_id)
    if (previous?.deleted === 0 && previous.level === m.level && previous.last_round_correct === m.lastRoundCorrect) continue
    rows.push({ child_id, level: m.level, last_round_correct: m.lastRoundCorrect, updated_at: now, updated_by: by, deleted: 0 })
  }
  for (const row of shadow) {
    if (row.deleted === 0 && !ids.has(row.child_id)) rows.push({ ...row, updated_at: now, updated_by: by, deleted: 1 })
  }
  return rows
}

export function mergeMorale(local: MoraleState[], rows: MoraleRow[], known: MoraleRow[]): {
  next: MoraleState[]; nextShadow: MoraleRow[]; changed: boolean; appliedRows: MoraleRow[]
} {
  const next = new Map(local.map((m) => [m.childId ?? DEFAULT_CHILD_ID, m]))
  const shadow = new Map(known.map((r) => [r.child_id, r]))
  const appliedRows: MoraleRow[] = []
  for (const row of rows) {
    if (row.updated_at < (shadow.get(row.child_id)?.updated_at ?? NEG_INF)) continue
    shadow.set(row.child_id, { ...row })
    appliedRows.push(row)
    if (row.deleted === 1) next.delete(row.child_id)
    else next.set(row.child_id, { childId: row.child_id, level: row.level, lastRoundCorrect: row.last_round_correct })
  }
  const values = [...next.values()]
  return { next: values, nextShadow: [...shadow.values()], changed: !jsonEq(local, values), appliedRows }
}

// ===== entry_visibility：逐入口显隐开关，按 entry_id 键控整行 LWW（最后改动方胜，#262）=====
// 影子/known 走数组形态（按 entry_id 多行）：复用 morale 一路的引擎通用路径
// （outboxMerge 按身份覆写 / dedupeSent 去重 / combineKnown 并集），引擎零特判。

export interface EntryVisibilityRow {
  entry_id: string
  visible: 0 | 1
  /** #278 限时档到期时间戳（epoch ms，写入方本地时钟）；非限时行缺省/null */
  expires_at?: number | null
  updated_at: number
  updated_by: string
}

/**
 * 推侧增量：记录中每个显式条目与影子比对——影子缺行或（显隐值、到期时间戳）不一致即出行（显式 false 也推，
 * 「家长关掉」必须可传播；影子缺行视为不一致，损坏重置后全量重推走 #171 对账）；
 * 记录中无该入口 = 未设置（默认隐藏），不是待推事实，不出行。
 * 限时条目（{ visible:true, expires_at }）出行带 expires_at；布尔条目行不带该字段（旧行为不变）。
 */
export function diffEntryVisibility(current: EntryVisibilityMap, shadow: EntryVisibilityRow[], now: number, by: string): EntryVisibilityRow[] {
  const rows: EntryVisibilityRow[] = []
  for (const [entry_id, value] of Object.entries(current)) {
    const timed = isTimedEntryVisibilityValue(value) ? value : null
    const visible = value === true || timed !== null
    const previous = shadow.find((r) => r.entry_id === entry_id)
    if (previous !== undefined
      && (previous.visible === 1) === visible
      && (previous.expires_at ?? null) === (timed?.expires_at ?? null)) continue
    rows.push(timed
      ? { entry_id, visible: 1, expires_at: timed.expires_at, updated_at: now, updated_by: by }
      : { entry_id, visible: visible ? 1 : 0, updated_at: now, updated_by: by })
  }
  return rows
}

/** 同步行 → 本地记录条目值（限时行 = 限时对象；其余 = 布尔，存量形状零变化） */
function entryVisibilityRowToValue(row: EntryVisibilityRow): EntryVisibilityValue {
  if (row.visible === 1 && row.expires_at != null) return { visible: true, expires_at: row.expires_at }
  return row.visible === 1
}

/** 拉侧 LWW（逐入口）：row.updated_at ≥ 该入口 known（≥ = 平手云端胜，与 worker 侧「严格大于才覆写」互补）才整行落地 */
export function mergeEntryVisibility(local: EntryVisibilityMap, rows: EntryVisibilityRow[], known: EntryVisibilityRow[]): {
  next: EntryVisibilityMap; nextShadow: EntryVisibilityRow[]; changed: boolean; appliedRows: EntryVisibilityRow[]
} {
  const next: EntryVisibilityMap = { ...local }
  const shadow = new Map(known.map((r) => [r.entry_id, r]))
  const appliedRows: EntryVisibilityRow[] = []
  for (const row of rows) {
    if (row.updated_at < (shadow.get(row.entry_id)?.updated_at ?? NEG_INF)) continue
    shadow.set(row.entry_id, { ...row })
    appliedRows.push(row)
    // #278 限时行（visible + expires_at）落地为限时对象；缺新字段的旧行照常落地为布尔（存量形状零变化）
    next[row.entry_id] = entryVisibilityRowToValue(row)
  }
  return { next, nextShadow: [...shadow.values()], changed: !jsonEq(local, next), appliedRows }
}

// ===== 影子推进（推送成功后；流水域影子由引擎取当前态快照，不经此函数） =====

/**
 * LWW 域 / 题库：推送成功后影子推进——影子行被 sent 行按 id 覆写（含墓碑），未涉及行保留。
 * 流水域（star_entries / question_results / word_appearances）返回原影子（引擎以当前态快照推进）。
 */
/** LWW 行域的行 id 列名（#263 评审 D 收口：域→影子 id 键查表，替代嵌套三元）。
 *  仅 advanceShadowFromSent 的列表合并域消费；其余条目为 Record 穷举护栏的占位（不可达）。 */
const SHADOW_ID_KEY: Record<SyncDomain, string> = {
  star_entries: 'id',
  question_results: 'question_id',
  word_appearances: 'word_id',
  reward_items: 'id',
  proposals: 'id',
  active_redemptions: 'id',
  question_flags: 'question_id',
  question_banks: 'id',
  morale: 'child_id',
  entry_visibility: 'entry_id',
}

export function advanceShadowFromSent(domain: SyncDomain, shadow: unknown, sent: unknown[]): unknown {
  switch (domain) {
    case 'reward_items':
    case 'proposals':
    case 'active_redemptions':
    case 'morale':
    case 'question_flags':
    case 'entry_visibility': {
      const idKey = SHADOW_ID_KEY[domain]
      const base = Array.isArray(shadow) ? (shadow as Array<Record<string, unknown>>).map((r) => ({ ...r })) : []
      for (const raw of sent as Array<Record<string, unknown>>) {
        const idx = base.findIndex((r) => r[idKey] === raw[idKey] && (domain === 'reward_items' || (r['child_id'] ?? DEFAULT_CHILD_ID) === (raw['child_id'] ?? DEFAULT_CHILD_ID)))
        if (idx === -1) base.push({ ...raw })
        else base[idx] = { ...raw }
      }
      return base
    }
    case 'question_banks': {
      const sentBank = sent[0] as QuestionBankRow | undefined
      return sentBank !== undefined ? sentBank : shadow
    }
    default:
      return shadow
  }
}
