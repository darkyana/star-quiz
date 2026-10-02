/**
 * T4 学习域单测（Spec 20260826-073 T3，REQ-T4-1）：
 * 5 组读写对（题池 / 红旗 / 临场状态 / 近期已测词 / 逐题答题记录）读写往返 + 空态初始化；
 * 学习域用例自 useAppState-flagged.test.ts / useAppState-question-results.test.ts /
 * useAppState.test.ts 迁移（断言保留不删，仅改模块引用与文件名）。
 * mock useExport 下载函数：备份断言只关心调用次数与先后顺序。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  init as initAppState,
  registerMigrationBackup,
  CURRENT_DATA_VERSION,
  STORAGE_KEYS,
} from '../useDataInfra'
import {
  flagged,
  writeFlagged,
  writeQuestions,
  questions,
  morale,
  writeMorale,
  recentWords,
  writeRecentWords,
  questionResults,
  writeQuestionResults,
} from '../useLearningData'
import { currentQuestionBank } from '../../data/current-questions'
import type { Question, StarEntry, RewardItem, FlaggedState, QuestionResultsState, MoraleState } from '../../types'

// mock useExport 下载函数：备份断言只关心调用次数与先后顺序。
// 剪环后备份注册上移组合根（学习域不再反向依赖 useExport）：测试扮演 main.ts 注册一次（与生产同构，架构评审 20260829）
vi.mock('../useExport', () => {
  const downloadDataExport = vi.fn()
  const downloadLedgerExport = vi.fn()
  return {
    downloadDataExport,
    downloadLedgerExport,
    runMigrationBackup: () => {
      try {
        downloadDataExport()
      } catch {
        // 备份失败不阻断迁移（与生产语义一致）
      }
      try {
        downloadLedgerExport()
      } catch {
        // 同上
      }
    },
  }
})
import { downloadDataExport, downloadLedgerExport, runMigrationBackup } from '../useExport'
const mockedDownloadData = vi.mocked(downloadDataExport)
const mockedDownloadLedger = vi.mocked(downloadLedgerExport)
registerMigrationBackup(runMigrationBackup)

beforeEach(() => {
  localStorage.clear()
  mockedDownloadData.mockClear()
  mockedDownloadLedger.mockClear()
})

/** v3 格式题池工厂：6 位数字 id + difficulty 就位（迁移不涉及题目内容） */
function makeV3Questions(count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1).padStart(6, '0'),
    type: 'zh2en',
    prompt: `第 ${i + 1} 题题干`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: i % 4,
    wordId: `word${i + 1}`,
    difficulty: (((i % 3) + 1) as 1 | 2 | 3),
  }))
}

function makeStars(count: number): StarEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    timestamp: 1724140800000 + i,
    type: 'earn',
    amount: 1,
    source: '答题得星',
  }))
}

function makeRewards(count: number): RewardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i + 1}`,
    name: `奖励${i + 1}`,
    price: 5 + i,
  }))
}

/** 预置一套完整的版本 3 用户数据（除 sq_data_version 外 6 个数据键就位） */
function seedVersion3Data(): void {
  localStorage.setItem('sq_data_version', '3')
  localStorage.setItem('sq_questions', JSON.stringify(makeV3Questions(20)))
  localStorage.setItem('sq_stars', JSON.stringify(makeStars(3)))
  localStorage.setItem('sq_rewards', JSON.stringify(makeRewards(2)))
  localStorage.setItem('sq_last_export', JSON.stringify(''))
  localStorage.setItem('sq_morale', JSON.stringify({ level: 2, lastRoundCorrect: 6 }))
  localStorage.setItem('sq_recent_words', JSON.stringify({ seq: 4, words: { apple: 4 } }))
}

/** 既有 7 个数据键（4→5 本步不触碰；链至 9 时 8→9 断代按目标形状改写） */
const LEGACY_KEYS = [
  'sq_questions',
  'sq_stars',
  'sq_rewards',
  'sq_last_export',
  'sq_morale',
  'sq_recent_words',
  'sq_flagged',
] as const

/** 预置一套完整的版本 4 用户数据（7 个既有键就位），返回迁移前的逐键原始快照 */
function seedVersion4Data(): Record<string, string> {
  const flaggedState: FlaggedState = { '000003': { flaggedAt: 1000 } }
  localStorage.setItem('sq_data_version', '4')
  localStorage.setItem('sq_questions', JSON.stringify(makeV3Questions(20)))
  localStorage.setItem('sq_stars', JSON.stringify(makeStars(3)))
  localStorage.setItem('sq_rewards', JSON.stringify(makeRewards(2)))
  localStorage.setItem('sq_last_export', JSON.stringify(''))
  localStorage.setItem('sq_morale', JSON.stringify({ level: 2, lastRoundCorrect: 6 }))
  localStorage.setItem('sq_recent_words', JSON.stringify({ seq: 4, words: { apple: 4 } }))
  localStorage.setItem('sq_flagged', JSON.stringify(flaggedState))
  return Object.fromEntries(LEGACY_KEYS.map((key) => [key, localStorage.getItem(key) as string]))
}

describe('学习域读写对：读写往返（T3 新增）', () => {
  it('版本9旧清单可读，替换已有词顺序生效并保留另一孩子', () => {
    localStorage.setItem('sq_data_version', '9')
    localStorage.setItem('sq_recent_words', JSON.stringify(['apple', 'banana']))
    initAppState()
    expect(recentWords()).toEqual(['apple', 'banana'])
    writeRecentWords(['sibling'], 'sibling')
    writeRecentWords(['banana', 'apple'])
    expect(recentWords()).toEqual(['banana', 'apple'])
    expect(recentWords('sibling')).toEqual(['sibling'])
  })
  it('questions / writeQuestions：写入读回一致且落盘 sq_questions', () => {
    const custom = makeV3Questions(2)
    writeQuestions(custom)
    expect(questions()).toEqual(custom)
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toEqual(custom)
  })

  it('flagged / writeFlagged：标记条目写入读回一致且落盘 sq_flagged', () => {
    const state: FlaggedState = {
      '000001': { flaggedAt: 1000 },
      '000002': { flaggedAt: 2000 },
      '000003': { flaggedAt: 3000 },
    }
    writeFlagged(state)
    expect(flagged()).toEqual(state)
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual(state)
  })

  it('morale / writeMorale：写入读回一致且落盘 sq_morale（#173 前名 proficiency）', () => {
    const state: MoraleState = { level: 3, lastRoundCorrect: 8, childId: 'default' }
    writeMorale(state)
    expect(morale()).toEqual(state)
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual(state)
  })

  it('recentWords / writeRecentWords：模块重新加载后仍读回已写清单（#178）', async () => {
    const state = ['apple', 'banana']
    writeRecentWords(state)
    expect(recentWords()).toEqual(state)
    vi.resetModules()
    const reloaded = await import('../useLearningData')
    expect(reloaded.recentWords()).toEqual(state)
  })

  it('questionResults / writeQuestionResults：写入读回一致且落盘 sq_question_results', () => {
    const state: QuestionResultsState = {
      '000001': [{ outcome: 'correct', timestamp: '2026-08-25T00:00:00.000Z' }],
      '000002': [
        { outcome: 'wrong', timestamp: '2026-08-25T00:00:00.000Z' },
        { outcome: 'skipped', timestamp: '2026-08-24T00:00:00.000Z' },
      ],
    }
    writeQuestionResults(state)
    expect(questionResults()).toEqual(state)
    expect(JSON.parse(localStorage.getItem('sq_question_results') as string)).toEqual(state)
  })
})

describe('学习域空态初始化（T3 新增）', () => {
  it('init 后 5 个学习键初始值就位（#173 形状：morale 带 childId / 近期已测词空数组 / 题库带大类分册）+ 数据版本 "9"', () => {
    initAppState()

    expect(questions()).toEqual(currentQuestionBank.questions.map((q) => ({ ...q, category: '学科', book: '默认' })))
    expect(flagged()).toEqual({})
    expect(morale()).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(recentWords()).toEqual([])
    expect(questionResults()).toEqual({})
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('不经 init 键缺失时读取兜底初始值并落盘（morale / recentWords / questionResults）', () => {
    expect(morale()).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(recentWords()).toEqual([])
    expect(questionResults()).toEqual({})
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual([])
    expect(JSON.parse(localStorage.getItem('sq_question_results') as string)).toEqual({})
  })

  it('重复 init 不覆盖已写入的学习域数据（幂等，自 useAppState.test.ts AC4-4 迁移）', () => {
    initAppState()
    const custom: Question[] = [
      { id: 'q1', type: 'zh2en', prompt: '一', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w1' },
      { id: 'q2', type: 'en2zh', prompt: 'two', options: ['a', 'b', 'c', 'd'], answerIndex: 1, wordId: 'w2' },
      { id: 'q3', type: 'cloze', prompt: '___ 三', options: ['a', 'b', 'c', 'd'], answerIndex: 2, wordId: 'w3' },
    ]
    localStorage.setItem('sq_questions', JSON.stringify(custom))

    initAppState()

    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toEqual(custom)
  })

  it('写函数持久化到 localStorage（自 useAppState.test.ts AC4-2 迁移）', () => {
    const custom: Question[] = [
      { id: 'custom_001', type: 'zh2en', prompt: '测试', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'custom' },
    ]
    writeQuestions(custom)
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toEqual(custom)
  })
})

describe('R25 迁移 3→4：初始化 sq_flagged（AC-R25-12 / AC-R25-13）', () => {
  it('AC-R25-12 版本 "3" + 既有 7 键数据 → 版本 "8"、sq_flagged 初始化 {}、既有数据条数不丢', () => {
    seedVersion3Data()

    initAppState()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({})
    // 既有键数据条数不丢；跨 8→9 断代按目标形状断言（morale 补 childId、清单改数组、流水补两列、题池补大类分册）
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toHaveLength(20)
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)[0].category).toBe('学科')
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)[0].kind).toBe('main')
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('sq_last_export') as string)).toBe('')
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 2, lastRoundCorrect: 6, childId: 'default' })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual(['apple'])
  })

  it('键已存在不覆盖：版本 "3" + sq_flagged 已有内容 → 迁移保留原值', () => {
    seedVersion3Data()
    const existing: FlaggedState = { '000003': { flaggedAt: 1000 } }
    localStorage.setItem('sq_flagged', JSON.stringify(existing))

    initAppState()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    // #173 8→9：既有条目保留 flaggedAt、补 childId
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({ '000003': { flaggedAt: 1000, childId: 'default' } })
  })

  it('幂等：迁移到当前版本后二次启动，全部数据键（含 sq_flagged）与第一次执行后完全一致', () => {
    seedVersion3Data()
    initAppState()

    const snapshot = Object.values(STORAGE_KEYS).map((key) => [key, localStorage.getItem(key)] as const)

    initAppState()

    snapshot.forEach(([key, value]) => expect(localStorage.getItem(key)).toBe(value))
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('AC-R25-13 迁移前备份：两个下载 spy 各 ≥ 1 次，且先于版本写入', () => {
    seedVersion3Data()

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    initAppState()

    expect(mockedDownloadData.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(mockedDownloadLedger.mock.calls.length).toBeGreaterThanOrEqual(1)
    const versionWriteIdx = setItemSpy.mock.calls.findIndex(
      ([k, v]) => k === 'sq_data_version' && v === '9',
    )
    expect(versionWriteIdx).toBeGreaterThanOrEqual(0)
    const versionCallOrder = setItemSpy.mock.invocationCallOrder[versionWriteIdx]
    expect(mockedDownloadData.mock.invocationCallOrder[0]).toBeLessThan(versionCallOrder)
    expect(mockedDownloadLedger.mock.invocationCallOrder[0]).toBeLessThan(versionCallOrder)
    setItemSpy.mockRestore()
  })

  it('全新安装：直接当前版本 + sq_flagged 初始 {}，备份 spy 零调用', () => {
    initAppState()

    expect(CURRENT_DATA_VERSION).toBe(9)
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({})
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
  })
})

describe('R25 flagged 读写函数（REQ-R25-4）', () => {
  it('flagged 缺省返回 {}（键不存在时初始化并返回空对象）', () => {
    expect(flagged()).toEqual({})
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({})
  })

  it('writeFlagged 写入 sq_flagged，flagged 读回一致', () => {
    const flaggedState: FlaggedState = {
      '000001': { flaggedAt: 1000 },
      '000002': { flaggedAt: 2000 },
      '000003': { flaggedAt: 3000 },
    }

    writeFlagged(flaggedState)

    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual(flaggedState)
    expect(flagged()).toEqual(flaggedState)
  })
})

describe('R27 新数据键 sq_question_results（AC-R27-1）', () => {
  it('AC-R27-1-1 全新安装（无任何 sq_* 键）→ initAppState 后 sq_question_results 为 "{}"', () => {
    initAppState()

    expect(localStorage.getItem('sq_question_results')).toBe('{}')
  })

  it('AC-R27-1-2 版本 "6" + sq_question_results 非法 JSON → 重置 "{}"、不抛错、console.warn 含键名', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      localStorage.setItem('sq_data_version', '6')
      localStorage.setItem('sq_question_results', '{bad json')

      expect(() => initAppState()).not.toThrow()

      expect(localStorage.getItem('sq_question_results')).toBe('{}')
      expect(warnSpy).toHaveBeenCalled()
      const warned = warnSpy.mock.calls.some((args) => String(args[0]).includes('sq_question_results'))
      expect(warned).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('R27 数据版本迁移 4→5（AC-R27-3）', () => {
  it('AC-R27-3-1 版本 "4" + 既有 7 键有数据 → sq_question_results 写 "{}"、版本 "8"、7 键内容与迁移前逐键相等', () => {
    const before = seedVersion4Data()

    initAppState()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(localStorage.getItem('sq_question_results')).toBe('{}')
    // 4→5 本步不动既有键；但链继续走到 9，8→9 断代改形（morale/清单/流水/题池），按目标形状断言条数与关键字段
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toHaveLength(20)
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 2, lastRoundCorrect: 6, childId: 'default' })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual(['apple'])
    expect(localStorage.getItem('sq_last_export')).toBe(before['sq_last_export'])
  })

  it('AC-R27-3-2 键已存在不覆盖：版本 "4" + sq_question_results 已预置 1 题记录 → 原样保留、版本到位（迁移中断重跑幂等）', () => {
    seedVersion4Data()
    const existing: QuestionResultsState = {
      '000001': [{ outcome: 'correct', timestamp: '2026-08-25T00:00:00.000Z' }],
    }
    localStorage.setItem('sq_question_results', JSON.stringify(existing))

    initAppState()

    // #173 8→9：逐题记录补 childId，其余逐字保留
    expect(JSON.parse(localStorage.getItem('sq_question_results') as string)).toEqual({
      '000001': [{ outcome: 'correct', timestamp: '2026-08-25T00:00:00.000Z', childId: 'default' }],
    })
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('AC-R27-3-3 版本 "4" → 迁移前备份：downloadDataExport / downloadLedgerExport 各被调用 1 次，且先于版本写入', () => {
    seedVersion4Data()

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    initAppState()

    expect(mockedDownloadData).toHaveBeenCalledTimes(1)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(1)
    const versionWriteIdx = setItemSpy.mock.calls.findIndex(
      ([k, v]) => k === 'sq_data_version' && v === '9',
    )
    expect(versionWriteIdx).toBeGreaterThanOrEqual(0)
    const versionCallOrder = setItemSpy.mock.invocationCallOrder[versionWriteIdx]
    expect(mockedDownloadData.mock.invocationCallOrder[0]).toBeLessThan(versionCallOrder)
    expect(mockedDownloadLedger.mock.invocationCallOrder[0]).toBeLessThan(versionCallOrder)
    setItemSpy.mockRestore()
  })

  it('AC-R27-3-4 全新安装（无任何 sq_* 键）→ 版本直接到位、两个下载函数零调用（无备份、无迁移）', () => {
    initAppState()

    expect(CURRENT_DATA_VERSION).toBe(9)
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
  })

  it('AC-R27-3-5 版本已是当前版本但 sq_question_results 缺失 → readRaw 兜底补 "{}"，其余键不动', () => {
    const before = seedVersion4Data()
    localStorage.setItem('sq_data_version', String(CURRENT_DATA_VERSION)) // 覆盖为当前版本，仅留 sq_question_results 缺失
    localStorage.removeItem('sq_question_results')
    expect(localStorage.getItem('sq_question_results')).toBeNull()

    initAppState()

    expect(localStorage.getItem('sq_question_results')).toBe('{}')
    expect(localStorage.getItem('sq_data_version')).toBe(String(CURRENT_DATA_VERSION))
    LEGACY_KEYS.forEach((key) => {
      expect(localStorage.getItem(key)).toBe(before[key])
    })
  })
})

// ===== #69 迁移 7→8：红旗瘦身剥 correct（2026-08-30 老板拍板）=====

describe('#69 迁移 7→8：sq_flagged 条目剥 correct', () => {
  /** 版本 "7" + 旧口径红旗（correct 三态混杂 + 已无 correct 的条目） */
  function seedVersion7Flagged(flagged: Record<string, unknown>): string {
    localStorage.setItem('sq_data_version', '7')
    localStorage.setItem('sq_flagged', JSON.stringify(flagged))
    return JSON.stringify(flagged)
  }

  it('版本 "7" + 旧口径条目（correct true/false/null 混杂）→ 各条目剥掉 correct 只留 flaggedAt（链续 8→9 补 childId），版本 "9"', () => {
    seedVersion7Flagged({
      '000001': { flaggedAt: 1000, correct: true },
      '000002': { flaggedAt: 2000, correct: false },
      '000003': { flaggedAt: 3000, correct: null },
    })

    initAppState()

    // 7→8 剥 correct；链续走 8→9 补 childId（#173）
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({
      '000001': { flaggedAt: 1000, childId: 'default' },
      '000002': { flaggedAt: 2000, childId: 'default' },
      '000003': { flaggedAt: 3000, childId: 'default' },
    })
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('幂等：条目本就无 correct → 零写回（存储逐字节不变），版本 "8"', () => {
    seedVersion7Flagged({
      '000001': { flaggedAt: 1000 },
      '000002': { flaggedAt: 2000 },
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    initAppState()

    // 7→8 零写回；8→9 因补 childId 有一次写回（改形后形状即目标形状，再跑零写回）
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)).toEqual({
      '000001': { flaggedAt: 1000, childId: 'default' },
      '000002': { flaggedAt: 2000, childId: 'default' },
    })
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    setItemSpy.mockRestore()
  })

  it('空对象边界：版本 "7" + sq_flagged 为 {} → 保持 {}、版本 "8"', () => {
    seedVersion7Flagged({})

    initAppState()

    expect(localStorage.getItem('sq_flagged')).toBe('{}')
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('迁移后二次启动幂等：全部数据键与第一次执行后完全一致', () => {
    seedVersion7Flagged({ '000001': { flaggedAt: 1000, correct: true } })
    initAppState()

    const snapshot = Object.values(STORAGE_KEYS).map((key) => [key, localStorage.getItem(key)] as const)

    initAppState()

    snapshot.forEach(([key, value]) => expect(localStorage.getItem(key)).toBe(value))
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })
})
