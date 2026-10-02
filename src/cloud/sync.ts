// 同步引擎（#126，R-P1d；ADR 0002 本地优先双向同步完整落地）：
// 写入即推（writeValue 单一收口监听 → 待推行 outbox，微任务去抖批量推）
// + 冷启动拉合（游标增量，组合根 main.ts 调 startSync，不散落页面）
// + 导航驱动拉合（#208：路由全局守卫唯一触发点 onNavigationSync → 复用同一同步周期；
//   进行中去重 + 5 秒节流 trailing 补跑；拉取成功落库广播 registerSyncCompleteListener → 页面静默重读）
// + 换机云端为准（配对后首次同步：云端任一域有行 → 覆盖前 useExport 自动双文件留档 + 逐域灌入；
//   全云端为空（首台设备）→ 无留档，本机全量推上云）
// + 时钟兜底（本地时间戳为主，server_at − 本地时刻维护偏移，发戳单调递增防回摆）。
// 失败静默攒账（outbox 持久化，下次写入/冷启动/静默恢复重试），不阻塞任何本地操作、不弹错。
// #171 T-损坏对账铁律（#67 T1）：上云参与键损坏重置 → 域标脏禁推（防重置态 diff 出删除墓碑清空云端）→
// 下个周期复用基线灌入通道全量对账（影子为证人：影子有而本地无自云端回填、本地新写保留）→
// 重建影子、解除禁推、补推本地新行；全程日志。
// 设备本地键（自管理，沿 #125 设备凭据键先例不进 STORAGE_KEYS/init/迁移/导出）：
// sq_sync_cursor / sq_sync_shadow / sq_sync_outbox / sq_sync_bootstrapped —— 永不同步、不进学习/经济文件导出。

import { STORAGE_KEYS, registerWriteListener, registerCorruptionResetHandler, consumeCorruptionResets, type StorageKey } from '../composables/useDataInfra'
import { readDeviceCredential, type DeviceCredential } from '../composables/useDeviceCredential'
import { downloadDataExport, downloadLedgerExport } from '../composables/useExport'
import { allLedger as ledger, writeLedger, rewards, writeRewards } from '../composables/useStarData'
import {
  allMorale,
  writeAllMorale,
  allFlagged as flagged,
  writeAllFlagged as writeFlagged,
  questions,
  allQuestionResults as questionResults,
  writeAllQuestionResults as writeQuestionResults,
  wordAppearances,
  writeWordAppearances,
  writeQuestions,
} from '../composables/useLearningData'
import { allProposals as proposals, writeProposals } from '../composables/useProposals'
import { allRecords as redemptions, writeRecords } from '../composables/useActiveRedemptions'
import { readEntryVisibilityMap, writeEntryVisibilityMap } from '../composables/useEntryVisibility'
import { fetchSyncCapabilities, pullSync, pushSync, SYNC_PROTOCOL_REQUIRED } from './api'
import { syncProtocolIncompatible } from '../composables/useSafetyNotice'
import {
  diffMorale,
  mergeMorale,
  type MoraleRow,
  advanceShadowFromSent,
  diffActiveRedemptions,
  diffProposals,
  diffQuestionBanks,
  diffQuestionFlags,
  diffQuestionResults,
  diffRewardItems,
  diffStarEntries,
  diffEntryVisibility,
  diffWordAppearances,
  mergeActiveRedemptions,
  mergeProposals,
  mergeQuestionBanks,
  mergeQuestionFlags,
  mergeQuestionResults,
  mergeRewardItems,
  mergeStarEntries,
  mergeEntryVisibility,
  mergeWordAppearances,
  type ActiveRedemptionRow,
  type ProposalRow,
  type QuestionBankRow,
  type QuestionFlagRow,
  type QuestionResultRow,
  type RewardItemRow,
  type StarEntryRow,
  type SyncDomain,
  type EntryVisibilityRow,
  type WordAppearanceRow,
} from './merge'
import type {
  MoraleState,
  ActiveRedemption,
  FlaggedState,
  ProposalRecord,
  Question,
  QuestionResultsState,
  WordAppearance,
  RewardItem,
  StarEntry,
  EntryVisibilityMap,
} from '../types'

// #168 收编入册：四键键名由 useDataInfra 登记册单一来源（值不变）；
// 读写与损坏回退仍走本模块自有策略（readJson/writeJson 直落盘），不接管语义
export const SYNC_CURSOR_KEY = STORAGE_KEYS.syncCursor
export const SYNC_SHADOW_KEY = STORAGE_KEYS.syncShadow
export const SYNC_OUTBOX_KEY = STORAGE_KEYS.syncOutbox
export const SYNC_BOOTSTRAPPED_KEY = STORAGE_KEYS.syncBootstrapped
export const SYNC_RECONCILE_KEY = STORAGE_KEYS.syncReconcile
// #174 断代一次性同步重对齐标记（useDataInfra 迁移链写入；引擎消费后清 false）
export const SYNC_REALIGN_KEY = STORAGE_KEYS.syncRealign

type Row = Record<string, unknown>
type Rows = Row[]

interface MergeOutcome {
  next: unknown
  nextShadow: unknown
  changed: boolean
  appliedRows: Rows
}

/** 域适配器：引擎与合并器纯函数之间的粘合（类型边界收在本表，引擎主体域无关） */
interface DomainAdapter {
  key: StorageKey
  /** 题库家长单写（客户端同口径：child 角色不推此域，worker 403 双保险） */
  parentOnly?: boolean
  /** LWW 实体（true）：影子按行推进 + 拉侧裁决用 known；流水（false）：影子取当前态快照 */
  lww: boolean
  read(): unknown
  write(next: unknown): void
  diff(current: unknown, shadow: unknown, now: number, by: string): Rows
  merge(local: unknown, rows: Rows, known: unknown): MergeOutcome
  emptyShadow(): unknown
  isEmptyLocal(current: unknown): boolean
  identityOf(row: Row): string
}

/** 域适配器表（#248 起导出供契约测试键集合对账；运行时行为不变） */
export const ADAPTERS: Record<SyncDomain, DomainAdapter> = {
  morale: {
    key: STORAGE_KEYS.morale,
    lww: true,
    read: () => allMorale(),
    write: (next) => writeAllMorale(next as MoraleState[]),
    diff: (cur, shadow, now, by) => diffMorale(cur as MoraleState[], (shadow ?? []) as MoraleRow[], now, by) as unknown as Rows,
    merge: (local, rows, known) => mergeMorale(local as MoraleState[], rows as unknown as MoraleRow[], (known ?? []) as MoraleRow[]) as unknown as MergeOutcome,
    emptyShadow: () => [],
    isEmptyLocal: (cur) => (cur as MoraleState[]).length > 0,
    identityOf: (row) => String(row['child_id']),
  },
  entry_visibility: {
    // 逐入口键控显隐（#262）：整记录按入口 id 多行 LWW，未设置 = 默认隐藏（空记录不出行不 isEmptyLocal）
    key: STORAGE_KEYS.entryVisibility,
    lww: true,
    read: () => readEntryVisibilityMap(),
    write: (next) => writeEntryVisibilityMap(next as EntryVisibilityMap),
    diff: (cur, shadow, now, by) => diffEntryVisibility(cur as EntryVisibilityMap, (shadow ?? []) as EntryVisibilityRow[], now, by) as unknown as Rows,
    merge: (local, rows, known) => mergeEntryVisibility(local as EntryVisibilityMap, rows as unknown as EntryVisibilityRow[], (known ?? []) as EntryVisibilityRow[]) as unknown as MergeOutcome,
    emptyShadow: () => [],
    isEmptyLocal: (cur) => Object.keys(cur as EntryVisibilityMap).length > 0,
    identityOf: (row) => String(row['entry_id']),
  },
  star_entries: {
    key: STORAGE_KEYS.stars,
    lww: false,
    read: () => ledger(),
    write: (next) => writeLedger(next as StarEntry[]),
    diff: (cur, shadow) => diffStarEntries(cur as StarEntry[], (shadow ?? []) as StarEntry[]) as unknown as Rows,
    merge: (local, rows) => {
      const r = mergeStarEntries(local as StarEntry[], rows as unknown as StarEntryRow[])
      // 流水拉侧 appliedRows = 全部到岸行（身份幂等：云上必已有，可安全清 outbox 同身份待推行）
      return { next: r.next, nextShadow: r.next, changed: r.changed, appliedRows: rows }
    },
    emptyShadow: () => [],
    isEmptyLocal: (cur) => (cur as StarEntry[]).length > 0,
    identityOf: (row) => JSON.stringify([row['child_id'] ?? 'default', row['id']]),
  },
  question_results: {
    key: STORAGE_KEYS.questionResults,
    lww: false,
    read: () => questionResults(),
    write: (next) => writeQuestionResults(next as QuestionResultsState),
    diff: (cur, shadow) =>
      diffQuestionResults(cur as QuestionResultsState, (shadow ?? {}) as QuestionResultsState) as unknown as Rows,
    merge: (local, rows) => {
      const r = mergeQuestionResults(local as QuestionResultsState, rows as unknown as QuestionResultRow[])
      return { next: r.next, nextShadow: r.next, changed: r.changed, appliedRows: rows }
    },
    emptyShadow: () => ({}),
    isEmptyLocal: (cur) => Object.keys(cur as QuestionResultsState).length > 0,
    identityOf: (row) => JSON.stringify([row['child_id'] ?? 'default', row['question_id'], row['answered_at']]),
  },
  word_appearances: {
    // #178 同键事件化存储：每孩保留最新30词事实，公开清单仍为字符串数组
    key: STORAGE_KEYS.recentWords,
    lww: false,
    read: () => wordAppearances(),
    write: (next) => writeWordAppearances(next as WordAppearance[]),
    diff: (cur, shadow) =>
      diffWordAppearances(cur as WordAppearance[], (shadow ?? []) as WordAppearance[] | string[]) as unknown as Rows,
    merge: (local, rows) => {
      const r = mergeWordAppearances(local as WordAppearance[], rows as unknown as WordAppearanceRow[])
      return { next: r.next, nextShadow: r.next, changed: r.changed, appliedRows: rows }
    },
    emptyShadow: () => [],
    isEmptyLocal: (cur) => (cur as WordAppearance[]).length > 0,
    identityOf: (row) => JSON.stringify([row['child_id'] ?? 'default', row['word_id'], row['appeared_at']]),
  },
  reward_items: {
    key: STORAGE_KEYS.rewards,
    lww: true,
    read: () => rewards(),
    write: (next) => writeRewards(next as RewardItem[]),
    diff: (cur, shadow, now, by) =>
      diffRewardItems(cur as RewardItem[], (shadow ?? []) as RewardItemRow[], now, by) as unknown as Rows,
    merge: (local, rows, known) => {
      const r = mergeRewardItems(local as RewardItem[], rows as unknown as RewardItemRow[], (known ?? []) as RewardItemRow[])
      return r as unknown as MergeOutcome
    },
    emptyShadow: () => [],
    isEmptyLocal: (cur) => (cur as RewardItem[]).length > 0,
    identityOf: (row) => String(row['id']),
  },
  proposals: {
    key: STORAGE_KEYS.proposals,
    lww: true,
    read: () => proposals(),
    write: (next) => writeProposals(next as ProposalRecord[]),
    diff: (cur, shadow, now, by) =>
      diffProposals(cur as ProposalRecord[], (shadow ?? []) as ProposalRow[], now, by) as unknown as Rows,
    merge: (local, rows, known) => {
      const r = mergeProposals(local as ProposalRecord[], rows as unknown as ProposalRow[], (known ?? []) as ProposalRow[])
      return r as unknown as MergeOutcome
    },
    emptyShadow: () => [],
    isEmptyLocal: (cur) => (cur as ProposalRecord[]).length > 0,
    identityOf: (row) => JSON.stringify([row['child_id'] ?? 'default', row['id']]),
  },
  active_redemptions: {
    key: STORAGE_KEYS.activeRedemptions,
    lww: true,
    read: () => redemptions(),
    write: (next) => writeRecords(next as ActiveRedemption[]),
    diff: (cur, shadow, now, by) =>
      diffActiveRedemptions(cur as ActiveRedemption[], (shadow ?? []) as ActiveRedemptionRow[], now, by) as unknown as Rows,
    merge: (local, rows, known) => {
      const r = mergeActiveRedemptions(
        local as ActiveRedemption[],
        rows as unknown as ActiveRedemptionRow[],
        (known ?? []) as ActiveRedemptionRow[],
      )
      return r as unknown as MergeOutcome
    },
    emptyShadow: () => [],
    isEmptyLocal: (cur) => (cur as ActiveRedemption[]).length > 0,
    identityOf: (row) => JSON.stringify([row['child_id'] ?? 'default', row['id']]),
  },
  question_flags: {
    key: STORAGE_KEYS.flagged,
    lww: true,
    read: () => flagged(),
    write: (next) => writeFlagged(next as FlaggedState),
    diff: (cur, shadow, now, by) =>
      diffQuestionFlags(cur as FlaggedState, (shadow ?? []) as QuestionFlagRow[], now, by) as unknown as Rows,
    merge: (local, rows, known) => {
      const r = mergeQuestionFlags(local as FlaggedState, rows as unknown as QuestionFlagRow[], (known ?? []) as QuestionFlagRow[])
      return r as unknown as MergeOutcome
    },
    emptyShadow: () => [],
    isEmptyLocal: (cur) => Object.keys(cur as FlaggedState).length > 0,
    identityOf: (row) => JSON.stringify([row['child_id'] ?? 'default', row['question_id']]),
  },
  question_banks: {
    key: STORAGE_KEYS.questions,
    lww: true,
    parentOnly: true,
    read: () => questions(),
    write: (next) => writeQuestions(next as Question[]),
    diff: (cur, shadow, now, by) =>
      diffQuestionBanks(cur as Question[], (shadow ?? null) as QuestionBankRow | null, now, by) as unknown as Rows,
    merge: (local, rows, known) => {
      const r = mergeQuestionBanks(local as Question[], rows[0] as unknown as QuestionBankRow | undefined, (known ?? null) as QuestionBankRow | null)
      return { next: r.next, nextShadow: r.nextShadow, changed: r.changed, appliedRows: r.applied ? rows : [] }
    },
    emptyShadow: () => null,
    isEmptyLocal: (cur) => (cur as Question[]).length > 0,
    identityOf: () => 'bank',
  },
}

// #246 域遍历清单单一真相：从适配器表（Record<SyncDomain, DomainAdapter> 完整映射）的键推导导出——
// SyncDomain 联合加域而 ADAPTERS 漏配条目时，Record 穷举检查让编译直接失败（编译器护栏，替代手抄名单对账）
export const SYNC_DOMAINS: SyncDomain[] = Object.keys(ADAPTERS) as SyncDomain[]

const KEY_TO_DOMAIN = new Map<StorageKey, SyncDomain>(
  SYNC_DOMAINS.map((d) => [ADAPTERS[d].key, d] as const),
)

// ===== 模块状态 =====

let started = false
let unregisterListener: (() => void) | null = null
let unregisterCorruptionHandler: (() => void) | null = null
let applying = 0
let clockOffset = 0
let lastStamp = 0
let pushScheduled = false
const inFlight = new Set<SyncDomain>()
// #174 协议兼容已验证（会话内缓存；不兼容/未知时每周期重探，Worker 升级后自动恢复）
let protocolVerified = false
// #208 导航驱动拉取：进行中去重（任意触发源的周期在跑时导航触发不重入，AC3）、节流基准与 trailing 补跑定时器
let cycleInFlight = false
let lastNavPullAt = 0
let navTrailingTimer: ReturnType<typeof setTimeout> | null = null
// #208 内部最近同步结果（备用状态字段，本轮无失败提示 UI）
let lastSyncOutcome: SyncOutcome = 'idle'

/**
 * #174 版本不兼容防护：首次交换前能力探测（GET /api/sync/capabilities）。
 * 协议版本不足或端点不存在（旧 Worker）→ 阻断一切推拉（outbox 攒着不丢、数据与配对不动、
 * 横幅提示离线可用）；探测网络失败 → 本次不交换但不误报不兼容（下个周期重试）；
 * 401（凭据未被云端认可）→ 同样不判不兼容：不置横幅、不动配对，攒账等下个周期重试（#174 审查修复）。
 */
async function ensureProtocolCompatible(cred: DeviceCredential): Promise<boolean> {
  if (protocolVerified) return true
  const res = await fetchSyncCapabilities({ credential: cred })
  if (res.ok && res.protocol >= SYNC_PROTOCOL_REQUIRED) {
    protocolVerified = true
    if (syncProtocolIncompatible.value) syncProtocolIncompatible.value = false
    return true
  }
  if (!res.ok && res.kind === 'auth') {
    console.warn('[star-quiz] 同步能力探测收到 401（凭据未被云端认可），本次不交换、不判定版本不兼容；配对与数据不动，下个周期重试')
    return false
  }
  if (res.ok || res.kind === 'error') {
    // 明确不兼容：协议版本不足，或端点不存在/形状不对（旧 Worker 404 等）。
    // 网络失败（kind=network）是「未知」不是「不兼容」——不置横幅，攒账等重连。
    if (!syncProtocolIncompatible.value) {
      syncProtocolIncompatible.value = true
      console.warn(
        `[star-quiz] 云端同步协议不兼容${res.ok ? `（协议版本 ${res.protocol} < 要求 ${SYNC_PROTOCOL_REQUIRED}）` : '（能力探测失败：端点不存在或形状不符）'}，同步已暂停：本地离线可用，数据与配对不受影响`,
      )
    }
    return false
  }
  return false
}

// ===== 设备本地键持久化（自管理，直写 localStorage）=====

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch (cause) {
    // #169 机器自用键补日志：保留自有回退策略（回默认值），语义不变
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 数据键 ${key} 损坏，已回退默认值（原因：${reason} JSON 解析失败）`)
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function readCursor(): number {
  return readJson<number>(SYNC_CURSOR_KEY, 0)
}

function readBootstrapped(): boolean {
  return readJson<boolean>(SYNC_BOOTSTRAPPED_KEY, false)
}

// #174 断代重对齐标记（迁移链写入 true；重对齐成功清 false——幂等凭据：重复启动不重放）
function readRealignPending(): boolean {
  return readJson<boolean>(SYNC_REALIGN_KEY, false)
}

function readShadows(): Partial<Record<SyncDomain, unknown>> {
  return readJson<Partial<Record<SyncDomain, unknown>>>(SYNC_SHADOW_KEY, {})
}

function readOutbox(): Partial<Record<SyncDomain, Rows>> {
  return readJson<Partial<Record<SyncDomain, Rows>>>(SYNC_OUTBOX_KEY, {})
}

function shadowOf(domain: SyncDomain): unknown {
  const stored = readShadows()[domain]
  return stored === undefined ? ADAPTERS[domain].emptyShadow() : stored
}

function setShadow(domain: SyncDomain, value: unknown): void {
  const shadows = readShadows()
  shadows[domain] = value
  writeJson(SYNC_SHADOW_KEY, shadows)
}

function outboxOf(domain: SyncDomain): Rows {
  return readOutbox()[domain] ?? []
}

// ===== #171 T-损坏对账铁律（#67 T1 / R2-1 注册回调）：损坏重置 → 域标脏禁推 → 对账回填 → 解除 =====

/** 待对账域集合（持久化 sq_sync_reconcile：跨重载禁推不失效；对账完成清空） */
function readPendingReconcile(): Set<SyncDomain> {
  const raw = readJson<string[]>(SYNC_RECONCILE_KEY, [])
  return new Set(raw.filter((d): d is SyncDomain => (SYNC_DOMAINS as string[]).includes(d)))
}

function writePendingReconcile(set: Set<SyncDomain>): void {
  writeJson(SYNC_RECONCILE_KEY, [...set])
}

/** 损坏重置钩子（useDataInfra #169 槽位，依赖倒置）：键 → 域标脏，对账完成前禁推（防墓碑化清空云端） */
function onCorruptionReset(key: StorageKey): void {
  const domain = KEY_TO_DOMAIN.get(key)
  if (domain === undefined) return // 非同步域键不参与对账
  const pending = readPendingReconcile()
  if (pending.has(domain)) return
  pending.add(domain)
  writePendingReconcile(pending)
  console.warn(`[star-quiz] #171 损坏对账：数据键 ${key} 损坏重置，域 ${domain} 已标脏禁推（对账完成前不推）`)
}

/** 域是否禁推中（增量写入即推与全量基线推送共用此闸） */
function isPushBlocked(domain: SyncDomain): boolean {
  return readPendingReconcile().has(domain)
}

/** 待推行按身份并入 outbox（新行覆写同身份旧行——写入时刻更晚者为真相）；题库整组单行替换 */
function outboxMerge(domain: SyncDomain, rows: Rows): void {
  if (rows.length === 0) return
  const a = ADAPTERS[domain]
  const box = readOutbox()
  if (domain === 'question_banks') {
    box[domain] = rows
  } else {
    const byIdentity = new Map((box[domain] ?? []).map((r) => [a.identityOf(r), r] as const))
    for (const row of rows) byIdentity.set(a.identityOf(row), row)
    box[domain] = [...byIdentity.values()]
  }
  writeJson(SYNC_OUTBOX_KEY, box)
}

function removeFromOutbox(domain: SyncDomain, sent: Rows): void {
  const a = ADAPTERS[domain]
  const box = readOutbox()
  const current = box[domain] ?? []
  // ACK confirms only the payload sent, not a newer edit sharing its identity.
  const acknowledged = new Map(sent.map((r) => [a.identityOf(r), JSON.stringify(r)]))
  const next = current.filter((r) => acknowledged.get(a.identityOf(r)) !== JSON.stringify(r))
  if (next.length === current.length) return
  if (next.length === 0) delete box[domain]
  else box[domain] = next
  writeJson(SYNC_OUTBOX_KEY, box)
}

function clearOutboxDomain(domain: SyncDomain): void {
  const box = readOutbox()
  if (!(domain in box)) return
  delete box[domain]
  writeJson(SYNC_OUTBOX_KEY, box)
}

// ===== 时钟（本地时间戳为主 + server_at 偏移兜底，发戳单调递增）=====

function noteServerAt(serverAt: number): void {
  clockOffset = serverAt - Date.now()
}

function stamp(): number {
  const candidate = Date.now() + clockOffset
  const s = candidate > lastStamp ? candidate : lastStamp + 1
  lastStamp = s
  return s
}

// ===== 写入即推（writeValue 单一收口 → 域适配 → outbox 攒行 → 去抖批量推）=====

function onLocalWrite(key: StorageKey): void {
  if (applying > 0) return // 引擎自身落库（拉合/灌入）不自我触发
  const domain = KEY_TO_DOMAIN.get(key)
  if (domain === undefined) return
  scheduleDomainPush(domain)
}

/** 域当前态 vs 影子 diff → outbox 攒行（写入时刻发戳——离线攒账保真编辑时序） */
function scheduleDomainPush(domain: SyncDomain): void {
  if (isPushBlocked(domain)) {
    // #171 禁推：既不 diff 也不攒（重置后的本地态 vs 旧影子会生成删除墓碑，绝不能攒）
    console.warn(`[star-quiz] #171 损坏对账：域 ${domain} 禁推中，本次推送已阻断（待对账）`)
    return
  }
  const a = ADAPTERS[domain]
  if (a.parentOnly) {
    const cred = readDeviceCredential()
    if (cred !== null && cred.role !== 'parent') return // 题库家长单写（客户端同口径）
  }
  // Pending LWW rows are already local truth: reverting an in-flight edit (or deleting a
  // just-created entity) must be diffed against them, not only the last ACK's shadow.
  const baseline = a.lww ? combineKnown(domain) : shadowOf(domain)
  const rows = a.diff(a.read(), baseline, stamp(), readDeviceCredential()?.device_id ?? 'local')
  outboxMerge(domain, rows)
  schedulePush()
}

let scheduleTimer: ReturnType<typeof setTimeout> | null = null

/** 去抖：微任务批量推本 tick 全部待推域 */
function schedulePush(): void {
  if (pushScheduled) return
  pushScheduled = true
  void Promise.resolve().then(() => {
    pushScheduled = false
    void pushAllOutbox()
  })
}

async function pushAllOutbox(): Promise<void> {
  const cred = readDeviceCredential()
  if (cred === null) return // 未配对零网络：攒着不推
  if (!(await ensureProtocolCompatible(cred))) return // #174 协议不兼容 / 未知：攒着不推
  for (const domain of Object.keys(readOutbox()) as SyncDomain[]) {
    await pushDomain(cred, domain)
  }
}

/** LWW 域待推行按 id 去重（同 id 保留 updated_at 最大者——后编辑胜） */
function dedupeSent(domain: SyncDomain, rows: Rows): Rows {
  if (!ADAPTERS[domain].lww || domain === 'question_banks') return rows
  const byId = new Map<string, Row>()
  for (const row of rows) {
    const id = ADAPTERS[domain].identityOf(row)
    const prev = byId.get(id)
    if (prev === undefined || Number(row['updated_at']) >= Number(prev['updated_at'])) byId.set(id, row)
  }
  return [...byId.values()]
}

async function pushDomain(cred: DeviceCredential, domain: SyncDomain): Promise<void> {
  if (inFlight.has(domain)) return
  if (isPushBlocked(domain)) {
    console.warn(`[star-quiz] #171 损坏对账：域 ${domain} 禁推中，推送已阻断（待对账）`)
    return
  }
  const a = ADAPTERS[domain]
  if (a.parentOnly && cred.role !== 'parent') {
    clearOutboxDomain(domain) // 孩子设备不推题库（客户端口径；worker 403 双保险）
    return
  }
  const pending = outboxOf(domain)
  if (pending.length === 0) return
  const sent = dedupeSent(domain, pending)
  if (sent.length === 0) return
  inFlight.add(domain)
  try {
    const res = await pushSync({ [domain]: sent }, { credential: cred })
    if (!res.ok) return // 失败静默攒着：下次写入/冷启动/静默恢复重试
    noteServerAt(res.serverAt)
    // 影子推进：LWW/题库按行（sent 覆写）；流水取当前态快照（在途写入的增量仍在 outbox）
    setShadow(domain, a.lww ? advanceShadowFromSent(domain, shadowOf(domain), sent) : a.read())
    removeFromOutbox(domain, sent)
    // Writes while this request was in flight could not push; wake them after success only.
    if (outboxOf(domain).length > 0) schedulePush()
  } catch {
    // 任何意外异常静默（同步永不阻塞本地操作）
  } finally {
    inFlight.delete(domain)
  }
}

// ===== 拉合 =====

/** LWW 拉侧裁决基准 known = 影子 ∪ outbox（outbox 为本机更新真相，按身份胜出） */
function combineKnown(domain: SyncDomain): unknown {
  const a = ADAPTERS[domain]
  if (domain === 'question_banks') {
    const out = outboxOf(domain)[0] as unknown as QuestionBankRow | undefined
    if (out !== undefined) return out
    return shadowOf(domain)
  }
  const known = new Map<string, Row>()
  for (const row of (shadowOf(domain) ?? []) as Rows) known.set(a.identityOf(row), row)
  for (const row of outboxOf(domain)) known.set(a.identityOf(row), row)
  return [...known.values()]
}

/** 拉侧落地行清 outbox 同身份待推行（云端版本 ≥ 本机待推版本 → 推必败，先清免噪） */
function pruneOutboxApplied(domain: SyncDomain, appliedRows: Rows): void {
  if (appliedRows.length === 0) return
  const a = ADAPTERS[domain]
  const applied = new Map(appliedRows.map((r) => [a.identityOf(r), Number(r['updated_at'] ?? 0)] as const))
  const box = readOutbox()
  const current = box[domain] ?? []
  const next = current.filter((r) => {
    const at = applied.get(a.identityOf(r))
    return at === undefined ? true : Number(r['updated_at'] ?? 0) > at
  })
  if (next.length === current.length) return
  if (next.length === 0) delete box[domain]
  else box[domain] = next
  writeJson(SYNC_OUTBOX_KEY, box)
}

async function pullAndMerge(cred: DeviceCredential): Promise<SyncPullResult> {
  const res = await pullSync(readCursor(), { credential: cred })
  if (!res.ok) return PULL_FAILED
  noteServerAt(res.serverAt)
  applying++
  let landed = false
  try {
    for (const domain of SYNC_DOMAINS) {
      const rows = res.domains[domain]
      if (rows === undefined || rows.length === 0) continue
      const a = ADAPTERS[domain]
      const known = a.lww ? combineKnown(domain) : undefined
      const r = a.merge(a.read(), rows, known)
      if (r.changed) {
        a.write(r.next)
        landed = true // #208 远端行实际落库（广播依据）
      }
      setShadow(domain, r.nextShadow)
      pruneOutboxApplied(domain, r.appliedRows)
    }
  } finally {
    applying--
  }
  writeJson(SYNC_CURSOR_KEY, res.serverAt)
  return { ok: true, landed }
}

// ===== 换机首次同步（云端为准 / 首台全量上云）=====

/** 覆盖前本机数据自动导出留档（复用 useExport 双文件；留档失败不阻断灌入，不弹选择题） */
function archiveLocal(): void {
  try {
    downloadDataExport()
  } catch {
    /* 留档是兜底保险 */
  }
  try {
    downloadLedgerExport()
  } catch {
    /* 同上 */
  }
}

/** 灌入时的空本地态（云端为准：本机态整体让位） */
function emptyLocalForMerge(domain: SyncDomain): unknown {
  switch (domain) {
    case 'star_entries':
      return []
    case 'question_results':
      return {}
    case 'reward_items':
      return []
    case 'proposals':
      return []
    case 'active_redemptions':
      return []
    case 'question_flags':
      return {}
    case 'entry_visibility':
      return {}
    default:
      return ADAPTERS[domain].emptyShadow()
  }
}

async function bootstrap(cred: DeviceCredential): Promise<SyncPullResult> {
  const res = await pullSync(0, { credential: cred })
  if (!res.ok) return PULL_FAILED // 下次冷启动/写入再试
  noteServerAt(res.serverAt)
  const anyRows = SYNC_DOMAINS.some((d) => (res.domains[d]?.length ?? 0) > 0)
  applying++
  try {
    if (anyRows) {
      archiveLocal()
      for (const domain of SYNC_DOMAINS) {
        // 损坏域交给随后全量对账，不能用首次灌入覆盖重置后新写的本机行。
        if (isPushBlocked(domain)) continue
        const rows = res.domains[domain] ?? []
        const a = ADAPTERS[domain]
        if (rows.length === 0) {
          // 云端该域为空 + 本地非空 → 保留本机并推上去（云端空域不灌入空值；首台设备部分域未推齐时兜底）
          if (a.isEmptyLocal(a.read())) scheduleDomainPush(domain)
          continue
        }
        // 云端为准灌入：本地态整体让位（覆盖前已留档）——流水不并旧账、LWW 实体本机独有行一并退位；
        // 近期词同口径整体让位：按孩子从云端出现事件派生清单
        const localForMerge =
          domain === 'question_banks' ? [] : emptyLocalForMerge(domain)
        const r = a.merge(localForMerge, rows, a.lww ? a.emptyShadow() : undefined)
        a.write(r.next) // 灌入必写（覆盖语义）
        setShadow(domain, r.nextShadow)
        pruneOutboxApplied(domain, r.appliedRows)
      }
    } else {
      // 首台设备：云端全空 → 无灌入无留档，本机全量推上云
      for (const domain of SYNC_DOMAINS) scheduleDomainPush(domain)
    }
  } finally {
    applying--
  }
  writeJson(SYNC_CURSOR_KEY, res.serverAt)
  writeJson(SYNC_BOOTSTRAPPED_KEY, true)
  return { ok: true, landed: anyRows } // 灌入必写：云端有行即视为落库（首台全空时仅上推，无落库）
}

// ===== #171 T-损坏对账（影子为证人：影子有而本地无 → 云端全量回填；本地新写保留）=====

/**
 * 对账前的本机真相恢复：重置丢掉的行，其最新版本可能仍在 outbox（未推的离线编辑）——
 * 先按既有合并规则把 outbox 行落回本地（影子有而本地无的行取已知最新版回填，本地新写不回滚）。
 */
function reapplyOutboxRows(domain: SyncDomain): void {
  const a = ADAPTERS[domain]
  const box = outboxOf(domain)
  if (box.length === 0) return
  const rows = a.lww ? box.filter((r) => Number(r['deleted'] ?? 0) === 0) : box
  if (rows.length === 0) return
  const r = a.merge(a.read(), rows, a.lww ? shadowOf(domain) : undefined)
  if (r.changed) a.write(r.next)
}

/**
 * 题库对账的本地保真：重置后本机又导入过新整组（本地非空且与影子不同）→ 本地为最新版本，
 * 拉侧裁决基准以本地充作已知最新行（云端不覆写本地新导入；解除禁推后由补推上云）。
 * 返回 [裁决基准, 本地是否更新]（本地更新时影子重建为空基线，让本地整组走补推）。
 */
function knownForReconcile(domain: SyncDomain, cred: DeviceCredential): [unknown, boolean] {
  const combined = combineKnown(domain)
  if (domain !== 'question_banks') return [combined, false]
  const local = ADAPTERS[domain].read() as Question[]
  const shadow = shadowOf(domain) as QuestionBankRow | null
  if (local.length > 0 && (shadow === null || JSON.stringify(shadow.content) !== JSON.stringify(local))) {
    return [{ content: local, updated_at: stamp(), updated_by: cred.device_id }, true]
  }
  return [combined, false]
}

/**
 * #171 对账：复用基线灌入通道（pullSync(0) 全量），以影子为证人——影子有而本地无的行自云端回填，
 * 本地新写保留；完成后重建影子、解除禁推、补推影子外本地新行。
 * 拉取失败保持禁推（下个周期重试）；云端该域为空则无可回填，影子重建为空基线、本机全量补推
 * （兜底链条的每日快照回滚属家长端票，不在本票）。
 */
async function reconcilePending(cred: DeviceCredential): Promise<SyncPullResult> {
  const pending = readPendingReconcile()
  if (pending.size === 0) return { ok: true, landed: false }
  const res = await pullSync(0, { credential: cred }) // 基线通道：since=0 全量
  if (!res.ok) return PULL_FAILED // 失败静默保持禁推，下个周期重试
  noteServerAt(res.serverAt)
  applying++
  let landed = false
  try {
    for (const domain of pending) reapplyOutboxRows(domain)
    // 全量行按既有拉合规则合并（对账不另起炉灶；非待对账域一并幂等合并，游标可安全推进）
    for (const domain of SYNC_DOMAINS) {
      const rows = res.domains[domain]
      if (rows === undefined || rows.length === 0) continue
      const a = ADAPTERS[domain]
      const isPending = pending.has(domain)
      const [known, localNewerBank] = a.lww
        ? isPending
          ? knownForReconcile(domain, cred)
          : [combineKnown(domain), false]
        : [undefined, false]
      const r = a.merge(a.read(), rows, known)
      if (r.changed) {
        a.write(r.next)
        landed = true // #208 远端行实际落库（广播依据）
      }
      if (isPending && !a.lww) {
        // 流水域影子 = 已交换态快照：不能把未上云的本地新行收进影子（否则永久漏推）——
        // 影子重建为空基线，全量本地行入 outbox 重推收口（云端流水按身份幂等 DO NOTHING，重推无害）
        setShadow(domain, a.emptyShadow())
        outboxMerge(domain, a.diff(a.read(), a.emptyShadow(), stamp(), cred.device_id))
        console.warn(
          `[star-quiz] #171 损坏对账：域 ${domain} 自云端回填 ${r.appliedRows.length} 行（影子有而本地无），本地新写保留`,
        )
        continue
      }
      setShadow(domain, localNewerBank ? a.emptyShadow() : r.nextShadow)
      pruneOutboxApplied(domain, r.appliedRows)
      if (isPending) {
        console.warn(
          `[star-quiz] #171 损坏对账：域 ${domain} 自云端回填 ${r.appliedRows.length} 行（影子有而本地无），本地新写保留` +
            (localNewerBank ? '；本机新导入整组保留（补推上云）' : ''),
        )
      }
    }
    for (const domain of pending) {
      if ((res.domains[domain]?.length ?? 0) > 0) continue
      setShadow(domain, ADAPTERS[domain].emptyShadow())
      console.warn(`[star-quiz] #171 损坏对账：域 ${domain} 云端无数据，无可回填，影子重建为空基线（本地为真相）`)
    }
  } finally {
    applying--
  }
  writeJson(SYNC_CURSOR_KEY, res.serverAt)
  writePendingReconcile(new Set())
  console.warn(`[star-quiz] #171 损坏对账：域 ${[...pending].join('、')} 对账完成，影子已重建，解除禁推`)
  for (const domain of pending) scheduleDomainPush(domain) // 补推影子外本地新行（含题库本地新导入）
  return { ok: true, landed }
}

// ===== #174 断代一次性同步重对齐（重基线；与 #171 损坏对账语义区分：键不同、触发不同、日志不同）=====

/**
 * 断代重对齐（#174）：数据形状断代（8→9）后，已配对设备的旧增量游标不再可信（行身份变了形），
 * 但也不能重走首次配对（bootstrap 云端覆盖会丢本机领先）。此流程一次性、幂等、可重试：
 *   全量拉（since=0）→ 按既有分域合并规则与云端汇合（LWW 以影子∪outbox 为本机已知最新；流水并集）
 *   → 流水域名域影子重建为空基线 + 全量本地行补推（云端按身份幂等，重推无害）
 *   → 成功后清标记（重复启动不重放、不重复记账）；失败保持标记下个周期重试。
 * 损坏禁推域（#171）跳过重推攒账，留给对账流程收口（拉侧合并仍按 known 基准保本机新写）。
 */
async function realignAfterBreak(cred: DeviceCredential): Promise<SyncPullResult> {
  const res = await pullSync(0, { credential: cred }) // 基线通道：since=0 全量
  if (!res.ok) return PULL_FAILED // 失败保持标记，下个周期重试
  noteServerAt(res.serverAt)
  applying++
  let landed = false
  try {
    // 本机未同步真相先落回本地（outbox 行是迁移前攒下的线协议行，同 #171 对账口径）
    for (const domain of SYNC_DOMAINS) {
      if (!isPushBlocked(domain)) reapplyOutboxRows(domain)
    }
    for (const domain of SYNC_DOMAINS) {
      const rows = res.domains[domain] ?? []
      const a = ADAPTERS[domain]
      if (rows.length === 0) continue
      const known = a.lww ? combineKnown(domain) : undefined
      const r = a.merge(a.read(), rows, known)
      if (r.changed) {
        a.write(r.next)
        landed = true // #208 远端行实际落库（广播依据）
      }
      if (!a.lww) {
        // 流水域：影子重建为空基线，全量本地行入 outbox 重推收口（不把未上云新行收进影子致永久漏推）
        if (!isPushBlocked(domain)) {
          setShadow(domain, a.emptyShadow())
          outboxMerge(domain, a.diff(a.read(), a.emptyShadow(), stamp(), cred.device_id))
        }
        continue
      }
      setShadow(domain, r.nextShadow)
      pruneOutboxApplied(domain, r.appliedRows)
    }
  } finally {
    applying--
  }
  writeJson(SYNC_CURSOR_KEY, res.serverAt)
  writeJson(SYNC_REALIGN_KEY, false)
  console.warn('[star-quiz] #174 断代重对齐：全域对齐完成，影子已重建，标记清除')
  for (const domain of SYNC_DOMAINS) {
    if (!isPushBlocked(domain)) scheduleDomainPush(domain) // 补推影子外本地新行（LWW 域）
  }
  return { ok: true, landed }
}

// ===== #208 导航驱动拉取（去重 + 短节流 + trailing 补跑）与拉取完成广播 =====

/** 单轮拉取结果：ok=拉取请求成功；landed=远端行实际落库（本地数据变化，广播依据） */
interface SyncPullResult {
  ok: boolean
  landed: boolean
}

const PULL_FAILED: SyncPullResult = { ok: false, landed: false }

/** 最近同步结果（备用状态字段，本轮无失败提示 UI；空转轮不改写） */
export type SyncOutcome = 'idle' | 'ok' | 'failed'

/** 内部读取最近同步结果（拉取口径：拉取请求成功 ok / 失败 failed；未拉取 idle） */
export function getLastSyncOutcome(): SyncOutcome {
  return lastSyncOutcome
}

/** 拉取完成监听：同步周期成功落库（远端数据写入本地）后回调；拉取失败不回调（AC4 静默） */
export type SyncCompleteListener = () => void

const syncCompleteListeners = new Set<SyncCompleteListener>()

/** 注册拉取完成监听（页面订阅后重读本地数据实现静默刷新），返回注销函数（对齐 registerWriteListener 注册风格） */
export function registerSyncCompleteListener(listener: SyncCompleteListener): () => void {
  syncCompleteListeners.add(listener)
  return () => {
    syncCompleteListeners.delete(listener)
  }
}

function notifySyncComplete(): void {
  for (const listener of syncCompleteListeners) listener()
}

/**
 * 导航触发节流档位（票面 5–10 秒定档 5 秒）：多端同步滞后是本票要修的痛点，宁可多拉——
 * 窗口内快速切页只打一轮，窗口结束后 trailing 补跑一轮，保证最后一次导航的数据不丢。
 */
export const NAVIGATION_PULL_THROTTLE_MS = 5_000

function scheduleNavTrailing(): void {
  if (navTrailingTimer !== null) return // 补跑定时器唯一，不叠加
  navTrailingTimer = setTimeout(() => {
    navTrailingTimer = null
    void runNavCycle()
  }, NAVIGATION_PULL_THROTTLE_MS)
}

function cancelNavTrailing(): void {
  if (navTrailingTimer === null) return
  clearTimeout(navTrailingTimer)
  navTrailingTimer = null
}

async function runNavCycle(): Promise<void> {
  if (cycleInFlight) {
    scheduleNavTrailing() // 冷启动轮等仍在跑：不并发两轮（AC3），改排一轮补跑收口
    return
  }
  lastNavPullAt = Date.now()
  await runCycle()
}

/**
 * 导航触发入口（路由全局守卫唯一调用点，#208）：不等待拉取、不抛错（AC6 导航零阻塞）；
 * 未配对 / 协议未知由 runCycle 自身 gating 空转（零网络红线，判定单一出口）。
 */
export function onNavigationSync(): void {
  if (!started) return // 引擎未启动（startSync 未调，如页面测试）：空转零副作用
  if (cycleInFlight) {
    scheduleNavTrailing()
    return
  }
  if (Date.now() - lastNavPullAt < NAVIGATION_PULL_THROTTLE_MS) {
    scheduleNavTrailing() // 节流窗口内不打接口，窗口结束后补跑一轮（trailing，AC2）
    return
  }
  cancelNavTrailing() // 即时轮已保数据新鲜，取消既定补跑（防近距双轮）
  void runNavCycle()
}

// ===== 周期与生命周期 =====

async function runCycle(): Promise<void> {
  cycleInFlight = true
  try {
    const cred = readDeviceCredential()
    if (cred === null) return // 未配对（无设备凭据）：零网络请求（#125 挂载零请求口径）
    if (!(await ensureProtocolCompatible(cred))) return // #174 协议不兼容 / 未知：零推零拉
    let pull: SyncPullResult = { ok: true, landed: false }
    if (!readBootstrapped()) {
      pull = await bootstrap(cred) // 基线灌入（待对账域推送已被阻断，灌入后由对账收口）
      if (readPendingReconcile().size > 0) {
        const reconcile = await reconcilePending(cred)
        pull = { ok: pull.ok && reconcile.ok, landed: pull.landed || reconcile.landed }
      }
    } else if (readPendingReconcile().size > 0) {
      pull = await reconcilePending(cred) // #171：待对账域优先走对账（全量拉 ⊇ 增量拉）
    } else {
      pull = await pullAndMerge(cred)
    }
    if (readRealignPending()) {
      const realign = await realignAfterBreak(cred) // #174：断代重对齐（成功清标记，失败下周期重试）
      pull = { ok: pull.ok && realign.ok, landed: pull.landed || realign.landed }
    }
    lastSyncOutcome = pull.ok ? 'ok' : 'failed' // #208 内部最近同步结果（备用，无 UI）
    if (pull.landed) notifySyncComplete() // #208 拉取成功落库广播（失败不广播），页面订阅后静默重读
    await pushAllOutbox()
  } catch {
    // 意外异常静默（同步永不阻塞本地操作）
  } finally {
    cycleInFlight = false
  }
}

/**
 * 启动同步引擎（组合根 main.ts 调用；不散落页面）：注册写监听 + 冷启动拉合。
 * 未配对设备空转零网络。
 */
export function startSync(): void {
  if (started) return
  started = true
  unregisterListener = registerWriteListener(onLocalWrite)
  // #171 T1 铁律接线（#67 R2-1 注册回调，依赖倒置）：损坏重置 → 域标脏禁推；
  // 引擎启动前（init / 早期读取）已发生的损坏重置从事件台账补挂（钩子注册晚于事件的不丢）
  unregisterCorruptionHandler = registerCorruptionResetHandler(onCorruptionReset)
  for (const key of consumeCorruptionResets()) onCorruptionReset(key)
  void runCycle()
}

/** 配对成功挂钩（Pair.vue writeDeviceCredential 后调用）：宏任务延迟首启，不与路由跳转/凭据落盘争抢同帧 */
export function onPaired(): void {
  if (scheduleTimer !== null) return
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null
    void runCycle()
  }, 0)
}

/** 仅供测试：手动触发一轮同步周期（冷启动路径复用） */
export async function __runCycleForTests(): Promise<void> {
  await runCycle()
}

/** 仅供测试：复位模块状态与同步设备键（不动业务数据键） */
export function __resetSyncForTests(): void {
  unregisterListener?.()
  unregisterListener = null
  unregisterCorruptionHandler?.()
  unregisterCorruptionHandler = null
  consumeCorruptionResets() // 排空事件台账，测试间零残留
  started = false
  applying = 0
  clockOffset = 0
  lastStamp = 0
  pushScheduled = false
  if (scheduleTimer !== null) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
  // #208 导航驱动状态复位（节流基准 / trailing 定时器 / 去重标志 / 最近同步结果）
  cancelNavTrailing()
  cycleInFlight = false
  lastNavPullAt = 0
  lastSyncOutcome = 'idle'
  syncCompleteListeners.clear() // 测试间零残留（页面订阅各自注销，这里兜底）
  inFlight.clear()
  protocolVerified = false
  syncProtocolIncompatible.value = false
  localStorage.removeItem(SYNC_CURSOR_KEY)
  localStorage.removeItem(SYNC_SHADOW_KEY)
  localStorage.removeItem(SYNC_OUTBOX_KEY)
  localStorage.removeItem(SYNC_BOOTSTRAPPED_KEY)
  localStorage.removeItem(SYNC_RECONCILE_KEY)
  localStorage.removeItem(SYNC_REALIGN_KEY)
}

export type { SyncDomain }
