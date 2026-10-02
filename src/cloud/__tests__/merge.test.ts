/**
 * 分域合并器纯函数单测（#126，R-P1d；ADR 0002 合并语义 / ADR 0005 域映射）。
 * 纯函数直测：不触 localStorage、不触网络；时间与写者显式注入。
 * 覆盖票面 AC 的多设备模拟合并语义：并发写同域并集、LWW 裁决、提议板修订即认同、题库整组胜。
 */
import { describe, it, expect } from 'vitest'
import type {
  Question,
  QuestionResultsState,
  WordAppearance,
  RewardItem,
  ProposalRecord,
  ActiveRedemption,
  StarEntry,
} from '../../types'
import {
  diffStarEntries,
  diffQuestionResults,
  diffWordAppearances,
  diffRewardItems,
  diffProposals,
  diffActiveRedemptions,
  diffQuestionFlags,
  diffQuestionBanks,
  diffEntryVisibility,
  mergeStarEntries,
  mergeQuestionResults,
  mergeWordAppearances,
  mergeRewardItems,
  mergeProposals,
  mergeActiveRedemptions,
  mergeQuestionFlags,
  mergeQuestionBanks,
  mergeEntryVisibility,
  advanceShadowFromSent,
  type RewardItemRow,
  type ProposalRow,
  type QuestionBankRow,
  type EntryVisibilityRow,
} from '../merge'

// ===== 样本工厂 =====

function entry(id: string, timestamp = 1000, type: 'earn' | 'redeem' = 'earn', amount = 1): StarEntry {
  return { id, timestamp, type, amount, source: type === 'earn' ? '答题得星' : '兑换：菠萝油', quizId: type === 'earn' ? `quiz-${id}` : undefined }
}

function results(state: Record<string, Array<{ outcome: 'correct' | 'wrong' | 'skipped'; timestamp: string }>>): QuestionResultsState {
  return state
}

function reward(id: string, name = '奖励', price = 3): RewardItem {
  return { id, name, price }
}

function rewardRow(id: string, updatedAt: number, name = '奖励', deleted: 0 | 1 = 0): RewardItemRow {
  return { id, name, price: 3, updated_at: updatedAt, updated_by: 'dev-a', deleted }
}

function proposal(id: string, updatedAt: number, over: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id,
    name: '乐高',
    price: 100,
    status: 'discussing',
    createdAt: 900,
    updatedAt,
    description: '想要一盒',
    parentStatus: 'notAgreed',
    childStatus: 'agreed',
    initiator: 'child',
    lastActionBy: 'child',
    lastActionKind: 'proposed',
    ...over,
  }
}

function redemption(id: string, createdAt = 500): ActiveRedemption {
  return { id, rewardId: 'r-1', name: '冰淇淋', emoji: '🍦', createdAt }
}

function question(id: string, wordId = `w-${id}`): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId }
}

const ISO = (n: number) => new Date(n).toISOString()

// ===== ① star_entries：并集幂等去重 =====

describe('star_entries 推侧 diff', () => {
  it('影子为空 → 全量成行（quizId → quiz_id 映射）；影子内条目不重复成行', () => {
    const rows = diffStarEntries([entry('s1'), entry('s2')], [])
    expect(rows).toEqual([
      { id: 's1', child_id: 'default', kind: 'main', timestamp: 1000, type: 'earn', amount: 1, source: '答题得星', quiz_id: 'quiz-s1' },
      { id: 's2', child_id: 'default', kind: 'main', timestamp: 1000, type: 'earn', amount: 1, source: '答题得星', quiz_id: 'quiz-s2' },
    ])
    expect(diffStarEntries([entry('s1')], [entry('s1')])).toEqual([])
  })

  it('新增条目只推增量（离线攒账后仍是 id 级增量）', () => {
    const rows = diffStarEntries([entry('s1'), entry('s2'), entry('s3')], [entry('s1')])
    expect(rows.map((r) => r.id)).toEqual(['s2', 's3'])
  })
})

describe('star_entries 拉侧 merge（并发写同域并集）', () => {
  it('两台设备各写各的流水，云端行并集落地：按 timestamp 升序、身份幂等', () => {
    const a = mergeStarEntries([entry('a1', 1000)], [
      { id: 'b1', timestamp: 2000, type: 'earn', amount: 2, source: '答题得星' },
      { id: 'a1', timestamp: 1000, type: 'earn', amount: 1, source: '答题得星', quiz_id: 'quiz-a1' },
      { id: 'b2', timestamp: 500, type: 'redeem', amount: 5, source: '兑换：菠萝油' },
    ])
    expect(a.next.map((e) => e.id)).toEqual(['b2', 'a1', 'b1'])
    expect(a.changed).toBe(true)
    // 幂等：同一批再合并不变化
    const again = mergeStarEntries(a.next, [
      { id: 'b1', timestamp: 2000, type: 'earn', amount: 2, source: '答题得星' },
    ])
    expect(again.changed).toBe(false)
    expect(again.next).toEqual(a.next)
  })
})

// ===== ② question_results：并集 + 本地 5 次滚动窗口 =====

describe('question_results 推侧 diff / 拉侧 merge', () => {
  it('diff 按 (question_id, answered_at) 身份出增量', () => {
    const current = results({ q1: [{ outcome: 'correct', timestamp: ISO(3) }, { outcome: 'wrong', timestamp: ISO(2) }] })
    const shadow = results({ q1: [{ outcome: 'wrong', timestamp: ISO(2) }] })
    expect(diffQuestionResults(current, shadow)).toEqual([{ child_id: 'default', question_id: 'q1', answered_at: ISO(3), outcome: 'correct' }])
  })

  it('merge 并集去重并维持「最新在前 + 每题最多 5 条」本地窗口（云端全量、本地裁剪）', () => {
    const local = results({ q1: [
      { outcome: 'correct', timestamp: ISO(50) },
      { outcome: 'correct', timestamp: ISO(40) },
      { outcome: 'correct', timestamp: ISO(30) },
      { outcome: 'correct', timestamp: ISO(20) },
      { outcome: 'correct', timestamp: ISO(10) },
    ] })
    const merged = mergeQuestionResults(local, [
      { question_id: 'q1', answered_at: ISO(60), outcome: 'wrong' },
      { question_id: 'q1', answered_at: ISO(10), outcome: 'correct' }, // 已有身份：去重
      { question_id: 'q2', answered_at: ISO(70), outcome: 'skipped' },
    ])
    expect(merged.next.q1.map((r) => r.timestamp)).toEqual([ISO(60), ISO(50), ISO(40), ISO(30), ISO(20)])
    expect(merged.next.q1[0].outcome).toBe('wrong')
    expect(merged.next.q2).toEqual([{ childId: 'default', outcome: 'skipped', timestamp: ISO(70) }])
    expect(merged.changed).toBe(true)
  })
})

// ===== ③ word_appearances：并集吸收进软去重窗口 =====

describe('word_appearances 推侧 diff / 拉侧 merge', () => {
  it('#173 同一词多次远端出现只占一格，按最新出现排序且不改输入', () => {
    const rows = [{ word_id: 'a', appeared_at: 1 }, { word_id: 'b', appeared_at: 2 }, { word_id: 'a', appeared_at: 3 }]
    expect(mergeWordAppearances([{ wordId: 'old', childId: 'default', appearedAt: 0 }], rows).next.map((r) => r.wordId)).toEqual(['a', 'b', 'old'])
    expect(rows.map((r) => r.appeared_at)).toEqual([1, 2, 3])
  })

  it('#178 事件形：diff 出新出现，成员相同但出现时间变新也成行', () => {
    const shadow = [{ wordId: 'wa', childId: 'default', appearedAt: 1 }, { wordId: 'wb', childId: 'default', appearedAt: 2 }]
    const current = [{ wordId: 'wb', childId: 'default', appearedAt: 9999 }, { wordId: 'wc', childId: 'default', appearedAt: 9998 }, shadow[0]]
    const rows = diffWordAppearances(current, shadow)
    expect(rows).toEqual([{ child_id: 'default', word_id: 'wb', appeared_at: 9999 }, { child_id: 'default', word_id: 'wc', appeared_at: 9998 }])
  })

  it('merge 把远端出现吸收进清单头部（新→旧），已知词幂等不重记', () => {
    const local = [{ wordId: 'wa', childId: 'default', appearedAt: 700 }]
    const m1 = mergeWordAppearances(local, [
      { word_id: 'wb', appeared_at: 800 },
      { word_id: 'wa', appeared_at: 700 }, // 已在清单：不动
    ])
    expect(m1.next.map((r) => r.wordId)).toEqual(['wb', 'wa'])
    expect(m1.changed).toBe(true)
    const m2 = mergeWordAppearances(m1.next, [{ word_id: 'wb', appeared_at: 800 }])
    expect(m2.changed).toBe(false)
    expect(m2.next).toEqual(m1.next)
  })

  it('清单外的旧词再收到新出现记录 → 吸收回清单（保守防重）', () => {
    const local: WordAppearance[] = [] // wa 早已不在清单（出窗）
    const m = mergeWordAppearances(local, [{ word_id: 'wa', appeared_at: 950 }])
    expect(m.next.map((r) => r.wordId)).toEqual(['wa'])
    expect(m.changed).toBe(true)
  })

  it('#173 清单上限 30：吸收后超过上限截尾（保留最新 30 词）', () => {
    const local = Array.from({ length: 30 }, (_, i) => ({ wordId: `old${i}`, childId: 'default', appearedAt: -i }))
    const m = mergeWordAppearances(local, [
      { word_id: 'new1', appeared_at: 100 },
      { word_id: 'new2', appeared_at: 200 },
    ])
    expect(m.next.map((r) => r.wordId)).toEqual(['new2', 'new1', ...local.map((r) => r.wordId)].slice(0, 30))
    expect(m.next).toHaveLength(30)
    expect(m.next.map((r) => r.wordId)).toContain('new2')
    expect(m.next.map((r) => r.wordId)).toContain('new1')
    expect(m.next.map((r) => r.wordId)).not.toContain('old29') // 最旧者出窗
  })
})

// ===== ④ reward_items：记录级 LWW + 墓碑 =====

describe('reward_items 推侧 diff', () => {
  it('新增/变更条目 → 行带注入时间戳与写者；未变条目不成行', () => {
    const shadow: RewardItemRow[] = [rewardRow('r1', 100, '旧名'), rewardRow('r2', 100)]
    const rows = diffRewardItems([reward('r1', '新名'), reward('r2'), reward('r3')], shadow, 2000, 'dev-b')
    expect(rows.length).toBe(2)
    expect(rows).toContainEqual({ id: 'r1', name: '新名', price: 3, requirement: null, updated_at: 2000, updated_by: 'dev-b', deleted: 0 })
    expect(rows).toContainEqual({ id: 'r3', name: '奖励', price: 3, requirement: null, updated_at: 2000, updated_by: 'dev-b', deleted: 0 })
  })

  it('本地删除（影子有、当前无）→ 墓碑行（deleted=1，携带影子字段）', () => {
    const rows = diffRewardItems([reward('r2')], [rewardRow('r1', 100, '旧名'), rewardRow('r2', 100)], 3000, 'dev-b')
    expect(rows).toEqual([{ id: 'r1', name: '旧名', price: 3, updated_at: 3000, updated_by: 'dev-b', deleted: 1 }])
  })

  it('已墓碑条目不再重复出墓碑；重建（当前重新出现）→ deleted=0 行', () => {
    expect(diffRewardItems([], [rewardRow('r1', 100, '旧名', 1)], 4000, 'dev-b')).toEqual([])
    const rows = diffRewardItems([reward('r1')], [rewardRow('r1', 100, '旧名', 1)], 5000, 'dev-b')
    expect(rows).toEqual([{ id: 'r1', name: '奖励', price: 3, requirement: null, updated_at: 5000, updated_by: 'dev-b', deleted: 0 }])
  })
})

describe('reward_items 拉侧 merge（LWW 裁决）', () => {
  it('云端 updated_at 更新 → 落地覆写；更旧 → 跳过保本地（随后推送自会胜出）', () => {
    const local = [reward('r1', '本地新版')]
    const known = [rewardRow('r1', 100, '旧版')]
    const m = mergeRewardItems(local, [
      { id: 'r1', name: '更旧版', price: 3, updated_at: 50, updated_by: 'dev-x', deleted: 0 },
      { id: 'r2', name: '远端新增', price: 8, updated_at: 900, updated_by: 'dev-x', deleted: 0 },
    ], known)
    expect(m.next.find((r) => r.id === 'r1')).toEqual({ id: 'r1', name: '本地新版', price: 3 })
    expect(m.next.find((r) => r.id === 'r2')).toEqual({ id: 'r2', name: '远端新增', price: 8 })
    expect(m.appliedRows.map((r) => r.id)).toEqual(['r2'])
  })

  it('云端墓碑（updated_at 更新）→ 本地删除并进影子；墓碑更旧 → 本地保留', () => {
    const m = mergeRewardItems([reward('r1')], [
      { id: 'r1', name: 'x', price: 3, updated_at: 900, updated_by: 'dev-x', deleted: 1 },
    ], [rewardRow('r1', 100)])
    expect(m.next).toEqual([])
    expect(m.nextShadow.find((r) => r.id === 'r1')?.deleted).toBe(1)

    const keep = mergeRewardItems([reward('r1')], [
      { id: 'r1', name: 'x', price: 3, updated_at: 50, updated_by: 'dev-x', deleted: 1 },
    ], [rewardRow('r1', 100)])
    expect(keep.next).toEqual([reward('r1')])
  })

  it('平手（updated_at 相等）→ 云端胜（与 worker 严格大于覆写互补成收敛闭环）', () => {
    const m = mergeRewardItems([reward('r1', '本地')], [
      { id: 'r1', name: '云端', price: 3, updated_at: 100, updated_by: 'dev-x', deleted: 0 },
    ], [rewardRow('r1', 100, '旧版')])
    expect(m.next.find((r) => r.id === 'r1')?.name).toBe('云端')
  })

  it('known 含待推 outbox 行（本机更新未上云）→ 以 outbox 为裁决基准，云端更旧不落地', () => {
    const outboxRow: RewardItemRow = { id: 'r1', name: '本机待推', price: 3, updated_at: 5000, updated_by: 'dev-b', deleted: 0 }
    const m = mergeRewardItems([reward('r1', '本机待推')], [
      { id: 'r1', name: '云端旧', price: 3, updated_at: 4000, updated_by: 'dev-x', deleted: 0 },
    ], [outboxRow])
    expect(m.next).toEqual([reward('r1', '本机待推')])
    expect(m.appliedRows).toEqual([])
  })
})

// ===== ⑤ proposals：LWW × 修订即认同（整行后写胜） =====

describe('proposals 推拉（字段映射 + 修订即认同场景）', () => {
  it('diff：camelCase → snake_case 全列映射；未变不成行', () => {
    const rows = diffProposals([proposal('p1', 900)], [], 2000, 'dev-b')
    expect(rows).toEqual([{
      id: 'p1', child_id: 'default', name: '乐高', price: 100, status: 'discussing',
      created_at: 900, updated_at: 2000, description: '想要一盒',
      parent_status: 'notAgreed', child_status: 'agreed', initiator: 'child',
      last_action_by: 'child', last_action_kind: 'proposed', updated_by: 'dev-b', deleted: 0,
    }])
    const shadowRows = rows as ProposalRow[]
    expect(diffProposals([proposal('p1', 900)], shadowRows, 3000, 'dev-b')).toEqual([])
  })

  it('#303 emoji：仅改 emoji 产生待推 diff；NULL/缺省 ≡ 🎁 等价不成行；行映射保真传递、拉侧缺省不落键', () => {
    // 本地无 emoji（存量行）→ 行不落 emoji 键（保真，云端落 NULL）
    const base = diffProposals([proposal('p1', 900)], [], 2000, 'dev-b')
    expect(base[0]).not.toHaveProperty('emoji')

    // 规范化等价：影子无 emoji vs 本地 '🎁'（读取兜底口径）→ 等价，不产生待推 diff
    expect(diffProposals([proposal('p1', 900, { emoji: '🎁' })], base as ProposalRow[], 3000, 'dev-b')).toEqual([])

    // 仅改 emoji → 待推 diff 成行，携带新值（LWW 语义不变，整行后写胜）
    const changed = diffProposals([proposal('p1', 900, { emoji: '🍕' })], base as ProposalRow[], 4000, 'dev-b')
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ id: 'p1', emoji: '🍕', updated_at: 4000 })

    // 拉侧：远端行带 emoji 落地；缺省/NULL 行不落 emoji 键（读取侧统一兜底 🎁）
    const m1 = mergeProposals([], [{ ...base[0], updated_at: 5000, emoji: '🍕' }], [])
    expect(m1.next[0].emoji).toBe('🍕')
    const m2 = mergeProposals([], [{ ...base[0], updated_at: 5000 }], [])
    expect(m2.next[0]).not.toHaveProperty('emoji')
    const m3 = mergeProposals([], [{ ...base[0], updated_at: 5000, emoji: null as unknown as string }], [])
    expect(m3.next[0]).not.toHaveProperty('emoji')
  })

  it('修订即认同场景：A 修订（updatedAt 更新、修订方自动同意、对方重置）→ B 拉取整行落地——后写方即修订方，先写方需重新表态', () => {
    // 设备 B 本地：孩子已同意、家长未同意（旧版）
    const bLocal = [proposal('p1', 1000, { parentStatus: 'notAgreed', childStatus: 'agreed' })]
    // 设备 A 修订：家长改价格并自动同意、孩子重置未同意（写侧联动已完成，行整体后写胜）
    const aRevision: ProposalRow = {
      id: 'p1', name: '乐高（改）', price: 120, status: 'discussing',
      created_at: 900, updated_at: 5000, description: '想要一盒',
      parent_status: 'agreed', child_status: 'notAgreed', initiator: 'child',
      last_action_by: 'parent', last_action_kind: 'changed', updated_by: 'dev-a', deleted: 0,
    }
    const m = mergeProposals(bLocal, [aRevision], [{
      ...aRevision, updated_at: 1000, name: '乐高', price: 100,
      parent_status: 'notAgreed', child_status: 'agreed', last_action_by: 'child', last_action_kind: 'proposed',
    }])
    expect(m.next).toHaveLength(1)
    expect(m.next[0]).toMatchObject({ price: 120, parentStatus: 'agreed', childStatus: 'notAgreed', lastActionBy: 'parent', lastActionKind: 'changed' })
  })

  it('物理删除（deleteProposal）→ 墓碑传播：对端拉取后本地移除', () => {
    const shadowRow: ProposalRow = {
      id: 'p9', name: '已作废提议', price: 10, status: 'voided',
      created_at: 100, updated_at: 200, description: '',
      parent_status: 'agreed', child_status: 'agreed', initiator: 'parent',
      last_action_by: 'parent', last_action_kind: 'proposed', updated_by: 'dev-a', deleted: 0,
    }
    const tomb = diffProposals([], [shadowRow], 3000, 'dev-a')
    expect(tomb[0].deleted).toBe(1)
    expect(tomb[0].updated_at).toBe(3000)

    const m = mergeProposals([{
      id: 'p9', name: '已作废提议', price: 10, status: 'voided', createdAt: 100, updatedAt: 200, description: '',
      parentStatus: 'agreed', childStatus: 'agreed', initiator: 'parent', lastActionBy: 'parent', lastActionKind: 'proposed',
    }], [tomb[0]], [shadowRow])
    expect(m.next).toEqual([])
    expect(m.appliedRows.map((r) => r.id)).toEqual(['p9'])
  })
})

// ===== ⑥ active_redemptions：LWW + 核销/放弃墓碑 =====

describe('active_redemptions 推拉', () => {
  it('建档成行（本地无 updatedAt → 注入）；核销/放弃 → 墓碑；拉侧墓碑落地删除', () => {
    const rows = diffActiveRedemptions([redemption('ar1')], [], 6000, 'dev-b')
    expect(rows).toEqual([{ id: 'ar1', child_id: 'default', reward_id: 'r-1', name: '冰淇淋', emoji: '🍦', created_at: 500, updated_at: 6000, updated_by: 'dev-b', deleted: 0 }])

    const shadow = rows
    const tomb = diffActiveRedemptions([], shadow, 7000, 'dev-b')
    expect(tomb).toEqual([{ id: 'ar1', child_id: 'default', reward_id: 'r-1', name: '冰淇淋', emoji: '🍦', created_at: 500, updated_at: 7000, updated_by: 'dev-b', deleted: 1 }])

    const m = mergeActiveRedemptions([redemption('ar1')], [tomb[0]], shadow)
    expect(m.next).toEqual([])
  })

  it('拉侧远端新建券落地（跨设备可见）', () => {
    const m = mergeActiveRedemptions([], [
      { id: 'arX', reward_id: 'rX', name: '寿喜锅', emoji: '🍲', created_at: 50, updated_at: 60, updated_by: 'dev-a', deleted: 0 },
    ], [])
    expect(m.next).toEqual([{ id: 'arX', childId: 'default', rewardId: 'rX', name: '寿喜锅', emoji: '🍲', createdAt: 50 }])
  })
})

// ===== ⑦ question_flags：LWW + 取消标记墓碑 =====

describe('question_flags 推拉', () => {
  it('升旗成行（flaggedAt→flagged_at）；降旗 → 墓碑；拉侧墓碑移除本键', () => {
    const rows = diffQuestionFlags({ q1: { flaggedAt: 123 } }, [], 8000, 'dev-c')
    expect(rows).toEqual([{ child_id: 'default', question_id: 'q1', flagged_at: 123, updated_at: 8000, updated_by: 'dev-c', deleted: 0 }])

    const tomb = diffQuestionFlags({}, rows, 9000, 'dev-c')
    expect(tomb).toEqual([{ child_id: 'default', question_id: 'q1', flagged_at: 123, updated_at: 9000, updated_by: 'dev-c', deleted: 1 }])

    const m = mergeQuestionFlags({ q1: { flaggedAt: 123 } }, [tomb[0]], rows)
    expect(m.next).toEqual({})
  })

  it('拉侧远端升旗落地 / 墓碑更旧不动', () => {
    const m = mergeQuestionFlags({}, [
      { question_id: 'q7', flagged_at: 77, updated_at: 700, updated_by: 'dev-a', deleted: 0 },
    ], [])
    expect(m.next).toEqual({ q7: { flaggedAt: 77, childId: 'default' } })

    const keep = mergeQuestionFlags({ q7: { flaggedAt: 77 } }, [
      { question_id: 'q7', flagged_at: 77, updated_at: 100, updated_by: 'dev-a', deleted: 1 },
    ], [{ question_id: 'q7', flagged_at: 77, updated_at: 600, updated_by: 'dev-a', deleted: 0 }])
    expect(keep.next).toEqual({ q7: { flaggedAt: 77 } })
  })
})

// ===== ⑧ question_banks：整组 LWW（最后导入方胜） =====

describe('question_banks 推拉（整组胜）', () => {
  const bankA = [question('000001'), question('000002')]

  it('diff：影子空或整组内容变化 → 整组一行；内容未变 → 空', () => {
    const rows = diffQuestionBanks(bankA, null, 1000, 'dev-parent')
    expect(rows).toEqual([{ content: bankA, updated_at: 1000, updated_by: 'dev-parent' }])

    const shadow: QuestionBankRow = { content: bankA, updated_at: 900, updated_by: 'dev-parent' }
    expect(diffQuestionBanks(bankA, shadow, 2000, 'dev-parent')).toEqual([])

    const bankB = [question('000001'), question('000002'), question('000003')]
    expect(diffQuestionBanks(bankB, shadow, 3000, 'dev-parent')).toEqual([{ content: bankB, updated_at: 3000, updated_by: 'dev-parent' }])
  })

  it('拉侧整组 LWW：更新者整组替换；更旧不动；平手云端胜', () => {
    const newer: QuestionBankRow = { content: [question('000009')], updated_at: 5000, updated_by: 'dev-a' }
    const m = mergeQuestionBanks(bankA, newer, { content: bankA, updated_at: 1000, updated_by: 'dev-x' })
    expect(m.next).toEqual([question('000009')])
    expect(m.applied).toBe(true)

    const older: QuestionBankRow = { content: [question('000008')], updated_at: 500, updated_by: 'dev-a' }
    const keep = mergeQuestionBanks(m.next, older, newer)
    expect(keep.next).toEqual([question('000009')])
    expect(keep.applied).toBe(false)

    const tie: QuestionBankRow = { content: [question('000007')], updated_at: 5000, updated_by: 'dev-b' }
    const tieM = mergeQuestionBanks(m.next, tie, newer)
    expect(tieM.applied).toBe(true)
    expect(tieM.next).toEqual([question('000007')])
  })
})

// ===== 影子推进（推送成功后） =====

describe('entry_visibility 推拉（#262 逐入口键控 LWW：最后改动方胜；未设置 = 默认隐藏）', () => {
  it('diff：未设置（无条目）不出行（默认隐藏不是待推事实）；显式 false 也出行；与影子一致不出行', () => {
    expect(diffEntryVisibility({}, [], 1000, 'dev-a')).toEqual([])
    expect(diffEntryVisibility({}, [{ entry_id: 'e1', visible: 0, updated_at: 900, updated_by: 'dev-b' }], 1000, 'dev-a')).toEqual([])

    // 显式 false 也推：影子缺行视为不一致（「家长关掉」必须可传播）
    expect(diffEntryVisibility({ e1: false }, [], 1000, 'dev-a')).toEqual([
      { entry_id: 'e1', visible: 0, updated_at: 1000, updated_by: 'dev-a' },
    ])

    const shadow: EntryVisibilityRow[] = [{ entry_id: 'e1', visible: 0, updated_at: 900, updated_by: 'dev-a' }]
    expect(diffEntryVisibility({ e1: false }, shadow, 2000, 'dev-a')).toEqual([])

    expect(diffEntryVisibility({ e1: true }, shadow, 3000, 'dev-a')).toEqual([
      { entry_id: 'e1', visible: 1, updated_at: 3000, updated_by: 'dev-a' },
    ])

    // 多入口各自独立 diff
    const twoRows: EntryVisibilityRow[] = [
      { entry_id: 'e1', visible: 1, updated_at: 900, updated_by: 'dev-a' },
      { entry_id: 'e2', visible: 0, updated_at: 900, updated_by: 'dev-a' },
    ]
    expect(diffEntryVisibility({ e1: true, e2: true }, twoRows, 4000, 'dev-a')).toEqual([
      { entry_id: 'e2', visible: 1, updated_at: 4000, updated_by: 'dev-a' },
    ])
  })

  it('拉侧 LWW（逐入口）：新行落地、更旧不动、平手云端胜；known 空必落地；他入口行不串扰', () => {
    const known: EntryVisibilityRow[] = [{ entry_id: 'e1', visible: 0, updated_at: 1000, updated_by: 'dev-a' }]

    const newer: EntryVisibilityRow = { entry_id: 'e1', visible: 1, updated_at: 2000, updated_by: 'dev-b' }
    const m = mergeEntryVisibility({ e1: false }, [newer], known)
    expect(m.next).toEqual({ e1: true })
    expect(m.nextShadow).toEqual([newer])
    expect(m.changed).toBe(true)
    expect(m.appliedRows).toEqual([newer])

    const older: EntryVisibilityRow = { entry_id: 'e1', visible: 0, updated_at: 500, updated_by: 'dev-b' }
    const keep = mergeEntryVisibility(m.next, [older], known)
    expect(keep.next).toEqual({ e1: true })
    expect(keep.changed).toBe(false)
    expect(keep.appliedRows).toEqual([])

    const tie: EntryVisibilityRow = { entry_id: 'e1', visible: 0, updated_at: 2000, updated_by: 'dev-c' }
    const tieM = mergeEntryVisibility(m.next, [tie], [newer])
    expect(tieM.next).toEqual({ e1: false })
    expect(tieM.appliedRows).toEqual([tie])

    const firstArrival: EntryVisibilityRow = { entry_id: 'e1', visible: 0, updated_at: 1, updated_by: 'dev-x' }
    expect(mergeEntryVisibility({}, [firstArrival], []).next).toEqual({ e1: false })

    // 另一入口的行独立落地，不触碰 e1
    const otherEntry: EntryVisibilityRow = { entry_id: 'e2', visible: 1, updated_at: 3000, updated_by: 'dev-d' }
    const other = mergeEntryVisibility({ e1: true }, [otherEntry], [])
    expect(other.next).toEqual({ e1: true, e2: true })
    expect(other.nextShadow).toEqual([otherEntry])
  })

  it('拉侧多行（快照回放等场景）逐行裁决：旧行被同入口新行压过，他入口行独立落地', () => {
    const rows: EntryVisibilityRow[] = [
      { entry_id: 'e1', visible: 1, updated_at: 100, updated_by: 'old' },
      { entry_id: 'e1', visible: 0, updated_at: 300, updated_by: 'new' },
      { entry_id: 'e2', visible: 1, updated_at: 250, updated_by: 'mid' },
    ]
    const m = mergeEntryVisibility({ e1: true, e2: false }, rows, [{ entry_id: 'e1', visible: 1, updated_at: 200, updated_by: 'known' }])
    expect(m.next).toEqual({ e1: false, e2: true })
    expect(m.appliedRows).toEqual([rows[1], rows[2]])
    expect(m.nextShadow).toEqual([rows[1], rows[2]])
  })
})

describe('advanceShadowFromSent：推送成功后影子推进（sent 按 id 胜出）', () => {
  it('reward_items：影子被 sent 覆写并保留未涉及行（含墓碑）', () => {
    const shadow = [rewardRow('r1', 100), rewardRow('r2', 200, '保留', 1)]
    const sent: RewardItemRow[] = [{ id: 'r1', name: '新版', price: 3, updated_at: 999, updated_by: 'dev-b', deleted: 0 }]
    const next = advanceShadowFromSent('reward_items', shadow, sent) as RewardItemRow[]
    expect(next.find((r) => r.id === 'r1')?.updated_at).toBe(999)
    expect(next.find((r) => r.id === 'r2')?.deleted).toBe(1)
  })

  it('question_banks：整组行替换', () => {
    const sent: QuestionBankRow[] = [{ content: [question('000001')], updated_at: 42, updated_by: 'p' }]
    expect(advanceShadowFromSent('question_banks', null, sent)).toEqual(sent[0])
  })

  it('entry_visibility：sent 按入口 id 覆写影子（键控多行，#262）', () => {
    const sent: EntryVisibilityRow[] = [{ entry_id: 'e1', visible: 0, updated_at: 42, updated_by: 'dev-parent' }]
    expect(advanceShadowFromSent('entry_visibility', [], sent)).toEqual(sent)
    expect(advanceShadowFromSent('entry_visibility', [{ entry_id: 'e1', visible: 1, updated_at: 10, updated_by: 'old' }], sent)).toEqual(sent)
    // 未涉及入口行保留
    const keep: EntryVisibilityRow = { entry_id: 'e2', visible: 1, updated_at: 5, updated_by: 'keep' }
    expect(advanceShadowFromSent('entry_visibility', [keep], sent)).toEqual([keep, sent[0]])
  })

  // #278 限时通道：expires_at 随行推/拉全链路（diff 出行、LWW 落地、影子推进、缺新字段的旧行照常）
  it('#278 限时档 diff：限时条目出行带 expires_at；显隐与到期均未变不出行；布尔条目行不带新字段', () => {
    const EXPIRES = 1_800_000_000_000
    // 限时条目：影子缺行 → 出行带 expires_at
    expect(diffEntryVisibility({ e1: { visible: true, expires_at: EXPIRES } }, [], 1000, 'dev-a')).toEqual([
      { entry_id: 'e1', visible: 1, expires_at: EXPIRES, updated_at: 1000, updated_by: 'dev-a' },
    ])
    // 显隐与到期均未变 → 不出行（纯推导无写回：到期不触发重推）
    const known: EntryVisibilityRow[] = [{ entry_id: 'e1', visible: 1, expires_at: EXPIRES, updated_at: 900, updated_by: 'dev-a' }]
    expect(diffEntryVisibility({ e1: { visible: true, expires_at: EXPIRES } }, known, 1000, 'dev-a')).toEqual([])
    // 同显隐、到期改写（重想起算）→ 出行
    expect(diffEntryVisibility({ e1: { visible: true, expires_at: EXPIRES + 1 } }, known, 1000, 'dev-a')).toEqual([
      { entry_id: 'e1', visible: 1, expires_at: EXPIRES + 1, updated_at: 1000, updated_by: 'dev-a' },
    ])
    // 改档清到期（限时 → 保持开启）→ 出行且不带 expires_at
    expect(diffEntryVisibility({ e1: true }, known, 1000, 'dev-a')).toEqual([
      { entry_id: 'e1', visible: 1, updated_at: 1000, updated_by: 'dev-a' },
    ])
    // 布尔条目照旧：行不带 expires_at（旧行为零变化）
    expect(diffEntryVisibility({ e1: false }, [], 1000, 'dev-a')).toEqual([
      { entry_id: 'e1', visible: 0, updated_at: 1000, updated_by: 'dev-a' },
    ])
  })

  it('#278 限时档 merge：含 expires_at 行落地为限时对象（LWW、影子含到期）；缺新字段的旧行照常落地为布尔', () => {
    const EXPIRES = 1_800_000_000_000
    const known: EntryVisibilityRow[] = [{ entry_id: 'e1', visible: 0, updated_at: 1000, updated_by: 'dev-a' }]
    // 限时行落地：本地值变限时对象，影子整行含 expires_at
    const timedRow: EntryVisibilityRow = { entry_id: 'e1', visible: 1, expires_at: EXPIRES, updated_at: 2000, updated_by: 'dev-b' }
    const m = mergeEntryVisibility({ e1: false }, [timedRow], known)
    expect(m.next).toEqual({ e1: { visible: true, expires_at: EXPIRES } })
    expect(m.nextShadow).toEqual([timedRow])
    expect(m.changed).toBe(true)
    expect(m.appliedRows).toEqual([timedRow])
    // 缺新字段的旧行照常落地为布尔（存量形状零变化）
    const legacyRow: EntryVisibilityRow = { entry_id: 'e2', visible: 1, updated_at: 3000, updated_by: 'dev-c' }
    const legacy = mergeEntryVisibility(m.next, [legacyRow], m.nextShadow)
    expect(legacy.next).toEqual({ e1: { visible: true, expires_at: EXPIRES }, e2: true })
    // 更旧行不动
    const older: EntryVisibilityRow = { entry_id: 'e1', visible: 0, updated_at: 500, updated_by: 'dev-d' }
    expect(mergeEntryVisibility(legacy.next, [older], legacy.nextShadow).next).toEqual(legacy.next)
  })

  it('流水域（star_entries 等）不经此函数推进（引擎取当前态快照），原样返回影子', () => {
    const shadow = [entry('s1')]
    expect(advanceShadowFromSent('star_entries', shadow, [
      { id: 's2', timestamp: 5, type: 'earn', amount: 1, source: 'x' },
    ])).toBe(shadow)
  })
})
