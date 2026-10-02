/**
 * R32 提议状态机单测（Spec 20260827-R32 REQ-R32-5 / AC-R32-6）
 * deriveState / onContentChange / canPublish 全矩阵行为验证（纯函数，无 localStorage 依赖）。
 * #66（2026-08-30）：新增 isTerminal 终态统一出口 + deriveCardView 提议卡视图判定表全枚举
 * （新建/修改/点头/收回点头 × 两侧 × 双方同意徽章 × 终态边界；页面只查 copy 渲染，判定矩阵钉在此处）。
 */
import { describe, it, expect } from 'vitest'
import {
  deriveState,
  onContentChange,
  canPublish,
  isTerminal,
  deriveCardView,
  type ProposalCampState,
  type ProposalBadgeKind,
} from '../proposalState'
import type { ProposalRecord, ProposalAgreement, ProposalInitiator, ProposalActionKind } from '../../types'

function makeProposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: 'p-1',
    name: '菠萝油',
    price: 5,
    status: 'discussing',
    createdAt: 1724140800000,
    updatedAt: 1724140800000,
    description: '周末早餐吃',
    parentStatus: 'notAgreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

describe('deriveState 整体状态与发布状态推导（REQ-R32-5-3 全矩阵）', () => {
  it('家长未同意 + 孩子未同意 → 沟通中 / 不可发布', () => {
    const p = makeProposal({ parentStatus: 'notAgreed', childStatus: 'notAgreed' })
    expect(deriveState(p)).toEqual({ status: 'discussing', publishState: 'blocked' })
  })

  it('家长已同意 + 孩子未同意 → 沟通中 / 不可发布', () => {
    const p = makeProposal({ parentStatus: 'agreed', childStatus: 'notAgreed' })
    expect(deriveState(p)).toEqual({ status: 'discussing', publishState: 'blocked' })
  })

  it('家长未同意 + 孩子已同意 → 沟通中 / 不可发布', () => {
    const p = makeProposal({ parentStatus: 'notAgreed', childStatus: 'agreed' })
    expect(deriveState(p)).toEqual({ status: 'discussing', publishState: 'blocked' })
  })

  it('双方都已同意 → 已达成一致 / 可发布（非终态 status 以双开关推导为准）', () => {
    const p = makeProposal({ status: 'discussing', parentStatus: 'agreed', childStatus: 'agreed' })
    expect(deriveState(p)).toEqual({ status: 'agreed', publishState: 'ready' })
  })

  it('终态已发布：双开关取值不影响结果 → 已发布 / N/A', () => {
    const p = makeProposal({ status: 'published', parentStatus: 'agreed', childStatus: 'agreed' })
    expect(deriveState(p)).toEqual({ status: 'published', publishState: 'none' })
  })

  it('终态已作废 → 已作废 / N/A', () => {
    const p = makeProposal({ status: 'voided' })
    expect(deriveState(p)).toEqual({ status: 'voided', publishState: 'none' })
  })
})

describe('onContentChange 内容变更：改动方自动同意新版本、对方重置（REQ-R32-5-4；2026-08-30 拍板修订）', () => {
  it('家长改动（原本已同意）：家长保持同意、孩子同意被重置为未同意', () => {
    const before = makeProposal({ status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })
    const after = onContentChange(before, 'parent')
    expect(after.parentStatus).toBe('agreed')
    expect(after.childStatus).toBe('notAgreed')
  })

  it('家长改动后整体状态回到沟通中（非终态 status 随双开关同步）', () => {
    const before = makeProposal({ status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })
    expect(onContentChange(before, 'parent').status).toBe('discussing')
  })

  it('家长改动（原本未同意，如家长修订孩子的新提议）：改动方自动同意新版本，无需再点一遍同意（2026-08-30 老板拍板）', () => {
    const before = makeProposal({ parentStatus: 'notAgreed', childStatus: 'agreed' })
    const after = onContentChange(before, 'parent')
    expect(after.parentStatus).toBe('agreed') // 修改即认同自己改后的内容
    expect(after.childStatus).toBe('notAgreed') // 对方对新版本重新表态
    expect(after.status).toBe('discussing')
  })

  it('孩子改动（R34 方向）：孩子同意（自动/保持）、家长同意被重置为未同意', () => {
    const before = makeProposal({ status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })
    const after = onContentChange(before, 'child')
    expect(after.childStatus).toBe('agreed')
    expect(after.parentStatus).toBe('notAgreed')
    expect(after.status).toBe('discussing')
  })

  it('纯函数：返回新对象，不修改传入的提议', () => {
    const before = makeProposal({ status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })
    onContentChange(before, 'parent')
    expect(before.parentStatus).toBe('agreed')
    expect(before.childStatus).toBe('agreed')
    expect(before.status).toBe('agreed')
  })
})

describe('canPublish 发布门槛（REQ-R32-5-3）', () => {
  it('非终态双方已同意 → 可发布', () => {
    const p = makeProposal({ status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' })
    expect(canPublish(p)).toBe(true)
  })

  it('任一方未同意 → 不可发布（家长未同意 / 孩子未同意两例）', () => {
    expect(canPublish(makeProposal({ parentStatus: 'notAgreed', childStatus: 'agreed' }))).toBe(false)
    expect(canPublish(makeProposal({ parentStatus: 'agreed', childStatus: 'notAgreed' }))).toBe(false)
  })

  it('已发布终态 → 不可发布（发布不可撤销）', () => {
    const p = makeProposal({ status: 'published', parentStatus: 'agreed', childStatus: 'agreed' })
    expect(canPublish(p)).toBe(false)
  })

  it('已作废终态 → 不可发布', () => {
    expect(canPublish(makeProposal({ status: 'voided' }))).toBe(false)
  })
})

// ===== #66 提议卡视图（deriveCardView 答案卡单一派生出口 + isTerminal 终态统一出口）=====

/** #66 阵营判定表（2026-08-30 老板拍板）全枚举：最后动作 × 两侧 × 双方同意 × 终态边界。
 *  每行给齐双侧 camp 枚举 / 徽章 / 门槛就绪的期望值，页面文案断言只做渲染接线。 */
const CAMP_MATRIX: Array<{
  name: string
  parentStatus: ProposalAgreement
  childStatus: ProposalAgreement
  lastActionBy: ProposalInitiator
  lastActionKind: ProposalActionKind
  parentCamp: ProposalCampState
  childCamp: ProposalCampState
  badge: ProposalBadgeKind
  publishReady: boolean
}> = [
  // 新建：动手方「刚刚提议」、另一方未表态「还在考虑」
  {
    name: '新建（家长发起）：家长「刚刚提议」、孩子「还在考虑」',
    parentStatus: 'agreed', childStatus: 'notAgreed', lastActionBy: 'parent', lastActionKind: 'proposed',
    parentCamp: 'proposed', childCamp: 'notAgreed', badge: 'none', publishReady: false,
  },
  {
    name: '新建（孩子发起）：孩子「刚刚提议」、家长「还在考虑」',
    parentStatus: 'notAgreed', childStatus: 'agreed', lastActionBy: 'child', lastActionKind: 'proposed',
    parentCamp: 'notAgreed', childCamp: 'proposed', badge: 'none', publishReady: false,
  },
  // 修改内容：动手方「已修改提议」（修订即认同：改=同意新版）、对方自动重置「还在考虑」
  {
    name: '修改内容（家长修订）：家长「已修改提议」、孩子「还在考虑」',
    parentStatus: 'agreed', childStatus: 'notAgreed', lastActionBy: 'parent', lastActionKind: 'changed',
    parentCamp: 'changed', childCamp: 'notAgreed', badge: 'none', publishReady: false,
  },
  {
    name: '修改内容（孩子修订）：孩子「已修改提议」、家长「还在考虑」',
    parentStatus: 'notAgreed', childStatus: 'agreed', lastActionBy: 'child', lastActionKind: 'changed',
    parentCamp: 'notAgreed', childCamp: 'changed', badge: 'none', publishReady: false,
  },
  // 点头：对方原本没表态 → 动手方「已点头」、对方维持「还在考虑」
  {
    name: '点头（家长点头、对方原本没表态）',
    parentStatus: 'agreed', childStatus: 'notAgreed', lastActionBy: 'parent', lastActionKind: 'agreed',
    parentCamp: 'agreed', childCamp: 'notAgreed', badge: 'none', publishReady: false,
  },
  {
    name: '点头（孩子点头、对方原本没表态）',
    parentStatus: 'notAgreed', childStatus: 'agreed', lastActionBy: 'child', lastActionKind: 'agreed',
    parentCamp: 'notAgreed', childCamp: 'agreed', badge: 'none', publishReady: false,
  },
  // 收回点头：动手方回「还在考虑」、对方维持原样（仍同意 → 已点头）
  {
    name: '收回点头（家长收回、孩子维持已同意 → 孩子已点头）',
    parentStatus: 'notAgreed', childStatus: 'agreed', lastActionBy: 'parent', lastActionKind: 'rethought',
    parentCamp: 'notAgreed', childCamp: 'agreed', badge: 'none', publishReady: false,
  },
  {
    name: '收回点头（孩子收回、家长维持已同意 → 家长已点头）',
    parentStatus: 'agreed', childStatus: 'notAgreed', lastActionBy: 'child', lastActionKind: 'rethought',
    parentCamp: 'agreed', childCamp: 'notAgreed', badge: 'none', publishReady: false,
  },
  // 双方都同意（无论谁最后动的）→ 两侧「已点头」+ 绿徽章「已谈成」+ 门槛就绪
  {
    name: '双方同意（最后动作＝家长点头）：两侧已点头 + 绿徽章 + 门槛就绪',
    parentStatus: 'agreed', childStatus: 'agreed', lastActionBy: 'parent', lastActionKind: 'agreed',
    parentCamp: 'agreed', childCamp: 'agreed', badge: 'done', publishReady: true,
  },
  {
    name: '双方同意（最后动作＝孩子修订）：无论谁最后动的均两侧已点头 + 绿徽章',
    parentStatus: 'agreed', childStatus: 'agreed', lastActionBy: 'child', lastActionKind: 'changed',
    parentCamp: 'agreed', childCamp: 'agreed', badge: 'done', publishReady: true,
  },
]

describe('deriveCardView 阵营判定表（#66 答案卡单一出口，判定矩阵全枚举钉在计算器）', () => {
  it.each(CAMP_MATRIX)('$name', (row) => {
    const view = deriveCardView(
      makeProposal({
        status: 'discussing',
        parentStatus: row.parentStatus,
        childStatus: row.childStatus,
        lastActionBy: row.lastActionBy,
        lastActionKind: row.lastActionKind,
      }),
    )
    expect(view.parentCamp).toBe(row.parentCamp)
    expect(view.childCamp).toBe(row.childCamp)
    expect(view.badge).toBe(row.badge)
    expect(view.publishReady).toBe(row.publishReady)
    expect(view.terminal).toBe(false)
  })
})

describe('deriveCardView 终态边界 + isTerminal 统一出口（#66）', () => {
  it('已作废：terminal true、红徽章 voided、双侧 camp 恒 notAgreed 占位（整块不消费）、门槛就绪 false', () => {
    expect(deriveCardView(makeProposal({ status: 'voided' }))).toEqual({
      parentCamp: 'notAgreed',
      childCamp: 'notAgreed',
      terminal: true,
      badge: 'voided',
      publishReady: false,
    })
  })

  it('已发布：terminal true、徽章 none（已发布不进列表）、门槛就绪 false', () => {
    expect(deriveCardView(makeProposal({ status: 'published', parentStatus: 'agreed', childStatus: 'agreed' }))).toEqual({
      parentCamp: 'notAgreed',
      childCamp: 'notAgreed',
      terminal: true,
      badge: 'none',
      publishReady: false,
    })
  })

  it('isTerminal 统一出口：discussing / agreed 非终态，published / voided 终态（全站共用）', () => {
    expect(isTerminal(makeProposal({ status: 'discussing' }))).toBe(false)
    expect(isTerminal(makeProposal({ status: 'agreed', parentStatus: 'agreed', childStatus: 'agreed' }))).toBe(false)
    expect(isTerminal(makeProposal({ status: 'published' }))).toBe(true)
    expect(isTerminal(makeProposal({ status: 'voided' }))).toBe(true)
  })
})
