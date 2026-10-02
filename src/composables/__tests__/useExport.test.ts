/**
 * T4 导出流程单测（Spec §4 REQ-3/REQ-4，AC3-2 / AC4-2 下载与写键部分）
 * Blob 下载：URL.createObjectURL spy + HTMLAnchorElement.click spy 捕获 a.download；
 * 导出成功 → writeLastExport(exportedAt ISO)；jsdom 无真实下载。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyLearningImport } from '../useImport'
import { downloadDataExport, downloadLedgerExport } from '../useExport'
import { init as initAppState, readLastExport } from '../useDataInfra'
import { questions as readQuestions, writeQuestions, writeFlagged, flagged, writeQuestionResults, questionResults } from '../useLearningData'
import { rewards as readRewards, writeLedger as writeStars } from '../useStarData'
import type { QuestionResultsState, StarEntry } from '../../types'

const RESULTS_KEY = 'sq_question_results'

let createObjectURLSpy: ReturnType<typeof vi.fn>
let revokeObjectURLSpy: ReturnType<typeof vi.fn>
let clickSpy: ReturnType<typeof vi.spyOn>
let capturedBlob: Blob | null = null
let capturedFilename = ''

/** jsdom 25 的 Blob 无 .text()，用 FileReader 读取 */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  capturedBlob = null
  capturedFilename = ''
  createObjectURLSpy = vi.fn((b: Blob) => {
    capturedBlob = b
    return 'blob:mock-url'
  })
  revokeObjectURLSpy = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: createObjectURLSpy, revokeObjectURL: revokeObjectURLSpy })
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    capturedFilename = this.download
  })
})

afterEach(() => {
  clickSpy.mockRestore()
  vi.unstubAllGlobals()
})

describe('AC3-2 数据管理导出（学习文件，R36 起，#173 升 LearningExport 3.0）', () => {
  it('学习文件下载→校验→覆盖导入，保真同题两孩红旗和各自五次记录', async () => {
    writeQuestions([readQuestions()[0]])
    const qid = readQuestions()[0].id
    for (const childId of ['default', 'sibling']) {
      writeFlagged({ [qid]: { flaggedAt: childId === 'default' ? 10 : 20, childId } }, childId)
      writeQuestionResults({ [qid]: Array.from({ length: 5 }, (_, i) => ({ outcome: 'correct', timestamp: new Date(10000 - i).toISOString(), childId })) }, childId)
    }
    downloadDataExport()
    const imported = validateLearningImport(await readBlobText(capturedBlob!))
    expect(imported.ok).toBe(true)
    if (!imported.ok) throw new Error(imported.reason)
    expect(Object.values(imported.data.flagged)).toHaveLength(2)
    expect(imported.data.questionResults[qid]).toHaveLength(10)
    localStorage.clear()
    expect(applyLearningImport(imported.data, 'overwrite')).toEqual({ ok: true })
    expect(flagged()[qid]).toEqual({ flaggedAt: 10, childId: 'default' })
    expect(flagged('sibling')[qid]).toEqual({ flaggedAt: 20, childId: 'sibling' })
    expect(questionResults()[qid]).toHaveLength(5)
    expect(questionResults('sibling')[qid]).toHaveLength(5)
  })
  it('Blob 内容 = LearningExport + 文件名匹配 + writeLastExport 写入 exportedAt', async () => {
    const now = new Date(2026, 7, 21, 18, 30, 0)
    const exportedAt = downloadDataExport(now)

    expect(exportedAt).toBe(now.toISOString())
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    // R36 自主决策 #2：学习文件前缀 star-quiz-learning-
    expect(capturedFilename).toMatch(/^star-quiz-learning-\d{8}-\d{6}\.json$/)

    const text = await readBlobText(capturedBlob!)
    // R36 REQ-R36-1：学习文件五字段（version/exportedAt/questionPool/flagged/questionResults），不含经济字段
    expect(JSON.parse(text)).toEqual({
      version: '3.0',
      exportedAt: now.toISOString(),
      questionPool: readQuestions(),
      flagged: {},
      questionResults: {},
    })

    expect(readLastExport()).toBe(now.toISOString())
  })
})

describe('AC4-2 流水管理导出（经济文件，R32 起 2.1，#75 升 2.2，#173 升 2.3，#299 升 2.4）', () => {
  it('Blob 内容 = EconomyExport + 文件名匹配 + writeLastExport 写入 exportedAt', async () => {
    const stars: StarEntry[] = [
      { id: 's1', timestamp: 1724230000000, type: 'earn', amount: 7, source: '答题得星' },
      { id: 's2', timestamp: 1724230000100, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
    ]
    writeStars(stars)

    const now = new Date(2026, 7, 21, 18, 31, 5)
    const exportedAt = downloadLedgerExport(now)

    expect(exportedAt).toBe(now.toISOString())
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    // R36 自主决策 #2：经济文件前缀 star-quiz-economy-
    expect(capturedFilename).toMatch(/^star-quiz-economy-\d{8}-\d{6}\.json$/)

    const text = await readBlobText(capturedBlob!)
    // R32 REQ-R32-8-1：proposals 为 sq_proposals 全量（全新安装为 []）；#75（R-72-3）：version '2.2'，activeRedemptions = sq_active_redemptions 全量（全新安装为 []）
    expect(JSON.parse(text)).toEqual({
      version: '2.4',
      exportedAt: now.toISOString(),
      rewards: readRewards(),
      proposals: [],
      starLedger: stars.map((s) => ({ ...s, childId: 'default', kind: 'main' })),
      activeRedemptions: [],
    })

    expect(readLastExport()).toBe(now.toISOString())
  })
})

describe('AC-R27-4 导出扩展（R36；#173 升位 3.0/2.3：version + questionResults）', () => {
  it('AC-R27-4-1 学习文件含 questionResults 全量快照：version "3.0" 且与 localStorage 当前值逐字相等（孤儿记录不过滤）', async () => {
    // 2 题共 8 条：题 000001 满窗口 5 条；999999 为孤儿（题池无此题）3 条，导出须原样带上
    const results: QuestionResultsState = {
      '000001': [
        { outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' },
        { outcome: 'wrong', timestamp: '2026-08-25T10:00:00.000Z' },
        { outcome: 'skipped', timestamp: '2026-08-24T10:00:00.000Z' },
        { outcome: 'correct', timestamp: '2026-08-24T10:00:00.000Z' },
        { outcome: 'wrong', timestamp: '2026-08-23T10:00:00.000Z' },
      ],
      '999999': [
        { outcome: 'wrong', timestamp: '2026-08-25T10:00:00.000Z' },
        { outcome: 'wrong', timestamp: '2026-08-24T10:00:00.000Z' },
        { outcome: 'correct', timestamp: '2026-08-23T10:00:00.000Z' },
      ],
    }
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results))

    downloadDataExport(new Date(2026, 7, 25, 12, 0, 0))

    const text = await readBlobText(capturedBlob!)
    const parsed = JSON.parse(text)
    expect(parsed.version).toBe('3.0')
    expect(parsed.questionResults).toEqual({
      '000001': results['000001'].map((r) => ({ ...r, childId: 'default' })),
      '999999': results['999999'].map((r) => ({ ...r, childId: 'default' })),
    })
    expect(localStorage.getItem(RESULTS_KEY)).toBe(JSON.stringify(results))
    expect(parsed.questionResults['000001']).toHaveLength(5)
    expect(parsed.questionResults['999999']).toHaveLength(3)
  })

  it('AC-R27-4-2 经济文件不含学习字段：version "2.4"（#299 随动）且无 questionResults / flagged / questionPool 字段', async () => {
    localStorage.setItem(
      RESULTS_KEY,
      JSON.stringify({ '000001': [{ outcome: 'correct', timestamp: '2026-08-25T00:00:00.000Z' }] }),
    )

    downloadLedgerExport(new Date(2026, 7, 25, 12, 1, 0))

    const text = await readBlobText(capturedBlob!)
    const parsed = JSON.parse(text)
    expect(parsed.version).toBe('2.4')
    expect(parsed).not.toHaveProperty('questionResults')
    expect(Object.keys(parsed).sort()).toEqual(['activeRedemptions', 'exportedAt', 'proposals', 'rewards', 'starLedger', 'version'])
  })
})

// ===== #172 导入前自动备份联动（按配对状态分流）+ 迁移前备份失败日志 =====

import { autoBackupBeforeImport, runMigrationBackup } from '../useExport'
import { validateLearningImport, validateEconomyImport } from '../../utils/importExport'
import { writeDeviceCredential, readDeviceCredential } from '../useDeviceCredential'

describe('#172 autoBackupBeforeImport：未配对设备导入确认前自动全量备份', () => {
  it('未配对（无 sq_device_credential）→ 学习 + 经济两份备份文件下载，且下载产物可走导入通道回环验证', async () => {
    expect(readDeviceCredential()).toBe(null)
    const blobs: Blob[] = []
    const filenames: string[] = []
    createObjectURLSpy.mockImplementation((b: Blob) => {
      blobs.push(b)
      return 'blob:mock-url'
    })
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      filenames.push(this.download)
    })

    autoBackupBeforeImport()

    expect(filenames).toHaveLength(2)
    expect(filenames[0]).toMatch(/^star-quiz-learning-\d{8}-\d{6}\.json$/)
    expect(filenames[1]).toMatch(/^star-quiz-economy-\d{8}-\d{6}\.json$/)
    // 「该文件可导入」＝反向走既有导入通道：下载产物原样通过两组校验
    const learningText = await readBlobText(blobs[0])
    expect(validateLearningImport(learningText).ok).toBe(true)
    const economyText = await readBlobText(blobs[1])
    expect(validateEconomyImport(economyText).ok).toBe(true)
  })

  it('已配对（有 sq_device_credential，数据有云端兜底）→ 不弹备份文件', () => {
    writeDeviceCredential({ device_id: 'd1', secret: 's1', role: 'parent', name: '家长机' })

    autoBackupBeforeImport()

    expect(createObjectURLSpy).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
  })
})

describe('#172 迁移前备份失败日志（双 catch 各有日志）', () => {
  it('两份备份下载均抛错 → 学习 / 经济各一条 console.warn，且不抛出（不阻断迁移）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createObjectURLSpy.mockImplementation(() => {
      throw new Error('mock download failure')
    })

    expect(() => runMigrationBackup()).not.toThrow()

    const messages = warnSpy.mock.calls.map((args) => String(args[0]))
    expect(messages.some((m) => m.includes('迁移前备份失败（学习文件'))).toBe(true)
    expect(messages.some((m) => m.includes('迁移前备份失败（经济文件'))).toBe(true)
    expect(messages).toHaveLength(2)
    warnSpy.mockRestore()
  })

  it('单份失败（学习成功、经济抛错）→ 仅经济一条日志', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let called = false
    createObjectURLSpy.mockImplementation(() => {
      if (called) throw new Error('mock download failure')
      called = true
      return 'blob:mock-url'
    })

    runMigrationBackup()

    const messages = warnSpy.mock.calls.map((args) => String(args[0]))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('迁移前备份失败（经济文件')
    warnSpy.mockRestore()
  })
})
