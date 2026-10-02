// 数据模型契约（Spec 20260820-P0基座 §3.2，PRD §6.1 原样）
// 字段名、字段类型、字面量枚举、可选性均不得偏离。

// ===== 孩子维度（#173 8→9 断代，ADR 0006 孩子维度先行）=====
// 数据行归属标注；现阶段恒为默认孩子（单点常量），多孩到来只演进前端、数据 1→n 零迁移。
// 兑换目录与题池为全家共享，不挂此维度（不出现 childId 字段）。
/** 每个孩子/词最近一次出现；近期清单是此事实集的派生视图。 */
export interface WordAppearance {
  wordId: string
  appearedAt: number
  childId: string
}

export const DEFAULT_CHILD_ID = 'default'

// ===== 星种（#173 8→9 断代，#166 模型决议 2：星种 = 单账本加一列）=====
// 流水记账维度（主星/游戏星/兴趣星），刻意不是货币：无汇率、无多币定价；
// 主星种跨用途通用（默认值），其余星种由特定行为积攒。
export type StarKind = 'main' | 'game' | 'interest'
export const DEFAULT_STAR_KIND: StarKind = 'main'

// ===== 题库大类 / 分册（#173 8→9 断代，#166 模型决议 3：两层归属，调度键 = 分册）=====
// 8 版存量与 8 版文件导入按学科初始归类物理补齐（缺省兜底同此两值）
export const DEFAULT_QUESTION_CATEGORY = '学科'
export const DEFAULT_QUESTION_BOOK = '默认'

// ===== 题库 =====
export interface QuestionBank {
  version: string
  generatedAt: string
  questions: Question[]
}

export interface Question {
  id: string // 6 位数字序号字符串（/^\d{6}$/，值域 1~999999；#234 起 9xxxxx 段保留给内置题集，学习文件导入整次拒收），全局唯一，不承载 wordId 语义；追加导入按「现有最大序号 + 1」生成
  type: 'zh2en' | 'en2zh' | 'cloze' | 'trivia' // 呈现形式（#234 起 type 不再兼任题库归属——归属由来源判定 bankOf：9 号段即惊喜题库；trivia 只是尚未启用的纯形式标签，见 ADR 0014）
  prompt: string // cloze 题型含 ___ 占位
  options: [string, string, string, string]
  answerIndex: number // 0-3
  wordId?: string // 词级去重主键（R24 起）；#173 起可空——惊喜题无词归属、不入近期已测词
  difficulty?: 1 | 2 | 3 // 难度档位（R24 新增，可选）：缺省按 3 兜底（读取侧兜底；物理补 3 仅发生在迁移与导入时）
  category?: string // 题库大类（#173 新增，可选）：缺省按学科初始归类兜底（物理补齐发生在迁移与导入时）
  book?: string // 分册（#173 新增，可选）：抽题调度范围键；缺省同上
}

// ===== 星星流水（append-only）=====
export interface StarEntry {
  id: string // UUID
  timestamp: number // Date.now()
  type: 'earn' | 'redeem'
  amount: number // 正数
  source: string // "答题得星" | "满分奖励" | "兑换：菠萝油"
  quizId?: string // 关联测验（可选）
  kind?: StarKind // 星种（#173 新增，可选）：缺省按主星兜底；迁移与导入物理补 'main'
  childId?: string // 孩子归属（#173 新增，可选）：缺省按默认孩子兜底；迁移与导入物理补齐
}

// ===== 兑换项配置 =====
export interface RewardItem {
  id: string
  name: string
  price: number
  emoji?: string
  // 星种附加要求（#173 预留形状，可选）：描述「某星种余额 ≥ N」；
  // 缺省无附加要求，本票不接线新的兑换规则（现役行为不变）
  requirement?: { kind: StarKind; amount: number }
}

// ===== 进行中兑换（R-72-1 新增 #73，持久化于 sq_active_redemptions）=====
// 兑换成功瞬间的快照凭证（"我的奖品"券卡）：展示只用 name/emoji/createdAt，
// 不依赖 rewardId（兑换项事后改名/删除不影响已持有券卡）；核销/放弃 = 删除记录（#74）
export interface ActiveRedemption {
  id: string
  rewardId: string // 留痕用，展示不依赖它
  name: string // 快照
  emoji: string // 快照
  createdAt: number // 兑换时间戳（Date.now()）
  childId?: string // 孩子归属（#173 新增，可选）：缺省按默认孩子兜底
}

// ===== 应用状态（内存聚合视图，不直接持久化）=====
export interface AppState {
  questionPool: Question[]
  starLedger: StarEntry[]
  rewards: RewardItem[]
}

// ===== 导出契约 2.0（R36 拆分，Spec 20260827-v0.10.0-R36 REQ-R36-1/2；原 1.x 混排导出类型随断代退役）=====
// 学习文件（数据管理入口导出）：题池 + 红旗 + 逐题答题记录全量快照（含孤儿记录不过滤）；不含经济字段。
// #173 导入白名单 ['2.0','3.0']；'1.0'/'1.1'/'1.2' 一律拒绝（老板拍板 D2）。
export interface LearningExport {
  version: '2.0' | '3.0' // #173 起导出 '3.0'（题池带大类/分册、行带 childId）；'2.0' 为兼容导入口径（按默认补齐）
  exportedAt: string // ISO 8601（new Date().toISOString()）
  questionPool: Question[]
  flagged: FlaggedState // 红旗标记映射（questionId → 红旗条目；#173 起条目带 childId）
  questionResults: QuestionResultsState // 逐题答题记录全量快照（questionId → 最近 5 次记录，含孤儿；#173 起记录带 childId）
}

// 经济文件（流水管理入口导出）：兑换项 + 提议板 + 星星流水 + 进行中兑换；不含学习字段。
// R32 起导出 version '2.1'（proposals 为 sq_proposals 全量真实数据，落盘口径 ProposalRecord）；
// #75（R-72-3）起 version '2.2'（新增 activeRedemptions）；#173 起 version '2.3'
// （流水带 kind/childId、提议与进行中兑换带 childId、兑换项带可选附加要求）；
// #299 起导出 version '2.4'（提议带可选 emoji，导出序列化、导入宽进：非字符串/空串按缺省兜底 🎁）；
// '2.0' ~ '2.3' 为兼容导入口径（proposals 于 2.0 兜底 []；activeRedemptions 于 2.0/2.1 兜底 []；
// kind/childId/requirement 于 2.0 ~ '2.2' 按默认补齐——#173 断代口径；proposals emoji 于全版本可选，读取侧兜底 🎁）。
export interface EconomyExport {
  version: '2.0' | '2.1' | '2.2' | '2.3' | '2.4'
  exportedAt: string // ISO 8601（new Date().toISOString()）
  rewards: RewardItem[]
  proposals: ProposalRecord[] // R32 起全量真实数据；2.0 导入兜底为 []
  starLedger: StarEntry[]
  activeRedemptions: ActiveRedemption[] // #75 起全量快照；2.0/2.1 导入兜底为 []
}

// ===== 出题模式（#103 新增，持久化于 sq_quiz_mode，useQuizMode 读写）=====
// normal 普通（默认/缺省，R24 难度分层引擎）/ fresh 新题优先 / wrong 错题优先（quizModeEngine 两纯函数）
export type QuizMode = 'normal' | 'fresh' | 'wrong'

// ===== 答题会话状态（R2 新增，Spec 20260820-P1核心闭环 §3.2，持久化于 sq_session）=====
export type QuizSessionStatus = 'in_progress' | 'pending' | 'settled'
// sq_session 键不存在 = none（无会话）

export interface QuizAnswer {
  questionId: string // 关联 Question.id
  selectedIndex: number | null // 所选选项下标；null = 选"不会"
  correct: boolean // 是否答对（判分结果）
}

/** 调度范围：类型隔离独立于可自由命名的大类；每轮只选一个分册。 */
export type QuizKind = 'subject' | 'trivia'
export interface QuizScope {
  kind: QuizKind
  category: string
  book: string
}

/** 惊喜得星规则档（#289）：正确率下限（0 < minAccuracy ≤ 1）→ 星数（正整数）；命中最高的 minAccuracy 档取一档入账 */
export interface StarRuleTier {
  minAccuracy: number
  stars: number
}

/** #289 惊喜规则入账参数：规则折算星数 + 快照式来源文案（earn 的可选 rule 入参） */
export interface TriviaRuleEarn {
  stars: number
  source: string
}

export interface QuizSession {
  scope?: QuizScope // #181 范围快照；旧会话读取时由题目快照保守推断
  starRule?: StarRuleTier[] // #289 惊喜得星规则快照：开局从现役题集头部定格；缺省（旧会话/无规则题集）= 惊喜轮不产星。结算与结果页只读本快照，不反查内容
  quizId: string // UUID，本轮测验唯一标识（幂等与防刷分核心）
  status: QuizSessionStatus
  questions: Question[] // 抽题 + 每题选项乱序后的快照（≤ 10 道，原题对象未被修改）
  mode?: QuizMode // 本轮出题模式快照（#103）：创建时由 sq_quiz_mode 定格；缺省 = normal（存量会话兼容）；结算写回矩阵依据
  currentIndex: number // 0-based 当前题号（进行中）
  answers: QuizAnswer[] // 已答记录（长度 = 已答数，append-only）
  correctCount: number // 答对数
  score?: number // 得分 = 答对数（pending / settled 时存在）
  earnedStars?: number // 本轮得星（pending / settled 时存在）：学科 = score + (满分 ? 3 : 0)；带规则惊喜轮 = 规则命中档星数（#289）；无规则惊喜轮 = 0
  createdAt: number // Date.now()
  settledAt?: number // 结算时间（settled 时存在）
}

// ===== 临场状态（#173 正名：掌握度 → 临场状态；档位+上轮答对数，仅内部术语，持久化于 sq_morale）=====
export interface MoraleState {
  level: 1 | 2 | 3 // 能力档：本组抽题带宽基准、轮间调整对象
  lastRoundCorrect: number | null // 上一轮答对数（下一组配额修正依据；null = 尚无轮次）
  childId?: string // 孩子归属（#173 新增，可选）：缺省按默认孩子兜底
}

// ===== 入口显隐（#262 家长控制化：家庭偏好，持久化于 sq_entry_visibility，同步域 entry_visibility）=====
// 按入口 id 键控（游戏 = GAME_SLOT.id、惊喜 = 内置题集入口 id），记录中每条目为一次显式写入；
// 未设置（记录中无该入口 / 键缺失 / 初始值）= 默认隐藏——默认语义是读取语义，不是待推事实。
// #278 限时档：条目值从纯布尔扩展为 boolean | 限时对象（四态编码：关闭 = false 无到期；
// 保持开启 = true 无到期；限时 = { visible:true, expires_at }，到期时间戳由写入方本地时钟算出）。
// 存量布尔值照旧解释（可见无到期 = 保持开启），无感迁移，不做数据改写。
export interface TimedEntryVisibilityValue {
  visible: true
  /** 到期时间戳（epoch ms，写入方本地时钟）；推导时当前时间 < expires_at 视为可见 */
  expires_at: number
}
export type EntryVisibilityValue = boolean | TimedEntryVisibilityValue
export type EntryVisibilityMap = Record<string, EntryVisibilityValue>

/** 「限时对象」判定谓词（#279 评审收口：useEntryVisibility 推导与 cloud/merge 推侧 diff 共用，不再各写一份） */
export function isTimedEntryVisibilityValue(value: EntryVisibilityValue | undefined): value is TimedEntryVisibilityValue {
  return typeof value === 'object' && value !== null && value.visible === true
}

// ===== 近期已测词公开视图（#173 字符串数组；#178 同键内部保存按孩子的出现事实）=====
// 最近考过的词的清单（新→旧，上限 30 个 ≈ 3 轮），唯一用途是抽题跨轮软去重；可弃先验。
export type RecentWords = string[]

/** 近期已测词上限（#166 模型决议 4：上限 30 ≈ 3 轮） */
export const RECENT_WORDS_LIMIT = 30

// ===== 红旗标记（R25 新增，Spec 20260825-v0.7.1-R25 §REQ-R25-4，持久化于 sq_flagged）=====
// 红旗条目：仅记录标记时间；是否标记 = 键存在与否（对错信息由 questionResults 逐题记录承担，#69 老板拍板）
export interface FlaggedEntry {
  questionId?: string // #178 复合映射键行保留原题号；旧文件裸题号键可缺省
  flaggedAt: number // 标记时间 Date.now()
  childId?: string // 孩子归属（#173 新增，可选）：缺省按默认孩子兜底
}

// 公开孩子视图：questionId → 条目；全孩存储/导出：无歧义复合键 → 带原questionId的条目
export type FlaggedState = Record<string, FlaggedEntry>

// ===== 逐题答题记录（R27 新增，Spec 20260825-v0.7.2-R27 §REQ-R27-1，持久化于 sq_question_results）=====
export interface QuestionResult {
  outcome: 'correct' | 'wrong' | 'skipped' // 三态：答对 / 答错 / 不会（selectedIndex = null）
  timestamp: string // 完整 ISO 8601（new Date().toISOString()），同轮全部记录共享同一取值
  childId?: string // 孩子归属（#173 新增，可选）：缺省按默认孩子兜底
}

// sq_question_results：questionId → 按childId归属的记录；公开孩子视图每题最近5次（index 0 = 最新）
export type QuestionResultsState = Record<string, QuestionResult[]>

// ===== 提议（R32 新增，Spec 20260827-R32 §REQ-R32-5，持久化于 sq_proposals）=====
export type ProposalStatus = 'discussing' | 'agreed' | 'published' | 'voided' // 整体状态：沟通中 / 已达成一致 / 已发布（终态）/ 已作废（终态）；非终态值由家长 / 孩子双开关推导（deriveState）
export type ProposalAgreement = 'agreed' | 'notAgreed' // 家长 / 孩子平等双开关
export type ProposalPublishState = 'blocked' | 'ready' | 'none' // 发布状态：不可发布 / 可发布 / 终态 N/A（运行时派生不落盘）
export type ProposalInitiator = 'parent' | 'child' // 发起人：本期恒 'parent'，R34 预留 'child'
// 最后动作归因（#63 拍板 2026-08-30）：阵营文案富化的依据——谁最后做了什么（新建/修改/点头/收回）
export type ProposalActionKind = 'proposed' | 'changed' | 'agreed' | 'rethought'

// 落盘口径（#66 归一：唯一口径，自主决策 #1）：sq_proposals 存储对象。
// 发布状态（publishState）归答案卡——由 proposalState 派生（ProposalCardView），不进落盘、不进本契约
export interface ProposalRecord {
  id: string
  name: string // 兑换物名称
  price: number // 兑换消耗（正整数）
  emoji?: string // 提议图标（#299 新增，可选）：读取侧缺省兜底 🎁、零物理迁移；属提议内容，改 emoji 走修订即认同
  status: ProposalStatus // 整体状态
  createdAt: number // 创建时间（Date.now() 毫秒，与 StarEntry.timestamp 同口径；「分钟级」仅展示层格式化）
  updatedAt: number // 最后变更时间（Date.now() 毫秒；「分钟级」仅展示层格式化）
  description: string // 说明文字（可空字符串）
  parentStatus: ProposalAgreement // 家长状态
  childStatus: ProposalAgreement // 孩子状态
  initiator: ProposalInitiator // 发起人
  /** 最后动作归因（#63；#66 起必填）：恒有值——写入方直写；存量由迁移 6→7 与导入归一化补齐 */
  lastActionBy: ProposalInitiator
  lastActionKind: ProposalActionKind
  childId?: string // 孩子归属（#173 新增，可选）：缺省按默认孩子兜底；迁移与导入物理补齐
}
