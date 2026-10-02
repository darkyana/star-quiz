/**
 * 导入编排模块单测（架构评审 20260829 候选 2）：
 * 落库段经公共接口断言（覆盖三键整体替换 / 追加只增量题库 / 追加溢出整次原子拒绝 / 经济覆盖式四键替换），
 * 校验段为契约层转接（字段级语义由 utils/importExport 专项覆盖，此处仅钉转接 seam 可用）。
 * 断言口径沿 useProposals / useLearningData：走公共读写接口 + localStorage 逐字节快照。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { init } from '../useDataInfra'
import '../useStarData'
import '../useLearningData'
import '../useProposals'
import '../useActiveRedemptions'
import {
  questions as readQuestions,
  flagged as readFlagged,
  questionResults as readQuestionResults,
  writeQuestions,
} from '../useLearningData'
import { rewards as readRewards, writeRewards } from '../useStarData'
import { list as readActiveRedemptions, writeRecords as writeActiveRedemptions } from '../useActiveRedemptions'
import {
  validateLearningImport,
  applyLearningImport,
  applyEconomyImport,
  importErrorText,
} from '../useImport'
import { copy } from '../../copy'
import type {
  LearningExport,
  EconomyExport,
  Question,
  StarEntry,
  RewardItem,
  ProposalRecord,
  ActiveRedemption,
} from '../../types'

beforeEach(() => {
  localStorage.clear()
  init()
})

// ===== seed 工具 =====

function makeQuestion(seq: number, overrides: Partial<Question> = {}): Question {
  return {
    id: String(seq).padStart(6, '0'),
    type: 'zh2en',
    prompt: `第 ${seq} 题题干`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: seq % 4,
    wordId: `word${seq}`,
    difficulty: 3,
    ...overrides,
  }
}

function makeLearningExport(pool: Question[]): LearningExport {
  return {
    version: '2.0',
    exportedAt: '2026-08-29T00:00:00.000Z',
    questionPool: pool,
    flagged: { '000001': { flaggedAt: 1000 } },
    questionResults: {
      '000001': [{ outcome: 'correct', timestamp: '2026-08-28T10:00:00.000Z' }],
    },
  }
}

function makeReward(id: string): RewardItem {
  return { id, name: `奖励${id}`, price: 5 }
}

function makeEntry(id: string): StarEntry {
  return { id, timestamp: 1724140800000, type: 'earn', amount: 1, source: '答题得星' }
}

function makeProposalRecord(id: string): ProposalRecord {
  return {
    id,
    name: `提议${id}`,
    price: 5,
    status: 'discussing',
    createdAt: 1000,
    updatedAt: 1000,
    description: '',
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
  }
}

function makeActiveRedemption(id: string): ActiveRedemption {
  return { id, rewardId: 'reward_x', name: `奖品${id}`, emoji: '🎁', createdAt: 1724140800000 }
}

function makeEconomyExport(): EconomyExport {
  return {
    version: '2.2',
    exportedAt: '2026-08-29T00:00:00.000Z',
    rewards: [makeReward('r-new1'), makeReward('r-new2')],
    proposals: [makeProposalRecord('p-new')],
    starLedger: [makeEntry('s-new1'), makeEntry('s-new2')],
    activeRedemptions: [makeActiveRedemption('ar-new')],
  }
}

/** localStorage 全键快照（零写入逐字节断言用） */
function snapshotLocalStorage(): Record<string, string> {
  const snap: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null) snap[key] = localStorage.getItem(key) as string
  }
  return snap
}

// ===== 学习文件落库 =====

describe('applyLearningImport overwrite（R21 / R36 REQ-R36-4）', () => {
  it('题池 / 红旗 / 逐题记录三键整体替换为文件值；兑换项不动', () => {
    writeQuestions([makeQuestion(1), makeQuestion(2)])
    writeRewards([makeReward('r-keep')])

    const result = applyLearningImport(makeLearningExport([makeQuestion(9), makeQuestion(10), makeQuestion(11)]), 'overwrite')

    expect(result).toEqual({ ok: true })
    expect(readQuestions()).toHaveLength(3)
    expect(readFlagged()).toEqual({ '000001': { flaggedAt: 1000 } })
    expect(readQuestionResults()['000001']).toHaveLength(1)
    expect(readRewards()).toEqual([makeReward('r-keep')]) // 不碰兑换项
  })
})

describe('applyLearningImport append（R21 / R36 REQ-R36-4：追加只增量题库）', () => {
  it('现有题库 + 文件题库重编号顺延合并，只写题池；红旗 / 答题记录 / 兑换项逐字节不动', () => {
    writeQuestions([makeQuestion(1), makeQuestion(2)])
    writeRewards([makeReward('r-keep')])
    const before = snapshotLocalStorage()

    const file = makeLearningExport([
      makeQuestion(1, { id: 'file-1', wordId: 'wordNew1' }),
      makeQuestion(2, { id: 'file-2', wordId: 'wordNew2' }),
    ])
    const result = applyLearningImport(file, 'append')

    expect(result).toEqual({ ok: true })
    const questions = readQuestions()
    expect(questions).toHaveLength(4)
    expect(questions.map((q) => q.id)).toEqual(['000001', '000002', '000003', '000004'])
    expect(questions[2]).toMatchObject({ wordId: 'wordNew1' }) // 重编号只改 id，其余字段原样
    expect(questions[3]).toMatchObject({ wordId: 'wordNew2' })
    // 红旗 / 答题记录 / 兑换项键逐字节不变
    expect(localStorage.getItem('sq_flagged')).toBe(before['sq_flagged'])
    expect(localStorage.getItem('sq_question_results')).toBe(before['sq_question_results'])
    expect(localStorage.getItem('sq_rewards')).toBe(before['sq_rewards'])
  })

  it('追加溢出（既有 id 999999）→ { ok: false, reason }，全键逐字节零写入（整次原子拒绝，REQ-R21-2-4）', () => {
    writeQuestions([makeQuestion(1), makeQuestion(999999)])
    const before = snapshotLocalStorage()

    const result = applyLearningImport(makeLearningExport([makeQuestion(1)]), 'append')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('题库编号已满')
    expect(snapshotLocalStorage()).toEqual(before)
  })
})

// ===== 经济文件落库 =====

describe('applyEconomyImport（R36 REQ-R36-5 / R32 REQ-R32-8-4 / #75 R-72-3：覆盖式，无追加概念）', () => {
  it('兑换项 / 提议 / 星星流水 / 进行中兑换四键整体替换为文件值（本机券被文件值覆盖）；学习域键不动', () => {
    writeQuestions([makeQuestion(1)])
    writeRewards([makeReward('r-old')])
    writeActiveRedemptions([makeActiveRedemption('ar-old1'), makeActiveRedemption('ar-old2')])
    const learningBefore = snapshotLocalStorage()

    applyEconomyImport(makeEconomyExport())

    expect(readRewards()).toEqual([makeReward('r-new1'), makeReward('r-new2')])
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)).toEqual([makeProposalRecord('p-new')])
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual([makeEntry('s-new1'), makeEntry('s-new2')])
    // #75：sq_active_redemptions 第四键整体替换（覆盖式，与 rewards / proposals / starLedger 同策略）
    expect(readActiveRedemptions()).toEqual([makeActiveRedemption('ar-new')])
    expect(JSON.parse(localStorage.getItem('sq_active_redemptions') as string)).toEqual([makeActiveRedemption('ar-new')])
    // 学习域键（题池 / 红旗 / 答题记录）逐字节不动
    for (const key of ['sq_questions', 'sq_flagged', 'sq_question_results']) {
      expect(localStorage.getItem(key)).toBe(learningBefore[key])
    }
  })

  it('#75 2.0 旧文件兜底落库：activeRedemptions [] 落库后本机券被清空（旧文件导入 = 兜底空数组整体替换）', () => {
    writeActiveRedemptions([makeActiveRedemption('ar-old')])

    applyEconomyImport({
      version: '2.0',
      exportedAt: '2026-08-29T00:00:00.000Z',
      rewards: [],
      proposals: [],
      starLedger: [],
      activeRedemptions: [],
    })

    expect(readActiveRedemptions()).toEqual([])
  })
})

// ===== 校验段转接 seam =====

describe('校验段转接（utils/importExport 契约层，字段级语义由其专项覆盖）', () => {
  it('validateLearningImport 非法 JSON → { ok: false }（转接可用，原子拒绝语义不变）', () => {
    expect(validateLearningImport('{not json').ok).toBe(false)
  })
})

// ===== #172 导入错误四类内部码 + 两档用户文案 =====

describe('#172 四类内部错误码（文件坏 / 版本不支持 / 校验不过 / 写失败）', () => {
  it('文件坏：非法 JSON → code = file-corrupt', () => {
    const result = validateLearningImport('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('file-corrupt')
  })

  it('版本不支持：1.x 断代与未知版本 → code = version-unsupported', () => {
    for (const version of ['1.0', '1.1', '1.2', '9.9']) {
      const result = validateLearningImport(
        JSON.stringify({ ...makeLearningExport([]), version }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('version-unsupported')
    }
  })

  it('校验不过：缺 questionResults 字段 → code = invalid', () => {
    const { questionResults: _omit, ...rest } = makeLearningExport([])
    const result = validateLearningImport(JSON.stringify(rest))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid')
  })

  it('校验不过：追加溢出 → applyLearningImport 返回 code = invalid（归「校验不过」档）', () => {
    writeQuestions([makeQuestion(999999)])
    const result = applyLearningImport(makeLearningExport([makeQuestion(1)]), 'append')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid')
  })
})

describe('#172 两档用户文案映射（importErrorText）', () => {
  it('前三类（文件坏 / 版本不支持 / 校验不过）共用「文件未通过检查，没有写入任何数据」', () => {
    for (const code of ['file-corrupt', 'version-unsupported', 'invalid'] as const) {
      expect(importErrorText(code)).toBe(copy.parent.importFailChecked)
      expect(importErrorText(code)).toBe('文件未通过检查，没有写入任何数据')
    }
  })

  it('写失败单列「已恢复原状，建议清理设备存储后重试」', () => {
    expect(importErrorText('write-failed')).toBe(copy.parent.importFailWrite)
    expect(importErrorText('write-failed')).toBe('已恢复原状，建议清理设备存储后重试')
  })

  it('#212 粘贴剥壳失败单列「未在粘贴内容中找到有效 JSON」（仅粘贴导入产生，文件导入不出此档）', () => {
    expect(importErrorText('no-json')).toBe(copy.parent.importPasteNoJson)
    expect(importErrorText('no-json')).toBe('未在粘贴内容中找到有效 JSON')
  })
})

describe('#172 写失败：commit 原语同步回滚（已恢复原状）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('学习覆盖导入：捆内第二键写失败 → write-failed + 全捆回滚到导入前值', () => {
    writeQuestions([makeQuestion(1)])
    writeRewards([makeReward('r-keep')])
    const beforeQuestions = localStorage.getItem('sq_questions')
    const beforeFlagged = localStorage.getItem('sq_flagged')
    // 模拟存储满：sq_flagged 首次写入抛错（哨兵键与其余键正常落盘）
    const nativeSetItem = Storage.prototype.setItem
    let thrown = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'sq_flagged' && !thrown) {
        thrown = true
        throw new Error('QuotaExceededError: mock')
      }
      nativeSetItem.call(this, key, value)
    })

    const result = applyLearningImport(makeLearningExport([makeQuestion(9)]), 'overwrite')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('write-failed')
    // #170 哨兵回滚被同步触发：三键全部恢复导入前值（哨兵键已清）
    expect(localStorage.getItem('sq_questions')).toBe(beforeQuestions)
    expect(localStorage.getItem('sq_flagged')).toBe(beforeFlagged)
    expect(localStorage.getItem('sq_commit_sentinel')).toBe(null)
  })

  it('经济导入：捆 B 写失败 → write-failed + 捆 B 回滚（捆 A 已完成不回滚，#170 拆两捆既有口径）', () => {
    writeRewards([makeReward('r-old')])
    writeActiveRedemptions([makeActiveRedemption('ar-old')])
    const beforeStars = localStorage.getItem('sq_stars')
    const beforeActive = localStorage.getItem('sq_active_redemptions')
    const nativeSetItem = Storage.prototype.setItem
    let thrown = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'sq_stars' && !thrown) {
        thrown = true
        throw new Error('QuotaExceededError: mock')
      }
      nativeSetItem.call(this, key, value)
    })

    const result = applyEconomyImport(makeEconomyExport())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('write-failed')
    // 捆 B（sq_stars / sq_active_redemptions）回滚到导入前值；哨兵清空
    expect(localStorage.getItem('sq_stars')).toBe(beforeStars)
    expect(localStorage.getItem('sq_active_redemptions')).toBe(beforeActive)
    expect(localStorage.getItem('sq_commit_sentinel')).toBe(null)
    // 捆 A（rewards / proposals）先行已完成落盘（#170 拆两捆：跨捆不原子，Spec 缺口见交付报告）
    expect(readRewards()).toEqual([makeReward('r-new1'), makeReward('r-new2')])
  })
})
