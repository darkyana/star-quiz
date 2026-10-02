// 相对时间五档（Spec REQ-8）：刚刚 / X 分钟前 / X 小时前 / X 天前 / YYYY-MM-DD（本地日期）

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const WEEK = 7 * DAY

/**
 * 限时档剩余分钟 → 展示文案（#279 评审收口单一格式化出口）：「剩余 X 分钟」/ 不足 1 分钟 =「不到 1 分钟」。
 * 字面量只在此一处；copy.ts 的 home.timedRemaining* 与 parent.entryRemaining* 槽位、Home/Parent 页面
 * 剩余文案均委托本函数（放 utils 纯函数层：copy.ts 可安全引用，不牵入单一出口模块的注册副作用）。
 */
export function entryRemainingText(minutes: number): string {
  return minutes < 1 ? '不到 1 分钟' : `剩余 ${minutes} 分钟`
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < WEEK) return `${Math.floor(diff / DAY)} 天前`
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
