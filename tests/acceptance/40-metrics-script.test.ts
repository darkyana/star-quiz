// 匿名聚合指标导出脚本纯函数单测（票 #229，ADR 0013）
// 被测对象：tools/metrics.mjs 导出的纯函数（ISO 周/日界换算、匿名 ID、SQL 组装、CSV 拼装、--weeks 解析）
// 不连真库（wrangler 调用边不在本套件覆盖，SQL 文本做口径锚点断言）
// 时间口径（worker/migrations/0001 头注释）：answered_at = TEXT ISO 8601 UTC（带 Z）；
// timestamp/created_at/paired_at = INTEGER 客户端本地毫秒；server_at = INTEGER UTC 毫秒。
// 三种入参同为绝对时刻，统一 +8h（Asia/Shanghai）折日界；ISO 周周一起始。
// 样例锚点：2026-01-01 周四 → 2026-W01 周一 = 2025-12-29；2026-09-07 周一 = W37 起点（09-06 周日属 W36）。
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  METRIC_COLUMNS,
  anonFamilyId,
  beijingMondayToIsoWeek,
  buildMetricsSql,
  isoTextToBeijingMonday,
  mapExportRows,
  msToBeijingMonday,
  normalizeIsoText,
  parseMetricsArgs,
  recentWeekMondays,
  toCsv,
} from '../../tools/metrics.mjs'

describe('msToBeijingMonday：INTEGER 毫秒（本地/UTC 毫秒同构绝对时刻）→ 北京墙上周一', () => {
  it('UTC 周日 17:30 = 北京周一 01:30：跨日界归下一周（周一 2026-09-07）', () => {
    expect(msToBeijingMonday(Date.UTC(2026, 8, 6, 17, 30))).toBe('2026-09-07')
  })
  it('UTC 周日 15:59:59.999 = 北京周日 23:59:59.999：仍属当周（周一 2026-08-31）', () => {
    expect(msToBeijingMonday(Date.UTC(2026, 8, 6, 15, 59, 59, 999))).toBe('2026-08-31')
  })
  it('UTC 周日 16:00:00.000 恰为北京周一 00:00 整：边界落下周（开区间右端归新周）', () => {
    expect(msToBeijingMonday(Date.UTC(2026, 8, 6, 16, 0, 0, 0))).toBe('2026-09-07')
  })
  it('周中样例：UTC 周四 02:00 = 北京周四 10:00 → 本周周一', () => {
    expect(msToBeijingMonday(Date.UTC(2026, 8, 10, 2, 0))).toBe('2026-09-07')
  })
  it('INTEGER 客户端本地毫秒语义（Date.now()）：与 UTC 毫秒同函数换算', () => {
    // star_entries.timestamp / families.created_at / devices.paired_at 均为 Date.now() 毫秒（绝对时刻）
    const localMs = Date.UTC(2026, 8, 6, 17, 30)
    expect(msToBeijingMonday(localMs)).toBe('2026-09-07')
  })
})

describe('isoTextToBeijingMonday：TEXT ISO 8601 UTC（question_results.answered_at 口径）', () => {
  it('带 Z 跨日界样例：UTC 周日 17:30 = 北京周一 01:30 → 下一周', () => {
    expect(isoTextToBeijingMonday('2026-09-06T17:30:00.000Z')).toBe('2026-09-07')
  })
  it('带 Z 日界内样例：UTC 周日 15:30 = 北京周日 23:30 → 当周', () => {
    expect(isoTextToBeijingMonday('2026-09-06T15:30:00.000Z')).toBe('2026-08-31')
  })
  it('无时区标记的串按 UTC 归一（与 SQLite date() 同构，防御数据源差异）', () => {
    expect(isoTextToBeijingMonday('2026-09-06T17:30:00.000')).toBe('2026-09-07')
  })
  it('非法时间串抛错（宁可炸也不静默错桶）', () => {
    expect(() => isoTextToBeijingMonday('not-a-date')).toThrow('非法 ISO 8601')
  })
})

describe('normalizeIsoText：ISO 串防御归一', () => {
  it('无时区标记补 Z；带 Z / 带 ±hh:mm 原样保留', () => {
    expect(normalizeIsoText('2026-09-06T17:30:00.000')).toBe('2026-09-06T17:30:00.000Z')
    expect(normalizeIsoText('2026-09-06T17:30:00.000Z')).toBe('2026-09-06T17:30:00.000Z')
    expect(normalizeIsoText('2026-09-06T17:30:00+08:00')).toBe('2026-09-06T17:30:00+08:00')
  })
  it('形状非法抛错', () => {
    expect(() => normalizeIsoText('')).toThrow()
    expect(() => normalizeIsoText('2026/09/06')).toThrow()
  })
})

describe('beijingMondayToIsoWeek：周一日期 → YYYY-Www（ISO 8601，自写算法零依赖）', () => {
  it('常规周：2026-09-07 → 2026-W37', () => {
    expect(beijingMondayToIsoWeek('2026-09-07')).toBe('2026-W37')
  })
  it('年末长周：2026-12-28 → 2026-W53（2027 元旦周五，属 26 年第 53 周）', () => {
    expect(beijingMondayToIsoWeek('2026-12-28')).toBe('2026-W53')
  })
  it('跨年首周（周一起于上年 12 月末）：2025-12-29 → 2026-W01（2026 元旦周四）', () => {
    expect(beijingMondayToIsoWeek('2025-12-29')).toBe('2026-W01')
  })
  it('跨年首周：2024-12-30 → 2025-W01（2025 元旦周三）', () => {
    expect(beijingMondayToIsoWeek('2024-12-30')).toBe('2025-W01')
  })
  it('第 2 周：2026-01-05 → 2026-W02；年内首周内一天 2026-01-01 所在周 → 2026-W01', () => {
    expect(beijingMondayToIsoWeek('2026-01-05')).toBe('2026-W02')
    expect(beijingMondayToIsoWeek('2025-12-29')).toBe('2026-W01')
  })
})

describe('recentWeekMondays：最近 N 个自然周（升序，末位 = 当周周一）', () => {
  it('北京周四凌晨时刻，weeks=3 → 升序三连周一，末位当周、间隔 7 天', () => {
    const now = Date.UTC(2026, 8, 9, 19, 30) // UTC 周三 19:30 = 北京周四 03:30
    expect(recentWeekMondays(now, 3)).toEqual(['2026-08-24', '2026-08-31', '2026-09-07'])
  })
  it('weeks=1 → 仅当周周一', () => {
    expect(recentWeekMondays(Date.UTC(2026, 8, 9, 19, 30), 1)).toEqual(['2026-09-07'])
  })
  it('周日深夜（北京）仍属当周：北京 2026-09-06 23:59 → 当周周一 08-31', () => {
    expect(recentWeekMondays(Date.UTC(2026, 8, 6, 15, 59), 1)).toEqual(['2026-08-31'])
  })
  it('非正整数/小数抛错', () => {
    expect(() => recentWeekMondays(0, 0)).toThrow()
    expect(() => recentWeekMondays(0, -1)).toThrow()
    expect(() => recentWeekMondays(0, 1.5)).toThrow()
  })
})

describe('anonFamilyId：sha256(固定前缀 + family_id) 截 16 位（ADR 0013 锚定 family_id）', () => {
  it('16 位小写十六进制', () => {
    expect(anonFamilyId('fam-uuid-1')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('与独立重算一致（锁定前缀 sq-metrics-v1 与直接拼接口径）', () => {
    const expected = createHash('sha256').update('sq-metrics-v1fam-uuid-1').digest('hex').slice(0, 16)
    expect(anonFamilyId('fam-uuid-1')).toBe(expected)
  })
  it('跨输入稳定：同 family_id 多次一致，不同 family_id 互不相同', () => {
    expect(anonFamilyId('fam-a')).toBe(anonFamilyId('fam-a'))
    expect(anonFamilyId('fam-a')).not.toBe(anonFamilyId('fam-b'))
  })
  it('输出不含 family_id 明文', () => {
    expect(anonFamilyId('fam-very-long-identifiable-uuid')).not.toContain('fam-very-long')
  })
})

describe('buildMetricsSql：聚合 SQL 组装（全网格 + 各事件子查询独立分桶）', () => {
  const mondays = ['2026-08-31', '2026-09-07']
  const startMs = Date.parse('2026-08-31T00:00:00Z') - 8 * 3600 * 1000
  const endMs = Date.parse('2026-09-14T00:00:00Z') - 8 * 3600 * 1000 // 末周一 + 7 天的北京 00:00
  const sql = buildMetricsSql(mondays)

  it('周序列由 JS 算好注入（VALUES CTE）', () => {
    expect(sql).toContain("VALUES ('2026-08-31'), ('2026-09-07')")
  })
  it('全网格：families × 周 CROSS JOIN，建家时刻 < 周末（下周一北京 00:00 的绝对毫秒）才有行', () => {
    expect(sql).toContain('FROM families f CROSS JOIN weeks w')
    expect(sql).toContain("f.created_at < (CAST(strftime('%s', date(w.monday, '+7 days')) AS INTEGER) - 28800) * 1000")
  })
  it('三种时间入参各自换算：TEXT ISO 串比较（answered_at）+ INTEGER 毫秒比较（server_at/timestamp 等）', () => {
    expect(sql).toContain(`answered_at >= '${new Date(startMs).toISOString()}'`)
    expect(sql).toContain(`answered_at < '${new Date(endMs).toISOString()}'`)
    expect(sql).toContain(`server_at >= ${startMs}`)
    expect(sql).toContain(`timestamp < ${endMs}`)
  })
  it('主口径列 = COUNT(DISTINCT 答题日)：按 answered_at 与 server_at 分别 DISTINCT（+8h 折日界）', () => {
    expect(sql).toContain("COUNT(DISTINCT date(answered_at, '+8 hours')) AS quiz_days_event")
    expect(sql).toContain("COUNT(DISTINCT date(server_at / 1000, 'unixepoch', '+8 hours')) AS quiz_days_sync")
  })
  it('口径锚点：redeem 过滤、首台设备=最早 active 家长设备、孩子设备 role 过滤', () => {
    expect(sql).toContain("type = 'redeem'")
    expect(sql).toContain("role = 'parent' AND status = 'active' AND revoked_at IS NULL")
    expect(sql).toContain("role = 'child'")
  })
  it('quiz_active 在 SQL 侧判定（聚合侧完成）：quiz_days_event ≥ 1 → 1/0', () => {
    expect(sql).toContain('CASE WHEN COALESCE(qe.quiz_days_event, 0) >= 1 THEN 1 ELSE 0 END AS quiz_active')
  })
  it('LEFT JOIN + COALESCE 补零（全网格无活动为 0），按 family × 周排序', () => {
    expect(sql).toContain('COALESCE(qe.quiz_days_event, 0)')
    expect(sql).toContain('COALESCE(cj.child_device_joins, 0)')
    expect(sql).toContain('ORDER BY g.family_id, g.monday')
  })
  it('匿名红线：SQL 面不触碰 pairing_codes / 口令 / 设备凭据哈希', () => {
    expect(sql).not.toContain('pairing_codes')
    expect(sql).not.toContain('passphrase')
    expect(sql).not.toContain('credential_hash')
    expect(sql).not.toContain('d.name')
  })
  it('空周数组抛错', () => {
    expect(() => buildMetricsSql([])).toThrow('非空')
  })
})

describe('mapExportRows：SQL 聚合行 → 导出行（family_id 仅进程内中转，离开即匿名）', () => {
  const raw = {
    family_id: 'fam-secret-uuid',
    monday: '2026-09-07',
    family_created_monday: '2026-08-31',
    quiz_days_event: 3,
    quiz_days_sync: 2,
    quiz_active: 1,
    redemption_count: 1,
    proposal_touched: 0,
    proposal_created_count: 0,
    first_device_flag: 1,
    child_device_joins: 0,
  }
  const rows = mapExportRows([raw])

  it('anon_id 替换 family_id；周一映射 ISO 周；计数归一 number', () => {
    expect(rows).toHaveLength(1)
    expect(rows[0].anon_id).toBe(anonFamilyId('fam-secret-uuid'))
    expect(rows[0].iso_week).toBe('2026-W37')
    expect(rows[0].family_created_week).toBe('2026-W36')
    expect(rows[0].quiz_days_event).toBe(3)
    expect(typeof rows[0].quiz_active).toBe('number')
  })
  it('导出行无 family_id / monday 明文键，序列化结果不含 family_id 值', () => {
    expect(Object.keys(rows[0])).not.toContain('family_id')
    expect(Object.keys(rows[0])).not.toContain('monday')
    expect(JSON.stringify(rows)).not.toContain('fam-secret-uuid')
  })
})

describe('toCsv：CSV 拼装（UTF-8 逗号分隔、首行表头、行尾换行）', () => {
  it('表头锁定 schema 列序', () => {
    expect(METRIC_COLUMNS.join(',')).toBe(
      'anon_id,family_created_week,iso_week,quiz_days_event,quiz_days_sync,quiz_active,' +
        'redemption_count,proposal_touched,proposal_created_count,first_device_flag,child_device_joins',
    )
  })
  it('空行集 → 仅表头 + 换行（文件结构稳定）', () => {
    expect(toCsv([])).toBe(`${METRIC_COLUMNS.join(',')}\n`)
  })
  it('每行按列序取值拼装，数字零原样输出', () => {
    const row = mapExportRows([
      {
        family_id: 'f',
        monday: '2026-09-07',
        family_created_monday: '2026-08-31',
        quiz_days_event: 0,
        quiz_days_sync: 0,
        quiz_active: 0,
        redemption_count: 0,
        proposal_touched: 1,
        proposal_created_count: 0,
        first_device_flag: 0,
        child_device_joins: 2,
      },
    ])[0]
    const csv = toCsv([row])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3) // 表头 + 数据行 + 末尾空串
    expect(lines[0]).toBe(METRIC_COLUMNS.join(','))
    expect(lines[1]).toBe(`${row.anon_id},2026-W36,2026-W37,0,0,0,0,1,0,0,2`)
    expect(csv.endsWith('\n')).toBe(true)
  })
})

describe('parseMetricsArgs：--weeks 必填正整数 + 开关解析（纯函数不碰进程）', () => {
  it('--weeks 4：正整数通过，remote/json 缺省 false', () => {
    expect(parseMetricsArgs(['--weeks', '4'])).toEqual({ weeks: 4, remote: false, json: false, help: false })
  })
  it('--weeks 4 --remote --json：开关组合任意位置', () => {
    expect(parseMetricsArgs(['--remote', '--weeks', '4', '--json'])).toEqual({ weeks: 4, remote: true, json: true, help: false })
  })
  it('--help / -h：不要求 --weeks，help=true', () => {
    expect(parseMetricsArgs(['--help'])).toEqual({ weeks: undefined, remote: false, json: false, help: true })
    expect(parseMetricsArgs(['-h'])).toEqual({ weeks: undefined, remote: false, json: false, help: true })
  })
  it('缺 --weeks → error（缺省不给大范围默认值，防误跑）', () => {
    const result = parseMetricsArgs([])
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('--weeks')
  })
  it('仅 --remote 缺 --weeks → 仍 error', () => {
    expect(parseMetricsArgs(['--remote']).error).toBeTruthy()
  })
  it('--weeks 0 / 负数 / 非数字 / 缺值 → error', () => {
    expect(parseMetricsArgs(['--weeks', '0']).error).toBeTruthy()
    expect(parseMetricsArgs(['--weeks', '-3']).error).toBeTruthy()
    expect(parseMetricsArgs(['--weeks', 'abc']).error).toBeTruthy()
    expect(parseMetricsArgs(['--weeks']).error).toContain('缺少数值参数')
  })
  it('数字串校验后无注入面：--weeks 后跟任意非数字文本直接拒绝', () => {
    expect(parseMetricsArgs(['--weeks', "4; DROP TABLE families"]).error).toBeTruthy()
  })
  it('未知 flag / 多余位置参数 → error（不静默吞参）', () => {
    expect(parseMetricsArgs(['--foo']).error).toContain('--foo')
    expect(parseMetricsArgs(['--weeks', '4', 'extra']).error).toContain('extra')
  })
})
