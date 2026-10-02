/**
 * R3 AC2-1 ~ AC2-13 导入导出契约与校验纯函数验收（Spec §4 REQ-2 / §3.2 / §3.4 / §3.5）。
 * R36（Spec 20260827-v0.10.0 §D6 有意变更）：导出契约按学习 / 经济两组重构、版本统一 2.0、
 * 旧 1.x 一次性断代——本文件形状与版本断言全量重构为新契约（buildLearningExport /
 * buildEconomyExport / validateLearningImport / validateEconomyImport，白名单 ['2.0']）。
 * reason 为精确枚举（机器可判定）；校验为原子拒绝：任一字段非法 → 整文件拒绝。
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import type { Question, StarEntry, RewardItem, LearningExport, EconomyExport, FlaggedState, QuestionResultsState, ProposalRecord, ActiveRedemption } from '../../src/types/index'
import {
  buildLearningExport,
  buildEconomyExport,
  formatExportFilename,
  validateLearningImport,
  validateEconomyImport,
} from '../../src/utils/importExport'

const NOW = '2026-08-21T10:30:00.000Z'

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'zh2en',
    prompt: '火车',
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 0,
    wordId: 'train',
    ...overrides,
  }
}

function makeReward(overrides: Partial<RewardItem> = {}): RewardItem {
  return { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐', ...overrides }
}

function makeEntry(overrides: Partial<StarEntry> = {}): StarEntry {
  return { id: 's1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星', ...overrides }
}

/** 合法 2.0 学习文件（默认 2 题 + 1 条红旗 + 1 题记录含 1 条孤儿记录；可覆盖字段） */
function validLearningJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    questionPool: [makeQuestion(), makeQuestion({ id: 'q2', wordId: 'bus' })],
    flagged: { q1: { flaggedAt: 1000 } },
    questionResults: {
      q1: [{ outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' }],
      ghost_q: [{ outcome: 'wrong', timestamp: '2026-08-25T10:00:00.000Z' }],
    },
    ...overrides,
  })
}

/** 合法 2.0 经济文件（默认 1 兑换项 + proposals 空位 + 2 条流水；可覆盖字段） */
function validEconomyJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    rewards: [makeReward()],
    proposals: [],
    starLedger: [makeEntry(), makeEntry({ id: 's2', type: 'redeem', amount: 2, source: '兑换：菠萝油' })],
    ...overrides,
  })
}

/** 进行中兑换条目（#75 / Spec #72：兑换项快照 5 字段） */
function makeRedemption(overrides: Partial<ActiveRedemption> = {}): ActiveRedemption {
  return { id: 'ar1', rewardId: 'reward_pineapple', name: '菠萝油', emoji: '🥐', createdAt: 1724230000000, ...overrides }
}

/** 合法 2.2 经济文件（默认 1 兑换项 + proposals 空位 + 1 条流水 + 2 条进行中兑换；可覆盖字段） */
function validEconomy22Json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.2',
    exportedAt: NOW,
    rewards: [makeReward()],
    proposals: [],
    starLedger: [makeEntry()],
    activeRedemptions: [makeRedemption(), makeRedemption({ id: 'ar2', rewardId: 'reward_tv', name: '看电视', emoji: '📺' })],
    ...overrides,
  })
}

describe('AC2-1 / AC2-2 序列化纯函数（R36 两组 2.0 导出契约）', () => {
  it('AC2-1 buildLearningExport 返回 LearningExport 结构：恰 5 字段 version "2.0" + exportedAt + questionPool + flagged + questionResults 深相等，不含经济字段（AC-R36-1-1）', () => {
    const pool = [makeQuestion(), makeQuestion({ id: 'q2', wordId: 'bus' })]
    const flagged: FlaggedState = { '000001': { flaggedAt: 1000 } }
    const questionResults: QuestionResultsState = {
      '000001': [{ outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' }],
    }
    const result = buildLearningExport(pool, flagged, questionResults, NOW)
    expect(Object.keys(result).sort()).toEqual(['exportedAt', 'flagged', 'questionPool', 'questionResults', 'version'])
    expect(result).toEqual({
      version: '3.0',
      exportedAt: NOW,
      questionPool: pool.map((q) => ({ ...q, category: '学科', book: '默认' })),
      flagged: { '000001': { flaggedAt: 1000, childId: 'default' } },
      questionResults: { '000001': [{ outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z', childId: 'default' }] },
    })
  })

  it('AC2-2（#75 随动）buildEconomyExport 返回 EconomyExport 结构：恰 6 字段 version "2.2"（R32 REQ-R32-8-1 起 2.1，#75 R-72-3 升 2.2）+ rewards + proposals 全量透传 + starLedger + activeRedemptions 深相等，不含学习字段（AC-R36-2-1 / AC-R32-10-1 纯函数侧）', () => {
    const rewards = [makeReward()]
    const proposals: ProposalRecord[] = [
      {
        id: 'p1',
        name: '公园野餐',
        price: 5,
        status: 'discussing',
        createdAt: 1000,
        updatedAt: 1000,
        description: '周六去',
        parentStatus: 'agreed',
        childStatus: 'notAgreed',
        initiator: 'parent',
        lastActionBy: 'parent',
        lastActionKind: 'proposed',
      },
    ]
    const ledger = [makeEntry(), makeEntry({ id: 's2', type: 'redeem', amount: 2, source: '兑换：菠萝油' })]
    const redemptions = [makeRedemption()]
    const result = buildEconomyExport(rewards, proposals, ledger, redemptions, NOW)
    expect(Object.keys(result).sort()).toEqual(['activeRedemptions', 'exportedAt', 'proposals', 'rewards', 'starLedger', 'version'])
    expect(result).toEqual({
      version: '2.4',
      exportedAt: NOW,
      rewards,
      proposals: proposals.map((p) => ({ ...p, childId: 'default' })),
      starLedger: ledger.map((s) => ({ ...s, childId: 'default', kind: 'main' })),
      activeRedemptions: redemptions.map((r) => ({ ...r, childId: 'default' })),
    })
  })

  it('REQ-2 formatExportFilename：本地时间 YYYYMMDD-HHmmss，learning / economy 前缀（AC-R36-1-3 / 自主决策 #2）', () => {
    const now = new Date(2026, 7, 21, 18, 30, 0) // 本地时间 2026-08-21 18:30:00
    expect(formatExportFilename('learning', now)).toBe('star-quiz-learning-20260821-183000.json')
    expect(formatExportFilename('economy', now)).toBe('star-quiz-economy-20260821-183000.json')
    // 前导补零（月份 / 日 / 时分秒一位数）
    const pad = new Date(2026, 0, 5, 9, 5, 7)
    expect(formatExportFilename('learning', pad)).toBe('star-quiz-learning-20260105-090507.json')
    expect(formatExportFilename('learning', now)).toMatch(/^star-quiz-learning-\d{8}-\d{6}\.json$/)
    expect(formatExportFilename('economy', now)).toMatch(/^star-quiz-economy-\d{8}-\d{6}\.json$/)
  })
})

describe('AC2-3 类型契约（E3，tsc 级断言；AC-R36-7-1）', () => {
  it('LearningExport / EconomyExport 字段契约：version 字面量、exportedAt string、activeRedemptions 为 ActiveRedemption[]（#75）', () => {
    expectTypeOf<LearningExport['version']>().toEqualTypeOf<'2.0' | '3.0'>()
    expectTypeOf<LearningExport['exportedAt']>().toEqualTypeOf<string>()
    expectTypeOf<LearningExport['questionPool']>().toEqualTypeOf<Question[]>()
    expectTypeOf<LearningExport['flagged']>().toEqualTypeOf<FlaggedState>()
    expectTypeOf<LearningExport['questionResults']>().toEqualTypeOf<QuestionResultsState>()
    expectTypeOf<EconomyExport['version']>().toEqualTypeOf<'2.0' | '2.1' | '2.2' | '2.3' | '2.4'>()
    expectTypeOf<EconomyExport['exportedAt']>().toEqualTypeOf<string>()
    expectTypeOf<EconomyExport['rewards']>().toEqualTypeOf<RewardItem[]>()
    expectTypeOf<EconomyExport['proposals']>().toEqualTypeOf<ProposalRecord[]>()
    expectTypeOf<EconomyExport['starLedger']>().toEqualTypeOf<StarEntry[]>()
    expectTypeOf<EconomyExport['activeRedemptions']>().toEqualTypeOf<ActiveRedemption[]>()
  })

  it('DataExport / LedgerExport 已随 1.x 断代退役（R36 §D6：类型引用编译失败）', () => {
    // @ts-expect-error —— DataExport 已按 R36 REQ-R36-7 退役移除，引用应编译失败
    type _RemovedData = DataExport
    void (null as unknown as _RemovedData)
    // @ts-expect-error —— LedgerExport 同上
    type _RemovedLedger = LedgerExport
    void (null as unknown as _RemovedLedger)
  })
})

describe('AC2-4 ~ AC2-11 validateLearningImport（学习文件校验，R36 REQ-R36-4）', () => {
  it('AC2-4 合法 2.0 学习文件：ok:true，questionPool 物理补 difficulty 3 + 大类/分册（#173）、flagged 补 childId、questionResults 孤儿清理（AC-R36-4-5 后半）', () => {
    const result = validateLearningImport(validLearningJson())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.questionPool).toEqual([
      makeQuestion({ difficulty: 3, category: '学科', book: '默认' }),
      makeQuestion({ id: 'q2', wordId: 'bus', difficulty: 3, category: '学科', book: '默认' }),
    ])
    expect(result.data.flagged).toEqual({ q1: { flaggedAt: 1000, childId: 'default' } })
    // 文件记录中 questionId 不在文件题池的条目（ghost_q）被删除，题在保留（#173 补 childId 一列）
    expect(result.data.questionResults).toEqual({
      q1: [{ outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z', childId: 'default' }],
    })
  })

  it('AC2-5 非法 JSON：reason 含「不是合法 JSON」', () => {
    const result = validateLearningImport('{invalid json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('不是合法 JSON')
  })

  it('AC2-6 非对象（数组 / null / 原始值）：reason 均含「不是合法 JSON」', () => {
    for (const raw of ['[1,2,3]', 'null', '"str"', '42']) {
      const result = validateLearningImport(raw)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toContain('不是合法 JSON')
    }
  })

  it('AC2-7 版本断代（AC-R36-3-1/3-3/3-4/3-5 纯函数侧）：缺 version →「缺少 version 字段」；1.x 三版本 →「文件版本过旧，请用最新版重新导出」；未知版本 →「不支持的导出版本」', () => {
    const noVersion = validateLearningImport(JSON.stringify({ exportedAt: NOW, questionPool: [], flagged: {}, questionResults: {} }))
    expect(noVersion.ok).toBe(false)
    if (noVersion.ok) return
    expect(noVersion.reason).toContain('缺少 version 字段')

    for (const legacy of ['1.0', '1.1', '1.2']) {
      const old = validateLearningImport(validLearningJson({ version: legacy }))
      expect(old.ok).toBe(false)
      if (old.ok) return
      expect(old.reason).toBe('文件版本过旧，请用最新版重新导出')
    }

    for (const unknown of ['2.1', '4.0', 'abc']) { // #173：学习 3.0 合法，未知版换 4.0
      const future = validateLearningImport(validLearningJson({ version: unknown }))
      expect(future.ok).toBe(false)
      if (future.ok) return
      expect(future.reason).toContain('不支持的导出版本')
    }
  })

  it('AC2-8 缺 questionPool / 非数组：reason 含「questionPool」', () => {
    const missing = validateLearningImport(JSON.stringify({ version: '2.0', exportedAt: NOW, flagged: {}, questionResults: {} }))
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.reason).toContain('questionPool')

    const nonArray = validateLearningImport(validLearningJson({ questionPool: {} }))
    expect(nonArray.ok).toBe(false)
    if (nonArray.ok) return
    expect(nonArray.reason).toContain('questionPool')
  })

  it('AC2-9 缺 flagged / questionResults 或结构非法 → 整文件拒绝（R36 自主决策 #3：2.0 缺字段即非法，无 1.x 兜底；AC-R36-4-4）', () => {
    const { flagged: _omitFlagged, ...noFlagged } = JSON.parse(validLearningJson()) as Record<string, unknown>
    const missingFlagged = validateLearningImport(JSON.stringify(noFlagged))
    expect(missingFlagged.ok).toBe(false)
    if (missingFlagged.ok) return
    expect(missingFlagged.reason).toContain('flagged')

    const { questionResults: _omitResults, ...noResults } = JSON.parse(validLearningJson()) as Record<string, unknown>
    const missingResults = validateLearningImport(JSON.stringify(noResults))
    expect(missingResults.ok).toBe(false)
    if (missingResults.ok) return
    expect(missingResults.reason).toContain('questionResults')

    const nonObjectResults = validateLearningImport(validLearningJson({ questionResults: 'x' }))
    expect(nonObjectResults.ok).toBe(false)
    if (nonObjectResults.ok) return
    expect(nonObjectResults.reason).toContain('questionResults')
  })

  it('AC2-10 questionPool 条目非法（1-based 条号）：缺 answerIndex / type 字面量 / options 长度 / difficulty 越界（AC-R36-4-5 前半）', () => {
    const noAnswer = validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ answerIndex: undefined })] }))
    expect(noAnswer.ok).toBe(false)
    if (noAnswer.ok) return
    expect(noAnswer.reason).toContain('questionPool 第 1 条')
    expect(noAnswer.reason).toContain('answerIndex')

    const badType = validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ type: 'essay' as never })] }))
    expect(badType.ok).toBe(false)
    if (badType.ok) return
    expect(badType.reason).toContain('questionPool 第 1 条')
    expect(badType.reason).toContain('type')

    const badOptions = validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ options: ['a', 'b'] as unknown as Question['options'] })] }))
    expect(badOptions.ok).toBe(false)
    if (badOptions.ok) return
    expect(badOptions.reason).toContain('questionPool 第 1 条')
    expect(badOptions.reason).toContain('options')

    const badDifficulty = validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ difficulty: 5 as unknown as 1 })] }))
    expect(badDifficulty.ok).toBe(false)
    if (badDifficulty.ok) return
    expect(badDifficulty.reason).toContain('questionPool 第 1 条')
    expect(badDifficulty.reason).toContain('difficulty')
  })

  it('AC2-11（#173 修订：wordId 可空）缺 wordId 的题 → 合法（惊喜题口径）；wordId 类型非法 → 整文件拒绝', () => {
    const noWordId = validateLearningImport(validLearningJson({ questionPool: [makeQuestion(), makeQuestion({ id: 'q2', wordId: undefined })] }))
    expect(noWordId.ok).toBe(true)
    const bad = validateLearningImport(validLearningJson({ questionPool: [makeQuestion(), makeQuestion({ id: 'q2', wordId: 123 as never })] }))
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.reason).toContain('questionPool 第 2 条')
    expect(bad.reason).toContain('wordId')
  })
})

describe('AC2-12 / AC2-13 validateEconomyImport（经济文件校验，R36 REQ-R36-5）', () => {
  it('AC2-12 合法 2.0 经济文件：ok:true，rewards / starLedger 与原文深相等、proposals 通过数组校验（AC-R36-3-3 纯函数侧）', () => {
    const text = validEconomyJson()
    const result = validateEconomyImport(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.rewards).toEqual([makeReward()])
    // #173：2.0 旧文件流水导入补 kind=主星 + childId=默认孩子
    expect(result.data.starLedger).toEqual([
      makeEntry({ kind: 'main', childId: 'default' }),
      makeEntry({ id: 's2', type: 'redeem', amount: 2, source: '兑换：菠萝油', kind: 'main', childId: 'default' }),
    ])
  })

  it('AC2-13 条目非法（1-based 条号）：starLedger type / amount、rewards price、proposals 非数组 → 整文件拒绝（AC-R36-5-2/5-3 纯函数侧）', () => {
    const badType = validateEconomyImport(validEconomyJson({ starLedger: [makeEntry(), makeEntry({ type: 'ear' as unknown as StarEntry['type'] })] }))
    expect(badType.ok).toBe(false)
    if (badType.ok) return
    expect(badType.reason).toContain('starLedger 第 2 条')
    expect(badType.reason).toContain('type')

    const badAmount = validateEconomyImport(validEconomyJson({ starLedger: [makeEntry({ amount: -5 })] }))
    expect(badAmount.ok).toBe(false)
    if (badAmount.ok) return
    expect(badAmount.reason).toContain('starLedger 第 1 条')
    expect(badAmount.reason).toContain('amount')

    const badPrice = validateEconomyImport(validEconomyJson({ rewards: [makeReward({ price: 0 })] }))
    expect(badPrice.ok).toBe(false)
    if (badPrice.ok) return
    expect(badPrice.reason).toContain('rewards 第 1 条')
    expect(badPrice.reason).toContain('price')

    // R32（REQ-R32-8-2/8-3）：proposals 元素校验仅作用于 2.1 文件（2.0 无条件兜底 []，兜底行为由 35-R32 验收文件断言）
    for (const badProposals of ['x', {}, 42]) {
      const result = validateEconomyImport(validEconomyJson({ version: '2.1', proposals: badProposals }))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toContain('proposals')
    }

    const { proposals: _omitProposals, ...noProposals } = JSON.parse(validEconomyJson({ version: '2.1' })) as Record<string, unknown>
    const missingProposals = validateEconomyImport(JSON.stringify(noProposals))
    expect(missingProposals.ok).toBe(false)
    if (missingProposals.ok) return
    expect(missingProposals.reason).toContain('proposals')
  })
})

// ===== #75（R-72-3）经济文件 2.2 契约：进行中兑换（activeRedemptions）=====

describe('AC75-1 经济文件 2.2 导出形状（buildEconomyExport）', () => {
  it('AC75-1-1 buildEconomyExport 返回恰 6 字段：version "2.2" + rewards + proposals + starLedger + activeRedemptions 全量透传，空列表导 []（对齐 proposals 空态先例）', () => {
    const rewards = [makeReward()]
    const ledger = [makeEntry()]
    const redemptions = [makeRedemption(), makeRedemption({ id: 'ar2', rewardId: 'reward_tv', name: '看电视', emoji: '📺' })]
    const result = buildEconomyExport(rewards, [], ledger, redemptions, NOW)
    expect(Object.keys(result).sort()).toEqual(['activeRedemptions', 'exportedAt', 'proposals', 'rewards', 'starLedger', 'version'])
    expect(result).toEqual({
      version: '2.4',
      exportedAt: NOW,
      rewards,
      proposals: [],
      starLedger: ledger.map((s) => ({ ...s, childId: 'default', kind: 'main' })),
      activeRedemptions: redemptions.map((r) => ({ ...r, childId: 'default' })),
    })
    // 空列表导 []（无券设备换机不丢契约结构）
    expect(buildEconomyExport([], [], [], [], NOW)).toEqual({
      version: '2.4',
      exportedAt: NOW,
      rewards: [],
      proposals: [],
      starLedger: [],
      activeRedemptions: [],
    })
  })
})

describe('AC75-2 ~ AC75-4 经济文件 2.2 导入契约（validateEconomyImport）', () => {
  it('AC75-2-1 白名单三分支：2.0 / 2.1 旧文件 ok:true 且 activeRedemptions 兜底 []（缺失或文件值均无条件忽略，对齐 proposals 2.0 兜底先例）；2.2 文件逐条校验后透传', () => {
    // 2.0 旧文件（无 activeRedemptions key）
    const r20 = validateEconomyImport(validEconomyJson())
    expect(r20.ok).toBe(true)
    if (r20.ok) expect(r20.data.activeRedemptions).toEqual([])

    // 2.1 旧文件（无 activeRedemptions key）
    const r21 = validateEconomyImport(validEconomyJson({ version: '2.1' }))
    expect(r21.ok).toBe(true)
    if (r21.ok) expect(r21.data.activeRedemptions).toEqual([])

    // 2.1 旧文件携带任意 activeRedemptions 文件值 → 无条件兜底 []（忽略文件值）
    const r21Junk = validateEconomyImport(validEconomyJson({ version: '2.1', activeRedemptions: [{ junk: true }] }))
    expect(r21Junk.ok).toBe(true)
    if (r21Junk.ok) expect(r21Junk.data.activeRedemptions).toEqual([])

    // 2.2 文件：activeRedemptions 逐条校验后透传（version 保持 '2.2'；#173 补 childId 一列）
    const redemptions = [makeRedemption(), makeRedemption({ id: 'ar2', rewardId: 'reward_tv', name: '看电视', emoji: '📺' })]
    const r22 = validateEconomyImport(validEconomy22Json({ activeRedemptions: redemptions }))
    expect(r22.ok).toBe(true)
    if (r22.ok) {
      expect(r22.data.version).toBe('2.2')
      expect(r22.data.activeRedemptions).toEqual(redemptions.map((r) => ({ ...r, childId: 'default' })))
    }
  })

  it('AC75-2-2 2.2 条目非法 → 整文件拒绝（原子、零写入前置）：非数组 / 字段缺失 / 类型错（1-based 条号），proposals 分流不回归', () => {
    expect(validateEconomyImport(validEconomy22Json({ activeRedemptions: 'x' }))).toEqual({
      ok: false,
      reason: '缺少 activeRedemptions 数组',
      code: 'invalid',
      })

    const { activeRedemptions: _omit, ...noKey } = JSON.parse(validEconomy22Json()) as Record<string, unknown>
    expect(validateEconomyImport(JSON.stringify(noKey))).toEqual({
      ok: false,
      reason: '缺少 activeRedemptions 数组',
      code: 'invalid',
      })

    const { name: _omitName, ...noName } = makeRedemption()
    expect(validateEconomyImport(validEconomy22Json({ activeRedemptions: [noName] }))).toEqual({
      ok: false,
      reason: 'activeRedemptions 第 1 条：缺少字段 name 或类型错误',
      code: 'invalid',
      })

    expect(
      validateEconomyImport(validEconomy22Json({ activeRedemptions: [makeRedemption(), makeRedemption({ createdAt: 'x' as unknown as number })] })),
    ).toEqual({
      ok: false,
      reason: 'activeRedemptions 第 2 条：缺少字段 createdAt 或类型错误',
      code: 'invalid',
      })

    expect(validateEconomyImport(validEconomy22Json({ activeRedemptions: [makeRedemption({ emoji: 5 as unknown as string })] }))).toEqual({
      ok: false,
      reason: 'activeRedemptions 第 1 条：缺少字段 emoji 或类型错误',
      code: 'invalid',
      })

    // 2.2 继承 2.1 的 proposals 逐条校验（版本升级不放松既有字段）
    expect(validateEconomyImport(validEconomy22Json({ proposals: 'x' }))).toEqual({
      ok: false,
      reason: '缺少 proposals 数组',
      code: 'invalid',
      })
  })

  it('AC75-3 版本断代与未知版本不回归：1.x 三版本拒绝（版本过旧）、3.0 / abc 拒绝（不支持）；学习白名单仍仅 2.0（伪造 2.2 学习文件拒绝）', () => {
    for (const legacy of ['1.0', '1.1', '1.2']) {
      expect(validateEconomyImport(validEconomy22Json({ version: legacy }))).toEqual({
        ok: false,
        reason: '文件版本过旧，请用最新版重新导出',
        code: 'version-unsupported',
        })
    }
    for (const unknown of ['3.0', 'abc']) {
      expect(validateEconomyImport(validEconomy22Json({ version: unknown }))).toEqual({
        ok: false,
        reason: '不支持的导出版本',
        code: 'version-unsupported',
        })
    }
    expect(validateLearningImport(validLearningJson({ version: '2.2' }))).toEqual({
      ok: false,
      reason: '不支持的导出版本',
      code: 'version-unsupported',
      })
  })

  it('AC75-4 导出→导入往返还原：buildEconomyExport 产物 JSON 序列化后导入，activeRedemptions 与其余三组逐字还原（换设备券不丢；#173 全形状行含 kind/childId）', () => {
    const rewards = [makeReward()]
    const proposals: ProposalRecord[] = []
    const ledger = [makeEntry({ kind: 'main', childId: 'default' })]
    const redemptions = [
      makeRedemption({ childId: 'default' }),
      makeRedemption({ id: 'ar2', rewardId: 'reward_tv', name: '看电视', emoji: '📺', childId: 'default' }),
    ]
    const exported = buildEconomyExport(rewards, proposals, ledger, redemptions, NOW)

    const result = validateEconomyImport(JSON.stringify(exported))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual(exported)
  })
})
