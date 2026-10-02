/**
 * R24 T5 / T6 集成单测（Spec 20260824-v0.7.0-R24 §AC-R24-4 / §AC-R24-6 / §AC-R24-8-3 / §AC-R24-9）
 * startQuiz 接新引擎（分层抽题 + 配额修正先验读取）与 settleQuiz 轮间写回；
 * happy-dom localStorage 真实键（sq_morale / sq_recent_words），随机断言注入 seeded 源。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { MoraleState, Question, QuizSession, RecentWords } from '../../types'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz, abandonQuiz } from '../useQuiz'
import { recentWords as readRecentWords } from '../useLearningData'
import { mulberry32 } from '../../utils/quizEngine'

function wordPool(specs: { wordId: string; difficulty?: 1 | 2 | 3 }[]): Question[] {
  return specs.map((spec, i) => ({
    id: `q_${String(i).padStart(3, '0')}`,
    type: 'zh2en' as const,
    prompt: `${spec.wordId} prompt`,
    options: [`${spec.wordId}-a`, `${spec.wordId}-b`, `${spec.wordId}-c`, `${spec.wordId}-d`] as [
      string,
      string,
      string,
      string,
    ],
    answerIndex: i % 4,
    wordId: spec.wordId,
    ...(spec.difficulty === undefined ? {} : { difficulty: spec.difficulty }),
  }))
}

/** 30 词池：difficulty 1 / 2 / 3 各 10 词，wordId 互不相同（AC-R24-4-1 构造） */
function pool30(): Question[] {
  return wordPool(
    ([1, 2, 3] as const).flatMap((d) =>
      Array.from({ length: 10 }, (_, i) => ({ wordId: `w${d}_${i}`, difficulty: d })),
    ),
  )
}

/** 20 词池：difficulty 2 / 3 各 10 词（AC-R24-4-2 level 平移构造） */
function pool20d2d3(): Question[] {
  return wordPool([
    ...Array.from({ length: 10 }, (_, i) => ({ wordId: `c2_${i}`, difficulty: 2 as const })),
    ...Array.from({ length: 10 }, (_, i) => ({ wordId: `c3_${i}`, difficulty: 3 as const })),
  ])
}

function seedState(
  proficiency: MoraleState,
  pool: Question[],
  recentWords: RecentWords = [],
): void {
  localStorage.setItem('sq_questions', JSON.stringify(pool))
  localStorage.setItem('sq_morale', JSON.stringify(proficiency))
  localStorage.setItem('sq_recent_words', JSON.stringify(recentWords))
}

function currentSession(): QuizSession {
  return JSON.parse(localStorage.getItem('sq_session') as string) as QuizSession
}

function countByDifficulty(questions: Question[], d: 1 | 2 | 3): number {
  return questions.filter((q) => (q.difficulty ?? 3) === d).length
}

beforeEach(() => {
  localStorage.clear()
})

describe('startQuiz 接新引擎：成就区配额构成与整组乱序（AC-R24-4 集成层）', () => {
  it('AC-R24-4-2 level=2 先验读取生效（带宽平移）：d2 题 8 或 7 道、d3 题 2 或 3 道；wordId 唯一；同状态同 seed 重复一致', () => {
    seedState({ level: 2, lastRoundCorrect: null }, pool20d2d3())
    const first = startQuiz(mulberry32(7)) as QuizSession
    expect(first.questions).toHaveLength(10)
    const comfort = countByDifficulty(first.questions, 2)
    const high = countByDifficulty(first.questions, 3)
    expect(comfort === 8 || comfort === 7).toBe(true)
    expect(high === 2 || high === 3).toBe(true)
    expect(comfort + high).toBe(10)
    expect(new Set(first.questions.map((q) => q.wordId)).size).toBe(10)
    // 同状态（未结算，两键不变）同 seed 重复执行：抽题结果完全一致
    const second = startQuiz(mulberry32(7)) as QuizSession
    expect(second.questions.map((q) => q.id)).toEqual(first.questions.map((q) => q.id))
  })

  it('AC-R24-4-3 整组乱序高位不沉底：跨 12 个 seed，至少一个 seed 的 d3 高位题出现在第 1~7 题位', () => {
    seedState({ level: 2, lastRoundCorrect: null }, pool20d2d3())
    let highEarly = false
    for (let seed = 1; seed <= 12; seed++) {
      const s = startQuiz(mulberry32(seed)) as QuizSession
      const firstHigh = s.questions.findIndex((q) => (q.difficulty ?? 3) === 3)
      if (firstHigh !== -1 && firstHigh < 7) highEarly = true
    }
    expect(highEarly).toBe(true)
  })

  it('AC-R24-4-4 缺省退化：30 词全无 difficulty、level=1 → 抽满 10 题、每题难度语义 3、wordId 唯一', () => {
    seedState({ level: 1, lastRoundCorrect: null }, wordPool(Array.from({ length: 30 }, (_, i) => ({ wordId: `plain_${i}` }))))
    const s = startQuiz(mulberry32(11)) as QuizSession
    expect(s.questions).toHaveLength(10)
    expect(s.questions.every((q) => (q.difficulty ?? 3) === 3)).toBe(true)
    expect(new Set(s.questions.map((q) => q.wordId)).size).toBe(10)
  })
})

describe('startQuiz 下一组配额修正先验读取（AC-R24-6-3 首局 / 高分三选一）', () => {
  const quotaCases: { name: string; proficiency: MoraleState }[] = [
    { name: '首局 lastRoundCorrect=null', proficiency: { level: 1, lastRoundCorrect: null } },
    { name: '上轮全对 lastRoundCorrect=10', proficiency: { level: 1, lastRoundCorrect: 10 } },
  ]
  for (const { name, proficiency } of quotaCases) {
    it(`AC-R24-6-3 ${name}：30 词池 level=1 → (会做 d≤1, 高位 d≥2) = (8,2) 或 (7,3)（正常三选一）`, () => {
      seedState(proficiency, pool30())
      const s = startQuiz(mulberry32(5)) as QuizSession
      expect(s.questions).toHaveLength(10)
      const comfort = s.questions.filter((q) => (q.difficulty ?? 3) <= 1).length
      expect(comfort === 8 || comfort === 7).toBe(true)
      expect(10 - comfort === 2 || 10 - comfort === 3).toBe(true)
    })
  }
})

describe('确定性与既有行为回归（AC-R24-9-1 / AC-R24-9-3）', () => {
  it('AC-R24-9-1 同状态同 seed 两次完整开局 + 相同作答序列：session.questions 题序与选项乱序完全一致', () => {
    const proficiency: MoraleState = { level: 2, lastRoundCorrect: null }
    seedState(proficiency, pool30())
    const first = startQuiz(mulberry32(99)) as QuizSession
    for (let i = 0; i < 3; i++) answerQuiz(first.questions[i].answerIndex)
    const firstSnapshot = currentSession()

    seedState(proficiency, pool30()) // 恢复同一 localStorage 状态（作答不写两键，重置后一致）
    const second = startQuiz(mulberry32(99)) as QuizSession
    for (let i = 0; i < 3; i++) answerQuiz(second.questions[i].answerIndex)
    const secondSnapshot = currentSession()

    expect(secondSnapshot.questions).toEqual(firstSnapshot.questions)
  })

  it('AC-R24-9-3 空题池 → null 且不创建会话（既有）', () => {
    seedState({ level: 1, lastRoundCorrect: null }, [])
    expect(startQuiz(mulberry32(1))).toBeNull()
    expect(localStorage.getItem('sq_session')).toBeNull()
  })

  it('AC-R24-9-3 7 题池 → 全量 7 题、答满结算按 7 题口径（全对 7 + 满分 3 = 10 星）', () => {
    const pool = wordPool(Array.from({ length: 7 }, (_, i) => ({ wordId: `s7_${i}`, difficulty: 2 as const })))
    seedState({ level: 2, lastRoundCorrect: null }, pool)
    const s = startQuiz(mulberry32(3)) as QuizSession
    expect(s.questions).toHaveLength(7)
    for (const q of s.questions) answerQuiz(q.answerIndex)
    finishQuiz()
    expect(currentSession().score).toBe(7)
    expect(currentSession().earnedStars).toBe(10)
    localStorage.setItem('sq_stars', JSON.stringify([]))
    settleQuiz()
    const stars = JSON.parse(localStorage.getItem('sq_stars') as string) as { amount: number }[]
    expect(stars.map((e) => e.amount)).toEqual([7, 3])
  })
})

// ===== T6：settleQuiz 轮间调整写回（AC-R24-5 / AC-R24-8-3）=====

/** 手动 seed 一轮 pending 会话（10 词、difficulty 2）+ 两统计键 + 空流水 */
function seedPendingRound(correctCount: number, level: MoraleState['level'], recentWords: RecentWords = []): void {
  const questions = wordPool(Array.from({ length: 10 }, (_, i) => ({ wordId: `r6_${i}`, difficulty: 2 as const })))
  localStorage.setItem(
    'sq_session',
    JSON.stringify({
      quizId: 'quiz_r24',
      status: 'pending',
      questions,
      currentIndex: questions.length,
      answers: [],
      correctCount,
      score: correctCount,
      earnedStars: correctCount,
      createdAt: 1_000_000,
    } satisfies QuizSession),
  )
  localStorage.setItem('sq_morale', JSON.stringify({ level, lastRoundCorrect: null }))
  localStorage.setItem('sq_recent_words', JSON.stringify(recentWords))
  localStorage.setItem('sq_stars', JSON.stringify([]))
}

function readMorale(): MoraleState {
  return JSON.parse(localStorage.getItem('sq_morale') as string) as MoraleState
}


describe('settleQuiz 轮间调整写回 sq_morale（AC-R24-5-1 ~ 5-3；#173 起带 childId）', () => {
  it('AC-R24-5-1 升档：level=2 答对 9 → { level: 3, lastRoundCorrect: 9 }（min(3, 2+1)）', () => {
    seedPendingRound(9, 2)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 3, lastRoundCorrect: 9, childId: 'default' })
  })

  it('AC-R24-5-1 边界：level=3 全对 10 → level 仍 3（min clamp）', () => {
    seedPendingRound(10, 3)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 3, lastRoundCorrect: 10, childId: 'default' })
  })

  it('AC-R24-5-2 强降档：level=2 答对 4 → { level: 1, lastRoundCorrect: 4 }（max(1, 2-1)）', () => {
    seedPendingRound(4, 2)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 1, lastRoundCorrect: 4, childId: 'default' })
  })

  it('AC-R24-5-2 边界：答对 5 → 降档；level=1 答对 0 → 仍 1（max clamp）', () => {
    seedPendingRound(5, 2)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 1, lastRoundCorrect: 5, childId: 'default' })
    seedPendingRound(0, 1)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 1, lastRoundCorrect: 0, childId: 'default' })
  })

  it('AC-R24-5-3 不变：level=2 答对 7 → { level: 2, lastRoundCorrect: 7 }；边界 6 / 8 均不变', () => {
    seedPendingRound(7, 2)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 2, lastRoundCorrect: 7, childId: 'default' })
    seedPendingRound(6, 2)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 2, lastRoundCorrect: 6, childId: 'default' })
    seedPendingRound(8, 3)
    settleQuiz()
    expect(readMorale()).toEqual({ level: 3, lastRoundCorrect: 8, childId: 'default' })
  })
})

describe('settleQuiz 写回 sq_recent_words 与作废 / 幂等（AC-R24-5-4 / 5-5、AC-R24-8-3）', () => {
  it('#173 重考词移到最前、同轮重复词去重、无词题排除，最多保留 30 词', () => {
    seedPendingRound(7, 2, ['old', 'r6_0', ...Array.from({ length: 30 }, (_, i) => `old${i}`)])
    const session = currentSession()
    session.questions[1].wordId = 'r6_0'
    delete session.questions[2].wordId
    localStorage.setItem('sq_session', JSON.stringify(session))
    settleQuiz()
    expect(readRecentWords()).toEqual([
      'r6_0', 'r6_3', 'r6_4', 'r6_5', 'r6_6', 'r6_7', 'r6_8', 'r6_9',
      'old', ...Array.from({ length: 21 }, (_, i) => `old${i}`),
    ])
  })

  it('AC-R24-8-3 结算写窗口：本轮 10 个 wordId 并入清单头部（新→旧），非本轮词后置保留', () => {
    seedPendingRound(7, 2, ['a1'])
    settleQuiz()
    const recent = readRecentWords()
    expect(recent).toHaveLength(11)
    expect(recent.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `r6_${i}`))
    expect(recent[10]).toBe('a1') // 非本轮词不动（旧词后置）
  })

  it('AC-R24-5-4 中途作废：进行到第 3 题后 abandonQuiz，两键均不变', () => {
    const proficiency: MoraleState = { level: 2, lastRoundCorrect: null }
    const recentWords: RecentWords = []
    seedState(proficiency, pool30(), recentWords)
    const s = startQuiz(mulberry32(21)) as QuizSession
    for (let i = 0; i < 3; i++) answerQuiz(s.questions[i].answerIndex)
    abandonQuiz()
    expect(readMorale()).toEqual(proficiency)
    expect(readRecentWords()).toEqual(recentWords)
    expect(localStorage.getItem('sq_session')).toBeNull()
  })

  it('AC-R24-5-5 二次 settleQuiz 幂等：seq 不重复递增、sq_morale 不被二次改写，返回 idempotent', () => {
    seedPendingRound(9, 2)
    expect(settleQuiz()).toBe('settled')
    const afterFirst = { proficiency: readMorale(), recent: readRecentWords() }
    expect(settleQuiz()).toBe('idempotent')
    expect(readMorale()).toEqual(afterFirst.proficiency)
    expect(readRecentWords()).toEqual(afterFirst.recent)
    expect(readRecentWords()).toHaveLength(10) // 只并入一次（每词一条，无重复）
  })
})

describe('startQuiz 下一组配额修正（AC-R24-6-1 / 6-2，lastRoundCorrect 先验驱动）', () => {
  it('AC-R24-6-1 上轮 ≤5 → 全会做：{ level: 2, lastRoundCorrect: 4 } + 30 词池 → 10 题全部 difficulty ≤ 2（无高位题）', () => {
    seedState({ level: 2, lastRoundCorrect: 4 }, pool30())
    const s = startQuiz(mulberry32(9)) as QuizSession
    expect(s.questions).toHaveLength(10)
    expect(s.questions.every((q) => (q.difficulty ?? 3) <= 2)).toBe(true)
  })

  it('AC-R24-6-2 上轮 6~8 → 不出挑战：{ level: 1, lastRoundCorrect: 7 } + 30 词池 → 配额 (8, 2, 0)', () => {
    seedState({ level: 1, lastRoundCorrect: 7 }, pool30())
    const s = startQuiz(mulberry32(13)) as QuizSession
    expect(s.questions).toHaveLength(10)
    expect(countByDifficulty(s.questions, 1)).toBe(8)
    expect(countByDifficulty(s.questions, 2)).toBe(2)
    expect(countByDifficulty(s.questions, 3)).toBe(0)
  })
})

describe('星星经济回归（AC-R24-9-2）', () => {
  it('混合难度全对 10 题 → earnedStars === 13（难度不挂钩得星）', () => {
    seedState({ level: 2, lastRoundCorrect: null }, pool30())
    const s = startQuiz(mulberry32(17)) as QuizSession
    const difficulties = new Set(s.questions.map((q) => q.difficulty ?? 3))
    expect(difficulties.size).toBeGreaterThan(1) // 题组确含混合难度
    for (const q of s.questions) answerQuiz(q.answerIndex)
    finishQuiz()
    expect(currentSession().earnedStars).toBe(13)
    settleQuiz()
    const stars = JSON.parse(localStorage.getItem('sq_stars') as string) as { amount: number }[]
    expect(stars.map((e) => e.amount)).toEqual([10, 3])
  })
})
