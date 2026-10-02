/**
 * 同步域 golden 契约测试（#248）：仓库根 sync-domains.golden.json ↔ 客户端域清单双向穷举对账。
 * golden 是全仓唯一需人工维护的契约文件；本测试把客户端三处域清单钉在它上面——
 * 域类型联合 / 引擎域清单 / 域适配器表任一与 golden 漂移（多一项或少一项）当场红。
 * 加新同步域的正确姿势：golden + 类型联合 + SYNC_DOMAINS + ADAPTERS 四处同改（worker 侧另有对账测试）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SYNC_DOMAINS, ADAPTERS, type SyncDomain } from '../sync'

// happy-dom 环境下 import.meta.url 为 http scheme（readFileSync 拒绝非 file URL），
// 根套件固定自仓库根运行，golden 定位走 cwd 相对路径。
const golden = JSON.parse(
  readFileSync(resolve(process.cwd(), 'sync-domains.golden.json'), 'utf8'),
) as string[]

// 编译期穷举探针（有意字面量，不算第二份生产清单）：Record<SyncDomain, string> 要求键
// 恰为类型联合——类型联合漏域或多域时 vue-tsc 与本套件双红，运行时再与 golden 双向对账。
const DOMAIN_PROBE: Record<SyncDomain, string> = {
  star_entries: '星流水',
  question_results: '逐题结果',
  word_appearances: '近期词',
  reward_items: '奖品行',
  proposals: '提议行',
  active_redemptions: '兑换中行',
  question_flags: '标记行',
  question_banks: '题库整组',
  morale: '临场状态',
  entry_visibility: '入口显隐',
}

function sortedUniq(list: readonly string[]): string[] {
  return [...new Set(list)].sort()
}

describe('#248 同步域 golden 契约（客户端侧）', () => {
  it('golden 自身规范：10 域、字母序、无重复', () => {
    expect(golden).toHaveLength(10)
    expect(golden).toEqual([...golden].sort())
    expect(new Set(golden).size).toBe(10)
  })

  it('域类型穷举映射 Record<SyncDomain, string> 键集合 == golden（双向穷举）', () => {
    expect(sortedUniq(Object.keys(DOMAIN_PROBE))).toEqual(sortedUniq(golden))
  })

  it('同步引擎域清单 SYNC_DOMAINS == golden（双向穷举）', () => {
    expect(sortedUniq(SYNC_DOMAINS)).toEqual(sortedUniq(golden))
  })

  it('域适配器表 ADAPTERS 键集合 == golden（双向穷举）', () => {
    expect(sortedUniq(Object.keys(ADAPTERS))).toEqual(sortedUniq(golden))
  })
})
