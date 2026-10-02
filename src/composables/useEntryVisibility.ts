// 入口显隐单一出口（#262 家长控制化）：家庭偏好独立同步域 entry_visibility，持久化于 sq_entry_visibility。
// 按入口 id 键控（现役两键：游戏 = GAME_SLOT.id、惊喜 = TRIVIA_ENTRY_ID），每入口一条显式写入事实；
// 未设置（记录中无该入口 / 键缺失 / JSON 损坏重置 / 初始值空记录）= **默认隐藏**——默认语义是
// 「未设置」的读取语义，不是待推事实：空记录不 diff 出行、不推上云（与 morale 初始档位同口径）。
// 读写走 useDataInfra 通用原语：writeValue 收口触发同步引擎写入即推（outbox 攒行，LWW 最后改动方胜）；
// 损坏重置经 #171 铁律（域标脏禁推 → 影子为证人云端回填）。
import { readValue, writeValue, registerDataDefaults, registerWriteListener, STORAGE_KEYS } from './useDataInfra'
import { ref, type Ref } from 'vue'
import type { EntryVisibilityMap, EntryVisibilityValue } from '../types'
import { isTimedEntryVisibilityValue } from '../types'
// 剩余分钟文案格式化单一出口（#279 评审收口）：实现在 utils 纯函数层（copy.ts 也引用同一实现），此处再出口供页面单点消费
export { entryRemainingText } from '../utils/relativeTime'

// ===== #278 限时档：到期推导纯函数（本模块 = 入口显隐单一出口，推导收口于此）=====
// 四态编码：关闭 = 不可见无到期；保持开启 = 可见无到期；限时 = 可见 + 到期时间戳。
// 到期语义 = 纯推导、无写回：可见 = 保持开启，或（限时 且 当前时间 < 到期时间）；
// 到期时间戳由写入方（家长设备）按自身本地时钟计算，各设备推导时拿本地当前时间直接比较，不做服务器时间校准。

/** 显隐档位：关闭 / 保持开启 / 限时 */
export type EntryVisibilityMode = 'off' | 'keep-on' | 'timed'

/** 推导结果：可见性 + 剩余分钟（仅限时档有值；分钟粒度，不足 1 分钟记 0 = 「不到 1 分钟」档） */
export interface EntryVisibilityDerivation {
  visible: boolean
  /** 剩余整分钟（向下取整）；非限时档 = null；限时且剩余不足 1 分钟 = 0（不到 1 分钟档） */
  remainingMinutes: number | null
  /** 「不到 1 分钟」档（限时档剩余 < 1 分钟，含已过期/恰好归零） */
  lessThanOneMinute: boolean
}

/** 记录条目值 → 档位（存量布尔照旧解释：可见无到期 = 保持开启，无感迁移不改数据） */
export function entryVisibilityModeOf(value: EntryVisibilityValue | undefined): EntryVisibilityMode {
  if (value === true) return 'keep-on'
  if (isTimedEntryVisibilityValue(value)) return 'timed'
  return 'off'
}

/** 记录条目值 → 限时档到期时间戳（非限时档 = null） */
export function entryVisibilityExpiresAtOf(value: EntryVisibilityValue | undefined): number | null {
  return isTimedEntryVisibilityValue(value) ? value.expires_at : null
}

/**
 * 到期推导纯函数（假时钟单测收口对象）：输入（档位，到期时间戳，当前时间）→ 输出（可见性，剩余分钟）。
 * 恰好归零（当前时间 = 到期时间）按已过期：可见性要求严格早于（<），剩余 0 分钟、「不到 1 分钟」档。
 */
export function deriveEntryVisibility(mode: EntryVisibilityMode, expiresAt: number | null, now: number): EntryVisibilityDerivation {
  if (mode === 'off') return { visible: false, remainingMinutes: null, lessThanOneMinute: false }
  if (mode === 'keep-on') return { visible: true, remainingMinutes: null, lessThanOneMinute: false }
  const expired = !(now < (expiresAt as number))
  const remainingMs = Math.max(0, (expiresAt as number) - now)
  const remainingMinutes = Math.floor(remainingMs / 60_000)
  return { visible: !expired, remainingMinutes, lessThanOneMinute: remainingMinutes < 1 }
}

/** 记录条目值 + 当前时间 → 推导结果（读取路径便捷形；假时钟经 now 注入） */
export function deriveEntryVisibilityFromValue(value: EntryVisibilityValue | undefined, now: number): EntryVisibilityDerivation {
  return deriveEntryVisibility(entryVisibilityModeOf(value), entryVisibilityExpiresAtOf(value), now)
}

// 初始值空记录（不是预置任何入口）：默认隐藏是「未设置」的读取语义，不是待推事实
registerDataDefaults({ [STORAGE_KEYS.entryVisibility]: {} })

/** 读取显隐记录整值（每键一次显式写入；缺入口 = 未设置） */
export function readEntryVisibilityMap(): EntryVisibilityMap {
  return readValue<EntryVisibilityMap>(STORAGE_KEYS.entryVisibility) ?? {}
}

/** 入口是否显示：未设置（记录中无该入口）= 默认隐藏；显式 true 才显示；限时档按当前时间推导（#278） */
export function readEntryVisibility(entryId: string): boolean {
  return deriveEntryVisibilityFromValue(readEntryVisibilityMap()[entryId], Date.now()).visible
}

/**
 * 单入口写（家长开关切换；经 writeValue 收口 → 同步引擎写入即推，时间戳与写者由引擎 diff 时注入）。
 * 显式 false 也落记录——「家长关掉」是事实不是「回到未设置」，必须可同步传播到孩子端。
 */
export function writeEntryVisibilityValue(entryId: string, value: EntryVisibilityValue): void {
  const next = readEntryVisibilityMap()
  next[entryId] = value
  writeValue(STORAGE_KEYS.entryVisibility, next)
}

/** 整记录写（同步引擎拉侧灌入/对账专用） */
export function writeEntryVisibilityMap(next: EntryVisibilityMap): void {
  writeValue(STORAGE_KEYS.entryVisibility, next)
}

// ===== #263 评审收口：响应式显隐 ref（页面消费单一出口，写监听管线收编进本模块）=====
// 每入口一条共享 ref；写监听（家长本机切换 / 云端拉合落库，均经 writeValue 收口通知）在首次
// 取 ref 时注册一次、模块生命周期常驻。每次取 ref 时回读本地重对齐——直接改 localStorage 的
// 测试/外部路径不触发写监听，挂载时回读保证与本地键一致（与旧页面 setup 直读同口径）。
const visibilityRefs = new Map<string, Ref<boolean>>()

/** 入口显隐响应式 ref：页面渲染门禁直接消费；写入（本地或同步落库）自动跟随 */
export function useEntryVisibilityRef(entryId: string): Ref<boolean> {
  const existing = visibilityRefs.get(entryId)
  if (existing) {
    existing.value = readEntryVisibility(entryId)
    return existing
  }
  const created = ref(readEntryVisibility(entryId))
  visibilityRefs.set(entryId, created)
  registerWriteListener((key) => {
    if (key === STORAGE_KEYS.entryVisibility) created.value = readEntryVisibility(entryId)
  })
  return created
}

// ===== #279 四态单选：响应式档位状态 ref（推导复用 #278 纯函数，本模块不重复推导逻辑）=====
// 页面（家长控制功能卡）消费：mode = 段位选中映射（限时档映射见 stateRef 注释）、剩余分钟文案、
// 到期回初始态都由 here 出。每入口一条共享 ref；写监听跟随 + refreshEntryVisibilityStates 供
// 前台分钟粒度定时器调用（每次重取本地当前时间重新推导，到期后 mode 推导回 'off' 初始态）。
export interface EntryVisibilityState {
  /** 记录档位（限时档不因流逝改写：仍为 'timed'，可见性/剩余走推导字段） */
  mode: EntryVisibilityMode
  /** 限时档到期时间戳（非限时 = null） */
  expiresAt: number | null
  /** 当前可见性（#278 推导） */
  visible: boolean
  /** 剩余整分钟（非限时 = null；不足 1 分钟 = 0 =「不到 1 分钟」档） */
  remainingMinutes: number | null
  lessThanOneMinute: boolean
}

function deriveEntryVisibilityState(entryId: string): EntryVisibilityState {
  const value = readEntryVisibilityMap()[entryId]
  return {
    mode: entryVisibilityModeOf(value),
    expiresAt: entryVisibilityExpiresAtOf(value),
    ...deriveEntryVisibilityFromValue(value, Date.now()),
  }
}

const stateRefs = new Map<string, { id: string; ref: Ref<EntryVisibilityState> }>()

/** 入口档位状态响应式 ref：页面四态单选组消费；写入（本地或同步落库）自动跟随重推导 */
export function useEntryVisibilityStateRef(entryId: string): Ref<EntryVisibilityState> {
  const existing = stateRefs.get(entryId)
  if (existing) {
    existing.ref.value = deriveEntryVisibilityState(entryId)
    return existing.ref
  }
  const created = ref(deriveEntryVisibilityState(entryId))
  stateRefs.set(entryId, { id: entryId, ref: created })
  registerWriteListener((key) => {
    if (key === STORAGE_KEYS.entryVisibility) created.value = deriveEntryVisibilityState(entryId)
  })
  return created
}

/** 前台分钟粒度重算入口（页面定时器每分钟调用）：所有已取 state ref 按本地当前时间重新推导，到期回 'off' 初始态 */
export function refreshEntryVisibilityStates(): void {
  for (const entry of stateRefs.values()) entry.ref.value = deriveEntryVisibilityState(entry.id)
}
