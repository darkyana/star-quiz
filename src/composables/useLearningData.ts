// 学习域数据模块（T4 重构 T3，Spec 20260826-073）：拥有题池（sq_questions）、红旗标记（sq_flagged）、
// 临场状态（sq_morale，#173 由 sq_proficiency 改名整搬）、近期已测词（sq_recent_words，#173 改形字符串数组）、
// 逐题答题记录（sq_question_results）。
// 学习域初始值与迁移实现（1→2 / 2→3 / 3→4 / 4→5 / 7→8 / 8→9，全部经 useDataInfra 注册表接手；
// 8→9 断代一次带全六项形状改动，跨域键（星星/提议/进行中兑换）按裸键读写、不依赖各域模块）。
// 迁移前全量备份由组合根 main.ts 注册（本模块不反向依赖 useExport，架构评审 20260829）。
// 存储读写走 useDataInfra 原语。全部直写 localStorage（F5：不得抽象适配层）。

import type {
  Question,
  WordAppearance,
  MoraleState,
  RecentWords,
  FlaggedState,
  QuestionResultsState,
} from '../types'
import {
  DEFAULT_CHILD_ID,
  DEFAULT_QUESTION_CATEGORY,
  DEFAULT_QUESTION_BOOK,
  DEFAULT_STAR_KIND,
  RECENT_WORDS_LIMIT,
} from '../types'
import { latestWordEvents, wordEventsOf } from '../utils/recentWords'
import { flagKey, flagQuestionId, flagEntry } from '../utils/learningIdentity'
import { currentQuestionBank } from '../data/current-questions'
import {
  STORAGE_KEYS,
  LEGACY_PROFICIENCY_KEY,
  type StoredKey,
  readValue,
  writeValue,
  readRawValue,
  deleteValue,
  registerDataDefaults,
  registerMigrations,
  type MigrationFn,
} from './useDataInfra'

/** 各业务键初始值（迁移初始化与注册默认值共用同一份，保证两处一致）
 *  #173 目标形状：临场状态带 childId；近期已测词为字符串数组（新→旧，上限 30）；
 *  内置题库物理带学科初始归类（大类/分册）。 */
const INITIAL_MORALE: MoraleState = { level: 1, lastRoundCorrect: null, childId: DEFAULT_CHILD_ID }
const INITIAL_RECENT_WORDS: RecentWords = []
const INITIAL_FLAGGED: FlaggedState = {}
const INITIAL_QUESTION_RESULTS: QuestionResultsState = {}

/** 内置题库（8→9 起物理带大类/分册学科初始归类，全家共享不挂 childId） */
const INITIAL_QUESTIONS: Question[] = currentQuestionBank.questions.map((q) => ({
  ...q,
  category: q.category ?? DEFAULT_QUESTION_CATEGORY,
  book: q.book ?? DEFAULT_QUESTION_BOOK,
}))

/**
 * 迁移专用读取 sq_questions：键缺失返回 null（REQ-R23-3-3 跳过迁移不写回，题库由
 * 读取兜底初始化）；内容损坏同样跳过并 warn（损坏恢复 E1 归读取兜底重置，
 * 不在迁移内制造覆盖）。存储层故障（读取抛错）按异常传播，版本号不写入（REQ-R23-3-5）。
 * #168 收编：裸读经 useDataInfra readRawValue，语义不变。
 */
function readQuestionsForMigration(): Question[] | null {
  const raw = readRawValue(STORAGE_KEYS.questions)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as Question[]
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] sq_questions 损坏，跳过数据迁移（由启动初始化重置，原因：${reason}）`)
    return null
  }
}

/** 迁移专用读取：任意键缺失返回 null、损坏返回 null 并 warn（各键迁移统一防御口径） */
function readForMigration<T>(key: StoredKey, label: string): T | null {
  const raw = readRawValue(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] ${label}（${key}）损坏，跳过 8→9 迁移（由启动初始化重置兜底，原因：${reason}）`)
    return null
  }
}

/** 1→2（R23 REQ-R23-3）：sq_questions 按数组顺序把每题 id 重编号为 6 位补零序号；wordId 与其余字段不动，条数不丢 */
function migrateRenumberQuestionIds(): void {
  const questions = readQuestionsForMigration()
  if (questions === null) return
  questions.forEach((question, index) => {
    question.id = String(index + 1).padStart(6, '0')
  })
  writeValue(STORAGE_KEYS.questions, questions)
}

/** 2→3（R24 REQ-R24-3）：初始化 sq_proficiency / sq_recent_words（键已存在不覆盖）；sq_questions 每题物理补 difficulty: 3（已有值不动） */
function migrateInitStatsAndDifficulty(): void {
  if (readRawValue(LEGACY_PROFICIENCY_KEY) === null) {
    writeValue(LEGACY_PROFICIENCY_KEY, { level: 1, lastRoundCorrect: null })
  }
  if (readRawValue(STORAGE_KEYS.recentWords) === null) {
    writeValue(STORAGE_KEYS.recentWords, { seq: 0, words: {} })
  }
  const questions = readQuestionsForMigration()
  if (questions === null) return
  let changed = false
  questions.forEach((question) => {
    if (question.difficulty === undefined) {
      question.difficulty = 3
      changed = true
    }
  })
  if (changed) {
    writeValue(STORAGE_KEYS.questions, questions)
  }
}

/** 3→4（R25 REQ-R25-7）：初始化 sq_flagged 红旗标记键（键已存在不覆盖） */
function migrateInitFlagged(): void {
  if (readRawValue(STORAGE_KEYS.flagged) === null) {
    writeValue(STORAGE_KEYS.flagged, INITIAL_FLAGGED)
  }
}

/** 4→5（R27 REQ-R27-3）：初始化 sq_question_results 逐题答题记录键（键已存在不覆盖） */
function migrateInitQuestionResults(): void {
  if (readRawValue(STORAGE_KEYS.questionResults) === null) {
    writeValue(STORAGE_KEYS.questionResults, INITIAL_QUESTION_RESULTS)
  }
}

/**
 * 7→8（#69 老板拍板）：遍历 sq_flagged 剥掉各条目上的 correct（是否标记 = 键存在与否；
 * 对错信息由 questionResults 逐题记录承担）。无变化不写回；JSON 损坏跳过并 warn
 * （由启动初始化重置兜底，不在迁移内制造覆盖，沿 readQuestionsForMigration 先例）。
 */
function migrateStripFlaggedCorrect(): void {
  const raw = readRawValue(STORAGE_KEYS.flagged)
  if (raw === null) return
  let state: FlaggedState
  try {
    state = JSON.parse(raw) as FlaggedState
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] sq_flagged 损坏，跳过红旗瘦身迁移（由启动初始化重置，原因：${reason}）`)
    return
  }
  let changed = false
  for (const entry of Object.values(state) as unknown as Array<Record<string, unknown>>) {
    if (entry !== null && typeof entry === 'object' && 'correct' in entry) {
      delete entry.correct
      changed = true
    }
  }
  if (changed) {
    writeValue(STORAGE_KEYS.flagged, state)
  }
}

// ===== 8→9（#173 数据形状断代，一次带全六项；#166 模型决议 / docs/data-keys.md 台账）=====

/** ⑤ sq_proficiency → sq_morale 改名整搬：值原样搬（补 childId），旧键删除；两键皆无 → 交给读取兜底初始化。
 *  sq_morale 已存在（半迁移重跑）：不搬运旧值，但缺 childId 仍补齐（#173 目标形状齐一）。 */
function migrateRenameMorale(): void {
  const legacyRaw = readRawValue(LEGACY_PROFICIENCY_KEY)
  if (readRawValue(STORAGE_KEYS.morale) === null) {
    if (legacyRaw !== null) {
      const state = readForMigration<MoraleState>(LEGACY_PROFICIENCY_KEY, '旧临场状态')
      // 只捕获解析失败；落盘失败必须传播，整捆回滚时才能保留旧值。
      if (state !== null) {
        writeValue(STORAGE_KEYS.morale, { ...state, childId: state.childId ?? DEFAULT_CHILD_ID })
      }
    }
  } else {
    const existing = readForMigration<MoraleState>(STORAGE_KEYS.morale, '临场状态')
    if (existing !== null && existing.childId === undefined) {
      writeValue(STORAGE_KEYS.morale, { ...existing, childId: DEFAULT_CHILD_ID })
    }
  }
  if (legacyRaw !== null) deleteValue(LEGACY_PROFICIENCY_KEY)
}

/** ④ 近期已测词改形：{seq, words} → 字符串数组（新→旧，上限 30）；已是数组或键缺失不动。 */
function migrateRecentWordsToArray(): void {
  const convert = (state: unknown): RecentWords | null => {
    if (state === null || Array.isArray(state) || typeof state !== 'object') return null
    if (typeof (state as { seq?: unknown }).seq !== 'number') return null
    const words = (state as { words?: Record<string, number> }).words
    if (typeof words !== 'object' || words === null) return null
    return Object.entries(words).sort((a, b) => b[1] - a[1]).map(([wordId]) => wordId).slice(0, RECENT_WORDS_LIMIT)
  }
  const list = convert(readForMigration<unknown>(STORAGE_KEYS.recentWords, '近期已测词'))
  if (list !== null) writeValue(STORAGE_KEYS.recentWords, list)
  // 影子保存同形快照，也须改形，否则下次 diff 会把旧对象当可迭代数组。
  // 只适配词清单，不重置游标/其他域；全域重基线仍由 #174 负责。
  const shadow = readForMigration<Record<string, unknown>>(STORAGE_KEYS.syncShadow, '同步影子')
  if (shadow !== null && typeof shadow === 'object' && !Array.isArray(shadow)) {
    const words = convert(shadow.word_appearances)
    if (words !== null) writeValue(STORAGE_KEYS.syncShadow, { ...shadow, word_appearances: words })
  }
}

/** ④+③ 题池：每题物理补大类/分册学科初始归类（已有值不动；wordId 兼容不动、type 不动） */
function migrateQuestionsCategoryBook(): void {
  const questions = readQuestionsForMigration()
  if (questions === null) return
  let changed = false
  for (const q of questions) {
    if (q.category === undefined) {
      q.category = DEFAULT_QUESTION_CATEGORY
      changed = true
    }
    if (q.book === undefined) {
      q.book = DEFAULT_QUESTION_BOOK
      changed = true
    }
  }
  if (changed) writeValue(STORAGE_KEYS.questions, questions)
}

/** ①+② 跨域数据行补默认值：星星流水（kind=主星、childId）、提议 / 进行中兑换 / 红旗条目 / 逐题记录（childId）。
 *  各键缺失跳过（读取兜底初始化）；损坏跳过并 warn；无变化不写回（幂等）。 */
function migrateStampRows(): void {
  type Row = Record<string, unknown>
  const stampRows = (key: StoredKey, label: string, stamp: (row: Row) => boolean) => {
    const rows = readForMigration<Row[]>(key, label)
    if (!Array.isArray(rows)) return
    let changed = false
    for (const row of rows) {
      if (row !== null && typeof row === 'object' && stamp(row)) changed = true
    }
    if (changed) writeValue(key, rows)
  }
  stampRows(STORAGE_KEYS.stars, '星星流水', (row) => {
    let changed = false
    if (row.kind === undefined) {
      row.kind = DEFAULT_STAR_KIND
      changed = true
    }
    if (row.childId === undefined) {
      row.childId = DEFAULT_CHILD_ID
      changed = true
    }
    return changed
  })
  stampRows(STORAGE_KEYS.proposals, '提议板', (row) => {
    if (row.childId === undefined) {
      row.childId = DEFAULT_CHILD_ID
      return true
    }
    return false
  })
  stampRows(STORAGE_KEYS.activeRedemptions, '进行中兑换', (row) => {
    if (row.childId === undefined) {
      row.childId = DEFAULT_CHILD_ID
      return true
    }
    return false
  })
  // 红旗条目 / 逐题记录为映射值结构（非顶层数组），单独遍历
  const flagged = readForMigration<Record<string, Row>>(STORAGE_KEYS.flagged, '红旗')
  if (flagged !== null && typeof flagged === 'object') {
    let changed = false
    for (const entry of Object.values(flagged)) {
      if (entry !== null && typeof entry === 'object' && entry.childId === undefined) {
        entry.childId = DEFAULT_CHILD_ID
        changed = true
      }
    }
    if (changed) writeValue(STORAGE_KEYS.flagged, flagged)
  }
  const results = readForMigration<Record<string, Row[]>>(STORAGE_KEYS.questionResults, '逐题答题记录')
  if (results !== null && typeof results === 'object') {
    let changed = false
    for (const records of Object.values(results)) {
      if (!Array.isArray(records)) continue
      for (const record of records) {
        if (record !== null && typeof record === 'object' && record.childId === undefined) {
          record.childId = DEFAULT_CHILD_ID
          changed = true
        }
      }
    }
    if (changed) writeValue(STORAGE_KEYS.questionResults, results)
  }
}

/** 8→9 断代整搬（一次带全，#173 上篇：形状断代；各步幂等，可重跑） */
function migrateV8ToV9(): void {
  migrateRenameMorale()
  migrateRecentWordsToArray()
  migrateQuestionsCategoryBook()
  migrateStampRows()
}

/**
 * 迁移注册表：key = 源版本号，value = 该版本 → 下一版本的迁移函数（data-migration.md 约束 1）。
 * 1→2：存量题 id 重编号（R23）；2→3：掌握度/近期出词键 + difficulty 补 3（R24）；3→4：红旗键（R25）；
 * 4→5：逐题记录键（R27）；7→8：红旗瘦身（#69）；8→9：数据形状断代一次带全（#173）。
 */
const migrations: Record<number, MigrationFn> = {
  1: migrateRenumberQuestionIds,
  2: migrateInitStatsAndDifficulty,
  3: migrateInitFlagged,
  4: migrateInitQuestionResults,
  7: migrateStripFlaggedCorrect,
  8: migrateV8ToV9,
}

// ===== 读写对（接口签名以 Spec §实现提示类型形状为准）=====

/** 题池读取 */
export function questions(): Question[] {
  return readValue<Question[]>(STORAGE_KEYS.questions)
}

/** 题池写入（导入题库追加合并场景整组替换） */
export function writeQuestions(qs: Question[]): void {
  writeValue(STORAGE_KEYS.questions, qs)
}

/** 红旗标记读取 */
export function allFlagged(): FlaggedState {
  return Object.fromEntries(Object.entries(readValue<FlaggedState>(STORAGE_KEYS.flagged)).map(([key, row]) =>
    [flagKey(flagQuestionId(key, row), row.childId), flagEntry(flagQuestionId(key, row), row)]))
}

export function flagged(childId = DEFAULT_CHILD_ID): FlaggedState {
  return Object.fromEntries(Object.entries(allFlagged()).filter(([, r]) => (r.childId ?? DEFAULT_CHILD_ID) === childId)
    .map(([key, row]) => {
      const { questionId: _questionId, ...view } = row
      return [flagQuestionId(key, row), view]
    }))
}

export function writeAllFlagged(state: FlaggedState): void {
  writeValue(STORAGE_KEYS.flagged, state)
}

/** 红旗标记写入 */
export function writeFlagged(f: FlaggedState, childId = DEFAULT_CHILD_ID): void {
  const other = Object.fromEntries(Object.entries(allFlagged()).filter(([, r]) => (r.childId ?? DEFAULT_CHILD_ID) !== childId))
  for (const [qid, row] of Object.entries(f)) other[flagKey(qid, childId)] = flagEntry(qid, childId === DEFAULT_CHILD_ID ? row : { ...row, childId })
  writeAllFlagged(other)
}

/** 全孩同步视图；兼容第9版单行。未作答的初始档位只是读取兜底，不是待推事实。 */
export function allMorale(): MoraleState[] {
  const stored = readValue<MoraleState | { states: MoraleState[] }>(STORAGE_KEYS.morale)
  if ('states' in stored) return stored.states
  if (stored.level === 1 && stored.lastRoundCorrect === null && (stored.childId ?? DEFAULT_CHILD_ID) === DEFAULT_CHILD_ID) return []
  return [stored]
}

/** 默认孩子体验不变；读取其他孩子不会初始化或改写其状态。 */
export function morale(childId = DEFAULT_CHILD_ID): MoraleState {
  return allMorale().find((m) => (m.childId ?? DEFAULT_CHILD_ID) === childId) ?? { ...INITIAL_MORALE, childId }
}

/** 同步整域写。常见单行保留旧落盘形状；多孩/显式初始态用同键容器避免默认值冒充事实。 */
export function writeAllMorale(states: MoraleState[]): void {
  const single = states[0]
  writeValue(STORAGE_KEYS.morale, states.length === 1 && single && !(single.level === 1 && single.lastRoundCorrect === null)
    ? single : { states })
}

/** 替换一个孩子的临场状态，保留其他孩子。 */
export function writeMorale(m: MoraleState): void {
  const childId = m.childId ?? DEFAULT_CHILD_ID
  writeAllMorale([...allMorale().filter((r) => (r.childId ?? DEFAULT_CHILD_ID) !== childId), m])
}

/** 近期已测词读取（字符串数组，新→旧，上限 30；#173 前形 {seq, words}） */
export function wordAppearances(): WordAppearance[] {
  const stored = readValue<RecentWords | { appearances: WordAppearance[] }>(STORAGE_KEYS.recentWords)
  return latestWordEvents(Array.isArray(stored) ? wordEventsOf(stored) : stored.appearances)
}

export function recentWords(childId = DEFAULT_CHILD_ID): RecentWords {
  return wordAppearances().filter((r) => r.childId === childId).map((r) => r.wordId)
}

/** 同步整域写：保留事件时刻，不能当成一次新的本机出现。 */
export function writeWordAppearances(events: WordAppearance[]): void {
  writeValue(STORAGE_KEYS.recentWords, { appearances: latestWordEvents(events) })
}

/** 公开清单替换：保留有序后缀的旧时刻，新增/前移词刷新时刻；其他孩子完全不动。 */
export function writeRecentWords(rw: RecentWords, childId = DEFAULT_CHILD_ID): void {
  const all = wordAppearances()
  const previous = new Map(all.filter((r) => r.childId === childId).map((r) => [r.wordId, r]))
  const words = [...new Set(rw)].slice(0, RECENT_WORDS_LIMIT)
  const now = Math.max(Date.now(), ...all.filter((r) => r.childId === childId).map((r) => r.appearedAt + 1))
  let newerThan = Number.NEGATIVE_INFINITY
  const next = words.map((wordId) => previous.get(wordId) ?? { wordId, childId, appearedAt: now })
  for (let index = next.length - 1; index >= 0; index--) {
    const row = next[index]
    if (!previous.has(row.wordId) || row.appearedAt <= newerThan) {
      next[index] = { ...row, appearedAt: Math.max(now, newerThan + 1) }
    }
    newerThan = next[index].appearedAt
  }
  writeWordAppearances([...all.filter((r) => r.childId !== childId), ...next])
}

/** 结算显式记录本轮出词，即使清单成员/顺序完全没变也产生新事实。 */
export function recordWordAppearances(words: string[], childId = DEFAULT_CHILD_ID): void {
  const all = wordAppearances()
  const unique = [...new Set(words)]
  const now = Math.max(Date.now(), ...all.filter((r) => r.childId === childId).map((r) => r.appearedAt + 1))
  writeWordAppearances([...all, ...unique.map((wordId, index) => ({ wordId, childId, appearedAt: now + unique.length - index }))])
}

/** 逐题答题记录读取 */
export function allQuestionResults(): QuestionResultsState {
  return readValue<QuestionResultsState>(STORAGE_KEYS.questionResults)
}

export function questionResults(childId = DEFAULT_CHILD_ID): QuestionResultsState {
  return Object.fromEntries(Object.entries(allQuestionResults()).map(([qid, rows]) =>
    [qid, rows.filter((r) => (r.childId ?? DEFAULT_CHILD_ID) === childId).slice(0, 5)]).filter(([, rows]) => rows.length > 0))
}

export function writeAllQuestionResults(results: QuestionResultsState): void {
  writeValue(STORAGE_KEYS.questionResults, results)
}

/** 替换指定孩子的逐题记录，其他孩子保真；全域覆盖只走显式writeAll/导入接口。 */
export function writeQuestionResults(results: QuestionResultsState, childId = DEFAULT_CHILD_ID): void {
  const next: QuestionResultsState = {}
  for (const [qid, rows] of Object.entries(allQuestionResults())) {
    const other = rows.filter((r) => (r.childId ?? DEFAULT_CHILD_ID) !== childId)
    if (other.length) next[qid] = other
  }
  for (const [qid, rows] of Object.entries(results)) next[qid] = [...(next[qid] ?? []), ...rows.map((r) => childId === DEFAULT_CHILD_ID ? r : { ...r, childId })]
  writeAllQuestionResults(next)
}

// 学习域自有键初始值注册（T3 自 useAppState 随迁，保持 9 键初始化集合不变）：
// 题池内置题库（8→9 起带学科初始归类）、临场状态初始档、近期已测词空清单、红旗与逐题记录空对象
registerDataDefaults({
  [STORAGE_KEYS.questions]: INITIAL_QUESTIONS,
  [STORAGE_KEYS.morale]: INITIAL_MORALE,
  [STORAGE_KEYS.recentWords]: INITIAL_RECENT_WORDS,
  [STORAGE_KEYS.flagged]: INITIAL_FLAGGED,
  [STORAGE_KEYS.questionResults]: INITIAL_QUESTION_RESULTS,
})

// 注册进数据基础设施：迁移函数（按版本号顺序编排）
registerMigrations(migrations)
