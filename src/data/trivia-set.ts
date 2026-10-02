// #287 惊喜题集对象化挂载（CONTEXT.md「内置题集」词条）：现役题集是一个题集对象，载体为 repo 静态资产槽位
// public/trivia/current/（set.json 元数据 + 题目数组 + 贴纸图），App 冷启动预热加载并校验后并入惊喜调度池
// （useQuiz.startQuiz 内存合并，与用户题池仍两物——不经任何 sq_ 键、学习文件闭环零改动，ADR 0014 契约不变）。
// 换内容 = 整夹替换 current/、旧内容整夹移入旁边 public/trivia/archive/（App 永不读取），全程零代码；
// 出题产出契约见 docs/prompts/trivia-question-prompt.md。缺失/损坏视为惊喜题库为空：入口照常显示、
// 点开提示「惊喜内容在路上，重试一下」并可重试（Home.vue），不与家长入口显隐耦合、不崩溃。
import { ref } from 'vue'
import { IS_MINITOOL } from '../minitool'
import offlineTriviaSet from '../../public/trivia/current/set.json'
import type { Question, StarRuleTier } from '../types'

/** 惊喜题库入口 id（#262 入口显隐键控域的入口键；值恒 'builtin-trivia'——云端同步键，不随题集内容更换） */
export const TRIVIA_ENTRY_ID = 'builtin-trivia'

/**
 * 现役题集资产槽位（对齐 public/games 的 GAME_SLOT 做法）：路径相对 BASE_URL，任意部署基座下可用。
 * json 为题集对象（元数据 + 题目数组）；icon 为首页贴纸画作（外描边归宿主）。
 */
export const TRIVIA_SET_SLOT = Object.freeze({
  id: TRIVIA_ENTRY_ID,
  json: 'trivia/current/set.json',
  icon: 'trivia/current/icon.svg',
})

/** 题集对象：名称（大类/分册，调度范围键）+ 孩子侧介绍 + 题目数组（id 全 9 号段） */
export interface TriviaSet {
  /** 题库大类（题库两层归属上层）；名称随题集内容走，与主题解耦（换内容不改代码常量） */
  category: string
  /** 分册（抽题调度范围键） */
  book: string
  /** #271 介绍弹窗文案：题集内容自带字段，随 App 版本分发 */
  intro: string
  /** #289 惊喜得星规则（可省）：门槛数组，开局由 startQuiz 快照进会话；缺省 = 无规则 = 惊喜轮不产星 */
  starRule?: StarRuleTier[]
  questions: Question[]
}

/** set.json 中题目条目的原始形状：category/book 由头部元数据统一盖章（题目内不携带，避免两处漂移） */
interface TriviaSetJson {
  category: unknown
  book: unknown
  intro: unknown
  starRule: unknown
  questions: unknown
}

/** 规则存在谓词（共享单一判断）：starRule 为 undefined 或空数组 = 无规则；useQuiz 产星判定与家长面板共用 */
export function hasStarRule(rule: StarRuleTier[] | undefined): boolean {
  return (rule?.length ?? 0) > 0
}

const QUESTION_TYPES = ['zh2en', 'en2zh', 'cloze', 'trivia'] as const
const TRIVIA_ID_PATTERN = /^9\d{5}$/
const MIN_QUESTION_COUNT = 3

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** #289 惊喜得星规则形状校验：非空档次数组，每档 { minAccuracy ∈ (0,1] 且互不重复, stars 正整数 }；undefined = 无规则（合法），其余非法形状整体拒绝（→ null 走空题库路径） */
function parseStarRule(raw: unknown): StarRuleTier[] | undefined | null {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0) return null
  const tiers: StarRuleTier[] = []
  const seenThresholds = new Set<number>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null
    const tier = entry as Record<string, unknown>
    if (typeof tier.minAccuracy !== 'number' || !Number.isFinite(tier.minAccuracy) || tier.minAccuracy <= 0 || tier.minAccuracy > 1) return null
    if (typeof tier.stars !== 'number' || !Number.isInteger(tier.stars) || tier.stars <= 0) return null
    // 门槛平级校验：重复 minAccuracy 会让 starsForRule 的「命中档取最高门槛」tie-break 不可判定，整集拒绝
    if (seenThresholds.has(tier.minAccuracy)) return null
    seenThresholds.add(tier.minAccuracy)
    tiers.push({ minAccuracy: tier.minAccuracy, stars: tier.stars })
  }
  return tiers
}

/**
 * 校验并解析题集对象（纯函数，冷启动预热与数据模块测试共用同一接缝）：
 * 头部 category/book/intro 非空；可选 starRule 形状合法（#289：非空档次数组、minAccuracy ∈ (0,1] 且互不重复、stars 正整数）；题目 ≥3 道；id 全 9 号段（9xxxxx）且唯一；题目形状合法且无 wordId（惊喜题无词归属）。
 * 任一不满足 → null（调用侧视为惊喜题库为空，绝不带病并入调度池）。
 */
export function parseTriviaSet(raw: unknown): TriviaSet | null {
  if (typeof raw !== 'object' || raw === null) return null
  const data = raw as TriviaSetJson
  if (!isNonEmptyString(data.category) || !isNonEmptyString(data.book) || !isNonEmptyString(data.intro)) return null
  const starRule = parseStarRule(data.starRule)
  if (starRule === null) return null
  if (!Array.isArray(data.questions) || data.questions.length < MIN_QUESTION_COUNT) return null
  const seenIds = new Set<string>()
  const questions: Question[] = []
  for (const entry of data.questions) {
    if (typeof entry !== 'object' || entry === null) return null
    const q = entry as Record<string, unknown>
    if (typeof q.id !== 'string' || !TRIVIA_ID_PATTERN.test(q.id)) return null
    if (seenIds.has(q.id)) return null
    seenIds.add(q.id)
    if (typeof q.type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(q.type)) return null
    if (!isNonEmptyString(q.prompt)) return null
    if (!Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(isNonEmptyString)) return null
    if (typeof q.answerIndex !== 'number' || !Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) return null
    if (q.wordId !== undefined) return null
    questions.push({
      id: q.id,
      type: q.type as Question['type'],
      prompt: q.prompt,
      options: q.options as Question['options'],
      answerIndex: q.answerIndex,
      category: data.category,
      book: data.book,
    })
  }
  return { category: data.category, book: data.book, intro: data.intro, ...(starRule === undefined ? {} : { starRule }), questions }
}

/** 现役题集的响应式状态：null = 未加载或缺失/损坏（惊喜题库视为空）。测试经 adoptTriviaSet 直接注入解析结果。 */
export const triviaSetRef = ref<TriviaSet | null>(null)

/** 解析并落位现役题集：校验失败同样落 null（清掉上一次的残留），返回是否成功 */
export function adoptTriviaSet(raw: unknown): boolean {
  const set = parseTriviaSet(raw)
  triviaSetRef.value = set
  return set !== null
}

/**
 * 冷启动预热：fetch 现役槽位 set.json → 校验 → 落位。任何失败（网络/HTTP/解析/校验）都只落空题库并 warn，
 * 不抛出、不阻断启动；入口照常显示，重试走 Home 的重试按钮（同一函数可再调）。
 */
export async function warmTriviaSet(): Promise<boolean> {
  // Pure-offline builds use the same validated current content, without a network retry path.
  if (IS_MINITOOL) return adoptTriviaSet(offlineTriviaSet)
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${TRIVIA_SET_SLOT.json}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const raw: unknown = await response.json()
    if (!adoptTriviaSet(raw)) throw new Error('set.json 校验未通过（题量/号段/唯一/形状/名称）')
    return true
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 现役题集加载失败，惊喜题库按空处理（原因：${reason}）`)
    triviaSetRef.value = null
    return false
  }
}

/** 现役题集题目数组（调度池合并接缝，useQuiz 消费）；未加载/损坏 → 空数组 */
export function loadedTriviaQuestions(): Question[] {
  return triviaSetRef.value?.questions ?? []
}
