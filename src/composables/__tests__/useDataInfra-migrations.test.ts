import { describe, it, expect, vi, beforeEach } from 'vitest'
import { init, recoverUnfinishedCommit, registerMigrationBackup } from '../useDataInfra'
// 迁移链实现（1→7）与业务键初始值由各域模块注册：星星域 useStarData（T2）、学习域 useLearningData（T3）、提议域 useProposals（R32/#63）
import '../useStarData'
import '../useLearningData'
import '../useProposals'
import type { Question, StarEntry, RewardItem } from '../../types'

// 数据版本迁移专项（R23 REQ-R23-3 / R24 REQ-R24-3，Spec 20260824-v0.7.0）
// mock useExport 下载函数：备份断言只关心调用次数与先后顺序（AC-R23-2-2）。
// 剪环后备份注册上移组合根：测试扮演 main.ts 注册一次（与生产同构，架构评审 20260829）
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

/** 旧格式题池工厂：id = `{wordId}_{3位序号}`（R23 前内置题库实测格式） */
function makeLegacyQuestions(count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `word${i + 1}_${String(i + 1).padStart(3, '0')}`,
    type: 'zh2en',
    prompt: `第 ${i + 1} 题题干`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: i % 4,
    wordId: `word${i + 1}`,
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

function parseQuestions(): Question[] {
  return JSON.parse(localStorage.getItem('sq_questions') as string) as Question[]
}

function paddedSeq(i: number): string {
  return String(i + 1).padStart(6, '0')
}

describe('R23 迁移 1→2：存量 id 重编号（REQ-R23-3）', () => {
  it('AC-R23-2-1 版本 "1" + 20 题旧格式 id → 按数组顺序重编号为 6 位补零，wordId 与其余键不动，版本一次到位 "9"', () => {
    const legacy = makeLegacyQuestions(20)
    const stars = makeStars(2)
    const rewards = makeRewards(3)
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_questions', JSON.stringify(legacy))
    localStorage.setItem('sq_stars', JSON.stringify(stars))
    localStorage.setItem('sq_rewards', JSON.stringify(rewards))

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    init()

    // 重编号：条数不丢、id 全部 6 位数字且按数组顺序 000001~000020、wordId 不动
    const migrated = parseQuestions()
    expect(migrated).toHaveLength(20)
    migrated.forEach((q, i) => {
      expect(q.id).toMatch(/^\d{6}$/)
      expect(q.id).toBe(paddedSeq(i))
      expect(q.wordId).toBe(legacy[i].wordId)
    })
    // 只动 sq_questions：stars / rewards 条数不变（#173 8→9 迁移补 kind/childId 两列，见专项用例）
    const migratedStars = JSON.parse(localStorage.getItem('sq_stars') as string)
    expect(migratedStars).toHaveLength(stars.length)
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(rewards)
    // 版本一次到位 "9"，中间版本 "2"~"7" 不落盘（写入仅 1 次且值非中间版本）
    const versionWrites = setItemSpy.mock.calls.filter(([k]) => k === 'sq_data_version')
    expect(versionWrites).toEqual([['sq_data_version', '9']])
    setItemSpy.mockRestore()
  })

  it('AC-R23-2-2 迁移前备份：两个下载 spy 各 ≥ 1 次，且先于版本写入 "8"', () => {
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_questions', JSON.stringify(makeLegacyQuestions(20)))
    localStorage.setItem('sq_stars', JSON.stringify(makeStars(2)))
    localStorage.setItem('sq_rewards', JSON.stringify(makeRewards(3)))

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    init()

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

  it('AC-R23-2-3 幂等：迁移后二次启动，全部数据键与版本与第一次执行后完全一致', () => {
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_questions', JSON.stringify(makeLegacyQuestions(20)))
    localStorage.setItem('sq_stars', JSON.stringify(makeStars(2)))
    localStorage.setItem('sq_rewards', JSON.stringify(makeRewards(3)))
    init()

    const snapshot = {
      questions: localStorage.getItem('sq_questions'),
      stars: localStorage.getItem('sq_stars'),
      rewards: localStorage.getItem('sq_rewards'),
      version: localStorage.getItem('sq_data_version'),
    }

    init()

    expect(localStorage.getItem('sq_questions')).toBe(snapshot.questions)
    expect(localStorage.getItem('sq_stars')).toBe(snapshot.stars)
    expect(localStorage.getItem('sq_rewards')).toBe(snapshot.rewards)
    expect(localStorage.getItem('sq_data_version')).toBe(snapshot.version)
    expect(snapshot.version).toBe('9')
  })

  it('AC-R23-3-1 全新安装：直接版本 "9" + 内置题库新 id，备份 spy 零调用', () => {
    init()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    const questions = parseQuestions()
    expect(questions).toHaveLength(20)
    questions.forEach((q, i) => expect(q.id).toBe(paddedSeq(i)))
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
  })

  it('AC-R23-4-1 迁移函数抛错：异常传播，版本保持 "1" 不写入（下次启动重试）', () => {
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_questions', JSON.stringify(makeLegacyQuestions(3)))
    // 模拟迁移函数内部抛错：存储读取 sq_questions 时故障（REQ-R23-3-5 不吞错）
    const realGetItem = localStorage.getItem.bind(localStorage)
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'sq_questions') throw new Error('模拟存储读取故障：迁移函数抛错')
      return realGetItem(key)
    })

    try {
      expect(() => init()).toThrow('模拟存储读取故障')
    } finally {
      getItemSpy.mockRestore()
    }

    expect(localStorage.getItem('sq_data_version')).toBe('1')
  })

  it('AC-R23-4-2 键缺失防御：版本 "1" + 无 sq_questions + 有 sq_stars → 不崩溃，题库由读取兜底，版本到位', () => {
    const stars = makeStars(2)
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_stars', JSON.stringify(stars))

    expect(() => init()).not.toThrow()

    const questions = parseQuestions()
    expect(questions).toHaveLength(20)
    expect(questions[0].id).toBe('000001')
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(stars.map((e) => ({ ...e, kind: 'main', childId: 'default' })))
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })
})

describe('R24 新数据键与迁移 2→3（REQ-R24-2 / REQ-R24-3）', () => {
  it('AC-R24-2-1 全新安装：sq_morale / sq_recent_words 初始形状就位，版本 "9"', () => {
    init()

    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({
      level: 1,
      lastRoundCorrect: null,
      childId: 'default',
    })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual([])
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('AC-R24-3-1 链式 "1"→"8" 一次到位：id 重编号 + 每题 difficulty 补 3 + 两新键就位 + stars 不变 + 备份 spy 各 ≥ 1 次', () => {
    const stars = makeStars(2)
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_questions', JSON.stringify(makeLegacyQuestions(20)))
    localStorage.setItem('sq_stars', JSON.stringify(stars))

    init()

    parseQuestions().forEach((q, i) => {
      expect(q.id).toBe(paddedSeq(i))
      expect(q.difficulty).toBe(3)
    })
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({
      level: 1,
      lastRoundCorrect: null,
      childId: 'default',
    })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual([])
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(stars.map((e) => ({ ...e, kind: 'main', childId: 'default' })))
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(mockedDownloadData.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(mockedDownloadLedger.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('AC-R24-3-2 幂等：链迁移后二次启动，全部数据键与版本与第一次执行后完全一致，difficulty 不被重复改写', () => {
    localStorage.setItem('sq_data_version', '1')
    localStorage.setItem('sq_questions', JSON.stringify(makeLegacyQuestions(20)))
    localStorage.setItem('sq_stars', JSON.stringify(makeStars(2)))
    init()

    const snapshot = {
      questions: localStorage.getItem('sq_questions'),
      stars: localStorage.getItem('sq_stars'),
      morale: localStorage.getItem('sq_morale'),
      recentWords: localStorage.getItem('sq_recent_words'),
      version: localStorage.getItem('sq_data_version'),
    }

    init()

    expect(localStorage.getItem('sq_questions')).toBe(snapshot.questions)
    expect(localStorage.getItem('sq_stars')).toBe(snapshot.stars)
    expect(localStorage.getItem('sq_morale')).toBe(snapshot.morale)
    expect(localStorage.getItem('sq_recent_words')).toBe(snapshot.recentWords)
    expect(localStorage.getItem('sq_data_version')).toBe(snapshot.version)
    expect(snapshot.version).toBe('9')
  })

  it('AC-R24-3-3 中间版本 "2" 直入：仅无 difficulty 的题补 3（已有值不动），不触发 1→2 重编号，版本写 "9"', () => {
    const questions: Question[] = [
      { id: '000001', type: 'zh2en', prompt: '一', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w1', difficulty: 1 },
      { id: '000002', type: 'en2zh', prompt: 'two', options: ['a', 'b', 'c', 'd'], answerIndex: 1, wordId: 'w2' },
      { id: '000003', type: 'cloze', prompt: '___ 三', options: ['a', 'b', 'c', 'd'], answerIndex: 2, wordId: 'w3' },
    ]
    localStorage.setItem('sq_data_version', '2')
    localStorage.setItem('sq_questions', JSON.stringify(questions))

    init()

    const migrated = parseQuestions()
    expect(migrated[0].difficulty).toBe(1) // 已有 difficulty 值的题不动
    expect(migrated[1].difficulty).toBe(3)
    expect(migrated[2].difficulty).toBe(3)
    expect(migrated.map((q) => q.id)).toEqual(['000001', '000002', '000003']) // 版本 "2" 不执行 1→2
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(mockedDownloadData.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(mockedDownloadLedger.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('AC-R24-3-4 版本超前 "10"：warn 提示 + 全部数据键零写入 + 版本保持 "9"', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let setItemSpy: ReturnType<typeof vi.spyOn> | undefined
    try {
      // 预置全部数据键（合法），隔离读取初始化写入噪音
      localStorage.setItem('sq_data_version', '10')
      localStorage.setItem('sq_questions', JSON.stringify(makeLegacyQuestions(3)))
      localStorage.setItem('sq_stars', JSON.stringify(makeStars(1)))
      localStorage.setItem('sq_rewards', JSON.stringify(makeRewards(1)))
      localStorage.setItem('sq_last_export', JSON.stringify(''))
      localStorage.setItem('sq_morale', JSON.stringify({ level: 2, lastRoundCorrect: 4, childId: 'default' }))
      localStorage.setItem('sq_recent_words', JSON.stringify(['w1']))
      localStorage.setItem('sq_flagged', JSON.stringify({ '000001': { flaggedAt: 1000 } }))
      localStorage.setItem('sq_question_results', JSON.stringify({ '000001': [{ outcome: 'correct', timestamp: '2026-08-25T00:00:00.000Z' }] }))
      localStorage.setItem('sq_proposals', JSON.stringify([]))
      // #73 R-72-1 新数据键（初始空数组）一并预置，隔离读取初始化写入噪音
      localStorage.setItem('sq_active_redemptions', JSON.stringify([]))
      const snapshot = {
        questions: localStorage.getItem('sq_questions'),
        stars: localStorage.getItem('sq_stars'),
        morale: localStorage.getItem('sq_morale'),
        recentWords: localStorage.getItem('sq_recent_words'),
        flagged: localStorage.getItem('sq_flagged'),
      }

      // 预置完成后挂 spy，init 期间的任何写入都会被捕获
      setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      init()

      expect(warnSpy).toHaveBeenCalled()
      expect(String(warnSpy.mock.calls[0][0])).toContain('版本')
      expect(localStorage.getItem('sq_data_version')).toBe('10')
      expect(setItemSpy).not.toHaveBeenCalled() // 数据零写入、不回滚
      expect(localStorage.getItem('sq_questions')).toBe(snapshot.questions)
      expect(localStorage.getItem('sq_stars')).toBe(snapshot.stars)
      expect(localStorage.getItem('sq_morale')).toBe(snapshot.morale)
      expect(localStorage.getItem('sq_recent_words')).toBe(snapshot.recentWords)
      expect(localStorage.getItem('sq_flagged')).toBe(snapshot.flagged)
    } finally {
      setItemSpy?.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ===== 自 useAppState.test.ts 迁移（T4 删除该文件，独有断言保留不删）=====
describe('老用户升级：无 sq_data_version + 既有数据（AC-1.3 / AC-1.5）', () => {
  it('AC-1.3 有 sq_questions 无 sq_data_version → 备份各 1 次 + 迁移链执行 + 写版本到位', () => {
    const questions: Question[] = [
      { id: 'q1', type: 'zh2en', prompt: '一', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w1' },
    ]
    const stars: StarEntry[] = [
      { id: 's1', timestamp: 1, type: 'earn', amount: 5, source: '答题得星', quizId: 'q1' },
    ]
    const rewards: RewardItem[] = [{ id: 'r1', name: '菠萝油', price: 5 }]
    localStorage.setItem('sq_questions', JSON.stringify(questions))
    localStorage.setItem('sq_stars', JSON.stringify(stars))
    localStorage.setItem('sq_rewards', JSON.stringify(rewards))

    init()

    expect(mockedDownloadData).toHaveBeenCalledTimes(1)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(1)
    // 迁移链执行（R23 id 重编号 + R24 difficulty 补 3 + #173 大类/分册补齐）：题目升级，其余键条数不变
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toEqual([
      { id: '000001', type: 'zh2en', prompt: '一', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w1', difficulty: 3, category: '学科', book: '默认' },
    ])
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toHaveLength(stars.length)
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(rewards)
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('AC-1.5 迁移测试：旧版本（无 sq_data_version）数据完整性不丢', () => {
    const oldStars: StarEntry[] = [
      { id: 's1', timestamp: 1, type: 'earn', amount: 5, source: '答题得星', quizId: 'q1' },
      { id: 's2', timestamp: 2, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
      { id: 's3', timestamp: 3, type: 'earn', amount: 3, source: '满分奖励', quizId: 'q1' },
    ]
    const oldQuestions: Question[] = [
      { id: 'q1', type: 'zh2en', prompt: '一', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w1' },
      { id: 'q2', type: 'en2zh', prompt: 'two', options: ['a', 'b', 'c', 'd'], answerIndex: 1, wordId: 'w2' },
    ]
    const oldRewards: RewardItem[] = [
      { id: 'r1', name: '菠萝油', price: 5 },
      { id: 'r2', name: '看电视', price: 15 },
    ]
    localStorage.setItem('sq_stars', JSON.stringify(oldStars))
    localStorage.setItem('sq_questions', JSON.stringify(oldQuestions))
    localStorage.setItem('sq_rewards', JSON.stringify(oldRewards))

    init()

    // 迁移链执行：条数不丢、id 重编号为 6 位序号 + difficulty 补 3，wordId 等其余字段一致
    const migratedQuestions = JSON.parse(localStorage.getItem('sq_questions') as string) as Question[]
    expect(migratedQuestions).toHaveLength(2)
    expect(migratedQuestions.map((q) => q.id)).toEqual(['000001', '000002'])
    migratedQuestions.forEach((q, i) => {
      expect(q.wordId).toBe(oldQuestions[i].wordId)
      expect(q.difficulty).toBe(3)
      expect(q.category).toBe('学科') // #173 大类/分册补齐
      expect(q.book).toBe('默认')
    })
    const migratedStars = JSON.parse(localStorage.getItem('sq_stars') as string) as StarEntry[]
    expect(migratedStars).toHaveLength(3)
    // #173 8→9：流水补 kind=主星 + childId=默认孩子，其余字段逐字保留
    expect(migratedStars).toEqual(oldStars.map((e) => ({ ...e, kind: 'main', childId: 'default' })))
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(oldRewards)
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })
})

// ===== #63 迁移 6→7：提议最后动作归因 backfill（2026-08-30 拍板）=====

describe('#63 迁移 6→7：存量提议补 lastActionBy / lastActionKind', () => {
  /** 旧口径提议字面量（无 lastAction 两字段，迁移前存量形状） */
  function legacyProposal(initiator: 'parent' | 'child') {
    return {
      id: 'p1',
      name: '旧提议',
      price: 5,
      status: 'discussing',
      createdAt: 1,
      updatedAt: 1,
      description: '',
      parentStatus: 'agreed' as const,
      childStatus: 'notAgreed' as const,
      initiator,
    }
  }

  it('版本 "6" + 存量提议 → backfill by=initiator / kind=proposed，其余字段不动，版本写 "9"（链上 7→8 红旗瘦身见 useLearningData.test.ts）', () => {
    localStorage.setItem('sq_data_version', '6')
    localStorage.setItem('sq_proposals', JSON.stringify([legacyProposal('child')]))

    init()

    const list = JSON.parse(localStorage.getItem('sq_proposals') as string)
    expect(list).toEqual([{ ...legacyProposal('child'), lastActionBy: 'child', lastActionKind: 'proposed', childId: 'default' }])
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('幂等：已有 lastAction 值不覆盖，二次启动零变化', () => {
    const seeded = [{ ...legacyProposal('parent'), lastActionBy: 'child', lastActionKind: 'changed', childId: 'default' }]
    localStorage.setItem('sq_data_version', '6')
    localStorage.setItem('sq_proposals', JSON.stringify(seeded))

    init()
    const afterFirst = localStorage.getItem('sq_proposals')
    init()

    expect(JSON.parse(afterFirst as string)).toEqual(seeded)
    expect(localStorage.getItem('sq_proposals')).toBe(afterFirst)
  })
})

// ===== #173 迁移 8→9：数据形状断代一次带全（上篇口径：形状断代+迁移链，行为等价）=====

describe('#173 迁移 8→9：形状断代一次带全', () => {
  it('旧词清单影子同捆改形，保留其他域与游标，二次启动不再改写', () => {
    localStorage.setItem('sq_data_version', '8')
    localStorage.setItem('sq_recent_words', JSON.stringify({ seq: 3, words: { old: 1, newest: 3 } }))
    localStorage.setItem('sq_sync_shadow', JSON.stringify({ word_appearances: { seq: 3, words: { old: 1, newest: 3 } }, star_entries: [{ id: 's1' }] }))
    localStorage.setItem('sq_sync_cursor', '123')
    init()
    const shadow = localStorage.getItem('sq_sync_shadow')!
    expect(JSON.parse(shadow)).toEqual({ word_appearances: ['newest', 'old'], star_entries: [{ id: 's1' }] })
    expect(localStorage.getItem('sq_sync_cursor')).toBe('123')
    init()
    expect(localStorage.getItem('sq_sync_shadow')).toBe(shadow)
  })

  it.each(['sq_morale', 'sq_stars'])('迁移写 %s 失败：不吞异常、不升版本，回滚保留旧临场状态，可重试', (failedKey) => {
    const legacy = JSON.stringify({ level: 3, lastRoundCorrect: 9 })
    const stars = JSON.stringify(makeStars(1))
    localStorage.setItem('sq_data_version', '8')
    localStorage.setItem('sq_proficiency', legacy)
    localStorage.setItem('sq_stars', stars)
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === failedKey) throw new Error('disk full')
      return originalSetItem.call(this, key, value)
    })
    try {
      expect(() => init()).toThrow('disk full')
      expect(localStorage.getItem('sq_data_version')).toBe('8')
    } finally {
      setItem.mockRestore()
      recoverUnfinishedCommit()
    }
    expect(localStorage.getItem('sq_proficiency')).toBe(legacy)
    expect(localStorage.getItem('sq_morale')).toBeNull()
    expect(localStorage.getItem('sq_stars')).toBe(stars)
    init()
    expect(JSON.parse(localStorage.getItem('sq_morale')!)).toEqual({ level: 3, lastRoundCorrect: 9, childId: 'default' })
    expect(localStorage.getItem('sq_proficiency')).toBeNull()
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('六项全量：childId / kind / 大类分册 / 近期已测词数组 / sq_morale 改名整搬，版本写 "9"', () => {
    localStorage.setItem('sq_data_version', '8')
    localStorage.setItem('sq_questions', JSON.stringify(makeLegacyQuestions(3)))
    localStorage.setItem('sq_stars', JSON.stringify(makeStars(2)))
    localStorage.setItem('sq_rewards', JSON.stringify(makeRewards(2)))
    localStorage.setItem('sq_proficiency', JSON.stringify({ level: 2, lastRoundCorrect: 4 }))
    localStorage.setItem(
      'sq_recent_words',
      JSON.stringify({ seq: 7, words: { w_old: 2, w_new1: 7, w_new2: 6, w_new3: 5 } }),
    )
    localStorage.setItem('sq_flagged', JSON.stringify({ '000001': { flaggedAt: 1000 } }))
    localStorage.setItem('sq_question_results', JSON.stringify({ '000001': [{ outcome: 'correct', timestamp: '2026-08-25T00:00:00.000Z' }] }))
    localStorage.setItem('sq_proposals', JSON.stringify([{ id: 'p1', name: 'x', price: 5, status: 'discussing', createdAt: 1, updatedAt: 1, description: '', parentStatus: 'agreed', childStatus: 'notAgreed', initiator: 'parent', lastActionBy: 'parent', lastActionKind: 'proposed' }]))
    localStorage.setItem('sq_active_redemptions', JSON.stringify([{ id: 'a1', rewardId: 'r1', name: '菠萝油', emoji: '🎁', createdAt: 1 }]))

    init()

    // ⑥ 改名整搬：sq_morale = 旧值 + childId；sq_proficiency 零残留
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 2, lastRoundCorrect: 4, childId: 'default' })
    expect(localStorage.getItem('sq_proficiency')).toBeNull()
    // ④ 近期已测词：按 seq 降序（新→旧）数组
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual(['w_new1', 'w_new2', 'w_new3', 'w_old'])
    // ④③ 题池：大类/分册补学科初始归类（wordId/type 不动）
    parseQuestions().forEach((q) => {
      expect(q.category).toBe('学科')
      expect(q.book).toBe('默认')
    })
    // ①② 星星流水：kind=主星 + childId
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(makeStars(2).map((e) => ({ ...e, kind: 'main', childId: 'default' })))
    // ① 提议 / 进行中兑换 / 红旗 / 逐题记录：childId
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)[0].childId).toBe('default')
    expect(JSON.parse(localStorage.getItem('sq_active_redemptions') as string)[0].childId).toBe('default')
    expect(JSON.parse(localStorage.getItem('sq_flagged') as string)['000001'].childId).toBe('default')
    expect(JSON.parse(localStorage.getItem('sq_question_results') as string)['000001'][0].childId).toBe('default')
    // 兑换目录不挂维度：原样保留
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(makeRewards(2))
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('近期已测词上限 30：40 个历史词只留最近 30 个（seq 降序截断）', () => {
    const words: Record<string, number> = {}
    for (let i = 1; i <= 40; i++) words[`w${i}`] = i
    localStorage.setItem('sq_data_version', '8')
    localStorage.setItem('sq_recent_words', JSON.stringify({ seq: 40, words }))

    init()

    const list = JSON.parse(localStorage.getItem('sq_recent_words') as string)
    expect(list).toHaveLength(30)
    expect(list[0]).toBe('w40')
    expect(list[29]).toBe('w11')
    expect(list).not.toContain('w10')
  })

  it('幂等：9 版数据二次启动零变化；8→9 重跑不重复改写', () => {
    localStorage.setItem('sq_data_version', '8')
    localStorage.setItem('sq_morale', JSON.stringify({ level: 3, lastRoundCorrect: 10 }))
    localStorage.setItem('sq_recent_words', JSON.stringify({ seq: 3, words: { a: 3, b: 2 } }))
    localStorage.setItem('sq_stars', JSON.stringify(makeStars(1)))
    init()
    const snapshot = {
      morale: localStorage.getItem('sq_morale'),
      recentWords: localStorage.getItem('sq_recent_words'),
      stars: localStorage.getItem('sq_stars'),
      version: localStorage.getItem('sq_data_version'),
    }
    expect(snapshot.version).toBe('9')

    init()

    expect(localStorage.getItem('sq_morale')).toBe(snapshot.morale)
    expect(localStorage.getItem('sq_recent_words')).toBe(snapshot.recentWords)
    expect(localStorage.getItem('sq_stars')).toBe(snapshot.stars)
    expect(localStorage.getItem('sq_data_version')).toBe(snapshot.version)
  })

  it('键缺失防御：8 版 + 全部业务键缺失 → 不崩溃，版本到位 "9"，各键由读取兜底初始化', () => {
    localStorage.setItem('sq_data_version', '8')

    expect(() => init()).not.toThrow()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual([])
  })

  it('sq_morale 已存在（半迁移重跑）→ 旧值不再覆盖，仅清旧键', () => {
    localStorage.setItem('sq_data_version', '8')
    localStorage.setItem('sq_proficiency', JSON.stringify({ level: 1, lastRoundCorrect: 0 }))
    localStorage.setItem('sq_morale', JSON.stringify({ level: 2, lastRoundCorrect: 7, childId: 'default' }))

    init()

    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 2, lastRoundCorrect: 7, childId: 'default' })
    expect(localStorage.getItem('sq_proficiency')).toBeNull()
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('全新安装：9 版初始形状就位（morale 带 childId / 近期已测词空数组 / 内置题库带大类分册）', () => {
    init()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_morale') as string)).toEqual({ level: 1, lastRoundCorrect: null, childId: 'default' })
    expect(JSON.parse(localStorage.getItem('sq_recent_words') as string)).toEqual([])
    parseQuestions().forEach((q) => {
      expect(q.category).toBe('学科')
      expect(q.book).toBe('默认')
    })
  })
})
