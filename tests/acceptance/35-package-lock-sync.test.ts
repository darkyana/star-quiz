/**
 * #107 package-lock 版本同步守卫（防回归）。
 * 事故背景：升版本只改 package.json 而 lock 未随 npm install 同步时，锁文件版本滞后。
 * 守卫断言：根处 lock 顶层 version 与 packages[""].version 均等于
 * 对应 package.json 的 version（1 处 × 2 字段 = 2 断言）；任一字段改旧即红。
 * （原「工具端」条目随家长端小工具移除而删，见 #175；根守卫不削弱。）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface PackageLock {
  version: string
  packages: Record<string, { version?: string }>
}

const TARGETS = [{ name: '根', pkg: 'package.json', lock: 'package-lock.json' }] as const

describe('#107 package-lock 版本同步守卫', () => {
  for (const { name, pkg, lock } of TARGETS) {
    it(`${name}：lock 顶层 version 与 packages[""].version 均等于 package.json 的 version`, () => {
      const pkgVersion = (JSON.parse(readFileSync(resolve(process.cwd(), pkg), 'utf-8')) as { version: string }).version
      const lockJson = JSON.parse(readFileSync(resolve(process.cwd(), lock), 'utf-8')) as PackageLock
      expect(lockJson.version).toBe(pkgVersion)
      expect(lockJson.packages['']?.version).toBe(pkgVersion)
    })
  }
})
