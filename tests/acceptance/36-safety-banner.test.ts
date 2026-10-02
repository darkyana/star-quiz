/**
 * #174 数据安全持续横幅验收（源码级守卫）：
 * 文案入册 copy.dataSafety；样式集归宿 components.css（.safety-banner，令牌引用、无硬编码色值）；
 * 外壳宿主 App.vue 绑定 useSafetyNotice 两类持续异常态（升级被拦 / 同步协议不兼容），空串不显示。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { copy } from '../../src/copy'
import { dataUpgradeBlocked, syncProtocolIncompatible, __resetSafetyNoticeForTests } from '../../src/composables/useSafetyNotice'

function repoPath(...parts: string[]): string {
  return resolve(process.cwd(), ...parts)
}

describe('#174 数据安全持续横幅', () => {
  it('文案入册：copy.dataSafety.upgradeBlocked / syncIncompatible 均非空', () => {
    expect(copy.dataSafety.upgradeBlocked.length).toBeGreaterThan(0)
    expect(copy.dataSafety.syncIncompatible.length).toBeGreaterThan(0)
    // 口径：不引导清数据 / 重新配对（切换保护不清本地、不断配对）
    expect(copy.dataSafety.syncIncompatible).toContain('无需重新配对')
  })

  it('样式集归宿 components.css：.safety-banner 存在且只引用设计令牌（无硬编码色值/字号）', () => {
    const css = readFileSync(repoPath('src', 'styles', 'components.css'), 'utf-8')
    const match = /\.safety-banner\s*\{[^}]*\}/.exec(css)
    expect(match, '.safety-banner 样式集应在 components.css').not.toBeNull()
    const body = match![0]
    expect(body).toContain('var(--')
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(body).not.toMatch(/\b\d+px\b/)
  })

  it('外壳宿主 App.vue：绑定 useSafetyNotice 状态与 copy 文案（空串不渲染）', () => {
    const app = readFileSync(repoPath('src', 'App.vue'), 'utf-8')
    expect(app).toContain('useSafetyNotice')
    expect(app).toContain('safety-banner')
    expect(app).toContain('dataSafety')
  })

  it('提示态默认关闭，可独立开关（互不牵连）', () => {
    __resetSafetyNoticeForTests()
    expect(dataUpgradeBlocked.value).toBe(false)
    expect(syncProtocolIncompatible.value).toBe(false)
    dataUpgradeBlocked.value = true
    expect(syncProtocolIncompatible.value).toBe(false)
    __resetSafetyNoticeForTests()
    expect(dataUpgradeBlocked.value).toBe(false)
  })
})
