// 提议域数据模块（R32 T2 骨架 + T3 增量动作，Spec 20260827-R32 §REQ-R32-6/3/5/7）：
// 拥有提议板数据键 sq_proposals，存储口径为 ProposalRecord（不含派生字段 publishState，自主决策 #1）。
// R34（Spec 20260828-R34 T2）双端化：create 增发起人参数（孩子新建自动同意自己）、
// setAgreed 双端表态（改造自 R32 setChildAgreed，按角色写各自开关）、update 修订方向参数化；
// voidProposal / publish 签名与行为零改动（发布作废仍家长专属，页面层控制）。
// 发布门禁收口（架构评审 20260829，术语见 CONTEXT.md）：publishGate 单一判定 = 发布门槛，
// 页面渲染与 publish 动作共用；发布窗口已随 #265 删除，门槛就绪即任意时刻可发布。
// 状态推导一律复用 utils/proposalState.ts 纯函数，本模块不重复推导逻辑。
// 存储读写走 useDataInfra 原语（沿 useStarData 模式）。

import type { ProposalRecord, ProposalInitiator, RewardItem } from '../types'
import { DEFAULT_CHILD_ID } from '../types'
import { STORAGE_KEYS, readValue, writeValue, readRawValue, registerDataDefaults, registerMigrations } from './useDataInfra'
import { deriveState, onContentChange, canPublish, isTerminal, PROPOSAL_EMOJI_DEFAULT } from '../utils/proposalState'
import { rewards, appendReward } from './useStarData'

/** 提议内容四字段（新建 / 编辑表单输入，REQ-R32-3-1；#299 emoji 可选、缺省 🎁 由表单层兜底） */
export interface ProposalInput {
  name: string
  price: number
  description: string
  emoji?: string
}

/** 提议图标缺省值（#299 读取侧唯一兜底语义：无 emoji 一律视作 🎁，不物理迁移）。
 *  定义收口至纯函数模块 utils/proposalState（#303，同步合并器共用），此处转发导出保既有引用稳定。 */
export { PROPOSAL_EMOJI_DEFAULT }

/** 提议图标读取出口（#299）：存量无 emoji 兜底 🎁；展示 / 编辑回填 / 发布携带统一走此处 */
export function proposalEmoji(proposal: ProposalRecord): string {
  return proposal.emoji ?? PROPOSAL_EMOJI_DEFAULT
}

/** 发布校验 seam（REQ-R32-7-4）：默认空实现恒通过；未来同名检查挂此处 */
export type PublishValidator = (proposal: ProposalRecord, currentRewards: RewardItem[]) => boolean

/** 发布门禁结果（CONTEXT.md「发布门禁」= 发布门槛）：not_publishable = 任一方未同意或终态 */
export type PublishGateResult = { allowed: true } | { allowed: false; reason: 'not_publishable' }

/** 发布结果：not_found = 无此提议 / not_publishable = 任一方未同意或终态 / rejected = 校验 seam 拒绝 */
export type PublishResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_publishable' | 'rejected' }

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 同步 / 导出用全孩提议容器（每次读取返回新数组）。 */
export function allProposals(): ProposalRecord[] {
  return readValue<ProposalRecord[]>(STORAGE_KEYS.proposals)
}

/** 业务提议视图：缺省默认孩子，旧行缺少归属仍视为默认孩子。 */
export function proposals(childId: string = DEFAULT_CHILD_ID): ProposalRecord[] {
  return allProposals().filter((p) => (p.childId ?? DEFAULT_CHILD_ID) === childId)
}

/** 提议列表整组写入（经济文件导入覆盖式替换场景） */
export function writeProposals(next: ProposalRecord[]): void {
  writeValue(STORAGE_KEYS.proposals, next)
}

/** 默认孩子的业务动作共用身份定位，避免同 id 的其他孩子被操作。 */
function defaultProposalIndex(list: ProposalRecord[], id: string): number {
  return list.findIndex((p) => p.id === id && (p.childId ?? DEFAULT_CHILD_ID) === DEFAULT_CHILD_ID)
}

/** 生成不与既有提议撞号的新 id */
function newProposalId(list: ProposalRecord[]): string {
  const existingIds = new Set(list.map((p) => p.id))
  let id = uuid()
  while (existingIds.has(id)) id = uuid()
  return id
}

/** 新建提议（REQ-R32-3-2 / R34 REQ-R34-3）：追加 1 条——id 新生成、发起人自动同意自己、另一方未同意、整体沟通中、createdAt / updatedAt 同为写入时刻；opts.initiator 缺省 parent（R32 既有调用兼容） */
export function create(
  input: ProposalInput,
  opts: { initiator: ProposalInitiator } = { initiator: 'parent' },
): ProposalRecord {
  const list = allProposals()
  const now = Date.now()
  const record: ProposalRecord = {
    id: newProposalId(list),
    name: input.name,
    price: input.price,
    description: input.description,
    status: 'discussing',
    createdAt: now,
    updatedAt: now,
    parentStatus: opts.initiator === 'parent' ? 'agreed' : 'notAgreed',
    childStatus: opts.initiator === 'child' ? 'agreed' : 'notAgreed',
    initiator: opts.initiator,
    lastActionBy: opts.initiator,
    lastActionKind: 'proposed',
    childId: DEFAULT_CHILD_ID, // #173 数据行挂孩子维度（现阶段恒默认孩子）
    ...(input.emoji !== undefined ? { emoji: input.emoji } : {}), // #299 可选：不传不落键，零迁移
  }
  writeProposals([...list, record])
  return record
}

/** 编辑内容（REQ-R32-3-3 / R34 REQ-R34-5 修订方向参数化；2026-08-30 拍板修订）：仅非终态可改；内容更新 + **改动方自动同意新版本**、对方重置未同意（onContentChange）、updatedAt 刷新、整体状态重推导；终态或不存在 → false 零变更；changedBy 缺省 parent（R32 既有调用兼容）。
 *  #299：emoji 属提议内容——改 emoji 与改名称/消耗/说明同走本出口（修订即认同单一语义，无字段豁免）；input 未携带 emoji 键时不改既有值 */
export function update(id: string, input: ProposalInput, changedBy: ProposalInitiator = 'parent'): boolean {
  const list = allProposals()
  const index = defaultProposalIndex(list, id)
  if (index === -1 || isTerminal(list[index])) return false
  const { emoji, ...content } = input
  const merged = { ...list[index], ...content, ...(emoji !== undefined ? { emoji } : {}) }
  const next = onContentChange(merged, changedBy)
  next.updatedAt = Date.now()
  next.lastActionBy = changedBy
  next.lastActionKind = 'changed'
  list[index] = next
  writeProposals(list)
  return true
}

/** 双端表态（R34 REQ-R34-4，改造自 R32 setChildAgreed）：按角色写该方开关（parent → parentStatus / child → childStatus），不碰对方；整体状态随双开关重新推导；终态或不存在 → false 零变更 */
export function setAgreed(id: string, role: ProposalInitiator, agreed: boolean): boolean {
  const list = allProposals()
  const index = defaultProposalIndex(list, id)
  if (index === -1 || isTerminal(list[index])) return false
  const next: ProposalRecord =
    role === 'parent'
      ? { ...list[index], parentStatus: agreed ? 'agreed' : 'notAgreed' }
      : { ...list[index], childStatus: agreed ? 'agreed' : 'notAgreed' }
  next.status = deriveState(next).status
  next.updatedAt = Date.now()
  next.lastActionBy = role
  next.lastActionKind = agreed ? 'agreed' : 'rethought'
  list[index] = next
  writeProposals(list)
  return true
}

/** 作废（REQ-R32-4-2，D7 不可恢复）：非终态任意状态 → 已作废终态；已终态或不存在 → false 零变更 */
export function voidProposal(id: string): boolean {
  const list = allProposals()
  const index = defaultProposalIndex(list, id)
  if (index === -1 || isTerminal(list[index])) return false
  list[index] = { ...list[index], status: 'voided', updatedAt: Date.now() }
  writeProposals(list)
  return true
}

/** 已作废删除（#266 常驻化，原 #77 REQ-77-3-4）：仅 status === 'voided' → 从 sq_proposals **物理移除记录**并返回 true
 *  （孩子端提议板同步消失）；其余（进行中 / 已发布 / 不存在）→ false 零变更。不依赖任何超能力状态。
 *  与 voidProposal 严格区分：作废是状态流转（置终态标记、记录保留留痕）；删除是物理清除（记录消失、不可恢复）。
 *  进行中须先作废留痕、已发布已流转兑换项有流水关联，任何情况下不可删（REQ-77-3-2）。 */
export function deleteProposal(id: string): boolean {
  const list = allProposals()
  const index = defaultProposalIndex(list, id)
  if (index === -1 || list[index].status !== 'voided') return false
  writeProposals(list.filter((_, i) => i !== index))
  return true
}

/** 发布校验 seam 默认实现：空实现恒通过（REQ-R32-7-4，未来同名检查挂此处；恒通过故不进门禁） */
const allowAlways: PublishValidator = () => true

/** 发布门禁（CONTEXT.md「发布门禁」= 发布门槛，#265 起与时间无关）：双方同意 + 非终态。
 *  页面按钮显隐与 publish 动作共用此单一判定，规则只此一份（架构评审 20260829 收口，页面不再自拼 utils）。 */
export function publishGate(proposal: ProposalRecord): PublishGateResult {
  if (!canPublish(proposal)) return { allowed: false, reason: 'not_publishable' }
  return { allowed: true }
}

/** 发布（REQ-R32-7）：先过发布门禁（publishGate 单一判定）再走校验 seam；成功 → 经 appendReward 向 sq_rewards 末尾追加新兑换项（新 id、同名允许、携带提议 emoji，#299 起废除「不设 emoji」旧行为——无 emoji 提议不落键、读取侧兜底）、星星流水零写入、提议置 published 终态；任一环节拒绝 → 零变更。 */
export function publish(
  id: string,
  opts: { validate?: PublishValidator } = {},
): PublishResult {
  const list = allProposals()
  const index = defaultProposalIndex(list, id)
  if (index === -1) return { ok: false, reason: 'not_found' }
  const proposal = list[index]
  const gate = publishGate(proposal)
  if (!gate.allowed) return { ok: false, reason: gate.reason }
  const validate = opts.validate ?? allowAlways
  if (!validate(proposal, rewards())) return { ok: false, reason: 'rejected' }
  appendReward({ name: proposal.name, price: proposal.price, emoji: proposal.emoji })
  list[index] = { ...proposal, status: 'published', updatedAt: Date.now() }
  writeProposals(list)
  return { ok: true }
}

// #66 拆壳（2026-08-30）：composable 入口 useProposals 已删除，调用方一律具名导入本模块函数；
// reload / refresh 手动刷新模式不变（数据层不缓存，页面自持快照）。

/** 5→6（R32 REQ-R32-6-2）：初始化 sq_proposals 提议键（键已存在不覆盖，迁移中断重跑幂等） */
function migrateInitProposals(): void {
  if (readRawValue(STORAGE_KEYS.proposals) === null) {
    writeValue(STORAGE_KEYS.proposals, [])
  }
}

/** 6→7（#63 拍板 2026-08-30）：存量提议补最后动作归因字段（backfill：by=initiator / kind=proposed，幂等——已有值不覆盖） */
function migrateProposalsLastAction(): void {
  const raw = readRawValue(STORAGE_KEYS.proposals)
  if (raw === null) return
  try {
    const list = JSON.parse(raw) as Array<Partial<ProposalRecord>>
    const next = list.map((p) => ({
      ...p,
      lastActionBy: p.lastActionBy ?? p.initiator ?? 'parent',
      lastActionKind: p.lastActionKind ?? 'proposed',
    }))
    writeValue(STORAGE_KEYS.proposals, next)
  } catch {
    // JSON 损坏走读取兜底（registerDataDefaults），迁移不抢救
  }
}

// 提议域自有键初始值注册（REQ-R32-6-1：键缺失 / JSON 损坏兜底 []）
registerDataDefaults({
  [STORAGE_KEYS.proposals]: [],
})

// 注册进数据基础设施：源版本 5/6 迁移（REQ-R32-6-2 + #63，data-migration.md 约束 1）
registerMigrations({ 5: migrateInitProposals, 6: migrateProposalsLastAction })
