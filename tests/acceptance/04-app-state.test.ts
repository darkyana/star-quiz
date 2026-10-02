/**
 * AC4-1 ~ AC4-5 数据层读写 + AC7-3 首次启动写入题池（Spec §4 REQ-4 / REQ-7）
 * 数据键与初始值来自 Spec §3.3 数据契约表。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Question } from '../../src/types/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import { writeQuestions } from '../../src/composables/useLearningData'
import { ledger as readStars, writeLedger as writeStars } from '../../src/composables/useStarData'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
// R32：sq_proposals 初始值注册在 useProposals 模块加载时发生。
// 剪环前经 useLearningData → useExport 传递加载；剪环后（架构评审 20260829）显式 import
import '../../src/composables/useProposals'
import { currentQuestionBank } from '../../src/data/current-questions'

const KEYS = {
  questions: 'sq_questions',
  stars: 'sq_stars',
  rewards: 'sq_rewards',
  lastExport: 'sq_last_export',
}

function parse(key: string): unknown {
  return JSON.parse(localStorage.getItem(key) as string)
}

/** 基于 Storage 标准接口（length/key）枚举全部键 */
function allKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k) keys.push(k)
  }
  return keys
}

beforeEach(() => {
  localStorage.clear()
})

describe('AC4 数据层读写', () => {
  it('AC4-1 首次启动初始值（逐键断言）', () => {
    // Given：4 个数据键均不存在
    expect(localStorage.getItem(KEYS.questions)).toBeNull()
    expect(localStorage.getItem(KEYS.stars)).toBeNull()
    expect(localStorage.getItem(KEYS.rewards)).toBeNull()
    expect(localStorage.getItem(KEYS.lastExport)).toBeNull()

    // When：应用首次启动并完成数据层初始化
    initAppState()

    // Then：逐键断言（Spec §3.3）
    const questions = parse(KEYS.questions) as { id: string }[]
    expect(questions).toHaveLength(20)
    expect(questions[0].id).toBe('000001')
    expect(questions[19].id).toBe('000020')

    expect(parse(KEYS.stars)).toEqual([])

    const rewards = parse(KEYS.rewards) as { id: string }[]
    expect(rewards).toHaveLength(3)
    expect(rewards.map((r) => r.id)).toEqual([
      'reward_pineapple',
      'reward_tv',
      'reward_sukiyaki',
    ])

    expect(parse(KEYS.lastExport)).toBe('')
  })

  it('AC4-2 写函数持久化：写入 sq_questions 后与写入值深相等', () => {
    initAppState()
    const custom: Question[] = [
      {
        id: 'custom_001',
        type: 'zh2en',
        prompt: '测试',
        options: ['a', 'b', 'c', 'd'],
        answerIndex: 0,
        wordId: 'custom',
      },
    ]
    writeQuestions(custom)
    expect(parse(KEYS.questions)).toEqual(custom)
  })

  it('AC4-3 读函数还原：读取 sq_stars 返回与写入对象深相等', () => {
    initAppState()
    const entry = [
      { id: 's1', timestamp: 1724140800000, type: 'earn' as const, amount: 1, source: '答题得星' },
    ]
    writeStars(entry)
    expect(readStars()).toEqual(entry)
  })

  it('AC4-4 重复启动不覆盖（幂等）：sq_questions 保持自定义数组不被重置', () => {
    initAppState()
    const custom: Question[] = [
      { id: 'c1', type: 'zh2en', prompt: 'p1', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w1' },
      { id: 'c2', type: 'en2zh', prompt: 'p2', options: ['a', 'b', 'c', 'd'], answerIndex: 1, wordId: 'w2' },
      { id: 'c3', type: 'cloze', prompt: 'p3 ___', options: ['a', 'b', 'c', 'd'], answerIndex: 2, wordId: 'w3' },
    ]
    localStorage.setItem(KEYS.questions, JSON.stringify(custom))
    // When：应用再次启动完成数据层初始化
    initAppState()
    // Then：仍为长度 3 的原数组，未被重置为初始 10 题
    const stored = parse(KEYS.questions) as Question[]
    expect(stored).toHaveLength(3)
    expect(stored).toEqual(custom)
  })

  it('AC4-5 键名边界：sq_ 前缀键恰好 11 个（含 sq_data_version / sq_proficiency / sq_recent_words / sq_flagged / sq_question_results / sq_proposals / sq_active_redemptions，R24 REQ-R24-2 + R25 REQ-R25-7 + R27 REQ-R27-1 + R32 REQ-R32-6 + #73 R-72-1 有意变更），无其他 sq_ 前缀键', () => {
    initAppState()
    const sqKeys = allKeys().filter((k) => k.startsWith('sq_')).sort()
    expect(sqKeys).toEqual([
      'sq_active_redemptions',
      'sq_data_version',
      'sq_flagged',
      'sq_last_export',
      'sq_morale',
      'sq_proposals',
      'sq_question_results',
      'sq_questions',
      'sq_recent_words',
      'sq_rewards',
      'sq_stars',
    ])
  })

  it('AC7-3 首次启动写入题池：sq_questions 与 currentQuestionBank.questions 深相等', () => {
    expect(localStorage.getItem(KEYS.questions)).toBeNull()
    initAppState()
    expect(parse(KEYS.questions)).toEqual(currentQuestionBank.questions.map((q) => ({ ...q, category: '学科', book: '默认' })))
  })
})
