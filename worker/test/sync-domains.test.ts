/**
 * 同步域 golden 契约测试（#248）：仓库根 sync-domains.golden.json ↔ worker 域清单双向穷举对账。
 * golden 加载：workerd 沙箱无磁盘 fs（readFileSync 打不开仓库路径，#248 探针实证），
 * 经 vite 管线 ?raw 构建期内联同一文件（相对路径 ../../sync-domains.golden.json，从 worker/test 出发）——
 * 仍是文件加载，非跨包代码 import（两包独立编译红线不破）。
 */
import { describe, it, expect } from 'vitest'
import { DOMAINS } from '../src/sync'
import { SYNC_TABLE_NAMES } from '../src/snapshot'
import goldenRaw from '../../sync-domains.golden.json?raw'

const golden = JSON.parse(goldenRaw) as string[]

function sortedUniq(list: readonly string[]): string[] {
  return [...new Set(list)].sort()
}

describe('#248 同步域 golden 契约（worker 侧）', () => {
  it('golden 自身规范：10 域、字母序、无重复', () => {
    expect(golden).toHaveLength(10)
    expect(golden).toEqual([...golden].sort())
    expect(new Set(golden).size).toBe(10)
  })

  it('域定义表 DOMAINS 键集合 == golden（双向穷举）', () => {
    expect(sortedUniq(Object.keys(DOMAINS))).toEqual(sortedUniq(golden))
  })

  it('快照表清单 SYNC_TABLE_NAMES == golden（双向穷举）', () => {
    expect(sortedUniq(SYNC_TABLE_NAMES)).toEqual(sortedUniq(golden))
  })
})
