// #169 T-损坏处理三类收口与三态读：三类损坏行为（家底重置+对账钩子 / 临时删键+日志 /
// 机器自用回退+日志）与三态读契约（ok / missing / corrupt）的集中测试。
// 家底重置+日志的既有断言在 useDataInfra.test.ts / useDataInfra-recovery.test.ts，此处不重复削弱。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  readValue,
  readOptionalValue,
  registerCorruptionResetHandler,
  STORAGE_KEYS,
} from '../useDataInfra'
import '../useStarData'
import '../useLearningData'
import { readQuizMode } from '../useQuizMode'
import { runMigrationBackup } from '../useExport'
import type { StarEntry } from '../../types'

const originalWarn = console.warn
let warnSpy: ReturnType<typeof vi.spyOn>

function warns(): string[] {
  return warnSpy.mock.calls.map((c) => String(c[0]))
}

beforeEach(() => {
  localStorage.clear()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  console.warn = originalWarn
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

// ===== 三态读契约（readOptionalValue）=====

describe('#169 readOptionalValue 三态返回契约', () => {
  it('ok：合法 JSON → { status: "ok", value }', () => {
    localStorage.setItem(STORAGE_KEYS.session, 'true')
    expect(readOptionalValue<boolean>(STORAGE_KEYS.session)).toEqual({ status: 'ok', value: true })
  })

  it('missing：键不存在 → { status: "missing" }，不落盘无副作用', () => {
    expect(readOptionalValue<unknown>(STORAGE_KEYS.session)).toEqual({ status: 'missing' })
    expect(localStorage.getItem(STORAGE_KEYS.session)).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('corrupt：JSON 非法 → { status: "corrupt" } 带原因，原语本身不删键不日志（调用方收口）', () => {
    localStorage.setItem(STORAGE_KEYS.session, '{invalid json')
    const result = readOptionalValue<unknown>(STORAGE_KEYS.session)
    expect(result.status).toBe('corrupt')
    if (result.status === 'corrupt') expect(result.reason.length).toBeGreaterThan(0)
    // 原语纯读：键原样保留、零日志（临时键口径由调用方落地）
    expect(localStorage.getItem(STORAGE_KEYS.session)).toBe('{invalid json')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ===== 家底：损坏 = 日志 + 重置 + 对账钩子 =====

describe('#169 家底键损坏：重置后触发对账钩子（可注册接口）', () => {
  it('sq_stars 损坏重置 → 钩子收到键名；重置 + 日志行为不变', () => {
    const handler = vi.fn()
    const unregister = registerCorruptionResetHandler(handler)
    localStorage.setItem(STORAGE_KEYS.stars, '[1,2,3')

    const stars = readValue<StarEntry[]>(STORAGE_KEYS.stars)

    expect(stars).toEqual([])
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(STORAGE_KEYS.stars)
    expect(warns().some((m) => m.includes('sq_stars'))).toBe(true)
    unregister()
  })

  it('多处理器都收到通知；注销后不再触发', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = registerCorruptionResetHandler(a)
    registerCorruptionResetHandler(b)
    localStorage.setItem(STORAGE_KEYS.proposals, '{broken')
    readValue<unknown>(STORAGE_KEYS.proposals)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    offA()
    localStorage.setItem(STORAGE_KEYS.proposals, '[also broken')
    readValue<unknown>(STORAGE_KEYS.proposals)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('机器自用键（sq_last_export，永不出本机）损坏重置不触发钩子（铁律只约束上云参与键）', () => {
    const handler = vi.fn()
    registerCorruptionResetHandler(handler)
    localStorage.setItem(STORAGE_KEYS.lastExport, '{broken')
    expect(readValue<string>(STORAGE_KEYS.lastExport)).toBe('')
    expect(handler).not.toHaveBeenCalled()
  })

  it('合法数据读取不触发钩子', () => {
    const handler = vi.fn()
    registerCorruptionResetHandler(handler)
    localStorage.setItem(STORAGE_KEYS.stars, JSON.stringify([]))
    readValue<StarEntry[]>(STORAGE_KEYS.stars)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('#169 临时键（出题模式）值非法：对齐注释口径删键（#168 遗留缺口收口）', () => {
  it('sq_quiz_mode 值非法 → 删键 + 日志 + 回 normal', () => {
    localStorage.setItem(STORAGE_KEYS.quizMode, '"hacker"')

    expect(readQuizMode()).toBe('normal')
    expect(localStorage.getItem(STORAGE_KEYS.quizMode)).toBeNull()
    expect(warns().some((m) => m.includes('sq_quiz_mode') && m.includes('值非法'))).toBe(true)
  })

  it('合法值保持：fresh 原样返回不删键不日志', () => {
    localStorage.setItem(STORAGE_KEYS.quizMode, JSON.stringify('fresh'))
    expect(readQuizMode()).toBe('fresh')
    expect(localStorage.getItem(STORAGE_KEYS.quizMode)).toBe(JSON.stringify('fresh'))
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ===== 机器自用路径：维持回退 + 补日志（迁移前备份双 catch）=====

describe('#169 迁移前备份失败：留档失败不阻断迁移 + 补日志', () => {
  it('下载失败 → 两条 warn（学习 / 经济文件），不抛出', () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      void this.download
      throw new Error('下载器故障')
    })

    expect(() => runMigrationBackup()).not.toThrow()
    const messages = warns()
    expect(messages.some((m) => m.includes('迁移前备份失败') && m.includes('学习文件'))).toBe(true)
    expect(messages.some((m) => m.includes('迁移前备份失败') && m.includes('经济文件'))).toBe(true)
  })
})
