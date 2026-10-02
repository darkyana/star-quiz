/**
 * R32 经济文件 2.1 契约纯函数单测（Spec 20260827-R32，AC-R32-10 / AC-R32-11 / REQ-R32-8）。
 * 版本白名单按组拆分：经济 ['2.0','2.1']（#75 起扩 ['2.0','2.1','2.2']）、学习维持 ['2.0']；1.x 断代拒绝（reason = copy.parent.importVersionTooOld 槽位值）；
 * 2.0 兼容导入 proposals 无条件兜底 []（忽略文件值，自主决策 #7）；2.1 proposals 元素按 Proposal 落盘口径（ProposalRecord）逐字段原子校验；
 * 导入 proposals 覆盖式（确认导入动作整组写 sq_proposals，经 useProposals 写入函数模拟）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { StarEntry, RewardItem, ProposalRecord } from '../../types'
import { buildEconomyExport, validateEconomyImport, validateLearningImport } from '../importExport'
import { proposals as readProposals, writeProposals, proposalEmoji, PROPOSAL_EMOJI_DEFAULT } from '../../composables/useProposals'
import { writeRecords, allRecords } from '../../composables/useActiveRedemptions'
import { applyEconomyImport } from '../../composables/useImport'

const NOW = '2026-08-27T10:30:00.000Z'
// 与 copy.parent.importVersionTooOld 槽位逐字一致（槽位值由 copy-r36.test.ts 锁定）
const VERSION_TOO_OLD = '文件版本过旧，请用最新版重新导出'

function makeReward(overrides: Partial<RewardItem> = {}): RewardItem {
  return { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐', ...overrides }
}

function makeEntry(overrides: Partial<StarEntry> = {}): StarEntry {
  return { id: 's1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星', ...overrides }
}

/** 落盘口径提议（ProposalRecord，12 字段，不含派生字段 publishState） */
function makeProposalRecord(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: 'p1',
    name: '去游乐园',
    price: 20,
    status: 'discussing',
    createdAt: 1724140800000,
    updatedAt: 1724140800000,
    description: '',
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

function validEconomyJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    rewards: [makeReward()],
    proposals: [],
    starLedger: [makeEntry()],
    ...overrides,
  })
}

function validEconomy21Json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.1',
    exportedAt: NOW,
    rewards: [makeReward()],
    proposals: [makeProposalRecord(), makeProposalRecord({ id: 'p2', name: '看电影', price: 10 })],
    starLedger: [makeEntry()],
    ...overrides,
  })
}

function validLearningJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    questionPool: [
      { id: 'q1', type: 'zh2en', prompt: '火车', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'train' },
    ],
    flagged: {},
    questionResults: {},
    ...overrides,
  })
}

beforeEach(() => {
  localStorage.clear()
})

describe('AC-R32-10 经济文件 2.1 契约（导出）', () => {
  it('AC-R32-10-1（#75 随动，#173 升 2.3，#299 升 2.4）buildEconomyExport 六字段：version "2.4" + rewards + proposals 全量真实数据（含终态提议）+ starLedger + activeRedemptions（#75 起）', () => {
    const rewards = [makeReward()]
    const ledger = [makeEntry(), makeEntry({ id: 's2' })]
    const proposals = [
      makeProposalRecord({ emoji: '🎢' }),
      makeProposalRecord({ id: 'p2', status: 'published', emoji: '🍿' }),
      makeProposalRecord({ id: 'p3', status: 'voided', description: '说好看电影，后来没去' }),
    ]
    expect(buildEconomyExport(rewards, proposals, ledger, [], NOW)).toEqual({
      version: '2.4',
      exportedAt: NOW,
      rewards,
      proposals: proposals.map((p) => ({ ...p, childId: 'default' })),
      starLedger: ledger.map((s) => ({ ...s, childId: 'default', kind: 'main' })),
      activeRedemptions: [],
    })
  })
})

describe('AC-R32-11 经济文件 2.1 契约（导入）', () => {
  it('AC-R32-11-1 2.1 合法文件 → ok:true 且 data 深相等（version "2.1"、proposals 为文件值 + #63 导入 backfill 归因字段；#75：activeRedemptions 兜底 []）', () => {
    const result = validateEconomyImport(validEconomy21Json())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        version: '2.1',
        exportedAt: NOW,
        rewards: [makeReward()],
        proposals: [
          { ...makeProposalRecord(), lastActionBy: 'parent', lastActionKind: 'proposed', childId: 'default' },
          { ...makeProposalRecord({ id: 'p2', name: '看电影', price: 10 }), lastActionBy: 'parent', lastActionKind: 'proposed', childId: 'default' },
        ],
        starLedger: [makeEntry({ kind: 'main', childId: 'default' })],
        activeRedemptions: [],
      })
    }
  })

  it('AC-R32-11-2 2.0 兼容导入：proposals [] → ok 且 []；字段缺失 → ok 且兜底 []；非空文件值 → 无条件取空（忽略文件值）', () => {
    const r1 = validateEconomyImport(validEconomyJson({ proposals: [] }))
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.data.version).toBe('2.0')
      expect(r1.data.proposals).toEqual([])
    }

    const { proposals: _omit, ...rest } = JSON.parse(validEconomyJson())
    const r2 = validateEconomyImport(JSON.stringify(rest))
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.data.proposals).toEqual([])

    const r3 = validateEconomyImport(validEconomyJson({ proposals: [{ junk: true }] }))
    expect(r3.ok).toBe(true)
    if (r3.ok) expect(r3.data.proposals).toEqual([])
  })

  it('AC-R32-11-3 覆盖式：本机 2 条提议 + 2.1 文件 1 条合法 → 确认导入整体替换为文件 1 条', () => {
    writeProposals([
      makeProposalRecord({ id: 'local-1' }),
      makeProposalRecord({ id: 'local-2', name: '吃冰淇淋' }),
    ])

    const fileProposal = makeProposalRecord({ id: 'file-1', name: '去动物园' })
    const result = validateEconomyImport(validEconomy21Json({ proposals: [fileProposal] }))
    expect(result.ok).toBe(true)

    // 确认导入的数据动作：sq_proposals 整组替换为文件值（与 rewards / starLedger 覆盖语义一致）
    if (result.ok) writeProposals(result.data.proposals)

    // #63：导入 backfill 补归因字段（by=initiator / proposed）；#173：补 childId（默认孩子）
    const expected = [{ ...fileProposal, lastActionBy: 'parent', lastActionKind: 'proposed', childId: 'default' }]
    expect(readProposals()).toEqual(expected)
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)).toEqual(expected)
  })

  it('AC-R32-11-5 2.1 原子校验：proposals 非数组 → 整文件拒绝「缺少 proposals 数组」', () => {
    expect(validateEconomyImport(validEconomy21Json({ proposals: 'x' }))).toEqual({
      ok: false,
      reason: '缺少 proposals 数组',
      code: 'invalid',
      })
    expect(validateEconomyImport(validEconomy21Json({ proposals: {} }))).toEqual({
      ok: false,
      reason: '缺少 proposals 数组',
      code: 'invalid',
      })
  })

  it('AC-R32-11-5 2.1 元素校验：任一字段缺失（落盘口径 10 字段逐个删）→ 第 1 条精确 reason', () => {
    const fields = [
      'id',
      'name',
      'price',
      'status',
      'createdAt',
      'updatedAt',
      'description',
      'parentStatus',
      'childStatus',
      'initiator',
    ] as const
    for (const field of fields) {
      const { [field]: _omit, ...bad } = makeProposalRecord()
      expect(validateEconomyImport(validEconomy21Json({ proposals: [bad] }))).toEqual({
        ok: false,
        reason: `proposals 第 1 条：缺少字段 ${field} 或类型错误`,
        code: 'invalid',
        })
    }
  })

  it('AC-R32-11-5 2.1 元素校验：类型错 / 枚举错（price 字符串、status、parentStatus、initiator）→ 原子拒绝；第 2 条同样拒绝', () => {
    expect(validateEconomyImport(validEconomy21Json({ proposals: [makeProposalRecord({ price: '20' as never })] }))).toEqual({
      ok: false,
      reason: 'proposals 第 1 条：缺少字段 price 或类型错误',
      code: 'invalid',
      })
    expect(validateEconomyImport(validEconomy21Json({ proposals: [makeProposalRecord({ status: 'done' as never })] }))).toEqual({
      ok: false,
      reason: 'proposals 第 1 条：缺少字段 status 或类型错误',
      code: 'invalid',
      })
    expect(validateEconomyImport(validEconomy21Json({ proposals: [makeProposalRecord({ parentStatus: 'yes' as never })] }))).toEqual({
      ok: false,
      reason: 'proposals 第 1 条：缺少字段 parentStatus 或类型错误',
      code: 'invalid',
      })
    expect(validateEconomyImport(validEconomy21Json({ proposals: [makeProposalRecord({ initiator: 'teacher' as never })] }))).toEqual({
      ok: false,
      reason: 'proposals 第 1 条：缺少字段 initiator 或类型错误',
      code: 'invalid',
      })
    expect(
      validateEconomyImport(validEconomy21Json({ proposals: [makeProposalRecord(), { ...makeProposalRecord({ id: 'p2' }), childStatus: 1 as never }] })),
    ).toEqual({
      ok: false,
      reason: 'proposals 第 2 条：缺少字段 childStatus 或类型错误',
      code: 'invalid',
      })
  })

  it('AC-R32-11-3 1.x 断代拒绝（1.0 / 1.1 / 1.2）+ 未知版本 9.9 拒绝', () => {
    for (const version of ['1.0', '1.1', '1.2']) {
      expect(validateEconomyImport(validEconomy21Json({ version }))).toEqual({ ok: false, reason: VERSION_TOO_OLD, code: 'version-unsupported' })
    }
    expect(validateEconomyImport(validEconomy21Json({ version: '9.9' }))).toEqual({
      ok: false,
      reason: '不支持的导出版本',
      code: 'version-unsupported',
    })
  })

  it('AC-R32-11-7 学习白名单回归：学习文件 "2.0" ok；伪造 "2.1" 学习文件 → 拒绝（学习白名单仍仅 2.0）', () => {
    expect(validateLearningImport(validLearningJson()).ok).toBe(true)
    expect(validateLearningImport(validLearningJson({ version: '2.1' }))).toEqual({
      ok: false,
      reason: '不支持的导出版本',
      code: 'version-unsupported',
    })
  })
})

describe('#304 经济文件 2.4 契约（提议 emoji 可选宽进）', () => {
  it('#304 导入白名单扩 "2.4"：合法 2.4 文件 ok:true，version 原样返回', () => {
    const result = validateEconomyImport(validEconomy21Json({ version: '2.4', activeRedemptions: [], proposals: [makeProposalRecord({ emoji: '🎢' })] }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.version).toBe('2.4')
      expect(result.data.proposals[0].emoji).toBe('🎢')
    }
  })

  it('#304 emoji 可选宽进：非字符串 / 空串 / null → 剔除键按缺省处理（读取侧兜底 🎁），不整次拒绝', () => {
    for (const bad of [42, '', null, { icon: 'x' }]) {
      const result = validateEconomyImport(validEconomy21Json({ version: '2.4', activeRedemptions: [], proposals: [makeProposalRecord({ emoji: bad as never })] }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.proposals[0]).not.toHaveProperty('emoji')
        expect(proposalEmoji(result.data.proposals[0])).toBe(PROPOSAL_EMOJI_DEFAULT)
      }
    }
  })

  it('#304 旧版本兼容：2.1 / 2.2 / 2.3 提议无 emoji 照常导入（读取侧兜底 🎁，不物理补值）', () => {
    for (const version of ['2.1', '2.2', '2.3']) {
      const result = validateEconomyImport(validEconomy21Json({ version, activeRedemptions: [], proposals: [makeProposalRecord()] }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.proposals[0]).not.toHaveProperty('emoji')
        expect(proposalEmoji(result.data.proposals[0])).toBe(PROPOSAL_EMOJI_DEFAULT)
      }
    }
  })

  it('#304 roundtrip：导出（2.4）→ 清库 → 校验 + 落库 → 提议与进行中兑换 emoji 不丢（无 emoji 提议读取兜底 🎁）', () => {
    const localProposals = [
      makeProposalRecord({ id: 'rp1', emoji: '🎢' }),
      makeProposalRecord({ id: 'rp2' }), // 存量无 emoji：导出不落键，导入后读取侧兜底
    ]
    const localRedemptions = [
      { id: 'ar1', rewardId: 'reward_pineapple', name: '菠萝油', emoji: '🥐', createdAt: 1724230000000, childId: 'default' },
    ]
    writeProposals(localProposals)
    writeRecords(localRedemptions)

    const file = buildEconomyExport([makeReward()], readProposals(), [makeEntry()], allRecords(), NOW)
    expect(file.version).toBe('2.4')

    // 清库：模拟换机 / 恢复备份前的空态
    localStorage.clear()

    const result = validateEconomyImport(JSON.stringify(file))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(applyEconomyImport(result.data)).toEqual({ ok: true })

    const restored = readProposals()
    expect(restored.map((p) => proposalEmoji(p))).toEqual(['🎢', '🎁'])
    expect(restored[0].emoji).toBe('🎢')
    expect(restored[1]).not.toHaveProperty('emoji')
    expect(allRecords()[0].emoji).toBe('🥐')
  })
})
