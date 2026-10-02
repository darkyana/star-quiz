// #287 惊喜题集对象化挂载：数据模块安全网直接断言现役资产槽位 public/trivia/current/set.json
// （人工改 JSON 后跑本测试即为验收：题量/9 号段唯一/题目形状/名称一致）。
// 与 current-questions.ts 是两物：本集不进用户题池、不经任何 sq_ 键、学习文件的替换与追加均不触碰
// （ADR 0014 契约零改动），抽题时按分册并入惊喜题库调度（useQuiz.startQuiz 合并调度池）。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { bankOf } from '../../utils/questionBank'
import { init as initAppState } from '../../composables/useDataInfra'
import {
  TRIVIA_ENTRY_ID,
  TRIVIA_SET_SLOT,
  adoptTriviaSet,
  loadedTriviaQuestions,
  parseTriviaSet,
  triviaSetRef,
} from '../trivia-set'

const readSlotJson = (): string => readFileSync(resolve(process.cwd(), 'public', TRIVIA_SET_SLOT.json), 'utf8')

beforeEach(() => {
  localStorage.clear()
  triviaSetRef.value = null
})

describe('#287 现役题集资产槽位（set.json）', () => {
  it('槽位固定：入口 id 恒 builtin-trivia（云端同步键），json/icon 落在 public/trivia/current/', () => {
    expect(TRIVIA_ENTRY_ID).toBe('builtin-trivia')
    expect(TRIVIA_SET_SLOT.json).toBe('trivia/current/set.json')
    expect(TRIVIA_SET_SLOT.icon).toBe('trivia/current/icon.svg')
    // 贴纸图随题集文件夹分发（换内容 = 换整夹）
    expect(readFileSync(resolve(process.cwd(), 'public', TRIVIA_SET_SLOT.icon))).toBeTruthy()
  })

  it('头部元数据非空：类别/分册/介绍随题集分发（名称与主题解耦的单一事实源）', () => {
    const set = JSON.parse(readSlotJson()) as Record<string, unknown>
    expect(typeof set.category).toBe('string')
    expect((set.category as string).length).toBeGreaterThan(0)
    expect(typeof set.book).toBe('string')
    expect((set.book as string).length).toBeGreaterThan(0)
    expect(typeof set.intro).toBe('string')
    expect((set.intro as string).length).toBeGreaterThan(0)
  })

  it('题集 3 道以上，id 全 9 号段且唯一（来源即身份可判定）', () => {
    const set = JSON.parse(readSlotJson()) as { questions: Array<{ id: string }> }
    expect(set.questions.length).toBeGreaterThanOrEqual(3)
    const ids = set.questions.map(q => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(bankOf(id)).toBe('trivia')
  })

  it('题目形状合法：type 现役题型、4 选项、answerIndex 0-3、prompt 非空、无 wordId、不带 category/book（头部统一盖章）', () => {
    const set = JSON.parse(readSlotJson()) as { questions: Array<Record<string, unknown>> }
    for (const q of set.questions) {
      expect(['zh2en', 'en2zh', 'cloze', 'trivia']).toContain(q.type)
      expect(typeof q.prompt).toBe('string')
      expect((q.prompt as string).length).toBeGreaterThan(0)
      expect(q.options).toHaveLength(4)
      expect((q.options as string[]).every(o => typeof o === 'string' && o.length > 0)).toBe(true)
      expect(q.answerIndex).toBeGreaterThanOrEqual(0)
      expect(q.answerIndex).toBeLessThanOrEqual(3)
      expect((q.options as string[])[q.answerIndex as number]).toBeTruthy()
      expect(q.wordId).toBeUndefined()
      expect(q.category).toBeUndefined()
      expect(q.book).toBeUndefined()
    }
  })

  it('解析落位：parseTriviaSet 接受现役 set.json，逐题盖章头部类别/分册（名称一致）', () => {
    expect(adoptTriviaSet(JSON.parse(readSlotJson()))).toBe(true)
    const set = triviaSetRef.value!
    const raw = JSON.parse(readSlotJson()) as { category: string, book: string }
    expect(set.category).toBe(raw.category)
    expect(set.book).toBe(raw.book)
    expect(loadedTriviaQuestions()).toHaveLength(set.questions.length)
    for (const q of set.questions) {
      expect(q.category).toBe(set.category)
      expect(q.book).toBe(set.book)
    }
  })

  it('不进用户题池：模块加载与数据初始化后，sq_questions 不含任何内置题 id', () => {
    adoptTriviaSet(JSON.parse(readSlotJson()))
    initAppState()
    const pool = JSON.parse(localStorage.getItem('sq_questions') ?? '[]') as Array<{ id: string }>
    const poolIds = new Set(pool.map(q => q.id))
    for (const q of loadedTriviaQuestions()) {
      expect(poolIds.has(q.id)).toBe(false)
    }
  })
})

describe('#289 惊喜得星规则（starRule 头部字段）', () => {
  const valid = JSON.parse(readSlotJson()) as Record<string, unknown>

  it('合法规则：非空档次数组（minAccuracy ∈ (0,1]、stars 正整数）解析保留在题集对象上', () => {
    const set = parseTriviaSet({ ...valid, starRule: [{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }] })
    expect(set?.starRule).toEqual([{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }])
  })

  it('可省字段：不携带 starRule = 无规则（合法，starRule 为 undefined，#288 零产星行为）', () => {
    const set = parseTriviaSet(valid)
    expect(set?.starRule).toBeUndefined()
  })

  it.each([
    ['非数组', 'not-a-rule'],
    ['空档次数组', []],
    ['档位非对象', [{ minAccuracy: 0.7, stars: 5 }, 'x']],
    ['minAccuracy 为 0（须 ∈ (0,1]）', [{ minAccuracy: 0, stars: 5 }]],
    ['minAccuracy 超过 1', [{ minAccuracy: 1.1, stars: 5 }]],
    ['minAccuracy 非数字', [{ minAccuracy: '0.7', stars: 5 }]],
    ['stars 为 0（须正整数）', [{ minAccuracy: 0.7, stars: 0 }]],
    ['stars 非整数', [{ minAccuracy: 0.7, stars: 2.5 }]],
    ['stars 为负数', [{ minAccuracy: 0.7, stars: -3 }]],
    ['stars 非数字', [{ minAccuracy: 0.7, stars: '5' }]],
    ['档位缺 stars 键', [{ minAccuracy: 0.7 }]],
    ['minAccuracy 门槛重复（平级，starsForRule tie-break 不可判定）', [{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 0.7, stars: 10 }]],
  ])('%s → null（整集按损坏拒绝，走空题库路径）', (_name, starRule) => {
    expect(parseTriviaSet({ ...valid, starRule })).toBeNull()
    expect(adoptTriviaSet({ ...valid, starRule })).toBe(false)
    expect(triviaSetRef.value).toBeNull()
  })
})

describe('名称一致 AC（#287）', () => {
  it('解析后逐题盖章头部 category/book：改头部名称即改全部题目归属，题目条目本身不携带名称字段', () => {
    const valid = JSON.parse(readSlotJson()) as Record<string, unknown>
    const set = parseTriviaSet({ ...valid, category: '自定义大类', book: '自定义分册' })
    expect(set).not.toBeNull()
    expect(set!.category).toBe('自定义大类')
    expect(set!.book).toBe('自定义分册')
    for (const q of set!.questions) {
      expect(q.category).toBe('自定义大类')
      expect(q.book).toBe('自定义分册')
    }
  })
})

describe('#287 题集校验拒绝带病内容（缺失/损坏视为惊喜题库为空）', () => {
  const valid = JSON.parse(readSlotJson())

  it.each([
    ['题量不足 3 道', { ...valid, questions: valid.questions.slice(0, 2) }],
    ['id 出 9 号段', { ...valid, questions: [{ ...valid.questions[0], id: '100001' }, ...valid.questions.slice(1, 4)] }],
    ['id 重复', { ...valid, questions: [valid.questions[0], { ...valid.questions[1], id: valid.questions[0].id }, ...valid.questions.slice(2, 4)] }],
    ['选项不足 4 个', { ...valid, questions: [{ ...valid.questions[0], options: ['A', 'B'] }, ...valid.questions.slice(1, 4)] }],
    ['头部名称缺失', { ...valid, category: '' }],
    ['非对象输入', 'not-a-set'],
  ])('%s → null，adoptTriviaSet 落空题库', (_name, broken) => {
    expect(parseTriviaSet(broken)).toBeNull()
    triviaSetRef.value = { category: 'x', book: 'y', intro: 'z', questions: [] }
    expect(adoptTriviaSet(broken)).toBe(false)
    expect(triviaSetRef.value).toBeNull()
    expect(loadedTriviaQuestions()).toEqual([])
  })
})
