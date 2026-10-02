// #173 抽题等价回归（改形前固化种子金样）：
// 金样 quizEngine-v9-equivalence.golden.json 由 8 版引擎（近期已测词 {seq, words} + 久未出第二层排序）
// 在改形前生成：5 个种子 × 3 档位 × 4 种上轮答对数，共 60 轮抽题序列。
// 用例数据特意取「窗口外候选 lastSeq 全为 0」的先验（从未出现的词），此时旧第二层排序稳定保持洗牌序、
// 与新引擎（清单成员判窗 + 无第二层排序）在该基线场景严格等价。
// 不声称任意历史均同序：删去久未出优先后，旧 lastSeq 不同的候选顺序按模型决议有意改变。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { drawQuestions, mulberry32 } from '../quizEngine'
import type { Question } from '../../types'

const golden = JSON.parse(
  // happy-dom 下 import.meta.url 为 http 协议，改以进程 cwd（vitest 根目录）定位金样
  readFileSync('src/utils/__tests__/quizEngine-v9-equivalence.golden.json', 'utf8'),
) as { cases: Array<{ seed: number; level: 1 | 2 | 3; lastRoundCorrect: number | null; ids: string[] }> }

const pool: Question[] = Array.from({ length: 40 }, (_, i) => ({
  id: String(i + 1).padStart(6, '0'),
  type: 'zh2en',
  prompt: `第 ${i + 1} 题`,
  options: ['a', 'b', 'c', 'd'],
  answerIndex: i % 4,
  wordId: `w${i + 1}`,
  difficulty: ((i % 3) + 1) as 1 | 2 | 3,
}))

// 8 版先验 {seq:5, words:{w1..w12:5}} 的 9 版等价清单：窗口内 12 词（新→旧序无关，引擎只判成员）
const recent = Array.from({ length: 12 }, (_, i) => `w${i + 1}`)

describe('#173 基线场景抽题等价：同种子下与 8 版引擎出题序列一致（金样固化）', () => {
  it('60 轮（5 种子 × 3 档位 × 4 上轮答对数）题序逐条一致', () => {
    expect(golden.cases).toHaveLength(60)
    for (const c of golden.cases) {
      const drawn = drawQuestions({
        pool,
        level: c.level,
        lastRoundCorrect: c.lastRoundCorrect,
        recentWords: recent,
        random: mulberry32(c.seed),
        count: 10,
      })
      expect(drawn.map((q) => q.id)).toEqual(c.ids)
    }
  })
})
