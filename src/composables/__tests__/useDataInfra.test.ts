import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  init,
  readValue,
  writeValue,
  readLastExport,
  writeLastExport,
  registerMigrationBackup,
  STORAGE_KEYS,
  CURRENT_DATA_VERSION,
} from '../useDataInfra'
// 业务键初始值与迁移实现由各域模块注册：星星域 useStarData（T2）、学习域 useLearningData（T3）、提议域 useProposals（R32）
import '../useStarData'
import '../useLearningData'
import '../useProposals'
import type { Question, StarEntry } from '../../types'

// mock useExport 下载函数：备份断言只关心调用次数（自 useAppState.test.ts AC-1.4 迁移）。
// 剪环后备份注册上移组合根：测试扮演 main.ts 注册一次（与生产同构，架构评审 20260829）
vi.mock('../useExport', () => {
  const downloadDataExport = vi.fn()
  const downloadLedgerExport = vi.fn()
  return {
    downloadDataExport,
    downloadLedgerExport,
    runMigrationBackup: () => {
      try {
        downloadDataExport()
      } catch (cause) {
        // 备份失败不阻断迁移（与生产语义一致，#169 起补日志）
        const reason = cause instanceof Error ? cause.message : String(cause)
        console.warn(`[star-quiz] 迁移前备份失败（学习文件，不阻断迁移，原因：${reason}）`)
      }
      try {
        downloadLedgerExport()
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        console.warn(`[star-quiz] 迁移前备份失败（经济文件，不阻断迁移，原因：${reason}）`)
      }
    },
  }
})
import { downloadDataExport, downloadLedgerExport, runMigrationBackup } from '../useExport'
const mockedDownloadData = vi.mocked(downloadDataExport)
const mockedDownloadLedger = vi.mocked(downloadLedgerExport)
registerMigrationBackup(runMigrationBackup)

const originalWarn = console.warn
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  mockedDownloadData.mockClear()
  mockedDownloadLedger.mockClear()
})

afterEach(() => {
  console.warn = originalWarn
})

describe('useDataInfra 通用读写原语（含损坏恢复）', () => {
  it('writeValue + readValue 往返：数组 / 字符串 / 对象按 JSON 序列化还原', () => {
    const stars: StarEntry[] = [
      { id: 's1', timestamp: 1724140800000, type: 'earn', amount: 1, source: '答题得星' },
    ]
    writeValue(STORAGE_KEYS.stars, stars)
    writeValue(STORAGE_KEYS.lastExport, '2026-08-26T00:00:00.000Z')

    expect(readValue<StarEntry[]>(STORAGE_KEYS.stars)).toEqual(stars)
    expect(readValue<string>(STORAGE_KEYS.lastExport)).toBe('2026-08-26T00:00:00.000Z')
  })

  it('writeValue 落盘为 JSON 字符串', () => {
    const stars: StarEntry[] = [
      { id: 's2', timestamp: 1724140800001, type: 'redeem', amount: 5, source: '兑换：菠萝油' },
    ]
    writeValue(STORAGE_KEYS.stars, stars)
    expect(localStorage.getItem(STORAGE_KEYS.stars)).toBe(JSON.stringify(stars))
  })

  it('readValue 键缺失 → 重置为注册默认值并返回（sq_last_export → ""）', () => {
    expect(readValue<string>(STORAGE_KEYS.lastExport)).toBe('')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.lastExport) as string)).toBe('')
  })

  it('readValue 损坏 JSON → 重置默认值 + console.warn 含键名', () => {
    localStorage.setItem(STORAGE_KEYS.lastExport, '{invalid json')

    expect(readValue<string>(STORAGE_KEYS.lastExport)).toBe('')
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain('sq_last_export')
  })
})

describe('sq_last_export 归属 useDataInfra（上次导出时间）', () => {
  it('writeLastExport / readLastExport 直接读写 sq_last_export', () => {
    writeLastExport('2026-08-26T12:00:00.000Z')
    expect(readLastExport()).toBe('2026-08-26T12:00:00.000Z')
    expect(localStorage.getItem(STORAGE_KEYS.lastExport)).toBe('"2026-08-26T12:00:00.000Z"')
  })
})

// ===== 自 useAppState.test.ts 迁移（T4 删除该文件，独有断言保留不删）=====
describe('init 启动初始化横切断言（AC4-1 / AC-1.1 / AC4-5 / AC-1.4）', () => {
  it('AC4-1 / AC-1.1 首次启动写入 4 键初始值 + 版本 "9"（逐键断言）', () => {
    init()

    const questions = JSON.parse(localStorage.getItem('sq_questions') as string) as Question[]
    expect(questions).toHaveLength(20)
    expect(questions[0].id).toBe('000001')
    expect(questions[19].id).toBe('000020')

    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual([])

    const rewards = JSON.parse(localStorage.getItem('sq_rewards') as string) as { id: string }[]
    expect(rewards).toHaveLength(3)
    expect(rewards.map((r) => r.id)).toEqual(['reward_pineapple', 'reward_tv', 'reward_sukiyaki'])

    expect(JSON.parse(localStorage.getItem('sq_last_export') as string)).toBe('')
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })

  it('AC4-5 键名边界：sq_ 前缀键恰好为 11 个（含 sq_data_version / sq_morale / sq_recent_words / sq_flagged / sq_question_results / sq_proposals / sq_active_redemptions，#73 R-72-1 有意变更）', () => {
    init()
    const sqKeys = Object.keys(localStorage).filter((k) => k.startsWith('sq_')).sort()
    expect(sqKeys).toEqual([
      'sq_active_redemptions',
      'sq_data_version',
      'sq_flagged',
      'sq_last_export',
      'sq_morale',
      'sq_proposals',
      'sq_question_results',
      'sq_questions',
      'sq_recent_words',
      'sq_rewards',
      'sq_stars',
    ])
  })

  it('AC-1.4 已是当前版本 sq_data_version="9"（#173 起终值）→ 不触发备份 + 版本保持 + 数据不变', () => {
    const stars: StarEntry[] = [
      { id: 's1', timestamp: 1, type: 'earn', amount: 5, source: '答题得星', kind: 'main', childId: 'default' },
    ]
    localStorage.setItem('sq_stars', JSON.stringify(stars))
    localStorage.setItem('sq_data_version', '9')

    init()

    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(stars)
  })
})

describe('init() 数据版本检查（sq_data_version）', () => {
  it('全新安装：写入当前版本 + 已注册键初始化（sq_last_export → ""）', () => {
    init()

    expect(localStorage.getItem(STORAGE_KEYS.dataVersion)).toBe(String(CURRENT_DATA_VERSION))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.lastExport) as string)).toBe('')
  })

  it('已是当前版本：无 warn，版本保持', () => {
    localStorage.setItem(STORAGE_KEYS.dataVersion, String(CURRENT_DATA_VERSION))
    localStorage.setItem(STORAGE_KEYS.lastExport, JSON.stringify(''))

    init()

    expect(localStorage.getItem(STORAGE_KEYS.dataVersion)).toBe(String(CURRENT_DATA_VERSION))
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('版本超前于当前版本：warn 含「版本」提示，版本保持不回滚', () => {
    localStorage.setItem(STORAGE_KEYS.dataVersion, String(CURRENT_DATA_VERSION + 1))

    init()

    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain('版本')
    expect(localStorage.getItem(STORAGE_KEYS.dataVersion)).toBe(String(CURRENT_DATA_VERSION + 1))
  })
})
