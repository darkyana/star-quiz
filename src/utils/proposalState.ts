// 提议状态机（R32 新增，Spec 20260827-R32 §REQ-R32-5）：纯函数，无副作用、不碰 localStorage
import type {
  ProposalRecord,
  ProposalStatus,
  ProposalPublishState,
  ProposalInitiator,
} from '../types'

/** 提议图标缺省值（#299 读取侧唯一兜底语义：无 emoji 一律视作 🎁，不物理迁移）。
 *  收口到本纯函数模块（#303）：composables（useProposals 转发导出）与同步合并器（cloud/merge 等价比较）共用单一出处。 */
export const PROPOSAL_EMOJI_DEFAULT = '🎁'

// deriveState 的推导结果：整体状态 + 发布状态（REQ-R32-5-3）
export interface ProposalDerivedState {
  status: ProposalStatus
  publishState: ProposalPublishState
}

/** 整体状态与发布状态推导：任一方未同意 → 沟通中 / 不可发布；双方同意 → 已达成一致 / 可发布；终态原样保留且发布状态 N/A */
export function deriveState(proposal: ProposalRecord): ProposalDerivedState {
  if (proposal.status === 'published' || proposal.status === 'voided') {
    return { status: proposal.status, publishState: 'none' }
  }
  if (proposal.parentStatus === 'agreed' && proposal.childStatus === 'agreed') {
    return { status: 'agreed', publishState: 'ready' }
  }
  return { status: 'discussing', publishState: 'blocked' }
}

/** 内容变更（REQ-R32-5-4；2026-08-30 老板拍板语义修订）：**改动方自动同意新版本**（修改提案即认同自己改后的内容）、另一方自动重置为未同意（需对新版本重新表态）；非终态整体状态随双开关重新推导；返回新对象不修改入参 */
export function onContentChange(proposal: ProposalRecord, changedBy: ProposalInitiator): ProposalRecord {
  const next: ProposalRecord = { ...proposal }
  if (changedBy === 'parent') {
    next.parentStatus = 'agreed'
    next.childStatus = 'notAgreed'
  } else {
    next.childStatus = 'agreed'
    next.parentStatus = 'notAgreed'
  }
  next.status = deriveState(next).status
  return next
}

/** 发布门槛：仅非终态且双方已同意时可发布（发布不可撤销，作废不可恢复） */
export function canPublish(proposal: ProposalRecord): boolean {
  return deriveState(proposal).publishState === 'ready'
}

// ===== 答案卡（#66 提议卡视图：提议卡渲染所需全部判定的单一派生出口，术语见 CONTEXT.md「提议卡视图」）=====

/** 是否终态（已发布 / 已作废，状态机 D1/D7；#66 终态判定统一出口，全站共用） */
export function isTerminal(proposal: ProposalRecord): boolean {
  return proposal.status === 'published' || proposal.status === 'voided'
}

/** 阵营文案状态（判定枚举，页面查 copy 映射文案；计算器不依赖 copy、不直接给文案）：
 *  notAgreed 还在考虑 / proposed 刚刚提议 / changed 已修改提议 / agreed 已点头 */
export type ProposalCampState = 'notAgreed' | 'proposed' | 'changed' | 'agreed'

/** 右上角徽章种别：done 已谈成（绿）/ voided 已作废（红）/ none 不出现 */
export type ProposalBadgeKind = 'done' | 'voided' | 'none'

/** 提议卡视图：提议卡渲染所需全部判定（双侧阵营文案状态、终态、徽章、发布门槛就绪）的现算只读视图；
 *  纯函数派生、不落盘、不碰 copy。终态时阵营文案整块不显示（camp 两字段不消费，恒 notAgreed 占位） */
export interface ProposalCardView {
  parentCamp: ProposalCampState
  childCamp: ProposalCampState
  terminal: boolean
  badge: ProposalBadgeKind
  publishReady: boolean
}

/** 答案卡单一派生出口（#66 阵营判定规格，2026-08-30 老板拍板，按侧判定）：
 *  该侧未同意 → 还在考虑；已同意且最后动作＝自己新建 → 刚刚提议、＝自己修改 → 已修改提议（修订即认同）；
 *  其余（点过同意 / 最后动作在对方）→ 已点头（默认归宿：该侧此刻同意着、且最后动作不是自己刚新建/修改）；
 *  双方都同意（无论谁最后动的）→ 两侧已点头 + 绿徽章已谈成；
 *  终态 → 阵营整块不显示、已作废红徽章（已发布不进列表，徽章 none）、门槛就绪 false */
export function deriveCardView(proposal: ProposalRecord): ProposalCardView {
  if (isTerminal(proposal)) {
    return {
      parentCamp: 'notAgreed',
      childCamp: 'notAgreed',
      terminal: true,
      badge: proposal.status === 'voided' ? 'voided' : 'none',
      publishReady: false,
    }
  }
  const bothAgreed = proposal.parentStatus === 'agreed' && proposal.childStatus === 'agreed'
  const campFor = (side: ProposalInitiator): ProposalCampState => {
    const agreed = side === 'parent' ? proposal.parentStatus === 'agreed' : proposal.childStatus === 'agreed'
    if (!agreed) return 'notAgreed'
    if (bothAgreed) return 'agreed' // 双方都同意：无论谁最后动的，两侧「已点头」
    if (proposal.lastActionBy === side && proposal.lastActionKind === 'proposed') return 'proposed'
    if (proposal.lastActionBy === side && proposal.lastActionKind === 'changed') return 'changed'
    return 'agreed'
  }
  return {
    parentCamp: campFor('parent'),
    childCamp: campFor('child'),
    terminal: false,
    badge: bothAgreed ? 'done' : 'none',
    publishReady: canPublish(proposal),
  }
}
