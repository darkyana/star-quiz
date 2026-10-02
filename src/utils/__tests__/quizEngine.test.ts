/** quizEngine 单测（Spec 20260824-v0.7.0-R24）。AC1-1~1-5 纯随机用例按 Spec D6 删除重写；
 * shuffleOptions / grade / mulberry32 用例保留（REQ-R24-6-2）。随机断言一律注入 mulberry32(seed)。 */
import { describe, it, expect } from 'vitest'
import type { Question, RecentWords } from '../../types'
import {
  drawQuestions,
  resolveRoundQuota,
  bandOfQuestion,
  shuffleOptions,
  grade,
  mulberry32,
} from '../quizEngine'

// ===== 题池构造辅助 =====

/** w = wordId；d = difficulty（缺省 = 题上无字段，语义兜底 3）；n = 同词题数（默认 1） */
interface QSpec { w: string; d?: 1 | 2 | 3; n?: number }

function words(prefix: string, count: number, d?: 1 | 2 | 3): QSpec[] {
  return Array.from({ length: count }, (_, i) => ({ w: `${prefix}${i}`, d }))
}

function buildPool(specs: QSpec[]): Question[] {
  const pool: Question[] = []
  let seq = 0
  for (const s of specs) {
    for (let k = 0; k < (s.n ?? 1); k++) {
      seq += 1
      pool.push({
        id: `q${String(seq).padStart(3, '0')}`,
        type: 'zh2en',
        prompt: `${s.w}#${k}`,
        options: [`a${seq}`, `b${seq}`, `c${seq}`, `d${seq}`],
        answerIndex: seq % 4,
        wordId: s.w,
        ...(s.d !== undefined ? { difficulty: s.d } : {}),
      })
    }
  }
  return pool
}

const EMPTY_RECENT: RecentWords = [] // #173 起近期已测词为字符串数组（清单形）

function draw(pool: Question[], level: 1 | 2 | 3, seed: number, recentWords: RecentWords = EMPTY_RECENT, lastRoundCorrect: number | null = null): Question[] {
  return drawQuestions({ pool, level, lastRoundCorrect, recentWords, random: mulberry32(seed) })
}

function ids(questions: Question[]): string[] {
  return questions.map((q) => q.id)
}

// ===== 分层纯函数：resolveRoundQuota（REQ-R24-4-2 三选一 / REQ-R24-4-7 配额修正）=====

describe('resolveRoundQuota 配额构成', () => {
  it('上一轮 ≤ 5：配额固定全会做 (10, 0, 0)', () => {
    expect(resolveRoundQuota(4, mulberry32(42))).toEqual({ comfort: 10, reach: 0, challenge: 0 })
  })
  it('上一轮 6~8：配额固定 (8, 2, 0) 不出挑战', () => {
    expect(resolveRoundQuota(7, mulberry32(42))).toEqual({ comfort: 8, reach: 2, challenge: 0 })
  })
  it('首局（null）或上一轮 ≥ 9：seed 驱动三选一，构成恒为三合法组合之一', () => {
    const legal = new Set(['8,1,1', '8,2,0', '7,2,1'])
    const seen = new Set<string>()
    for (const last of [null, 9, 10] as const) {
      for (let s = 1; s <= 30; s++) {
        const q = resolveRoundQuota(last, mulberry32(s))
        expect(q.comfort + q.reach + q.challenge).toBe(10)
        const key = `${q.comfort},${q.reach},${q.challenge}`
        expect(legal.has(key)).toBe(true)
        seen.add(key)
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2) // 随机源确实驱动三选一
  })
})

// ===== 分层纯函数：bandOfQuestion（类带宽，difficulty 缺省兜底 3）=====

describe('bandOfQuestion 类带宽判定', () => {
  const q = (d?: 1 | 2 | 3): Question => ({ ...buildPool([{ w: 'w', d }])[0] })
  it('level=1：d1 会做 / d2 够一够 / d3 挑战；缺省按 3 判为挑战', () => {
    expect(bandOfQuestion(q(1), 1)).toBe('comfort')
    expect(bandOfQuestion(q(2), 1)).toBe('reach')
    expect(bandOfQuestion(q(3), 1)).toBe('challenge')
    expect(bandOfQuestion(q(undefined), 1)).toBe('challenge')
  })
  it('level=2：d≤2 会做 / d3 够一够（挑战带宽 clamp 后为空）', () => {
    expect(bandOfQuestion(q(1), 2)).toBe('comfort')
    expect(bandOfQuestion(q(2), 2)).toBe('comfort')
    expect(bandOfQuestion(q(3), 2)).toBe('reach')
  })
  it('level=3：全部落会做（够一够 / 挑战带宽均 clamp 为空）', () => {
    expect(bandOfQuestion(q(1), 3)).toBe('comfort')
    expect(bandOfQuestion(q(3), 3)).toBe('comfort')
    expect(bandOfQuestion(q(undefined), 3)).toBe('comfort')
  })
})

// ===== 引擎：配额构成与整组乱序（AC-R24-4）=====

describe('drawQuestions 分层抽题（AC-R24-4-1 构成三选一 + seed 确定）', () => {
  const pool = buildPool([...words('a', 10, 1), ...words('b', 10, 2), ...words('c', 10, 3)])
  it('AC-R24-4-1: level=2 首局构成 ∈ {(会做8,高位2),(会做7,高位3)}，wordId 唯一，同 seed 完全复现', () => {
    const round = draw(pool, 2, 42)
    expect(round).toHaveLength(10)
    expect(new Set(round.map((x) => x.wordId)).size).toBe(10)
    const comfort = round.filter((x) => (x.difficulty ?? 3) <= 2).length
    expect([[8, 2], [7, 3]].some(([c, h]) => comfort === c && 10 - comfort === h)).toBe(true)
    expect(ids(draw(pool, 2, 42))).toEqual(ids(round))
  })
  it('AC-R24-4-1 补充: 跨 seed 出现两种构成（三选一由注入随机源选定）', () => {
    const comps = new Set<string>()
    for (let s = 1; s <= 50; s++) {
      const comfort = draw(pool, 2, s).filter((x) => (x.difficulty ?? 3) <= 2).length
      comps.add(`${comfort},${10 - comfort}`)
    }
    expect([...comps].every((k) => k === '8,2' || k === '7,3')).toBe(true)
    expect(comps.size).toBe(2)
  })
  it('AC-R24-4-2 引擎层: 会做带宽跟随 level 平移（d≤level），d2/d3 池下构成仍合法', () => {
    const pool20 = buildPool([...words('m', 10, 2), ...words('h', 10, 3)])
    for (const seed of [7, 42, 99]) {
      const round = draw(pool20, 2, seed)
      const comfort = round.filter((x) => x.difficulty === 2).length
      expect([7, 8]).toContain(comfort)
      expect(10 - comfort).toBe(round.filter((x) => x.difficulty === 3).length)
      expect(new Set(round.map((x) => x.wordId)).size).toBe(10)
    }
  })
  it('AC-R24-4-4 引擎层: 全池缺省难度 3 退化为纯随机 + 词级去重（可抽满、不崩、wordId 唯一）', () => {
    const round = draw(buildPool(words('x', 30)), 1, 42)
    expect(round).toHaveLength(10)
    expect(round.every((x) => x.difficulty === undefined)).toBe(true)
    expect(new Set(round.map((x) => x.wordId)).size).toBe(10)
  })
})

describe('drawQuestions 构成后整组乱序（AC-R24-4-3 高位不沉底）', () => {
  const pool = buildPool([...words('m', 10, 2), ...words('h', 10, 3)])
  it('AC-R24-4-3: 跨 20 个 seed 存在高位题（difficulty=3）出现在第 1~7 题位的开局', () => {
    const firstHighPos: number[] = []
    for (let s = 1; s <= 20; s++) {
      firstHighPos.push(draw(pool, 2, s).findIndex((x) => x.difficulty === 3))
    }
    expect(firstHighPos.every((p) => p >= 0)).toBe(true) // 构成保证高位题存在
    expect(firstHighPos.some((p) => p <= 6)).toBe(true) // 至少一个 seed 高位题在前 7 位
    expect(firstHighPos.every((p) => p >= 7)).toBe(false) // 不得全部沉底 8~10 位
  })
})

// ===== 引擎：词级去重（AC-R24-7）=====

describe('drawQuestions 同轮 wordId 唯一（AC-R24-7）', () => {
  it('AC-R24-7-1: 同词多题池（20 题 18 词）抽 10 题 wordId 互不相同，同词至多 1 题', () => {
    const pool = buildPool([{ w: 'escalator', n: 2 }, { w: 'journey', n: 2 }, ...words('s', 16)])
    for (const seed of [42, 7, 2024]) {
      const round = draw(pool, 3, seed)
      expect(round).toHaveLength(10)
      const wordIds = round.map((x) => x.wordId)
      expect(new Set(wordIds).size).toBe(10)
      expect(wordIds.filter((w) => w === 'escalator').length).toBeLessThanOrEqual(1)
      expect(wordIds.filter((w) => w === 'journey').length).toBeLessThanOrEqual(1)
    }
  })
  it('AC-R24-7-2: 6 词池（词数 < 10）硬去重放宽为词间均匀分散，全部词出现且次数差 ≤ 1', () => {
    const round = draw(buildPool(Array.from({ length: 6 }, (_, i) => ({ w: `v${i}`, n: 2 }))), 3, 42)
    expect(round).toHaveLength(10)
    const counter = new Map<string, number>()
    for (const x of round) {
      expect(x.wordId).toBeDefined()
      counter.set(x.wordId!, (counter.get(x.wordId!) ?? 0) + 1)
    }
    expect(counter.size).toBe(6)
    const counts = [...counter.values()]
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })
})

// ===== 引擎：跨轮软去重与久未出优先（AC-R24-8）=====

describe('drawQuestions 跨轮软去重（AC-R24-8）', () => {
  it('#173 无词归属题的 id 不得与别题 wordId 碰撞，也不被词窗口误伤', () => {
    const pool = buildPool([...words('outside', 9, 3), { w: 'recent', d: 3 }])
    const independent: Question = { id: 'recent', type: 'trivia', prompt: '独立题', options: ['a', 'b', 'c', 'd'], answerIndex: 0 }
    for (const seed of [1, 2, 3]) {
      const round = draw([...pool, independent], 3, seed, ['recent'])
      expect(round).toHaveLength(10)
      expect(round.map((q) => q.id)).toContain('recent')
      expect(round.some((q) => q.wordId === 'recent')).toBe(false)
    }
  })

  it('AC-R24-8-1: 窗口外候选充足时，窗口内词（近 3 轮）零出现', () => {
    const pool = buildPool([...words('n', 12, 3), { w: 'w1', d: 3 }, { w: 'w2', d: 3 }, { w: 'w3', d: 3 }])
    const recent: RecentWords = ['w1', 'w2', 'w3'] // #173 清单形：窗口 = 清单成员（近 30 词 ≈ 3 轮）
    const wordIds = draw(pool, 3, 42, recent).map((x) => x.wordId)
    expect(wordIds).toHaveLength(10)
    expect(wordIds.filter((w) => w === 'w1' || w === 'w2' || w === 'w3')).toHaveLength(0)
    expect(new Set(wordIds).size).toBe(10)
  })
  it('AC-R24-8-2: 窗口外候选不足时窗口内词补位（#173 起补位序为公平轮转，不再按久远排序）', () => {
    const pool = buildPool([
      ...words('n', 7, 3),
      { w: 'a4', d: 3 }, { w: 'a5', d: 3 }, // 窗口外（不在清单）
      { w: 'a3', d: 3 }, { w: 'a2', d: 3 }, { w: 'a1', d: 3 }, // 窗口内（清单成员）
    ])
    const recent: RecentWords = ['a1', 'a2', 'a3'] // 新→旧
    const round = draw(pool, 3, 42, recent)
    expect(round).toHaveLength(10)
    const drawn = new Set(round.map((x) => x.wordId))
    // 窗口外 9 词全部先入选；最后 1 席由窗口内词按洗牌序公平补位（#166 模型决议 4：移除久未出第二层排序）
    for (const w of ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'a4', 'a5']) expect(drawn.has(w)).toBe(true)
    expect(['a1', 'a2', 'a3'].some((w) => drawn.has(w))).toBe(true)
  })
  it('#173 清单外公平轮转：新词与清单外旧词同权（久未出优先已随第二层排序移除）', () => {
    // 池 12 词全 d3：7 新词 + 5 个清单外旧词 → 清单外全员同权轮转，跨种子旧词亦入选
    const pool = buildPool([...words('n', 7, 3), ...words('o', 5, 3)])
    const recent: RecentWords = [] // 清单为空：12 词全在窗口外
    let oldWordDrawn = false
    for (let seed = 1; seed <= 20; seed++) {
      const drawn = draw(pool, 3, seed, recent).map((x) => x.wordId)
      expect(drawn).toHaveLength(10)
      if (drawn.some((w) => w?.startsWith('o'))) oldWordDrawn = true
    }
    expect(oldWordDrawn).toBe(true)
  })
})

// ===== 引擎：极端题池退化（REQ-R24-4-9，既有行为回归）=====

describe('drawQuestions 极端题池退化', () => {
  it('空题池返回空数组', () => {
    expect(draw([], 3, 42)).toEqual([])
  })
  it('题池 < 10 全量返回（长度 = 池长、集合一致）', () => {
    const pool = buildPool(words('s', 7))
    const round = draw(pool, 2, 42)
    expect(round).toHaveLength(7)
    expect(new Set(ids(round))).toEqual(new Set(ids(pool)))
  })
  it('不修改原题池（长度与内容深相等）', () => {
    const pool = buildPool([...words('m', 10, 2), ...words('h', 10, 3)])
    const before = JSON.parse(JSON.stringify(pool))
    draw(pool, 2, 42)
    expect(pool).toHaveLength(20)
    expect(pool).toEqual(before)
  })
})

// ===== 既有行为保留（REQ-R24-6-2：shuffleOptions / grade 不变）=====

describe('shuffleOptions 选项乱序（AC1-6 / AC1-7）', () => {
  it('AC1-6 返回 4 项排列：长度 4、集合相同', () => {
    const q: Question = { id: 't1', type: 'zh2en', prompt: 'p', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w' }
    const { options } = shuffleOptions(q, mulberry32(42))
    expect(options).toHaveLength(4)
    expect([...options].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
  it('AC1-7 answerIndex 重映射指向原正确答案文本，且不修改原题', () => {
    const q: Question = { id: 't2', type: 'zh2en', prompt: 'p', options: ['a', 'b', 'c', 'd'], answerIndex: 2, wordId: 'w' }
    const before = JSON.parse(JSON.stringify(q))
    const result = shuffleOptions(q, mulberry32(42))
    expect(result.options).toHaveLength(4)
    expect(result.answerIndex).toBeGreaterThanOrEqual(0)
    expect(result.answerIndex).toBeLessThanOrEqual(3)
    expect(result.options[result.answerIndex]).toBe('c')
    expect(q.options).toEqual(before.options)
    expect(q.answerIndex).toBe(before.answerIndex)
  })
})

describe('grade 三态判分（AC1-8）', () => {
  it('答对 / 答错 / 不会依次返回 correct / wrong / skipped', () => {
    expect(grade(1, 1)).toBe('correct')
    expect(grade(0, 1)).toBe('wrong')
    expect(grade(null, 1)).toBe('skipped')
  })
})

describe('mulberry32 seeded 随机源', () => {
  it('返回 [0,1) 区间均匀分布的确定序列', () => {
    const rng = mulberry32(1)
    const samples = Array.from({ length: 100 }, () => rng())
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(1)
    }
    const again = mulberry32(1)
    expect(Array.from({ length: 100 }, () => again())).toEqual(samples)
  })
})
