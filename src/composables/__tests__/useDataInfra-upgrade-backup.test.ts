// #174 T-本次 8→9 数据升级保障·切片1：升级前恢复副本（可持久化、可校验、可恢复）。
// 票面 Desired behavior 2/3：修改旧数据前先持久化并校验足以恢复本次迁移涉及数据的副本；
// 副本保存失败时不继续修改原数据；不以「已发起浏览器下载」作为成功凭据（下载仍保留但不是闸门）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, readUpgradeBackup, restoreUpgradeBackup, STORAGE_KEYS } from '../useDataInfra'
import { dataUpgradeBlocked, __resetSafetyNoticeForTests } from '../useSafetyNotice'
// 迁移链实现与业务键初始值由各域模块注册（与生产同构）
import '../useStarData'
import '../useLearningData'
import '../useProposals'
import type { StarEntry } from '../../types'

function makeStars(count: number): StarEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    timestamp: 1724140800000 + i,
    type: 'earn',
    amount: 1,
    source: '答题得星',
  }))
}

/** 8 版老用户现场：版本 8 + 旧形状业务数据（含待改名整搬的 sq_proficiency） */
function seedV8Data(): { stars: string; proficiency: string } {
  const stars = JSON.stringify(makeStars(2))
  const proficiency = JSON.stringify({ level: 2, lastRoundCorrect: 4 })
  localStorage.setItem('sq_data_version', '8')
  localStorage.setItem('sq_stars', stars)
  localStorage.setItem('sq_proficiency', proficiency)
  localStorage.setItem('sq_recent_words', JSON.stringify({ seq: 2, words: { a: 2, b: 1 } }))
  return { stars, proficiency }
}

beforeEach(() => {
  localStorage.clear()
  __resetSafetyNoticeForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetSafetyNoticeForTests()
})

describe('#174 升级前恢复副本：正常路径', () => {
  it('v8 → init → 副本持久化（含迁移前原始值）且校验通过，迁移照常完成', () => {
    const { stars, proficiency } = seedV8Data()

    init()

    // 副本持久化在读得到的位置，且能通过校验（readUpgradeBackup 非 null = 校验通过）
    const backup = readUpgradeBackup()
    expect(backup).not.toBeNull()
    expect(backup!.fromVersion).toBe(8)
    const byKey = new Map(backup!.entries.map((e) => [e.key, e.raw]))
    // 迁移前原始值：旧流水（无 kind/childId）与待改名的 sq_proficiency 原文
    expect(byKey.get('sq_stars')).toBe(stars)
    expect(byKey.get('sq_proficiency')).toBe(proficiency)
    // 迁移照常完成
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)[0].childId).toBe('default')
  })

  it('副本可恢复：restoreUpgradeBackup 把迁移前原值写回并回退版本号，下次启动重跑迁移', () => {
    const { stars, proficiency } = seedV8Data()
    init()
    expect(localStorage.getItem('sq_data_version')).toBe('9')

    expect(restoreUpgradeBackup()).toBe(true)

    expect(localStorage.getItem('sq_stars')).toBe(stars)
    expect(localStorage.getItem('sq_proficiency')).toBe(proficiency)
    expect(localStorage.getItem('sq_morale')).toBeNull()
    // #174 审查修复：版本号一并回退到迁移前，init 识别为待升级现场（否则 v8 形状数据被 v9 代码读取、迁移不再重跑）
    expect(localStorage.getItem('sq_data_version')).toBe('8')

    // 下次启动重跑迁移链，回到已完成状态
    init()
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)[0].childId).toBe('default')
  })

  it('副本损坏后 readUpgradeBackup 返回 null、restore 返回 false（不盲恢复）', () => {
    seedV8Data()
    init()
    localStorage.setItem(STORAGE_KEYS.upgradeBackup, '{broken')

    expect(readUpgradeBackup()).toBeNull()
    expect(restoreUpgradeBackup()).toBe(false)
    // 不动现役数据
    expect(localStorage.getItem('sq_data_version')).toBe('9')
  })
})

describe('#174 升级前恢复副本：保存/校验失败 → 不修改原数据', () => {
  it('副本写入失败（磁盘满）→ 版本保持 8、业务键零改动、明确警告；故障解除后再启动完成迁移', () => {
    const { stars } = seedV8Data()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === STORAGE_KEYS.upgradeBackup) throw new Error('disk full')
      return originalSetItem.call(this, key, value)
    })

    try {
      init()
    } finally {
      setItem.mockRestore()
    }

    // 不继续修改原数据：版本不升、既有业务键原文不动、旧键不删（读取兜底可为缺失键补默认值，不改既有数据）
    expect(localStorage.getItem('sq_data_version')).toBe('8')
    expect(localStorage.getItem('sq_stars')).toBe(stars)
    expect(localStorage.getItem('sq_proficiency')).toBe(JSON.stringify({ level: 2, lastRoundCorrect: 4 }))
    expect(warnSpy).toHaveBeenCalled()
    expect(dataUpgradeBlocked.value).toBe(true)

    // 故障解除 → 再次启动重试成功
    warnSpy.mockRestore()
    init()
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(readUpgradeBackup()).not.toBeNull()
  })

  it('副本读回校验失败（写后读损坏）→ 同样中止迁移，不把半套保障当成功', () => {
    seedV8Data()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const originalGetItem = localStorage.getItem.bind(localStorage)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === STORAGE_KEYS.upgradeBackup) return '{broken'
      return originalGetItem.call(this, key)
    })

    init()

    expect(localStorage.getItem('sq_data_version')).toBe('8')
    expect(dataUpgradeBlocked.value).toBe(true)
  })
})
