// 数据基础设施（T4 重构 T1，Spec 20260826-073）：数据版本检查（sq_data_version）、
// 迁移注册表与顺序编排、迁移前全量备份触发、通用读写原语（含损坏 JSON 恢复）、
// sq_last_export（上次导出时间）。
// 本模块不拥有任何业务数据：业务键初始值、迁移实现由数据所有方注册进来
// （星星域 useStarData、学习域 useLearningData、提议域 useProposals）；
// 备份导出动作由组合根 main.ts 注册（架构评审 20260829 剪环上移）。
// 全部直写 localStorage（F5：不得抽象适配层）。
// #174 升级前恢复副本（sq_upgrade_backup）与断代重对齐标记（sq_sync_realign）也归本模块收口：
// 副本写入/校验/恢复原语 + init 迁移闸门（副本不落定不动原数据）。

import { dataUpgradeBlocked } from './useSafetyNotice'

export const STORAGE_KEYS = {
  questions: 'sq_questions',
  stars: 'sq_stars',
  rewards: 'sq_rewards',
  lastExport: 'sq_last_export',
  // #173 8→9 断代改名（#166 模型决议 5）：sq_proficiency → sq_morale（临场状态），迁移 8→9 整搬
  morale: 'sq_morale',
  recentWords: 'sq_recent_words',
  flagged: 'sq_flagged',
  questionResults: 'sq_question_results',
  proposals: 'sq_proposals',
  // 进行中兑换（#73 R-72-1）：初始空数组，零迁移（老用户既有键一字不动）
  activeRedemptions: 'sq_active_redemptions',
  // #262 入口显隐（家长控制化：家庭偏好，参与云同步的独立域 entry_visibility；按入口 id 键控，未设置 = 默认隐藏）
  entryVisibility: 'sq_entry_visibility',
  dataVersion: 'sq_data_version',
  // ===== #168 收编入册（生命周期自管理键，不注册初始值，init 不初始化）=====
  // 答题会话（useQuiz 持有；损坏 = 删键，见 useQuiz）
  session: 'sq_session',
  // 出题模式选择（useQuizMode 持有；损坏 / 非法 = 删键回 normal）
  quizMode: 'sq_quiz_mode',
  // 设备凭据（useDeviceCredential 持有；损坏 / 非法 = 删键回未配对）
  deviceCredential: 'sq_device_credential',
  // 同步引擎四键（src/cloud/sync.ts 持有并保留自有回退策略，本册只登记不接管）
  syncCursor: 'sq_sync_cursor',
  syncShadow: 'sq_sync_shadow',
  syncOutbox: 'sq_sync_outbox',
  syncBootstrapped: 'sq_sync_bootstrapped',
  // #171 T-损坏对账：待对账域集合（引擎持有；损坏重置 → 标脏禁推 → 对账完成清空）
  syncReconcile: 'sq_sync_reconcile',
  // ===== #170 T-commit 落盘管家（生命周期自管理，不注册初始值，init 不初始化而先检测回滚）=====
  // 多键写捆哨兵：捆进行期间存整捆捆前值快照（{ key, raw }[]），整捆完成即删；
  // 启动检出残留 = 上次捆未完成 → 回滚捆前值。读写均收口在本模块内。
  commitSentinel: 'sq_commit_sentinel',
  // ===== #174 T-本次 8→9 数据升级保障（生命周期自管理键，不注册初始值，init 专管写入）=====
  // 升级前恢复副本：迁移动数据前持久化的迁移前原始值快照（含校验和）；设备本地键，永不上云
  upgradeBackup: 'sq_upgrade_backup',
  // 断代一次性同步重对齐标记：迁移链执行时置 true，同步引擎完成全域重对齐后清 false
  syncRealign: 'sq_sync_realign',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

/** 只供历史迁移搬运，非现役数据键；不注册默认值、不通知现役写监听。 */
export const LEGACY_PROFICIENCY_KEY = 'sq_proficiency'
export type StoredKey = StorageKey | typeof LEGACY_PROFICIENCY_KEY

// ===== #168 键元数据登记册（真相源：docs/data-keys.md 台账，一处一对照，不自行发明枚举）=====

/** 键分类（台账「分类」列取值） */
export type DataKeyCategory =
  | '家底'
  | '可弃先验'
  | '临时'
  | '机器自用'
  | '机器自用（引擎）'
  | '凭据'

/** 上云策略（台账「上云」列取值） */
export type DataKeyCloudPolicy = '参与' | '永不出本机' | '服务端有档，键不参与同步'

export interface DataKeyMeta {
  category: DataKeyCategory
  cloud: DataKeyCloudPolicy
}

/** 全部键的分类＋上云策略（与 docs/data-keys.md 台账逐键一致；改键先改表） */
export const KEY_META: Record<StorageKey, DataKeyMeta> = {
  [STORAGE_KEYS.questions]: { category: '家底', cloud: '参与' },
  [STORAGE_KEYS.flagged]: { category: '家底', cloud: '参与' },
  [STORAGE_KEYS.questionResults]: { category: '家底', cloud: '参与' },
  [STORAGE_KEYS.stars]: { category: '家底', cloud: '参与' },
  [STORAGE_KEYS.rewards]: { category: '家底', cloud: '参与' },
  [STORAGE_KEYS.proposals]: { category: '家底', cloud: '参与' },
  [STORAGE_KEYS.activeRedemptions]: { category: '家底', cloud: '参与' },
  [STORAGE_KEYS.morale]: { category: '可弃先验', cloud: '参与' },
  [STORAGE_KEYS.recentWords]: { category: '可弃先验', cloud: '参与' },
  // #262 入口显隐键控记录：可弃先验（本地丢失回默认隐藏，云端有档可拉回）、参与上云
  [STORAGE_KEYS.entryVisibility]: { category: '可弃先验', cloud: '参与' },
  [STORAGE_KEYS.session]: { category: '临时', cloud: '永不出本机' },
  [STORAGE_KEYS.quizMode]: { category: '临时', cloud: '永不出本机' },
  [STORAGE_KEYS.dataVersion]: { category: '机器自用', cloud: '永不出本机' },
  [STORAGE_KEYS.lastExport]: { category: '机器自用', cloud: '永不出本机' },
  [STORAGE_KEYS.deviceCredential]: { category: '凭据', cloud: '服务端有档，键不参与同步' },
  [STORAGE_KEYS.syncCursor]: { category: '机器自用（引擎）', cloud: '永不出本机' },
  [STORAGE_KEYS.syncShadow]: { category: '机器自用（引擎）', cloud: '永不出本机' },
  [STORAGE_KEYS.syncOutbox]: { category: '机器自用（引擎）', cloud: '永不出本机' },
  [STORAGE_KEYS.syncBootstrapped]: { category: '机器自用（引擎）', cloud: '永不出本机' },
  [STORAGE_KEYS.syncReconcile]: { category: '机器自用（引擎）', cloud: '永不出本机' },
  [STORAGE_KEYS.commitSentinel]: { category: '机器自用', cloud: '永不出本机' },
  [STORAGE_KEYS.upgradeBackup]: { category: '机器自用', cloud: '永不出本机' },
  [STORAGE_KEYS.syncRealign]: { category: '机器自用（引擎）', cloud: '永不出本机' },
}

/** 当前数据结构版本（迁移判定基准）；仅数据结构变更时递增：1→2 题目 id 重编号（R23）、2→3 掌握度/近期出词键 + difficulty 物理补 3（R24）、3→4 红旗标记键（R25）、4→5 逐题答题记录键（R27）、5→6 提议键 sq_proposals（R32）、6→7 提议最后动作归因字段（#63）、7→8 红旗瘦身：FlaggedEntry 删 correct（#69）、8→9 数据形状断代一次带全（#173：childId/kind/附加要求/大类分册+wordId 可空+trivia/近期已测词改数组/sq_proficiency→sq_morale） */
export const CURRENT_DATA_VERSION = 9

/** 迁移函数：把数据从源版本升级到下一版本 */
export type MigrationFn = () => void

/** 各数据键初始值注册表：键缺失 / JSON 损坏时的兜底来源（损坏恢复 E1） */
const dataDefaults = new Map<StorageKey, unknown>()

/** 迁移注册表：key = 源版本号，value = 该版本 → 下一版本的迁移函数（data-migration.md 约束 1） */
const migrationsRegistry = new Map<number, MigrationFn>()

/** 迁移前备份动作（由组合根 main.ts 注入：导出所有域的全量数据包） */
let migrationBackup: (() => void) | null = null

/** 注册数据键初始值（数据所有方调用；键重复注册以最后一次为准） */
export function registerDataDefaults(defaults: Partial<Record<StorageKey, unknown>>): void {
  for (const [key, value] of Object.entries(defaults)) {
    dataDefaults.set(key as StorageKey, value)
  }
}

/** 注册迁移函数（数据所有方调用；key = 源版本号，编排按版本号顺序执行） */
export function registerMigrations(migrations: Record<number, MigrationFn>): void {
  for (const [version, migrate] of Object.entries(migrations)) {
    migrationsRegistry.set(Number(version), migrate)
  }
}

/** 注册迁移前备份动作（组合根 main.ts 调用；备份失败不阻断迁移由注入方保证） */
export function registerMigrationBackup(backup: () => void): void {
  migrationBackup = backup
}

function warnMessage(key: string, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause)
  return `[star-quiz] 数据键 ${key} 损坏，已重置为初始值（原因：${reason}）`
}

function defaultFor(key: StorageKey): unknown {
  if (!dataDefaults.has(key)) {
    throw new Error(`[star-quiz] 数据键 ${key} 未注册初始值，无法兜底（需数据所有方 registerDataDefaults）`)
  }
  return dataDefaults.get(key)
}

// 读取原始 JSON 字符串；键缺失或 JSON 解析失败时重置为注册的初始值并返回（损坏恢复 E1）。
function readRaw(key: StorageKey): string {
  const raw = localStorage.getItem(key)
  if (raw !== null) {
    try {
      JSON.parse(raw)
      return raw
    } catch (cause) {
      console.warn(warnMessage(key, cause))
      notifyCorruptionReset(key)
    }
  }
  const serialized = JSON.stringify(defaultFor(key))
  localStorage.setItem(key, serialized)
  return serialized
}

/** 通用读原语：JSON.parse 还原为 T；键缺失 / 损坏时重置为注册的初始值再返回 */
export function readValue<T>(key: StorageKey): T {
  return JSON.parse(readRaw(key)) as T
}

/** 通用写原语：JSON.stringify 后直写 localStorage；批内（commit 捆中）延迟通知 */
export function writeValue(key: StoredKey, value: unknown): void {
  if (batchPreValues !== null) {
    // #170 捆内写：首次触碰的键先留捆前值快照进哨兵，落盘不走通知路径
    if (!batchPreValues.has(key)) {
      batchPreValues.set(key, localStorage.getItem(key))
      persistCommitSentinel(batchPreValues)
    }
    localStorage.setItem(key, JSON.stringify(value))
    return
  }
  localStorage.setItem(key, JSON.stringify(value))
  // #126 同步引擎写入即推挂点：单一收口通知（引擎未启动时零监听零开销；引擎自身落库自行抑制）
  if (key !== LEGACY_PROFICIENCY_KEY) {
    for (const listener of writeListeners) listener(key)
  }
}

// ===== #170 T-commit 落盘管家：多键原子提交原语＋哨兵键＋启动回滚 =====

/** 一捆中的一条写：目标键 + 内存备齐的目标值 */
export interface CommitEntry {
  key: StorageKey
  value: unknown
}

/** 哨兵快照单条：捆前原始字符串（null = 捆前键不存在，回滚 = 删键） */
interface SentinelEntry {
  key: StoredKey
  raw: string | null
}

/** 进行中捆的捆前值快照（null = 不在捆中）；哨兵键自身不入快照 */
let batchPreValues: Map<StoredKey, string | null> | null = null

/** 把当前快照整份写进哨兵键（每有新键入快照即刷新，保证任意时刻被杀哨兵都完整） */
function persistCommitSentinel(pre: Map<StoredKey, string | null>): void {
  const entries: SentinelEntry[] = []
  for (const [key, raw] of pre) entries.push({ key, raw })
  localStorage.setItem(STORAGE_KEYS.commitSentinel, JSON.stringify({ entries }))
}

/**
 * 捆执行核心：哨兵标记 → fn 内全部写直落盘（零中途通知）→ 撤哨兵 → 按键统一通知。
 * fn 中途抛异常 = 视同被杀：哨兵原样保留（启动时回滚），异常继续上抛；
 * 嵌套调用并入外层捆（迁移链整体一捆）。
 */
function runInBatch(fn: () => void): void {
  if (batchPreValues !== null) {
    fn()
    return
  }
  const pre = new Map<StoredKey, string | null>()
  batchPreValues = pre
  persistCommitSentinel(pre)
  try {
    fn()
  } catch (cause) {
    batchPreValues = null
    throw cause
  }
  localStorage.removeItem(STORAGE_KEYS.commitSentinel)
  batchPreValues = null
  // 整捆完成后按键统一通知（每个键各一次，保持 #126 键级契约）
  for (const key of pre.keys()) {
    if (key === LEGACY_PROFICIENCY_KEY) continue
    for (const listener of writeListeners) {
      listener(key)
    }
  }
}

/**
 * 批量提交原语（#170）：内存备齐 → 哨兵标记（含捆前值快照）→ 同步依次落盘 →
 * 撤哨兵 → 统一写监听通知。落盘期间零写监听触发；中途被杀由启动检测回滚。
 */
export function commit(entries: CommitEntry[]): void {
  runInBatch(() => {
    for (const entry of entries) {
      writeValue(entry.key, entry.value)
    }
  })
}

/**
 * 启动检测（#170）：哨兵残留 = 上次多键捆未完成 → 回滚全部捆内键到捆前值
 * （捆前不存在的键删键）→ 日志 → 清哨兵；哨兵自身损坏 = 无法回滚，删键 + 日志兜底。
 * 回滚不走写监听通知（启动时引擎未启动，与 init 既有口径一致），
 * 也不触发 #169 损坏对账钩子（回滚是恢复原值而非重置，无数据丢失）。
 */
export function recoverUnfinishedCommit(): void {
  const raw = localStorage.getItem(STORAGE_KEYS.commitSentinel)
  if (raw === null) return
  let entries: SentinelEntry[] | null = null
  try {
    const parsed = JSON.parse(raw) as { entries: SentinelEntry[] }
    if (Array.isArray(parsed.entries)) entries = parsed.entries
  } catch {
    entries = null
  }
  if (entries === null) {
    console.warn(
      `[star-quiz] 哨兵键 ${STORAGE_KEYS.commitSentinel} 损坏，无法回滚未完成写捆，已删除`,
    )
  } else {
    for (const entry of entries) {
      if (entry.raw === null) localStorage.removeItem(entry.key)
      else localStorage.setItem(entry.key, entry.raw)
    }
    console.warn(
      `[star-quiz] 检出未完成多键写捆，已回滚到捆前值（键：${entries
        .map((entry) => entry.key)
        .join('、')}）`,
    )
  }
  localStorage.removeItem(STORAGE_KEYS.commitSentinel)
}

/** 数据键写监听（#126 同步引擎注册）：writeValue 落盘后同步回调（键级） */
export type WriteListener = (key: StorageKey) => void

const writeListeners = new Set<WriteListener>()

/** 注册写监听，返回注销函数 */
export function registerWriteListener(listener: WriteListener): () => void {
  writeListeners.add(listener)
  return () => {
    writeListeners.delete(listener)
  }
}

/**
 * 可选读原语（#169 三态化）：正常 / 不存在 / 损坏三态判别返回，损坏态带原因；
 * 原语本身不落盘、不删键、不重置、不校验初始值注册。
 * 供生命周期自管理的基础设施键（如会话 / 出题模式）使用——"缺失"是其合法状态；
 * 临时键损坏口径（删键 + 日志）由调用方收口。
 */
export type OptionalReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'corrupt'; reason: string }

export function readOptionalValue<T>(key: StorageKey): OptionalReadResult<T> {
  const raw = localStorage.getItem(key)
  if (raw === null) return { status: 'missing' }
  try {
    return { status: 'ok', value: JSON.parse(raw) as T }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    return { status: 'corrupt', reason }
  }
}

// ===== #169 T1 对账钩子（可注册接口；对账实现属对账票，提示属导入体验票，本票只留挂点）=====

/** 损坏重置通知：上云=参与的键（家底 + 可弃先验，铁律「不论可弃与否」）重置后触发 */
export type CorruptionResetHandler = (key: StorageKey) => void

const corruptionResetHandlers = new Set<CorruptionResetHandler>()

/** 注册损坏重置处理器（对账票 / 提示票在此挂点），返回注销函数 */
export function registerCorruptionResetHandler(handler: CorruptionResetHandler): () => void {
  corruptionResetHandlers.add(handler)
  return () => {
    corruptionResetHandlers.delete(handler)
  }
}

/** 损坏重置后通知全部已注册处理器（键级，data-keys.md T1 铁律：上云参与的键损坏重置必触发） */
function notifyCorruptionReset(key: StorageKey): void {
  if (KEY_META[key].cloud !== '参与') return
  corruptionResetLog.push(key)
  for (const handler of corruptionResetHandlers) {
    handler(key)
  }
}

// ===== #171 损坏重置事件台账（引擎启动补挂用）=====
// 损坏重置可能发生在同步引擎注册钩子之前（启动 init / 早期模块读取），事件台账保证不丢：
// 引擎 startSync 时取走消费（依赖倒置不变：本模块不知道引擎存在）。

const corruptionResetLog: StorageKey[] = []

/** 取走并清空自模块加载以来的损坏重置事件（键级，仅上云参与键；同步引擎启动时消费） */
export function consumeCorruptionResets(): StorageKey[] {
  const log = corruptionResetLog.slice()
  corruptionResetLog.length = 0
  return log
}

/**
 * 裸读原语（#168）：返回原始字符串，键缺失 → null；不解析、不落盘、不重置、不校验注册。
 * 供生命周期自管理键的持有方（会话 / 模式 / 凭据——损坏 = 删键由持有方自决）与
 * 历史迁移函数（损坏跳过由启动初始化兜底）收编用，仓内不再直用浏览器存储接口。
 */
export function readRawValue(key: StoredKey): string | null {
  return localStorage.getItem(key)
}

/** 删除原语：捆内先留捆前值，迁移改名删旧键也必须可回滚；捆外语义不变。 */
export function deleteValue(key: StoredKey): void {
  if (batchPreValues !== null && !batchPreValues.has(key)) {
    batchPreValues.set(key, localStorage.getItem(key))
    persistCommitSentinel(batchPreValues)
  }
  localStorage.removeItem(key)
}

/** 迁移前全量备份触发（REQ-1.5）：动作由组合根（main.ts）注册（导出所有域）；未注册则跳过 */
function backupBeforeMigration(): void {
  migrationBackup?.()
}

// ===== #174 T-升级前恢复副本（设备本地键 sq_upgrade_backup：可持久化、可校验、可恢复）=====

/** 副本覆盖的数据键：全部上云参与的业务数据键 + 历史迁移搬运键（保守全集，覆盖任何在册迁移触达的键） */
const UPGRADE_BACKUP_DATA_KEYS: StoredKey[] = [
  STORAGE_KEYS.questions,
  STORAGE_KEYS.flagged,
  STORAGE_KEYS.questionResults,
  STORAGE_KEYS.stars,
  STORAGE_KEYS.rewards,
  STORAGE_KEYS.proposals,
  STORAGE_KEYS.activeRedemptions,
  STORAGE_KEYS.morale,
  STORAGE_KEYS.recentWords,
  LEGACY_PROFICIENCY_KEY,
]

/** 副本单条：迁移前原始字符串（null = 迁移前键不存在，恢复 = 删键） */
export interface UpgradeBackupEntry {
  key: string
  raw: string | null
}

/** 副本整包：源版本 + 校验和 + 迁移前原始值快照 */
export interface UpgradeBackup {
  fromVersion: number
  createdAt: number
  checksum: string
  entries: UpgradeBackupEntry[]
}

/** 条目校验和（FNV-1a 32 位，键与原文逐条拌入；同步原语不引异步 crypto） */
function checksumEntries(entries: UpgradeBackupEntry[]): string {
  let hash = 0x811c9dc5
  for (const entry of entries) {
    const segment = `${entry.key}\u0000${entry.raw ?? ''}\u0001`
    for (let i = 0; i < segment.length; i++) {
      hash ^= segment.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  return hash.toString(16)
}

function isValidBackup(parsed: unknown, fromVersion: number): parsed is UpgradeBackup {
  if (typeof parsed !== 'object' || parsed === null) return false
  const backup = parsed as UpgradeBackup
  return (
    backup.fromVersion === fromVersion &&
    typeof backup.checksum === 'string' &&
    Array.isArray(backup.entries) &&
    backup.entries.every((e) => typeof e?.key === 'string' && (e.raw === null || typeof e.raw === 'string')) &&
    checksumEntries(backup.entries) === backup.checksum
  )
}

/**
 * 持久化升级前副本并回读校验（#174 闸门）：写完必须读得回、校验得过才算落定。
 * 任何失败返回 false——调用方（init）据此拒绝本次迁移，不修改原数据。
 */
export function persistUpgradeBackup(fromVersion: number): boolean {
  try {
    const entries = UPGRADE_BACKUP_DATA_KEYS.map((key) => ({ key, raw: localStorage.getItem(key) }))
    const backup: UpgradeBackup = {
      fromVersion,
      createdAt: Date.now(),
      checksum: checksumEntries(entries),
      entries,
    }
    localStorage.setItem(STORAGE_KEYS.upgradeBackup, JSON.stringify(backup))
    const raw = localStorage.getItem(STORAGE_KEYS.upgradeBackup)
    if (raw === null) return false
    return isValidBackup(JSON.parse(raw), fromVersion)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 升级前恢复副本保存/校验失败（原因：${reason}）`)
    return false
  }
}

/** 读取并校验副本；缺失或校验不过返回 null（不盲恢复） */
export function readUpgradeBackup(): UpgradeBackup | null {
  const raw = localStorage.getItem(STORAGE_KEYS.upgradeBackup)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { fromVersion?: unknown }
    if (typeof parsed.fromVersion !== 'number' || !isValidBackup(parsed, parsed.fromVersion)) return null
    return parsed as UpgradeBackup
  } catch {
    return null
  }
}

/**
 * 从副本恢复迁移前原始值（人工兜底通道）；副本无效返回 false。
 * 版本号一并回退到 fromVersion：恢复后 init 识别为待升级现场、重跑迁移链（重对齐标记随迁移捆重新置位），
 * 避免 v8 形状数据留在版本 9 下被当作已升级（#174 审查修复）。
 */
export function restoreUpgradeBackup(): boolean {
  const backup = readUpgradeBackup()
  if (backup === null) return false
  for (const entry of backup.entries) {
    if (entry.raw === null) localStorage.removeItem(entry.key)
    else localStorage.setItem(entry.key, entry.raw)
  }
  localStorage.setItem(STORAGE_KEYS.dataVersion, String(backup.fromVersion))
  return true
}

/** 从 fromVersion 逐步执行迁移链到 CURRENT_DATA_VERSION（循环内不写版本号，中间版本不落盘） */
function runMigrations(fromVersion: number): void {
  let v = fromVersion
  while (v < CURRENT_DATA_VERSION) {
    const migrate = migrationsRegistry.get(v)
    if (migrate) migrate()
    v += 1
  }
}

/**
 * 迁移入口（#174 闸门前移）：先持久化并校验升级前恢复副本——副本不落定即拒绝本次迁移，
 * 原数据一字不动（版本号不写，下次启动自动重试；持续失败经 useSafetyNotice 横幅明确提示）。
 * 副本落定后：#170 迁移链整体一捆（外部下载备份 → 迁移 → 版本号 → 断代重对齐标记），
 * 中途被杀启动回滚到整链前（迁移幂等可重跑；副本与哨兵同批次落盘，回滚后副本仍对应捆前态）。
 * 外部下载备份保留但不再是成功凭据（凭据 = 持久化副本校验通过）。
 */
function migrateFrom(fromVersion: number): void {
  if (!persistUpgradeBackup(fromVersion)) {
    console.warn(
      `[star-quiz] 升级前恢复副本未落定，本次启动不修改原数据（版本保持 ${fromVersion}，下次启动自动重试）`,
    )
    dataUpgradeBlocked.value = true
    return
  }
  runInBatch(() => {
    backupBeforeMigration()
    runMigrations(fromVersion)
    writeValue(STORAGE_KEYS.dataVersion, CURRENT_DATA_VERSION)
    // #174 断代一次性同步重对齐标记：随迁移捆原子落盘（迁移被回滚则标记一并消失），引擎消费后清 false
    writeValue(STORAGE_KEYS.syncRealign, true)
  })
}

/** 是否存在既有数据（任一基础数据键 getItem !== null）——用于区分全新安装与老用户升级 */
function hasExistingData(): boolean {
  return (
    localStorage.getItem(STORAGE_KEYS.questions) !== null ||
    localStorage.getItem(STORAGE_KEYS.stars) !== null ||
    localStorage.getItem(STORAGE_KEYS.rewards) !== null
  )
}

/**
 * 启动初始化：先做数据版本检查（不经读取兜底，避免写初始值破坏"是否老用户"判断，REQ-1.2）；
 * 再对全部已注册初始值的数据键做初始化/校验（幂等）。
 * 版本分支（REQ-1.3）：
 *   - 缺失 + 无既有数据 → 全新安装：直接写版本，不触发备份
 *   - 缺失 + 有既有数据 → 老用户升级：备份 → 迁移链 → 写版本
 *   - < CURRENT → 备份 → 迁移链 → 写 CURRENT
 *   - = CURRENT → 无操作
 *   - > CURRENT → 不动数据，warn 提示版本超前（不回滚）
 */
export function init(): void {
  // #170 启动第一件事：检出未完成多键写捆并回滚（含上一条迁移链捆），再做版本检查
  recoverUnfinishedCommit()
  const stored = localStorage.getItem(STORAGE_KEYS.dataVersion)
  const userVersion = stored === null ? null : Number(stored)

  if (userVersion === null) {
    if (hasExistingData()) {
      migrateFrom(0)
    } else {
      localStorage.setItem(STORAGE_KEYS.dataVersion, String(CURRENT_DATA_VERSION))
    }
  } else if (userVersion < CURRENT_DATA_VERSION) {
    migrateFrom(userVersion)
  } else if (userVersion === CURRENT_DATA_VERSION) {
    // 已是当前版本，无操作
  } else {
    console.warn(
      `[star-quiz] 数据版本 ${userVersion} 超前于当前版本 ${CURRENT_DATA_VERSION}，可能来自更高版本，数据未改动`,
    )
  }

  // 初始化全部已注册初始值的数据键（dataVersion 已由版本检查路径管理，不经读取兜底）
  for (const key of dataDefaults.keys()) {
    readRaw(key)
  }
}

// sq_last_export（上次导出时间）归本模块所有
export function readLastExport(): string {
  return readValue<string>(STORAGE_KEYS.lastExport)
}

export function writeLastExport(iso: string): void {
  writeValue(STORAGE_KEYS.lastExport, iso)
}

// 自有键初始值：sq_last_export 默认空串（无导出记录）
registerDataDefaults({ [STORAGE_KEYS.lastExport]: '' })
