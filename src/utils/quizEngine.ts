// Quiz Engine 纯函数（v0.7.0 R24：成就区分层抽题——模式 B：整组抽 + 构成后乱序 + 轮间调整）
// 随机源可注入（RandomSource），默认 Math.random，测试注入 seeded 源（mulberry32）。
// 全链路确定性（REQ-R24-6-1）：计划组合选定、类内候选选择、去重补位、选项乱序均走注入随机源。

import type { Question, MoraleState, RecentWords } from '../types'

/** 均匀分布随机源：返回 [0,1) 区间数值 */
export type RandomSource = () => number

type MoraleLevel = MoraleState['level']

/** mulberry32：32 位种子伪随机数生成器（确定性，供测试注入） */
export function mulberry32(seed: number): RandomSource {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates 全洗副本（不修改原数组） */
function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** 构成后整组乱序（REQ-R24-4-1）：10 题位整体洗牌，高位题位置不固定 */
export function shuffleGroup<T>(items: readonly T[], random: RandomSource): T[] {
  return shuffled(items, random)
}

// ===== 类带宽（REQ-R24-4-2，相对本组 level）=====

export type DifficultyBand = 'comfort' | 'reach' | 'challenge'

/** difficulty 缺省兜底 3（REQ-R24-4-9：读取侧兜底） */
export function effectiveDifficulty(q: Question): 1 | 2 | 3 {
  return q.difficulty ?? 3
}

/** 会做 = d ≤ level；够一够 = d ≤ min(3, level+1)；挑战 = d ≤ min(3, level+2)（带宽 clamp 后可为空类） */
export function bandOfQuestion(q: Question, level: MoraleLevel): DifficultyBand {
  const d = effectiveDifficulty(q)
  if (d <= level) return 'comfort'
  if (d <= Math.min(3, level + 1)) return 'reach'
  return 'challenge'
}

// ===== 配额构成（REQ-R24-4-2 三选一 + REQ-R24-4-7 轮间配额修正）=====

export interface RoundQuota {
  comfort: number
  reach: number
  challenge: number
}

const LEGAL_QUOTAS: RoundQuota[] = [
  { comfort: 8, reach: 1, challenge: 1 },
  { comfort: 8, reach: 2, challenge: 0 },
  { comfort: 7, reach: 2, challenge: 1 },
]

/**
 * 配额构成：上一轮 ≤ 5 → (10,0,0) 全会做；上一轮 6~8 → (8,2,0) 不出挑战；
 * 首局（null）或上一轮 ≥ 9 → 由注入随机源从三合法组合中选定其一。
 */
export function resolveRoundQuota(lastRoundCorrect: number | null, random: RandomSource): RoundQuota {
  if (lastRoundCorrect !== null && lastRoundCorrect <= 5) return { comfort: 10, reach: 0, challenge: 0 }
  if (lastRoundCorrect !== null && lastRoundCorrect <= 8) return { comfort: 8, reach: 2, challenge: 0 }
  return LEGAL_QUOTAS[Math.floor(random() * LEGAL_QUOTAS.length)]
}

// ===== 词级去重取词内核（REQ-R24-5；#173 8→9 改形：近期已测词为字符串数组）=====

/**
 * 跨轮软去重窗口（#173 起按清单成员判断）：近期已测词清单（最近 30 词 ≈ 3 轮）内的词避开、
 * 清单外的词公平轮转（随机）。#166 模型决议 4：清单唯一用途是软去重，
 * 旧形状 {seq, words} 的「久未出优先」第二层排序随之移除（窗口外候选只按洗牌序公平轮转）。
 */

/** 候选词单元：questions 为该词在候选集内的全部题（已乱序，取哪道 = 随机破平局） */
interface WordEntry {
  word: string
  questions: Question[]
  windowed: boolean
  difficulty: 1 | 2 | 3
}

interface PickOptions {
  /** 放宽硬去重：允许同词多题，词间 round-robin 均匀分散（REQ-R24-4-8） */
  allowDuplicateWords: boolean
  /** 跨类补位时难度降序前置：缺高位类时优先补高位词，保住构成的 (会做, 高位) 映射 */
  preferHighDifficulty: boolean
}

/**
 * 从候选集中按词抽取 need 道：
 * 词优先序 = 窗口外优先（软去重）→ 随机破平局（#173 起清单外词公平轮转，无第二层排序）；
 * 同轮 wordId 唯一（硬去重），除非 allowDuplicateWords（round-robin，任意两词出现次数差 ≤ 1）。
 * wordId 可空（trivia 题无词归属）：按题目 id 独立成词级单元，不入近期已测词（写入侧过滤）。
 */
function pickQuestions(
  candidates: Question[],
  need: number,
  usedWords: Set<string>,
  recent: RecentWords,
  random: RandomSource,
  opts: PickOptions,
): Question[] {
  if (need <= 0 || candidates.length === 0) return []
  // 按词分组（题组内乱序），并预计算排序键
  const windowed = new Set(recent)
  const byWord = new Map<string, WordEntry>()
  for (const q of shuffled(candidates, random)) {
    // 词与无词题使用互斥命名空间，避免某题 id 恰好等于另一个 wordId。
    const word = q.wordId === undefined ? `question:${q.id}` : `word:${q.wordId}`
    let entry = byWord.get(word)
    if (!entry) {
      entry = { word, questions: [], windowed: q.wordId !== undefined && windowed.has(q.wordId), difficulty: effectiveDifficulty(q) }
      byWord.set(word, entry)
    }
    entry.questions.push(q)
  }
  // 先洗牌破平局，再稳定排序：补位模式前置难度降序，主键窗口外优先（#173 起无第二层排序）
  const wordList = shuffled([...byWord.values()], random)
  wordList.sort((a, b) => {
    if (opts.preferHighDifficulty && a.difficulty !== b.difficulty) return b.difficulty - a.difficulty
    if (a.windowed !== b.windowed) return a.windowed ? 1 : -1
    return 0
  })

  const picked: Question[] = []
  if (!opts.allowDuplicateWords) {
    for (const entry of wordList) {
      if (picked.length >= need) break
      if (usedWords.has(entry.word)) continue
      picked.push(entry.questions[0])
      usedWords.add(entry.word)
    }
    return picked
  }
  // 硬去重放宽：按词优先序 round-robin 轮转取未取过的题（每词每轮至多 1 道 → 均匀分散）
  let progressed = true
  while (picked.length < need && progressed) {
    progressed = false
    for (const entry of wordList) {
      if (picked.length >= need) break
      const q = entry.questions.find((x) => !picked.includes(x))
      if (q) {
        picked.push(q)
        progressed = true
      }
    }
  }
  return picked
}

// ===== 引擎主入口（REQ-R24-4 模式 B）=====

export interface DrawRoundParams {
  pool: Question[]
  level: MoraleLevel
  /** 上一轮答对数（下一组配额修正依据，null = 首局） */
  lastRoundCorrect: number | null
  /** 近期已测词清单（#173 起字符串数组，新→旧，上限 30；清单内词窗口内避开） */
  recentWords: RecentWords
  random: RandomSource
  count?: number
}

/** 分层 + 词级去重 + 整组乱序抽题（一轮）：题池空返回 []；题池 < count 全量乱序返回。 */
export function drawQuestions(params: DrawRoundParams): Question[] {
  const { pool, level, lastRoundCorrect, recentWords, random } = params
  const count = params.count ?? 10
  if (pool.length === 0) return []
  if (pool.length < count) return shuffleGroup(pool, random)

  const quota = resolveRoundQuota(lastRoundCorrect, random)
  const bands: Record<DifficultyBand, Question[]> = { comfort: [], reach: [], challenge: [] }
  for (const q of pool) bands[bandOfQuestion(q, level)].push(q)

  const selected: Question[] = []
  const usedWords = new Set<string>()
  // 1. 类内抽取：硬去重 + 软去重窗口外优先 + 久未出优先
  for (const band of ['comfort', 'reach', 'challenge'] as const) {
    selected.push(
      ...pickQuestions(bands[band], quota[band], usedWords, recentWords, random, {
        allowDuplicateWords: false,
        preferHighDifficulty: false,
      }),
    )
  }
  // 2. 候选不足 → 其余两类并集补位（类内耗尽时全池未用词 = 其余两类未用词；难度降序保构成）
  if (selected.length < count) {
    selected.push(
      ...pickQuestions(pool, count - selected.length, usedWords, recentWords, random, {
        allowDuplicateWords: false,
        preferHighDifficulty: true,
      }),
    )
  }
  // 3. 仍不足（不同 wordId 数 < count）→ 放宽硬去重：同词均匀分散
  if (selected.length < count) {
    selected.push(
      ...pickQuestions(pool, count - selected.length, usedWords, recentWords, random, {
        allowDuplicateWords: true,
        preferHighDifficulty: true,
      }),
    )
  }
  // 4. 纯随机兜底（防御：题池 ≥ count 时第 3 级按题数恒可取满，理论不可达）
  if (selected.length < count) {
    const rest = shuffled(
      pool.filter((q) => !selected.includes(q)),
      random,
    )
    selected.push(...rest.slice(0, count - selected.length))
  }
  // 5. 构成后整组乱序：高位题位置不固定
  return shuffleGroup(selected, random)
}

/**
 * 对 4 个选项下标做 Fisher-Yates 乱序，返回乱序后的 options 与重映射的 answerIndex。
 * options[answerIndex] 仍指向原正确答案文本；不修改原题对象。（REQ-R24-6-2 行为不变）
 */
export function shuffleOptions(
  question: Question,
  random: RandomSource,
): { options: [string, string, string, string]; answerIndex: number } {
  const indices = [0, 1, 2, 3]
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  const options = indices.map((idx) => question.options[idx]) as [string, string, string, string]
  const answerIndex = indices.indexOf(question.answerIndex)
  return { options, answerIndex }
}

/** 判分三态：答对 correct / 答错 wrong / 选"不会"（null）skipped（REQ-R24-6-2 行为不变） */
export function grade(selectedIndex: number | null, answerIndex: number): 'correct' | 'wrong' | 'skipped' {
  if (selectedIndex === null) return 'skipped'
  return selectedIndex === answerIndex ? 'correct' : 'wrong'
}
