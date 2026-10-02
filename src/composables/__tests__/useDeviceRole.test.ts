/**
 * 设备角色唯一出口单测（#252）：双口径——
 * 同步读 deviceRole() 返回现值；响应式 useDeviceRole() 订阅即取现值、写凭据后自动跟随；
 * 删凭据后回未配对态（删除原语无写监听通知，旧订阅不跟随，由消费点「本地清空 / 重挂载」兜底——
 * 模块头注释口径；本测以同步读 + 新订阅断言「回未配对态」）；
 * 损坏凭据按凭据模块既有口径处理（读取时删键回未配对，E1）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEVICE_CREDENTIAL_KEY,
  deleteDeviceCredential,
  writeDeviceCredential,
  type DeviceCredential,
} from '../useDeviceCredential'
import { deviceRole, useDeviceRole } from '../useDeviceRole'

const VALID: DeviceCredential = {
  device_id: 'dev-000',
  secret: 'a'.repeat(64),
  role: 'parent',
  name: '家长手机',
}

beforeEach(() => {
  localStorage.clear()
})

describe('同步读 deviceRole()：导航瞬间取值场合', () => {
  it('未配对（键缺失）→ null', () => {
    expect(deviceRole()).toBeNull()
  })

  it('已配对返回现值：parent / child', () => {
    writeDeviceCredential(VALID)
    expect(deviceRole()).toBe('parent')
    writeDeviceCredential({ ...VALID, role: 'child', name: '孩子平板' })
    expect(deviceRole()).toBe('child')
  })

  it('删凭据后回未配对态：同步读 null，新订阅亦取 null', () => {
    writeDeviceCredential(VALID)
    expect(deviceRole()).toBe('parent')
    deleteDeviceCredential()
    expect(deviceRole()).toBeNull()
    expect(useDeviceRole().value).toBeNull()
  })

  it('损坏凭据按凭据模块既有口径处理：非 JSON / 角色越界 → 读取时删键回 null', () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, 'not-json')
    expect(deviceRole()).toBeNull()
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBeNull()
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify({ ...VALID, role: 'guest' }))
    expect(deviceRole()).toBeNull()
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBeNull()
  })
})

describe('响应式 useDeviceRole()：页面订阅，写凭据后自动跟随', () => {
  it('订阅即取现值（跨订阅间隙的写入在订阅时校准）', () => {
    writeDeviceCredential(VALID)
    const role = useDeviceRole()
    expect(role.value).toBe('parent')
  })

  it('写凭据后自动跟随（null → parent → child），无需重新订阅', () => {
    const role = useDeviceRole()
    expect(role.value).toBeNull()
    writeDeviceCredential(VALID)
    expect(role.value).toBe('parent')
    writeDeviceCredential({ ...VALID, role: 'child', name: '孩子平板' })
    expect(role.value).toBe('child')
  })

  it('多订阅者共享同一份跟随：各自看到写入后的同一新值', () => {
    const a = useDeviceRole()
    const b = useDeviceRole()
    expect(a.value).toBeNull()
    expect(b.value).toBeNull()
    writeDeviceCredential({ ...VALID, role: 'child', name: '孩子平板' })
    expect(a.value).toBe('child')
    expect(b.value).toBe('child')
  })
})
