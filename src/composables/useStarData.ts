// 星星域数据模块（T4 重构 T2，Spec 20260826-073）：拥有星星账本（sq_stars）与兑换目录（sq_rewards），
// 承载全部记账规则：答对 +1 星 / 题、满分额外 +3、兑换扣星（模块内部读兑换目录并校验余额 ≥ 价格，
// 传标识符不传对象）、余额 = Σearn − Σredeem 实时求和不持久化、已入账判定幂等、流水列表。
// 存储读写走 useDataInfra 原语；账本函数族（computeBalance 等）自 useStars.ts 并入本模块并保持导出
// （模块内部导出函数不变，实现提示决策 5），行为与现行完全一致（REQ-T4-6 基线）。

import type { RewardItem, StarEntry, TriviaRuleEarn } from '../types'
import { DEFAULT_CHILD_ID, DEFAULT_STAR_KIND } from '../types'
import { copy } from '../copy'
import { currentRewards } from '../data/current-rewards'
import { GAME_SLOT } from '../data/playable-games'
import { STORAGE_KEYS, readValue, writeValue, registerDataDefaults } from './useDataInfra'
import { create as createActiveRedemption } from './useActiveRedemptions'

/** 兑换结果：失败给 reason（reward_not_found = 目录中无此标识符 / insufficient_balance = 余额不足） */
export type RedeemResult = { ok: true } | { ok: false; reason: 'reward_not_found' | 'insufficient_balance' }

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 余额 = Σearn.amount − Σredeem.amount（实时求和，C2）；空流水返回 0 */
export function computeBalance(entries: StarEntry[]): number {
  return entries.filter((e) => (e.childId ?? DEFAULT_CHILD_ID) === DEFAULT_CHILD_ID)
    .reduce((sum, e) => sum + (e.type === 'earn' ? e.amount : -e.amount), 0)
}

/**
 * 答题入账（append-only，C1）：返回追加后的新数组。
 * correctCount > 0 写一条"答题得星"；满分（correctCount === totalCount）再追加"满分奖励"+3；
 * 0 分不写（Spec §6 D2）。
 */
export function earnForQuiz(
  entries: StarEntry[],
  opts: { quizId: string; correctCount: number; totalCount: number },
): StarEntry[] {
  const { quizId, correctCount, totalCount } = opts
  const next = [...entries]
  if (correctCount > 0) {
    next.push({ id: uuid(), timestamp: Date.now(), type: 'earn', amount: correctCount, source: copy.stars.quizSource, quizId, kind: DEFAULT_STAR_KIND, childId: DEFAULT_CHILD_ID })
  }
  if (correctCount === totalCount) {
    next.push({ id: uuid(), timestamp: Date.now(), type: 'earn', amount: 3, source: copy.stars.fullMarkSource, quizId, kind: DEFAULT_STAR_KIND, childId: DEFAULT_CHILD_ID })
  }
  return next
}

/**
 * 兑换扣星（C3 逻辑层校验余额 ≥ 价格；C4 来源文本快照"兑换：{名称}"）。
 * 余额不足返回 ok:false 且 entries 不变（绕过 UI 直接调用也不可超余额）。
 */
export function redeemReward(
  entries: StarEntry[],
  reward: RewardItem,
): { ok: true; entries: StarEntry[] } | { ok: false; entries: StarEntry[] } {
  if (computeBalance(entries) < reward.price) {
    return { ok: false, entries }
  }
  return {
    ok: true,
    entries: [
      ...entries,
      { id: uuid(), timestamp: Date.now(), type: 'redeem', amount: reward.price, source: copy.stars.redeemSource(reward.name), kind: DEFAULT_STAR_KIND, childId: DEFAULT_CHILD_ID },
    ],
  }
}

/** 结算幂等判定：sq_stars 中是否存在该 quizId 的 earn 流水（唯一依据） */
export function hasQuizEarned(entries: StarEntry[], quizId: string): boolean {
  return entries.some((e) => (e.childId ?? DEFAULT_CHILD_ID) === DEFAULT_CHILD_ID && e.type === 'earn' && e.quizId === quizId)
}

/** 同步 / 导出用全孩流水容器（每次读取返回新数组）。 */
export function allLedger(): StarEntry[] {
  return readValue<StarEntry[]>(STORAGE_KEYS.stars)
}

/** 业务流水视图：缺省默认孩子；旧行缺少归属仍视为默认孩子。 */
export function ledger(childId: string = DEFAULT_CHILD_ID): StarEntry[] {
  return allLedger().filter((e) => (e.childId ?? DEFAULT_CHILD_ID) === childId)
}

/** 账本全量写（append-only 语义由记账入口维护；还原 / 迁移场景整组替换） */
export function writeLedger(entries: StarEntry[]): void {
  writeValue(STORAGE_KEYS.stars, entries)
}

/** 兑换目录读取 */
export function rewards(): RewardItem[] {
  return readValue<RewardItem[]>(STORAGE_KEYS.rewards)
}

/** 兑换目录写入（家长页管理兑换项） */
export function writeRewards(next: RewardItem[]): void {
  writeValue(STORAGE_KEYS.rewards, next)
}

/** 追加单条兑换项（R32 REQ-R32-7-5 发布写入通道）：生成新 id（与既有 id 撞号时重生成），末尾追加不整组覆写；emoji 可选透传（#299 发布携带提议 emoji，不传不落键、读取侧 🎁 兜底） */
export function appendReward(item: { name: string; price: number; emoji?: string }): RewardItem {
  const list = rewards()
  const existingIds = new Set(list.map((r) => r.id))
  let id = uuid()
  while (existingIds.has(id)) id = uuid()
  const appended: RewardItem = {
    id,
    name: item.name,
    price: item.price,
    ...(item.emoji !== undefined ? { emoji: item.emoji } : {}),
  }
  writeRewards([...list, appended])
  return appended
}

/** #289 惊喜规则入账（纯函数）：按规则折算的星数写一条 earn 流水（source = 快照式文案「惊喜答题：{类别名}」，由调用侧从会话快照取）；0 星不写；幂等同 quizId 判定 */
export function earnForTriviaRule(
  entries: StarEntry[],
  opts: { quizId: string; amount: number; source: string },
): StarEntry[] {
  if (opts.amount <= 0) return entries
  return [
    ...entries,
    { id: uuid(), timestamp: Date.now(), type: 'earn', amount: opts.amount, source: opts.source, quizId: opts.quizId, kind: DEFAULT_STAR_KIND, childId: DEFAULT_CHILD_ID },
  ]
}

/** 答题入账：答对 +1 星 / 题，满分追加 +3；0 分不写；已入账幂等零写入（C1 append-only，AC2-3 ~ AC2-5，REQ-T4-1-1）。
 *  #289 可选 rule（带规则惊喜轮）：改走 earnForTriviaRule 按规则星数写单条流水；缺省走 earnForQuiz 学科公式（公式零变更）。 */
export function earn(opts: { quizId: string; correctCount: number; totalCount: number; rule?: TriviaRuleEarn }): void {
  if (hasQuizEarned(ledger(), opts.quizId)) return
  const next = opts.rule === undefined
    ? earnForQuiz(allLedger(), opts)
    : earnForTriviaRule(allLedger(), { quizId: opts.quizId, amount: opts.rule.stars, source: opts.rule.source })
  writeLedger(next)
}

/**
 * 兑换扣星：传标识符不传兑换项对象，模块内部读兑换目录并校验余额 ≥ 价格；
 * 标识符不存在或余额不足均拒绝且零写入（C3 逻辑层兜底，AC2-6 / AC2-7 / AC7-7）。
 * R-72-1（#73）两写原子性：成功时「扣星流水 + 建券记录（我的奖品快照）」收在本函数单次调用内，
 * 依赖单向 useStarData → useActiveRedemptions；失败路径两者都不写。
 */
export function redeem(rewardId: string): RedeemResult {
  const reward = rewards().find((item) => item.id === rewardId)
  if (reward === undefined) return { ok: false, reason: 'reward_not_found' }
  const result = redeemReward(allLedger(), reward)
  if (!result.ok) return { ok: false, reason: 'insufficient_balance' }
  writeLedger(result.entries)
  createActiveRedemption(reward)
  return { ok: true }
}

/** 即时兑换并使用：只收可信游戏标识，复用兑换流水规则；不碰目录或进行中兑换。
 * 同步落盘及既有本地写广播完成后才返回成功，页面据此授权游戏。#264：时窗删除，可信标识校验与余额扣费不变。 */
export function redeemGame(gameId: string): { ok: true } | { ok: false; reason: 'game_not_found' | 'insufficient_balance' } {
  if (gameId !== GAME_SLOT.id) return { ok: false, reason: 'game_not_found' }
  const result = redeemReward(allLedger(), GAME_SLOT)
  if (!result.ok) return { ok: false, reason: 'insufficient_balance' }
  try {
    writeLedger(result.entries)
  } catch (cause) {
    // writeValue 是先同步落盘再广播。监听器异常不等于扣费失败：只认本次完整流水
    // 已存在的事实，不再次写账、不误判为扣费失败；真正未落盘仍抛给宿主且不得授权。
    const appended = JSON.stringify(result.entries[result.entries.length - 1])
    if (!allLedger().some(entry => JSON.stringify(entry) === appended)) throw cause
  }
  return { ok: true }
}

/** 开局未就绪退回（#232）：redeemGame 的配套退款——只收可信游戏标识（校验 = 槽位 id），
 *  向 sq_stars 追加一条等额 earn 退回流水（amount = GAME_SLOT.price、source = copy.home.game.refundSource(name)，
 *  id / timestamp 沿既有 earn 写法）；余额实时求和、经济文件导出导入由既有机制天然覆盖。
 *  何时退（未收到 ready 的尝试）由页面就绪判定决定，本函数不做幂等；写账未真正落盘返回 false 供页面提示。 */
export function refundGame(gameId: string): boolean {
  if (gameId !== GAME_SLOT.id) return false
  const entries = [
    ...allLedger(),
    { id: uuid(), timestamp: Date.now(), type: 'earn' as const, amount: GAME_SLOT.price, source: copy.home.game.refundSource(GAME_SLOT.name), kind: DEFAULT_STAR_KIND, childId: DEFAULT_CHILD_ID },
  ]
  try {
    writeLedger(entries)
  } catch {
    // 与 redeemGame 同口径：监听器异常不等于写账失败——只认退回流水已落盘的事实，不再次写账。
    const appended = JSON.stringify(entries[entries.length - 1])
    if (!allLedger().some(entry => JSON.stringify(entry) === appended)) return false
  }
  return true
}

/** 余额 = Σearn − Σredeem 实时求和，不持久化字段（C2） */
export function balance(): number {
  return computeBalance(ledger())
}

/** 超能力奖励（#77 REQ-77-4-3，家长直接加星）：向 sq_stars 追加一条 earn 流水——
 *  source = copy.superPower.rewardSource(reason)（「特别奖励：{原因}」，D5 与满分奖励语感一致），
 *  id / timestamp 沿既有 earn 写法；余额实时求和、经济文件导出导入均由既有机制天然覆盖。
 *  校验收口本模块：amount 1–99 正整数、reason trim 非空，非法拒绝零写入返回 false（REQ-77-4-1 仅正向）。 */
export function grant(opts: { amount: number; reason: string }): boolean {
  const { amount } = opts
  const reason = opts.reason.trim()
  if (!Number.isInteger(amount) || amount < 1 || amount > 99) return false
  if (reason === '') return false
  writeLedger([
    ...allLedger(),
    { id: uuid(), timestamp: Date.now(), type: 'earn', amount, source: copy.superPower.rewardSource(reason), kind: DEFAULT_STAR_KIND, childId: DEFAULT_CHILD_ID },
  ])
  return true
}

/** 已入账判定幂等：sq_stars 中存在该 quizId 的 earn 流水（唯一依据） */
export function hasEarned(quizId: string): boolean {
  return hasQuizEarned(ledger(), quizId)
}

// #173 起新写入流水物理带 kind（主星）与 childId（默认孩子）两列——形状断代，行为等价。
// 星星域自有键初始值注册（T2 自 useAppState 随迁，保持 9 键初始化集合不变）：
// 账本空数组、兑换目录 currentRewards（AC5-1 / AC5-2）
registerDataDefaults({
  [STORAGE_KEYS.stars]: [],
  [STORAGE_KEYS.rewards]: currentRewards,
})
