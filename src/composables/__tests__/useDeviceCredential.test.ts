/**
 * 设备配对凭据单测（#125，R-P1c）：sq_device_credential 读写单一出口、损坏恢复、
 * 设备本地键口径（不进导出/同步域的边界由 34-export-contract 验收断言）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  DEVICE_CREDENTIAL_KEY,
  readDeviceCredential,
  writeDeviceCredential,
  type DeviceCredential,
} from '../useDeviceCredential'

const VALID: DeviceCredential = {
  device_id: 'dev-000',
  secret: 'a'.repeat(64),
  role: 'parent',
  name: '家长手机',
}

beforeEach(() => {
  localStorage.clear()
})

describe('readDeviceCredential / writeDeviceCredential', () => {
  it('未配对（键缺失）→ null', () => {
    expect(readDeviceCredential()).toBeNull()
  })

  it('写入后读回完整凭据（JSON 落盘，字段逐字一致）', () => {
    writeDeviceCredential(VALID)
    expect(readDeviceCredential()).toEqual(VALID)
    const raw = localStorage.getItem(DEVICE_CREDENTIAL_KEY)
    expect(JSON.parse(raw as string)).toEqual(VALID)
  })

  it('child 角色凭据照常读回（#84 设备角色）', () => {
    writeDeviceCredential({ ...VALID, role: 'child', name: '孩子平板' })
    expect(readDeviceCredential()?.role).toBe('child')
  })

  it('#144 重申请替换的本地面：二次写入整键覆盖（旧 device_id/secret/role/name 全部消失，读到新凭据）', () => {
    writeDeviceCredential(VALID)
    const renewed: DeviceCredential = {
      device_id: 'dev-999',
      secret: 'b'.repeat(64),
      role: 'child',
      name: '孩子的新平板',
    }
    writeDeviceCredential(renewed)
    expect(readDeviceCredential()).toEqual(renewed)
    const raw = localStorage.getItem(DEVICE_CREDENTIAL_KEY)
    expect(JSON.parse(raw as string)).toEqual(renewed) // 落盘即新值，无旧字段残留
  })
})

describe('损坏恢复（E1 口径：非法值 → 移除键按未配对处理）', () => {
  it('非 JSON 文本 → 移除键返回 null', () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, 'not-json')
    expect(readDeviceCredential()).toBeNull()
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBeNull()
  })

  it('字段非法（secret 空 / 角色越界 / 缺 name）→ 移除键返回 null', () => {
    for (const bad of [
      { ...VALID, secret: '' },
      { ...VALID, role: 'guest' },
      { device_id: 'dev-000', secret: 'x', role: 'parent' },
      'plain string',
      42,
    ]) {
      localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(bad))
      expect(readDeviceCredential(), JSON.stringify(bad)).toBeNull()
      expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBeNull()
    }
  })
})

describe('单一出口门禁（#125 完成标准：键名读写无散落；#168 起键名字面量单一来源 = 登记册）', () => {
  it('src/ 源码（跳过 __tests__）中 sq_device_credential 字面量仅出现在 useDataInfra.ts 登记册', () => {
    function collectSrcFiles(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue
          collectSrcFiles(p, out)
        } else if (/\.(ts|vue)$/.test(entry.name)) {
          out.push(p)
        }
      }
      return out
    }
    const files = collectSrcFiles(resolve(process.cwd(), 'src'))
    expect(files.length).toBeGreaterThan(0)
    const hits = files.filter((file) => readFileSync(file, 'utf-8').includes(DEVICE_CREDENTIAL_KEY))
    // #168 收编：键名字面量的落点 = useDataInfra 登记册（单一来源）+ useDeviceCredential 头注释（文档性提及）
    expect(hits).toEqual([
      resolve(process.cwd(), 'src', 'composables', 'useDataInfra.ts'),
      resolve(process.cwd(), 'src', 'composables', 'useDeviceCredential.ts'),
    ])
    // 持有方代码里字面量只允许出现在注释行（读写一律经 STORAGE_KEYS / 原语）
    const holderSource = readFileSync(resolve(process.cwd(), 'src', 'composables', 'useDeviceCredential.ts'), 'utf-8')
    const codeLines = holderSource.split('\n').filter((l) => !l.trim().startsWith('//'))
    expect(codeLines.some((l) => l.includes(DEVICE_CREDENTIAL_KEY as string))).toBe(false)
  })
})
