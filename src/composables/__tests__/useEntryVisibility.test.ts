// #262 入口显隐单一出口单测：按入口 id 键控读/写，默认隐藏（未设置 = false）；
// 每入口独立、显式 false 也是事实（落记录可同步）；写入经 writeValue 收口广播写监听。
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readEntryVisibility,
  writeEntryVisibilityValue,
  readEntryVisibilityMap,
  useEntryVisibilityRef,
} from '../useEntryVisibility'
import { STORAGE_KEYS, registerWriteListener, init } from '../useDataInfra'

beforeEach(() => {
  localStorage.clear()
  init()
})

describe('#262 入口显隐单一出口（键控，默认隐藏）', () => {
  it('未设置（键缺失 / 空记录 / 缺该入口）= 默认隐藏', () => {
    expect(readEntryVisibility('builtin-trivia')).toBe(false)
    localStorage.setItem(STORAGE_KEYS.entryVisibility, JSON.stringify({}))
    expect(readEntryVisibility('builtin-trivia')).toBe(false)
    localStorage.setItem(STORAGE_KEYS.entryVisibility, JSON.stringify({ 'mini-garage-prototype': true }))
    expect(readEntryVisibility('builtin-trivia')).toBe(false)
    // JSON 损坏兜底：读取回退默认隐藏，不抛
    localStorage.setItem(STORAGE_KEYS.entryVisibility, '{oops')
    expect(readEntryVisibility('builtin-trivia')).toBe(false)
  })

  it('显式 true 才显示；每入口独立互不串扰', () => {
    writeEntryVisibilityValue('mini-garage-prototype', true)
    expect(readEntryVisibility('mini-garage-prototype')).toBe(true)
    expect(readEntryVisibility('builtin-trivia')).toBe(false)
    writeEntryVisibilityValue('builtin-trivia', true)
    expect(readEntryVisibilityMap()).toEqual({ 'mini-garage-prototype': true, 'builtin-trivia': true })
  })

  it('显式 false 也是事实：落记录（可同步传播），区别于未设置', () => {
    writeEntryVisibilityValue('builtin-trivia', true)
    writeEntryVisibilityValue('builtin-trivia', false)
    expect(readEntryVisibilityMap()).toEqual({ 'builtin-trivia': false })
    expect(readEntryVisibility('builtin-trivia')).toBe(false)
  })

  it('写入广播写监听（键 = sq_entry_visibility）→ 页面订阅即时跟随', () => {
    const seen: string[] = []
    const unregister = registerWriteListener((key) => seen.push(key))
    writeEntryVisibilityValue('builtin-trivia', true)
    unregister()
    expect(seen).toContain(STORAGE_KEYS.entryVisibility)
  })
})

describe('#263 评审 C 收口：响应式显隐 ref（useEntryVisibilityRef）', () => {
  it('写入自动跟随（含显式 false）；同一入口重复取同一 ref；每次取值回读本地重对齐', () => {
    const game = useEntryVisibilityRef('mini-garage-prototype')
    expect(game.value).toBe(false)
    expect(useEntryVisibilityRef('mini-garage-prototype')).toBe(game)
    writeEntryVisibilityValue('mini-garage-prototype', true)
    expect(game.value).toBe(true)
    // 显式 false 也是事实：ref 跟随落关
    writeEntryVisibilityValue('mini-garage-prototype', false)
    expect(game.value).toBe(false)
    // 直接改 localStorage 不经写监听 → 下次取 ref 回读重对齐
    localStorage.setItem(STORAGE_KEYS.entryVisibility, JSON.stringify({ 'mini-garage-prototype': true }))
    expect(useEntryVisibilityRef('mini-garage-prototype').value).toBe(true)
  })
})

// #278 限时通道：到期推导纯函数（假时钟单测；输入档位/到期时间戳/当前时间 → 输出可见性/剩余分钟）
import {
  deriveEntryVisibility,
  deriveEntryVisibilityFromValue,
  entryVisibilityExpiresAtOf,
  entryVisibilityModeOf,
} from '../useEntryVisibility'

describe('#278 到期推导纯函数（deriveEntryVisibility，假时钟）', () => {
  const EXPIRES = 1_800_000_000_000
  const MIN = 60_000

  it('保持开启：可见、无剩余分钟概念', () => {
    expect(deriveEntryVisibility('keep-on', null, EXPIRES)).toEqual({ visible: true, remainingMinutes: null, lessThanOneMinute: false })
  })

  it('关闭：不可见、无剩余分钟概念', () => {
    expect(deriveEntryVisibility('off', null, EXPIRES)).toEqual({ visible: false, remainingMinutes: null, lessThanOneMinute: false })
  })

  it('限时未到期：可见，剩余分钟向下取整（分钟粒度）', () => {
    // 恰好剩 30 分钟
    expect(deriveEntryVisibility('timed', EXPIRES, EXPIRES - 30 * MIN)).toEqual({ visible: true, remainingMinutes: 30, lessThanOneMinute: false })
    // 剩 30 分钟 + 半分钟：向下取整仍记 30
    expect(deriveEntryVisibility('timed', EXPIRES, EXPIRES - 30 * MIN - 30_000)).toEqual({ visible: true, remainingMinutes: 30, lessThanOneMinute: false })
    // 剩 1 分钟整
    expect(deriveEntryVisibility('timed', EXPIRES, EXPIRES - MIN)).toEqual({ visible: true, remainingMinutes: 1, lessThanOneMinute: false })
  })

  it('限时不足 1 分钟：「不到 1 分钟」档（剩余记 0），仍可见', () => {
    expect(deriveEntryVisibility('timed', EXPIRES, EXPIRES - 59_999)).toEqual({ visible: true, remainingMinutes: 0, lessThanOneMinute: true })
    expect(deriveEntryVisibility('timed', EXPIRES, EXPIRES - 1)).toEqual({ visible: true, remainingMinutes: 0, lessThanOneMinute: true })
  })

  it('限时恰好归零（当前时间 = 到期时间）按已过期：不可见、剩余 0、不到 1 分钟档', () => {
    expect(deriveEntryVisibility('timed', EXPIRES, EXPIRES)).toEqual({ visible: false, remainingMinutes: 0, lessThanOneMinute: true })
  })

  it('限时已过期：不可见、剩余 0、不到 1 分钟档（纯推导无写回，记录不动）', () => {
    expect(deriveEntryVisibility('timed', EXPIRES, EXPIRES + 5 * MIN)).toEqual({ visible: false, remainingMinutes: 0, lessThanOneMinute: true })
  })

  it('改档语义：清除到期（限时 → 保持开启/关闭）与重想起算（同档换到期时间戳）由输入档位/时间戳直接表达', () => {
    // 清除到期：改档即推导基准切换，不依赖写回
    expect(deriveEntryVisibility('keep-on', null, EXPIRES + 5 * MIN).visible).toBe(true)
    // 重想起算：同一档位换新到期时间戳，剩余分钟从新起点算
    expect(deriveEntryVisibility('timed', EXPIRES + 10 * MIN, EXPIRES + 3 * MIN).remainingMinutes).toBe(7)
  })
})

describe('#278 记录条目值 → 档位/到期（存量布尔照旧解释，无感迁移）', () => {
  it('entryVisibilityModeOf / entryVisibilityExpiresAtOf / deriveEntryVisibilityFromValue', () => {
    expect(entryVisibilityModeOf(undefined)).toBe('off')
    expect(entryVisibilityModeOf(false)).toBe('off')
    expect(entryVisibilityModeOf(true)).toBe('keep-on')
    expect(entryVisibilityModeOf({ visible: true, expires_at: 5 })).toBe('timed')
    expect(entryVisibilityExpiresAtOf(true)).toBeNull()
    expect(entryVisibilityExpiresAtOf(false)).toBeNull()
    expect(entryVisibilityExpiresAtOf({ visible: true, expires_at: 5 })).toBe(5)
    // 读取便捷形：存量布尔行为零变化（true 可见、false/缺失隐藏）
    expect(deriveEntryVisibilityFromValue(true, 1).visible).toBe(true)
    expect(deriveEntryVisibilityFromValue(false, 1).visible).toBe(false)
    expect(deriveEntryVisibilityFromValue(undefined, 1).visible).toBe(false)
    // 限时条目按当前时间推导
    expect(deriveEntryVisibilityFromValue({ visible: true, expires_at: 10 }, 5).visible).toBe(true)
    expect(deriveEntryVisibilityFromValue({ visible: true, expires_at: 10 }, 10).visible).toBe(false)
  })

  it('readEntryVisibility 对限时记录按当前时间推导（未到期可见、过期隐藏）', () => {
    localStorage.setItem(STORAGE_KEYS.entryVisibility, JSON.stringify({ 'builtin-trivia': { visible: true, expires_at: Date.now() + 60_000 } }))
    expect(readEntryVisibility('builtin-trivia')).toBe(true)
    localStorage.setItem(STORAGE_KEYS.entryVisibility, JSON.stringify({ 'builtin-trivia': { visible: true, expires_at: Date.now() - 1 } }))
    expect(readEntryVisibility('builtin-trivia')).toBe(false)
  })
})
