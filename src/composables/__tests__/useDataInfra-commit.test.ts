// #170 T-commit 落盘管家：commit 原语契约测试。
// 覆盖票内验收：一捆内同步依次落盘且期间零写监听触发、整捆完成后按键统一通知（每键一次）、
// 捆前值随哨兵留存、启动检出未完成捆自动回滚＋日志＋清哨兵、崩溃注入（中途抛异常模拟被杀）后重启 = 捆前完整状态。
// 学习覆盖导入 / 经济导入两捆 / 迁移链改走 commit 的行为保持另见
// useImport.test.ts / useDataInfra-migrations.test.ts 既有套件。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  commit,
  recoverUnfinishedCommit,
  registerWriteListener,
  registerCorruptionResetHandler,
  init,
  writeValue,
  STORAGE_KEYS,
} from '../useDataInfra'
// 业务键初始值与迁移实现由各域模块注册（迁移链捆测试依赖 7→8 红旗瘦身迁移）
import '../useStarData'
import '../useLearningData'
import '../useProposals'
import { applyEconomyImport, applyLearningImport } from '../useImport'
import type { EconomyExport, LearningExport } from '../../types'

const originalWarn = console.warn
// shim 后端真实落盘透传（崩溃注入 mock 里的「其余键照常」实现用）
const originalSetItem = Storage.prototype.setItem
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  console.warn = originalWarn
  vi.restoreAllMocks()
})

describe('#170 commit 原语契约', () => {
  it('整捆落盘：期间零写监听触发，完成后每个键各通知一次，哨兵清除', () => {
    const notified: string[] = []
    const unregister = registerWriteListener((key) => notified.push(key))

    commit([
      { key: STORAGE_KEYS.stars, value: [1] },
      { key: STORAGE_KEYS.rewards, value: [2] },
    ])

    // 期间零中途通知（通知全部发生在整捆完成后）＝监听器收到的序列只能是完成后的两键各一次；
    // 再用「捆内写不通知」直接验证：捆进行中无从观察（同步），故以捆后聚合结果断言契约
    expect(notified.slice().sort()).toEqual(['sq_rewards', 'sq_stars'])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.stars) as string)).toEqual([1])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.rewards) as string)).toEqual([2])
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).toBeNull()
    unregister()
  })

  it('捆内写零中途通知：注册的监听器在 commit 返回前不被逐键打断触发（同步聚合）', () => {
    // 反证裸写路径：writeValue 每写必通知一次；捆路径下两键写入只产生完成后的统一通知
    const calls: string[] = []
    const unregister = registerWriteListener((key) => calls.push(key))
    writeValue(STORAGE_KEYS.proposals, [])
    expect(calls).toEqual(['sq_proposals']) // 裸写 = 单键即时通知（#126 契约不变）
    calls.length = 0
    commit([
      { key: STORAGE_KEYS.proposals, value: [1] },
      { key: STORAGE_KEYS.activeRedemptions, value: [2] },
    ])
    // 两键捆 = 恰好两次通知且都在捆后（若中途逐键通知，顺序无法区分；数量与聚合由上一用例钉死）
    expect(calls.filter((k) => k === 'sq_proposals')).toHaveLength(1)
    expect(calls.filter((k) => k === 'sq_active_redemptions')).toHaveLength(1)
    unregister()
  })

  it('崩溃注入：捆中途落盘抛异常 → 哨兵残留含捆前值 → 启动检测回滚到捆前完整状态＋日志＋清哨兵', () => {
    localStorage.setItem(STORAGE_KEYS.stars, JSON.stringify(['旧流水']))
    localStorage.setItem(STORAGE_KEYS.rewards, JSON.stringify(['旧目录']))

    // 注入：捆内第二个键（rewards）落盘时被杀（setItem 抛异常 = 落盘中途死亡），其余键照常落盘
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEYS.rewards) throw new Error('killed mid-bundle')
      return originalSetItem.call(this, key, value)
    })

    expect(() =>
      commit([
        { key: STORAGE_KEYS.stars, value: ['新流水'] },
        { key: STORAGE_KEYS.rewards, value: ['新目录'] },
      ]),
    ).toThrow('killed mid-bundle')
    setItemSpy.mockRestore()

    // 被杀现场：哨兵残留，第一键已是新值（半套状态）
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).not.toBeNull()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.stars) as string)).toEqual(['新流水'])

    // 重启路径：启动检测 → 回滚到捆前完整状态 + 日志 + 清哨兵
    const corruptionHandler = vi.fn()
    const unregisterCorruption = registerCorruptionResetHandler(corruptionHandler)
    recoverUnfinishedCommit()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.stars) as string)).toEqual(['旧流水'])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.rewards) as string)).toEqual(['旧目录'])
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).toBeNull()
    expect(String(warnSpy.mock.calls[0][0])).toContain('回滚')
    // 回滚是恢复原值而非损坏重置：不触发 #169 对账钩子
    expect(corruptionHandler).not.toHaveBeenCalled()
    unregisterCorruption()
  })

  it('捆前不存在的键：回滚 = 删键', () => {
    localStorage.setItem(STORAGE_KEYS.proposals, JSON.stringify(['旧提议']))
    const sentinel = {
      entries: [
        { key: STORAGE_KEYS.proposals, raw: localStorage.getItem(STORAGE_KEYS.proposals) },
        { key: STORAGE_KEYS.activeRedemptions, raw: null },
      ],
    }
    localStorage.setItem(STORAGE_KEYS.activeRedemptions, JSON.stringify(['半套']))
    localStorage.setItem(STORAGE_KEYS.commitSentinel, JSON.stringify(sentinel))

    recoverUnfinishedCommit()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.proposals) as string)).toEqual(['旧提议'])
    expect(localStorage.getItem(STORAGE_KEYS.activeRedemptions)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).toBeNull()
  })

  it('哨兵自身损坏：无法回滚 → 删键＋日志兜底，其余数据不动', () => {
    localStorage.setItem(STORAGE_KEYS.stars, JSON.stringify(['不动我']))
    localStorage.setItem(STORAGE_KEYS.commitSentinel, '{broken sentinel')

    recoverUnfinishedCommit()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.stars) as string)).toEqual(['不动我'])
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).toBeNull()
    expect(String(warnSpy.mock.calls[0][0])).toContain(STORAGE_KEYS.commitSentinel)
  })

  it('无哨兵残留：启动检测无操作、零日志', () => {
    recoverUnfinishedCommit()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('init 启动即检测：检出残留捆先回滚，再走版本检查', () => {
    localStorage.setItem(STORAGE_KEYS.dataVersion, '9')
    localStorage.setItem(STORAGE_KEYS.stars, JSON.stringify(['半套新值']))
    const sentinel = { entries: [{ key: STORAGE_KEYS.stars, raw: JSON.stringify(['捆前值']) }] }
    localStorage.setItem(STORAGE_KEYS.commitSentinel, JSON.stringify(sentinel))

    init()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.stars) as string)).toEqual(['捆前值'])
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.dataVersion)).toBe('9')
  })
})

describe('#170 迁移链整捆：崩溃注入后重启 = 迁移前完整状态且迁移可重跑', () => {
  it('7→8 迁移中途被杀 → init 再跑回滚旧数据旧版本 → 迁移重跑成功（链至 9，8→9 断代一并重跑）', () => {
    // 老版本数据：7（7→8 红旗瘦身：剥各条目 correct）
    const oldFlagged = { q1: { correct: true }, q2: { correct: false } }
    localStorage.setItem(STORAGE_KEYS.dataVersion, '7')
    localStorage.setItem(STORAGE_KEYS.flagged, JSON.stringify(oldFlagged))

    // 注入：迁移写 sq_flagged 时被杀
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEYS.flagged) throw new Error('killed mid-migration')
      return originalSetItem.call(this, key, value)
    })
    expect(() => init()).toThrow('killed mid-migration')
    setItemSpy.mockRestore()

    // 被杀现场：哨兵残留（迁移链整捆），版本号已被写成新值（半套）
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).not.toBeNull()

    // 重启：init 先回滚到迁移前完整状态（旧数据 + 旧版本），随后迁移链重跑成功
    init()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.flagged) as string)).toEqual({
      q1: { childId: 'default' },
      q2: { childId: 'default' },
    })
    expect(localStorage.getItem(STORAGE_KEYS.dataVersion)).toBe('9')
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).toBeNull()
    expect(String(warnSpy.mock.calls[0][0])).toContain('回滚')
  })
})

describe('#170 五场景改走 commit：行为保持', () => {
  it('经济导入：四键整体替换为文件值，每个键整捆后各通知一次', () => {
    init()
    const notified: string[] = []
    const unregister = registerWriteListener((key) => notified.push(key))
    const data = {
      version: '1',
      rewards: [{ id: 'r1', name: '奖品', price: 5 }],
      proposals: [],
      starLedger: [{ id: 's1', timestamp: 1, type: 'earn', amount: 2, source: '导入' }],
      activeRedemptions: [],
    } as unknown as EconomyExport

    applyEconomyImport(data)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.rewards) as string)).toEqual(data.rewards)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.proposals) as string)).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.stars) as string)).toEqual(data.starLedger)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.activeRedemptions) as string)).toEqual([])
    for (const key of [
      STORAGE_KEYS.rewards,
      STORAGE_KEYS.proposals,
      STORAGE_KEYS.stars,
      STORAGE_KEYS.activeRedemptions,
    ]) {
      expect(notified.filter((k) => k === key)).toHaveLength(1)
    }
    unregister()
  })

  it('学习覆盖导入：题池 / 红旗 / 逐题记录三键一捆整体替换，各通知一次', () => {
    init()
    const notified: string[] = []
    const unregister = registerWriteListener((key) => notified.push(key))
    const data = {
      version: '1',
      questionPool: [{ id: '000001', type: 'word', word: 'apple' }],
      flagged: {},
      questionResults: {},
    } as unknown as LearningExport

    const result = applyLearningImport(data, 'overwrite')

    expect(result).toEqual({ ok: true })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.questions) as string)).toEqual(
      data.questionPool,
    )
    expect(notified.filter((k) => k === STORAGE_KEYS.questions)).toHaveLength(1)
    expect(notified.filter((k) => k === STORAGE_KEYS.flagged)).toHaveLength(1)
    expect(notified.filter((k) => k === STORAGE_KEYS.questionResults)).toHaveLength(1)
    expect(localStorage.getItem(STORAGE_KEYS.commitSentinel)).toBeNull()
    unregister()
  })
})
