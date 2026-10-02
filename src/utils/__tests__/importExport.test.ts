/**
 * R36 导出契约 2.0 纯函数单测（Spec 20260827-v0.10.0-R36，AC-R36-1-x / 2-x / 3-x / 4-3~4-6 / 5-2~5-3 / 7-1）
 * R32 起版本白名单按组拆分（经济 ['2.0','2.1']、学习 ['2.0']，#75 起经济扩 ['2.0','2.1','2.2']），2.1 契约专项见 importExport-proposals.test.ts、2.2 契约专项见 16 号验收；
 * 1.x 断代拒绝「文件版本过旧」；非 1.x 未知版本「不支持的导出版本」；
 * 学习文件缺 rewards 合法（不校验经济字段），缺 flagged / questionResults 拒绝（2.0 缺字段即非法）。
 */
import { describe, it, expect } from 'vitest'
import type { Question, StarEntry, RewardItem, QuestionResultsState, ProposalRecord, ActiveRedemption } from '../../types'
import {
  buildLearningExport,
  buildEconomyExport,
  formatExportFilename,
  validateLearningImport,
  validateEconomyImport,
} from '../importExport'

const NOW = '2026-08-27T10:30:00.000Z'
const VERSION_TOO_OLD = '文件版本过旧，请用最新版重新导出'

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

function validLearningJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    questionPool: [makeQuestion(), makeQuestion({ id: 'q2', wordId: 'bus' })],
    flagged: {},
    questionResults: {},
    ...overrides,
  })
}

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

describe('AC-R36-1 学习文件契约（导出）', () => {
  it('AC-R36-1-1 buildLearningExport 五字段：version "3.0"（#173 升位）+ exportedAt + questionPool + flagged + questionResults', () => {
    const pool = [makeQuestion(), makeQuestion({ id: 'q2' })]
    const flagged = { '000001': { flaggedAt: 1000, correct: true } }
    const questionResults: QuestionResultsState = {
      '000001': [{ outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' }],
    }
    expect(buildLearningExport(pool, flagged, questionResults, NOW)).toEqual({
      version: '3.0',
      exportedAt: NOW,
      questionPool: pool.map((q) => ({ ...q, category: '学科', book: '默认' })),
      flagged: { '000001': { ...flagged['000001'], childId: 'default' } },
      questionResults: { '000001': [{ ...questionResults['000001'][0], childId: 'default' }] },
    })
    // 导出只归一文件，不改写读入的旧数据。
    expect(pool[0].category).toBeUndefined()
    expect(questionResults['000001'][0].childId).toBeUndefined()
  })

  it('AC-R36-1-3 formatExportFilename learning：star-quiz-learning-{YYYYMMDD-HHmmss}.json', () => {
    expect(formatExportFilename('learning', new Date(2026, 7, 27, 18, 30, 0))).toBe('star-quiz-learning-20260827-183000.json')
  })

  it('formatExportFilename 单数字零填充', () => {
    expect(formatExportFilename('learning', new Date(2026, 0, 5, 9, 7, 3))).toBe('star-quiz-learning-20260105-090703.json')
  })
})

describe('AC-R36-2 经济文件契约（导出，R32 升 2.1，#75 升 2.2，#299 升 2.4）', () => {
  it('AC-R36-2-1（#75 随动，#173 升 2.3，#299 升 2.4）buildEconomyExport 六字段：version "2.4" + rewards + proposals 传入全量 + starLedger + activeRedemptions 传入全量', () => {
    const rewards = [makeReward()]
    const ledger = [makeEntry(), makeEntry({ id: 's2' })]
    const activeRedemptions: ActiveRedemption[] = [
      { id: 'ar1', rewardId: 'reward_pineapple', name: '菠萝油', emoji: '🥐', createdAt: 1724230000000 },
    ]
    const proposals: ProposalRecord[] = [
      {
        id: 'p1',
        name: '去游乐园',
        price: 20,
        status: 'published',
        createdAt: 1724140800000,
        updatedAt: 1724140800000,
        description: '',
        parentStatus: 'agreed',
        childStatus: 'agreed',
        initiator: 'parent',
        lastActionBy: 'parent',
        lastActionKind: 'proposed',
      },
    ]
    expect(buildEconomyExport(rewards, proposals, ledger, activeRedemptions, NOW)).toEqual({
      version: '2.4',
      exportedAt: NOW,
      rewards,
      proposals: proposals.map((p) => ({ ...p, childId: 'default' })),
      starLedger: ledger.map((s) => ({ ...s, childId: 'default', kind: 'main' })),
      activeRedemptions: activeRedemptions.map((r) => ({ ...r, childId: 'default' })),
    })
    expect(proposals[0].childId).toBeUndefined()
    expect(ledger[0].kind).toBeUndefined()
  })

  it('AC-R36-2-3 formatExportFilename economy：star-quiz-economy-{YYYYMMDD-HHmmss}.json', () => {
    expect(formatExportFilename('economy', new Date(2026, 7, 27, 18, 31, 5))).toBe('star-quiz-economy-20260827-183105.json')
  })
})

describe('AC-R36-3 版本契约（导入，白名单学习 ["2.0","3.0"] / 经济 ["2.0"~"2.4"]，#173 起兼容上一版按默认补齐）', () => {
  it('AC-R36-3-1 学习文件 "2.0"（#173 前上一版）→ ok:true 且 data 深相等（difficulty 补 3 + 大类/分册补学科初始归类 + 行补 childId，归一 version "3.0"）', () => {
    const result = validateLearningImport(validLearningJson())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        version: '3.0',
        exportedAt: NOW,
        questionPool: [
          makeQuestion({ difficulty: 3, category: '学科', book: '默认' }),
          makeQuestion({ id: 'q2', wordId: 'bus', difficulty: 3, category: '学科', book: '默认' }),
        ],
        flagged: {},
        questionResults: {},
      })
    }
  })

  it('AC-R36-3-2 经济文件 "2.0"（#173 前上一版）→ ok:true 且 data 深相等（activeRedemptions 兜底 [] + 流水补 kind/childId）', () => {
    const result = validateEconomyImport(validEconomyJson())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        version: '2.0',
        exportedAt: NOW,
        rewards: [makeReward()],
        proposals: [],
        starLedger: [
          makeEntry({ kind: 'main', childId: 'default' }),
          makeEntry({ id: 's2', type: 'redeem', amount: 2, source: '兑换：菠萝油', kind: 'main', childId: 'default' }),
        ],
        activeRedemptions: [],
      })
    }
  })

  it('#173 学习文件 "3.0"（新版）→ ok:true，已带大类/分册与 childId 的字段原样保留（不重复补齐）', () => {
    const result = validateLearningImport(
      validLearningJson({
        version: '3.0',
        questionPool: [makeQuestion({ difficulty: 2, category: '小学', book: '三年级' })],
        flagged: { '000001': { flaggedAt: 1000, childId: 'default' } },
        questionResults: { q1: [{ outcome: 'wrong', timestamp: NOW, childId: 'default' }] }, // q1 在文件题池内（孤儿会被清理）
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.version).toBe('3.0')
      expect(result.data.questionPool[0].category).toBe('小学')
      expect(result.data.questionPool[0].book).toBe('三年级')
      expect(result.data.flagged['000001'].childId).toBe('default')
      expect(result.data.questionResults['q1'][0].childId).toBe('default')
    }
  })

  it('#173 经济文件 "2.3"（上一版，#299 起仍兼容导入）→ ok:true，kind/childId/requirement 原样保留', () => {
    const result = validateEconomyImport(
      validEconomyJson({
        version: '2.3',
        rewards: [makeReward({ requirement: { kind: 'game', amount: 5 } })],
        starLedger: [makeEntry({ kind: 'game', childId: 'default' })],
        proposals: [],
        activeRedemptions: [{ id: 'ar1', rewardId: 'r1', name: 'x', emoji: '🎁', createdAt: 1, childId: 'default' }],
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.version).toBe('2.3')
      expect(result.data.rewards[0].requirement).toEqual({ kind: 'game', amount: 5 })
      expect(result.data.starLedger[0].kind).toBe('game')
      expect(result.data.starLedger[0].childId).toBe('default')
      expect(result.data.activeRedemptions[0].childId).toBe('default')
    }
  })

  it('#173 非法 requirement（kind 越枚举 / amount 非正整数）→ 原子拒绝', () => {
    expect(validateEconomyImport(validEconomyJson({ rewards: [{ ...makeReward(), requirement: { kind: 'vip', amount: 5 } }] })).ok).toBe(false)
    expect(validateEconomyImport(validEconomyJson({ rewards: [makeReward({ requirement: { kind: 'game', amount: 0 } })] })).ok).toBe(false)
    expect(validateEconomyImport(validEconomyJson({ rewards: [makeReward({ requirement: { kind: 'game', amount: 1.5 } })] })).ok).toBe(false)
  })

  it('#173 所有归属数据行均拒绝显式非法 childId，缺省仍兼容旧文件', () => {
    for (const childId of ['', 42, null]) {
      expect(validateLearningImport(validLearningJson({ flagged: { q1: { flaggedAt: 1, childId } } })).ok).toBe(false)
      expect(validateLearningImport(validLearningJson({ questionResults: { q1: [{ outcome: 'correct', timestamp: NOW, childId }] } })).ok).toBe(false)
      expect(validateEconomyImport(validEconomyJson({ version: '2.3', activeRedemptions: [{ id: 'a', rewardId: 'r', name: '奖励', emoji: '🎁', createdAt: 1, childId }] })).ok).toBe(false)
      expect(validateEconomyImport(validEconomyJson({ version: '2.3', activeRedemptions: [], proposals: [{
        id: 'p', name: '奖励', price: 1, status: 'discussing', createdAt: 1, updatedAt: 1,
        description: '', parentStatus: 'agreed', childStatus: 'notAgreed', initiator: 'parent', childId,
      }] })).ok).toBe(false)
    }
  })

  it('#173 wordId 可空（trivia 题）与 type trivia 合法；非法可选字段类型拒绝', () => {
    expect(
      validateLearningImport(
        validLearningJson({ questionPool: [makeQuestion({ type: 'trivia', wordId: undefined })] }),
      ).ok,
    ).toBe(true)
    expect(validateLearningImport(validLearningJson({ questionPool: [{ ...makeQuestion(), wordId: 123 }] })).ok).toBe(false)
    expect(validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ category: '' })] })).ok).toBe(false)
  })

  it('#234 id 9 号段（9xxxxx 内置题集保留段）整次拒绝；学科段与 trivia 形式不受影响', () => {
    expect(validateLearningImport(validLearningJson({ questionPool: [makeQuestion(), makeQuestion({ id: '900001' })] }))).toEqual({
      ok: false,
      reason: 'questionPool 第 2 条：序号 900001 属内置题集保留段（9xxxxx），不能导入',
      code: 'invalid',
    })
    expect(validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ id: '999999' })] })).ok).toBe(false)
    // 9 号段拒收只认序号段：type 不参与（trivia 形式 + 学科段照常合法）
    expect(validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ id: '899999', type: 'trivia', wordId: undefined })] })).ok).toBe(true)
    expect(validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ id: '000009' })] })).ok).toBe(true)
  })

  it('AC-R36-3-1/3-2 学习文件 "1.0" / "1.1" / "1.2" → 整文件拒绝，reason 版本过旧', () => {
    for (const version of ['1.0', '1.1', '1.2']) {
      expect(validateLearningImport(validLearningJson({ version }))).toEqual({ ok: false, reason: VERSION_TOO_OLD, code: 'version-unsupported' })
    }
  })

  it('AC-R36-3-2 经济文件 "1.0" → 拒绝版本过旧', () => {
    expect(validateEconomyImport(validEconomyJson({ version: '1.0' }))).toEqual({ ok: false, reason: VERSION_TOO_OLD, code: 'version-unsupported' })
  })

  it('AC-R36-3-4 非 1.x 未知版本（"4.0" / "abc"）→ 沿用「不支持的导出版本」（#173 起学习 3.0 / #299 起经济 2.4 合法）', () => {
    expect(validateLearningImport(validLearningJson({ version: '4.0' }))).toEqual({ ok: false, reason: '不支持的导出版本', code: 'version-unsupported' })
    expect(validateLearningImport(validLearningJson({ version: 'abc' }))).toEqual({ ok: false, reason: '不支持的导出版本', code: 'version-unsupported' })
    expect(validateEconomyImport(validEconomyJson({ version: '3.0' }))).toEqual({ ok: false, reason: '不支持的导出版本', code: 'version-unsupported' })
  })

  it('AC-R36-3-5 缺 version 或 version 非字符串 → 「缺少 version 字段」', () => {
    const { version: _omit, ...rest } = JSON.parse(validLearningJson())
    expect(validateLearningImport(JSON.stringify(rest))).toEqual({ ok: false, reason: '缺少 version 字段', code: 'invalid' })
    expect(validateLearningImport(validLearningJson({ version: 2.0 }))).toEqual({ ok: false, reason: '缺少 version 字段', code: 'invalid' })
    const { version: _omit2, ...rest2 } = JSON.parse(validEconomyJson())
    expect(validateEconomyImport(JSON.stringify(rest2))).toEqual({ ok: false, reason: '缺少 version 字段', code: 'invalid' })
  })

  it('非合法 JSON → 「不是合法 JSON」（数组 / null / 原始值 / 解析失败）', () => {
    for (const bad of ['{invalid json', '[1,2,3]', 'null', '42', '"str"']) {
      expect(validateLearningImport(bad)).toEqual({ ok: false, reason: '不是合法 JSON', code: 'file-corrupt' })
      expect(validateEconomyImport(bad)).toEqual({ ok: false, reason: '不是合法 JSON', code: 'file-corrupt' })
    }
  })
})

describe('AC-R36-4 学习文件字段校验（原子拒绝）', () => {
  it('缺少 questionPool → 缺少 questionPool 数组', () => {
    const { questionPool: _omit, ...rest } = JSON.parse(validLearningJson())
    expect(validateLearningImport(JSON.stringify(rest))).toEqual({ ok: false, reason: '缺少 questionPool 数组', code: 'invalid' })
  })

  it('questionPool 非数组 → 缺少 questionPool 数组', () => {
    expect(validateLearningImport(validLearningJson({ questionPool: {} }))).toEqual({ ok: false, reason: '缺少 questionPool 数组', code: 'invalid' })
  })

  it('AC-R36-4-3 条目字段非法 → 第 N 条精确 reason（answerIndex / type / options / id / prompt / wordId）', () => {
    const { answerIndex: _omit, ...bad } = makeQuestion()
    expect(validateLearningImport(validLearningJson({ questionPool: [bad] }))).toEqual({
      ok: false,
      reason: 'questionPool 第 1 条：缺少字段 answerIndex 或类型错误',
      code: 'invalid',
    })
    expect(
      validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ type: 'essay' as never })] })),
    ).toEqual({ ok: false, reason: 'questionPool 第 1 条：缺少字段 type 或类型错误', code: 'invalid' })
    expect(
      validateLearningImport(validLearningJson({ questionPool: [makeQuestion({ options: ['a', 'b'] as never })] })),
    ).toEqual({ ok: false, reason: 'questionPool 第 1 条：缺少字段 options 或类型错误', code: 'invalid' })
    expect(
      validateLearningImport(validLearningJson({ questionPool: [makeQuestion(), makeQuestion({ id: 'q2', answerIndex: '1' as never })] })),
    ).toEqual({ ok: false, reason: 'questionPool 第 2 条：缺少字段 answerIndex 或类型错误', code: 'invalid' })
  })

  it('AC-R36-4-5 difficulty 缺省物理补 3；非 1/2/3 拒绝（保留 R24 规则）', () => {
    const okResult = validateLearningImport(validLearningJson())
    expect(okResult.ok).toBe(true)
    if (okResult.ok) {
      for (const q of okResult.data.questionPool) expect(q.difficulty).toBe(3)
    }
    for (const bad of [4, '3', null]) {
      const pool = [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2', difficulty: bad as never })]
      expect(validateLearningImport(validLearningJson({ questionPool: pool }))).toEqual({
        ok: false,
        reason: 'questionPool 第 2 条：difficulty 必须是 1/2/3',
        code: 'invalid',
      })
    }
  })

  it('AC-R36-4-6 缺 flagged 字段 → 整文件拒绝（2.0 缺字段即非法，无兜底）', () => {
    const { flagged: _omit, ...rest } = JSON.parse(validLearningJson())
    expect(validateLearningImport(JSON.stringify(rest))).toEqual({ ok: false, reason: 'flagged 必须是对象', code: 'invalid' })
  })

  it('AC-R36-4-6 缺 questionResults 字段 → 整文件拒绝（2.0 缺字段即非法，无兜底）', () => {
    const { questionResults: _omit, ...rest } = JSON.parse(validLearningJson())
    expect(validateLearningImport(JSON.stringify(rest))).toEqual({ ok: false, reason: 'questionResults 必须是对象', code: 'invalid' })
  })

  it('AC-R36-4 学习文件不校验经济字段：无 rewards / proposals / starLedger 字段 → ok', () => {
    const result = validateLearningImport(validLearningJson())
    expect(result.ok).toBe(true)
  })
})

describe('AC-R36-5 经济文件字段校验（原子拒绝）', () => {
  it('AC-R36-5-2 缺 rewards → 缺少 rewards 数组；条目非法 → 第 N 条精确 reason', () => {
    const { rewards: _omit, ...rest } = JSON.parse(validEconomyJson())
    expect(validateEconomyImport(JSON.stringify(rest))).toEqual({ ok: false, reason: '缺少 rewards 数组', code: 'invalid' })
    expect(validateEconomyImport(validEconomyJson({ rewards: [makeReward({ price: -3 })] }))).toEqual({
      ok: false,
      reason: 'rewards 第 1 条：缺少字段 price 或类型错误',
      code: 'invalid',
    })
    const { name: _omit2, ...bad } = makeReward()
    expect(validateEconomyImport(validEconomyJson({ rewards: [bad] }))).toEqual({
      ok: false,
      reason: 'rewards 第 1 条：缺少字段 name 或类型错误',
      code: 'invalid',
    })
  })

  it('AC-R36-5-2 → R32：2.1 proposals 非数组 → 整文件拒绝「缺少 proposals 数组」；2.0 无条件兜底 []（缺失 / 非空文件值均忽略）', () => {
    expect(validateEconomyImport(validEconomyJson({ version: '2.1', proposals: 'x' }))).toEqual({ ok: false, reason: '缺少 proposals 数组', code: 'invalid' })
    expect(validateEconomyImport(validEconomyJson({ version: '2.1', proposals: {} }))).toEqual({ ok: false, reason: '缺少 proposals 数组', code: 'invalid' })
    const r1 = validateEconomyImport(validEconomyJson())
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.data.proposals).toEqual([])
  })

  it('AC-R36-5-3 缺 starLedger / 条目非法 → 精确 reason（type / amount / id / timestamp / source）', () => {
    const { starLedger: _omit, ...rest } = JSON.parse(validEconomyJson())
    expect(validateEconomyImport(JSON.stringify(rest))).toEqual({ ok: false, reason: '缺少 starLedger 数组', code: 'invalid' })
    expect(
      validateEconomyImport(validEconomyJson({ starLedger: [makeEntry(), makeEntry({ id: 's2', type: 'ear' as never })] })),
    ).toEqual({ ok: false, reason: 'starLedger 第 2 条：缺少字段 type 或类型错误', code: 'invalid' })
    expect(validateEconomyImport(validEconomyJson({ starLedger: [makeEntry({ amount: -5 })] }))).toEqual({
      ok: false,
      reason: 'starLedger 第 1 条：缺少字段 amount 或类型错误',
      code: 'invalid',
    })
  })

  it('emoji / quizId 可选字段不判非法', () => {
    const { emoji: _omit, ...noEmoji } = makeReward()
    const r1 = validateEconomyImport(validEconomyJson({ rewards: [noEmoji] }))
    expect(r1.ok).toBe(true)
    const { quizId: _omit2, ...noQuiz } = makeEntry()
    const r2 = validateEconomyImport(validEconomyJson({ starLedger: [noQuiz] }))
    expect(r2.ok).toBe(true)
  })

  it('经济文件不校验学习字段：无 questionPool / flagged / questionResults 字段 → ok', () => {
    const result = validateEconomyImport(validEconomyJson())
    expect(result.ok).toBe(true)
  })
})

describe('#236 惊喜入口开关键导出隔离（家庭偏好不进学习/经济文件）', () => {
  it('学习 / 经济导出 JSON 不含 entry_visibility 域任何字段（键清单天然隔离）', () => {
    const learning = JSON.stringify(buildLearningExport([makeQuestion()], {}, {}, NOW))
    const economy = JSON.stringify(buildEconomyExport([makeReward()], [], [makeEntry()], [], NOW))
    for (const payload of [learning, economy]) {
      expect(payload).not.toContain('entry_visibility')
      expect(payload).not.toContain('triviaEntry')
      expect(payload).not.toContain('"visible"')
    }
  })
})
