// 答题会话状态机（Spec REQ-3，持久化于 sq_session；防刷分 §3.4）
// sq_session 延迟创建（不进 initAppState 初始 4 键）；损坏恢复：JSON 解析失败 → removeItem + warn → 视为无会话。

import type { MoraleState, Question, QuestionResult, QuizAnswer, QuizSession, RecentWords, StarRuleTier } from '../types'
import { DEFAULT_CHILD_ID, DEFAULT_QUESTION_CATEGORY, DEFAULT_QUESTION_BOOK, type QuizScope } from '../types'
// T4 单一真相源收敛：题池 / 掌握度 / 近期词 / 逐题记录读取经 useLearningData，入账与幂等判定经 useStarData；
// sq_session 会话读写保持本模块现职责（Spec 自主决策 #3，键名与行为零变更）。
import {
  questions as readQuestions,
  morale as readMorale,
  writeMorale,
  recentWords as readRecentWords,
  recordWordAppearances,
  questionResults as readQuestionResults,
  writeQuestionResults as persistQuestionResults,
  flagged as readFlagged,
} from './useLearningData'
import { earn, hasEarned } from './useStarData'
import { copy } from '../copy'
import { drawQuestions, shuffleOptions, grade, type RandomSource } from '../utils/quizEngine'
import { bankOf } from '../utils/questionBank'
import { drawFreshFirstRound, drawWrongFirstRound } from '../utils/quizModeEngine'
import { readQuizMode } from './useQuizMode'
import { hasStarRule, loadedTriviaQuestions, triviaSetRef } from '../data/trivia-set'
import { readTriviaStarEarns } from './useTriviaStarToggle'
import { STORAGE_KEYS, readRawValue, writeValue, deleteValue } from './useDataInfra'
import type { QuizMode } from '../types'

// #168 收编入册：SESSION_KEY 沿用原字面量（现由登记册单一来源），导出保持兼容
export const SESSION_KEY = STORAGE_KEYS.session

const QUESTION_COUNT = 10

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 读取会话（损坏恢复 E1 / §3.3）：JSON 解析失败 → removeItem + console.warn（含键名与原因）→ null。
 * 键不存在 → null（none）；旧同册会话由题目快照推断范围，混范围/空题快照按损坏会话清理。
 */
export function readSession(): QuizSession | null {
  const raw = readRawValue(SESSION_KEY)
  if (raw === null) return null
  try {
    const session = JSON.parse(raw) as QuizSession
    if (!Array.isArray(session.questions) || session.questions.length === 0) throw new Error('会话题目快照为空或非法')
    const scope = session.scope === undefined ? scopeOf(session.questions[0]) : session.scope
    if (!scope || !session.questions.every(q => inScope(q, scope))) throw new Error('会话题目跨大类、分册或类型')
    session.scope = scope
    if (scope.kind === 'trivia' && session.mode !== 'fresh' && session.mode !== 'wrong') session.mode = 'fresh'
    return session
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 数据键 ${SESSION_KEY} 损坏，已删除（原因：${reason}）`)
    deleteValue(SESSION_KEY)
    return null
  }
}

function writeSession(session: QuizSession): void {
  writeValue(SESSION_KEY, session)
}

/** 分层抽题 + 每题选项乱序，生成会话快照（原题对象不修改）——新引擎按 level 配额构成 + 词级去重 + 构成后整组乱序（R24 REQ-R24-4） */
function buildQuestions(
  pool: Question[],
  morale: MoraleState,
  recentWords: RecentWords,
  random: RandomSource,
): Question[] {
  const round = drawQuestions({
    pool,
    level: morale.level,
    lastRoundCorrect: morale.lastRoundCorrect,
    recentWords,
    random,
    count: QUESTION_COUNT,
  })
  return round.map((q) => {
    const shuffled = shuffleOptions(q, random)
    return { ...q, options: shuffled.options, answerIndex: shuffled.answerIndex }
  })
}

/** 新模式抽题（#103）：fresh / wrong 各走独立纯函数（题级，输入逐题记录与红旗状态），构成后每题选项乱序 */
function buildModeQuestions(pool: Question[], mode: Exclude<QuizMode, 'normal'>, random: RandomSource): Question[] {
  const modeParams = { pool, results: readQuestionResults(), flagged: readFlagged(), random }
  const drawn = mode === 'fresh' ? drawFreshFirstRound(modeParams) : drawWrongFirstRound(modeParams)
  return drawn.map((q) => {
    const shuffled = shuffleOptions(q, random)
    return { ...q, options: shuffled.options, answerIndex: shuffled.answerIndex }
  })
}

/** 大类名是自由文本；惊喜归属单点判定经 bankOf（#234 来源即身份：9 号段即惊喜，type 从不参与），缺省归类沿 #173。 */
function scopeOf(question: Question): QuizScope {
  return {
    kind: bankOf(question.id),
    category: question.category ?? DEFAULT_QUESTION_CATEGORY,
    book: question.book ?? DEFAULT_QUESTION_BOOK,
  }
}

function inScope(question: Question, scope: QuizScope): boolean {
  return bankOf(question.id) === scope.kind
    && (question.category ?? DEFAULT_QUESTION_CATEGORY) === scope.category
    && (question.book ?? DEFAULT_QUESTION_BOOK) === scope.book
}

/** 开局先固定范围，再交给现有引擎抽取及补位，mode / scope / 题目均存会话快照。
 * 未指定范围：优先可答的默认学科分册，否则按题池顺序选一个可答学科分册。
 * 显式范围：精确匹配 kind + category + book；空池或全红旗返回 null，绝不回退。
 * #234/#287：内置题集（现役资产槽位加载的题集对象）按分册并入惊喜调度池（不进用户题池，仅内存合并）；
 * 惊喜由首页入口显式指定；题集缺失/损坏时此处合并为空数组，惊喜会话开局自然无题返回 null。 */
export function startQuiz(random: RandomSource = Math.random, scope?: QuizScope): QuizSession | null {
  readSession() // 先触发 sq_session 损坏恢复（E1）：损坏 → removeItem + console.warn → 视为无会话（AC3-10）
  const all = [...readQuestions(), ...loadedTriviaQuestions()]
  if (scope === undefined) {
    const defaultScope: QuizScope = { kind: 'subject', category: DEFAULT_QUESTION_CATEGORY, book: DEFAULT_QUESTION_BOOK }
    const flagged = readQuizMode() === 'normal' ? {} : readFlagged()
    const available = all.filter(q => bankOf(q.id) === 'subject' && flagged[q.id] === undefined)
    const first = available.find(q => inScope(q, defaultScope)) ?? available[0]
    if (!first) return null
    scope = scopeOf(first)
  }
  const pool = all.filter(q => inScope(q, scope))
  if (pool.length === 0) return null
  // #272：惊喜会话固定新题优先（按 kind 分流的偏好记忆已拆除，无可读偏好）；学科沿 sq_quiz_mode
  const mode = scope.kind === 'trivia' ? 'fresh' : readQuizMode()
  // #289 惊喜得星规则开局快照：惊喜轮开局把现役题集头部的规则定格进会话（与 mode/scope 同级快照），
  // 结算与结果页只读快照、绝不反查内容——换主题（App 升级换题集）不打断进行中的轮；快照深拷贝防串改。
  // #290 家长得星开关在此一并读取（键控惊喜入口的家庭级开关，默认开）：关闭时不写 starRule
  // （= 无规则 = 不产星）——生效决定只在此刻定格进快照，结算绝不反查开关，进行中的轮不受之后改开关影响。
  const activeSet = triviaSetRef.value
  const starRule = scope.kind === 'trivia' && activeSet !== null
    && scope.category === activeSet.category && scope.book === activeSet.book
    && activeSet.starRule !== undefined
    && readTriviaStarEarns()
    ? activeSet.starRule.map(tier => ({ ...tier }))
    : undefined
  const session: QuizSession = {
    quizId: uuid(),
    scope,
    status: 'in_progress',
    questions:
      mode === 'normal'
        ? buildQuestions(pool, readMorale(), readRecentWords(), random)
        : buildModeQuestions(pool, mode, random),
    mode,
    ...(starRule === undefined ? {} : { starRule }),
    currentIndex: 0,
    answers: [],
    correctCount: 0,
    createdAt: Date.now(),
  }
  if (session.questions.length === 0) return null
  writeSession(session)
  return session
}

/** 对当前题作答：判分三态 → 追加 answers → 推进 currentIndex → 写回（无会话 / 已答完则忽略） */
export function answerQuiz(selectedIndex: number | null): void {
  const session = readSession()
  if (!session || session.status !== 'in_progress') return
  if (session.currentIndex >= session.questions.length) return
  const question = session.questions[session.currentIndex]
  const correct = grade(selectedIndex, question.answerIndex) === 'correct'
  session.answers.push({ questionId: question.id, selectedIndex, correct })
  if (correct) session.correctCount += 1
  session.currentIndex += 1
  writeSession(session)
}

/** #288 产星判定单一分支点：学科轮恒产星；惊喜轮按会话 starRule 快照判定（#289 起规则快照存在即产星）。
 *  旧会话 / 无规则题集轮无该字段 = 不产星（#288 基线行为不变）；结算与结果页只读本判定。 */
export function sessionEarnsStars(session: QuizSession): boolean {
  return session.scope?.kind !== 'trivia' || hasStarRule(session.starRule)
}

/** #289 惊喜规则得星数（纯函数）：正确率 = 答对数 / 本轮题数；命中档（正确率 ≥ minAccuracy）中取
 *  最高的 minAccuracy 档，只取一档入账（如 0.7→5 与 1.0→25 两档全对只得 25，不是 30）；无命中档 = 0。 */
export function starsForRule(rule: StarRuleTier[], correctCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0
  const accuracy = correctCount / totalCount
  let best: StarRuleTier | undefined
  for (const tier of rule) {
    if (accuracy >= tier.minAccuracy && (best === undefined || tier.minAccuracy > best.minAccuracy)) best = tier
  }
  return best?.stars ?? 0
}

/** 答完最后一题点"查看结果"：写入 score / earnedStars，status → pending（未答完则忽略）。
 *  #288：无规则惊喜轮零得星（earnedStars 恒 0），学科得星公式不变。 */
export function finishQuiz(): void {
  const session = readSession()
  if (!session || session.status !== 'in_progress') return
  if (session.currentIndex < session.questions.length) return
  const fullMark = session.correctCount === session.questions.length
  session.score = session.correctCount
  // #289：带规则惊喜轮按规则命中档折算 earnedStars（结算入账同一折算）；无规则惊喜轮恒 0；学科公式不变
  session.earnedStars = session.scope?.kind === 'trivia' && session.starRule !== undefined
    ? starsForRule(session.starRule, session.correctCount, session.questions.length)
    : sessionEarnsStars(session) ? session.correctCount + (fullMark ? 3 : 0) : 0
  session.status = 'pending'
  writeSession(session)
}

/**
 * 结算页挂载：幂等入账（§3.4）。
 * pending / settled：hasQuizEarned 未入账则 earnForQuiz 写流水 + 轮间写回两统计键 + status→settled（返回 'settled'）；
 * 已入账（或已 settled，含 0 分无流水的轮）则不再写，仅确保 settled（返回 'idempotent'）；
 * 无会话 / in_progress（非法直访 #/result）：不写流水不写回，返回 'redirect'（组件据此跳首页）。
 */
export function settleQuiz(): 'settled' | 'idempotent' | 'redirect' {
  const session = readSession()
  if (!session || session.status === 'in_progress') return 'redirect'
  // 幂等门：流水已入账，或会话已 settled（0 分轮无流水，防二次结算重复写回，AC-R24-5-5）
  const already = session.status === 'settled' || hasEarned(session.quizId)
  const result: 'settled' | 'idempotent' = already ? 'idempotent' : 'settled'
  if (!already) {
    const correctCount = session.score ?? session.correctCount
    // #288：无规则惊喜轮零 earn 流水（幂等以会话 status 兜底）；逐题答题记录照写，
    // 学科临场状态 / 近期已测词写回沿 writeRoundStats 既有惊喜跳过。#289 起带规则惊喜轮经 sessionEarnsStars 恢复入账。
    if (sessionEarnsStars(session)) {
      const rule = session.scope?.kind === 'trivia' ? session.starRule : undefined
      earn({
        quizId: session.quizId,
        correctCount,
        totalCount: session.questions.length,
        // #289 带规则惊喜轮：单条 earn 流水，星数按规则命中档、来源文案用会话 scope 快照类别名（不反查题集内容）
        ...(rule === undefined ? {} : {
          rule: {
            stars: starsForRule(rule, correctCount, session.questions.length),
            source: copy.stars.triviaSource(session.scope?.category ?? DEFAULT_QUESTION_CATEGORY),
          },
        }),
      })
    }
    writeRoundStats(session, correctCount)
    writeQuestionResults(session.answers)
  }
  session.status = 'settled'
  session.settledAt = Date.now()
  writeSession(session)
  return result
}

/** 轮间 level 三规则（REQ-R24-4-7）：≥9 升档（min 3）/ ≤5 强降档（max 1）/ 6~8 不变 */
function nextLevel(level: MoraleState['level'], correctCount: number): MoraleState['level'] {
  if (correctCount >= 9) return Math.min(3, level + 1) as MoraleState['level']
  if (correctCount <= 5) return Math.max(1, level - 1) as MoraleState['level']
  return level
}

/** 轮间调整写回（REQ-R24-4-7 / REQ-R24-5-4，仅首次结算执行）：sq_morale level + lastRoundCorrect；近期已测词清单头部并入本轮全部 wordId（新→旧，上限 30；#173 起数组形）
 *  #103 写回矩阵：新模式轮（fresh / wrong）临场状态不写、保持不变（防污染普通模式难度配额）；学科近期已测词两模式照写；#181 惊喜整轮跳过两个先验（不依赖 wordId 缺失） */
function writeRoundStats(session: QuizSession, correctCount: number): void {
  if (session.scope?.kind === 'trivia') return
  if (session.mode === undefined || session.mode === 'normal') {
    const previous = readMorale()
    writeMorale({ ...previous, level: nextLevel(previous.level, correctCount), lastRoundCorrect: correctCount, childId: previous.childId ?? DEFAULT_CHILD_ID })
  }

  const thisRound = session.questions
    .map((q) => q.wordId)
    .filter((wordId): wordId is string => wordId !== undefined)
  // 先放本轮词，再合并旧清单：重考词刷新位置，同轮重复词也仅留一次。
  recordWordAppearances(thisRound)
}

/**
 * 逐题答题记录写入（R27 REQ-R27-2，结算与放弃两链路共用）：
 * 三态映射（selectedIndex=null → skipped；非 null 且 correct → correct；非 null 且 !correct → wrong），
 * 遍历 answers 一题一条（未作答题不产生记录）；新记录 unshift 至 index 0（最新），每题保留最近 5 条；
 * 同轮共享同一 ISO 时间戳（单次写入只取一次）。读 → 改 → 写直写 sq_question_results。
 */
function writeQuestionResults(answers: QuizAnswer[]): void {
  if (answers.length === 0) return
  const state = readQuestionResults()
  const timestamp = new Date().toISOString()
  for (const { questionId, selectedIndex, correct } of answers) {
    const outcome: QuestionResult['outcome'] = selectedIndex === null ? 'skipped' : correct ? 'correct' : 'wrong'
    const records = state[questionId] ?? []
    records.unshift({ outcome, timestamp, childId: DEFAULT_CHILD_ID })
    state[questionId] = records.slice(0, 5)
  }
  persistQuestionResults(state)
}

/** 中途离开答题页：已作答题写入逐题记录后删除 sq_session（作废不写星星流水与轮间统计） */
export function abandonQuiz(): void {
  const session = readSession()
  if (session) writeQuestionResults(session.answers)
  deleteValue(SESSION_KEY)
}

/** 结算页"回到首页"：删除 sq_session */
export function clearSession(): void {
  deleteValue(SESSION_KEY)
}
