import { describe, expect, it } from 'vitest'
// @ts-expect-error operator CLI is a standalone JavaScript module
import { exportSql, toCsv, parseArgs } from '../../tools/onboarding-metrics.mjs'

describe('#310 anonymous daily CSV export', () => {
  it('uses only fixed counters and an inclusive 90-Beijing-date window, independent of cron', () => {
    expect(exportSql).toContain("date('now', '+8 hours', '-89 days')")
    expect(exportSql).toContain("day <= date('now', '+8 hours')")
    expect(exportSql).toContain('SELECT day, event, family_status, count')
    expect(exportSql).not.toMatch(/family_id|device_id|DELETE|INSERT|UPDATE/)
  })
  it('exports exactly the four columns and excludes accidental extra fields', () => {
    expect(toCsv([{ day: '2026-09-17', event: 'quiz_start', family_status: 'joined', count: 2, secret: 'never' }]))
      .toBe('day,event,family_status,count\n2026-09-17,quiz_start,joined,2\n')
    expect(toCsv([])).toBe('day,event,family_status,count\n')
  })
  it('is local by default and only accepts explicit remote or help flags', () => {
    expect(parseArgs([])).toEqual({ remote: false, help: false })
    expect(parseArgs(['--remote'])).toEqual({ remote: true, help: false })
    expect(() => parseArgs(['--days', '900'])).toThrow()
  })
})
