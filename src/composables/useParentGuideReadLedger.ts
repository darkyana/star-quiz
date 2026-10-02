// #321 家长通知已读账单一出口（spec #319 T2）：家庭级 + 布尔 + 行级 LWW，搭既有入口显隐同步域
// （域 = entry_visibility / sq_entry_visibility，先例：惊喜得星开关键 builtin-trivia:star 同域零云侧改动）。
// 键形如 parent-guide:<通知id>，值 true = 已读，键缺席 = 未读。键名自带语义（读作「这条通知被确认过」），
// 不复用该域「可见」的含义——本模块按 === true 判读，绝不走 readEntryVisibility 的显隐推导。
// 只允许在通知视图里通过「知道了」显式写入；不存在「打开即已读」。
// 本轮不新建同步域、不改协议版本、不加云侧迁移：新键走该域通用行级 LWW（任意业务键 + 布尔值），
// 最坏情况（状态损坏/被清空）= 通知重新显示为未读，不阻塞任何功能。
// 迁移触发条件（票面留痕）：当通知需要布尔之外的第二层状态（送达状态/未读计数/通知类型）时，迁到独立同步域。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { readEntryVisibilityMap, writeEntryVisibilityValue } from './useEntryVisibility'
import { registerWriteListener, STORAGE_KEYS } from './useDataInfra'
import { parentGuideNotifications, type ParentGuideNotification } from '../data/parent-guide-notifications'

/** 已读账键前缀：parent-guide:<通知id> */
const READ_KEY_PREFIX = 'parent-guide:'

/** 已读账键单一出口（键格式只在此处定义；测试/调用方一律经此构造，勿手拼字符串） */
export function parentGuideReadLedgerKey(notificationId: string): string {
  return READ_KEY_PREFIX + notificationId
}

/**
 * 单条通知是否已读（家庭级）：键缺席 / 值非 true（含损坏重置回未设置）= 未读（保守方向：该显示的继续显示）。
 */
export function isParentGuideNotificationRead(notificationId: string): boolean {
  return readEntryVisibilityMap()[parentGuideReadLedgerKey(notificationId)] === true
}

/**
 * 单条通知写已读（「知道了」唯一写入口）：显式 true 落记录，经 writeValue 收口 → 同步引擎写入即推，
// 断网时本地先落（localStorage 即时生效），联网后随既有同步链路全家一致；小工具版本地可用、从不同步。
 */
export function markParentGuideNotificationRead(notificationId: string): void {
  writeEntryVisibilityValue(parentGuideReadLedgerKey(notificationId), true)
}

/** 本机已读通知 id 集合（整账快照，供推导未读集合） */
export function readParentGuideReadIds(): Set<string> {
  const map = readEntryVisibilityMap()
  const ids = new Set<string>()
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(READ_KEY_PREFIX) && value === true) ids.add(key.slice(READ_KEY_PREFIX.length))
  }
  return ids
}

// ===== 响应式已读集合 ref（页面消费单一出口）：本地「知道了」与同步拉合落库均经 writeValue 收口通知，自动跟随 =====
const readIdsRef: Ref<Set<string>> = ref(readParentGuideReadIds())
registerWriteListener((key) => {
  if (key === STORAGE_KEYS.entryVisibility) readIdsRef.value = readParentGuideReadIds()
})

/** 已读集合响应式 ref：写入（本地或同步落库）自动跟随；每次取值即当前快照（不可变替换，触发更新） */
export function useParentGuideReadIds(): Ref<Set<string>> {
  readIdsRef.value = readParentGuideReadIds()
  return readIdsRef
}

/**
 * 未读通知集合单一推导（#325 复审收口）：Home 贴纸显隐与 ParentGuide 通知视图共用同一形状，
 * 「有未读」= 该集合非空。行为与原两处各自内联推导完全一致。
 */
export function useUnreadParentGuideNotifications(): ComputedRef<ParentGuideNotification[]> {
  const readIds = useParentGuideReadIds()
  return computed(() => parentGuideNotifications.filter(notification => !readIds.value.has(notification.id)))
}
