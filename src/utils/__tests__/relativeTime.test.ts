/**
 * T2 相对时间五档单测（Spec REQ-8 / §4 AC8-3 ~ AC8-6、AC8-8）
 * 边界：59s / 60s / 59min / 60min / 23h59m / 24h / 6d / 7d。
 */
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../relativeTime'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

describe('formatRelativeTime 五档', () => {
  it('AC8-3 60 秒以内为"刚刚"（59s 边界）', () => {
    const now = 1_000_000
    expect(formatRelativeTime(now - 0, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 59_000, now)).toBe('刚刚')
  })

  it('AC8-4 分钟档：60s 与 59 分钟边界', () => {
    const now = 10_000_000
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 分钟前')
    expect(formatRelativeTime(now - 3_540_000, now)).toBe('59 分钟前')
  })

  it('AC8-5 小时档：60 分钟起', () => {
    const now = 10_000_000
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1 小时前')
  })

  it('AC8-6 天档与日期档：6 天 / 7 天边界', () => {
    // 本地时区固定 now = 2026-08-21T00:00:00
    const now = new Date(2026, 7, 21, 0, 0, 0).getTime()
    expect(formatRelativeTime(now - 6 * DAY, now)).toBe('6 天前')
    expect(formatRelativeTime(now - 7 * DAY, now)).toBe('2026-08-14')
  })

  it('AC8-8 24 小时边界：23h59m 与 24h', () => {
    const now = new Date(2026, 7, 21, 12, 0, 0).getTime()
    expect(formatRelativeTime(now - 86_340_000, now)).toBe('23 小时前')
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('1 天前')
  })

  it('分钟 / 小时 / 天数值正确取整（非进位）', () => {
    const now = 100_000_000
    expect(formatRelativeTime(now - 2 * MINUTE - 30_000, now)).toBe('2 分钟前')
    expect(formatRelativeTime(now - 5 * HOUR - 30 * MINUTE, now)).toBe('5 小时前')
    expect(formatRelativeTime(now - 3 * DAY - 12 * HOUR, now)).toBe('3 天前')
  })

  it('日期档输出 YYYY-MM-DD 本地日期（跨月跨年）', () => {
    const now = new Date(2026, 0, 15, 8, 0, 0).getTime()
    expect(formatRelativeTime(now - 9 * DAY, now)).toBe('2026-01-06')
    const now2 = new Date(2026, 0, 3, 8, 0, 0).getTime()
    expect(formatRelativeTime(now2 - 9 * DAY, now2)).toBe('2025-12-25')
  })
})
