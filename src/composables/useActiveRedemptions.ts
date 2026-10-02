// 进行中兑换域数据模块（#73 R-72-1 建档 / #74 R-72-2 核销与放弃）：拥有「我的奖品」券记录（sq_active_redemptions）。
// 记录为兑换项快照（名称/emoji/兑换时间），展示不依赖 rewardId——与兑换项生命周期解耦，
// 兑换项改名/删除不影响已持有券卡。建档由 useStarData.redeem 内部调用：
// 「扣星流水 + 建券记录」两写收在 redeem 单次调用内（依赖单向 useStarData → 本模块）。
// complete（使用，#74 R-72-2「用完了」→ #293 拍板唯一终态）按 id 删记录、星星账本零变动；
// abandon（放弃）词条已随 #293 删除路径整体裁撤，不再是本域动作。
// 老用户零迁移：新 key 初始空数组，既有键一字不动。存储读写走 useDataInfra 原语（F5）。

import type { ActiveRedemption, RewardItem } from '../types'
import { DEFAULT_CHILD_ID } from '../types'
import { STORAGE_KEYS, readValue, writeValue, registerDataDefaults } from './useDataInfra'
import { PROPOSAL_EMOJI_DEFAULT } from '../utils/proposalState' // 🎁 兜底单一出处（#299：提议/兑换项/券卡全链路共用）

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 同步 / 导出用全孩券容器（每次读取返回新数组）。 */
export function allRecords(): ActiveRedemption[] {
  return readValue<ActiveRedemption[]>(STORAGE_KEYS.activeRedemptions)
}

/** 业务券视图：缺省默认孩子，旧行缺少归属仍视为默认孩子。 */
export function list(childId: string = DEFAULT_CHILD_ID): ActiveRedemption[] {
  return allRecords().filter((r) => (r.childId ?? DEFAULT_CHILD_ID) === childId)
}

/** 券记录全量写（还原 / 整组替换场景）；append 语义由建档入口维护 */
export function writeRecords(next: ActiveRedemption[]): void {
  writeValue(STORAGE_KEYS.activeRedemptions, next)
}

/**
 * 建档（redeem 内部调用）：把兑换项快照（名称/emoji + 兑换时间戳）追加为一条进行中兑换记录；
 * emoji 缺省兜底 🎁（同兑换页展示兜底）；末尾追加不覆写既有券。
 */
export function create(reward: RewardItem): ActiveRedemption {
  const record: ActiveRedemption = {
    id: uuid(),
    rewardId: reward.id,
    name: reward.name,
    emoji: reward.emoji ?? PROPOSAL_EMOJI_DEFAULT,
    createdAt: Date.now(),
    childId: DEFAULT_CHILD_ID, // #173 数据行挂孩子维度（现阶段恒默认孩子）
  }
  writeRecords([...allRecords(), record])
  return record
}

// 本域自有键初始值注册：初始空数组（老用户升级新 key 为空，零迁移）
registerDataDefaults({ [STORAGE_KEYS.activeRedemptions]: [] })

/**
 * 按 id 从列表删除一条记录；id 不存在时零写入（存储原文不动）。
 */
function removeById(id: string): void {
  const current = allRecords()
  const isTarget = (r: ActiveRedemption) => r.id === id && (r.childId ?? DEFAULT_CHILD_ID) === DEFAULT_CHILD_ID
  if (!current.some(isTarget)) return
  writeRecords(current.filter((r) => !isTarget(r)))
}

/**
 * 使用（#74 R-72-2「用完了」；#293 拍板：使用是奖品唯一终态）：按 id 从列表删除该奖品记录；
 * 其余记录原样保留；星星账本零变动（奖品是已付款凭证，使用不产生任何流水）。
 */
export function complete(id: string): void {
  removeById(id)
}
