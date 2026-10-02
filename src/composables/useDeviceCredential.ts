// 设备配对凭据状态模块（#125，R-P1c）：拥有 sq_device_credential（配对成功后服务端签发的设备身份）。
// 属设备本地键（ADR 0002）：永不同步、不进学习/经济文件导出、不进任何同步域。
// 键沿仓内 sq_* 风格、生命周期自管理（#168 起经 useDataInfra 登记册入册并经原语读写；
// 仍不注册初始值，不参与 init 初始化与迁移）；读写删收本模块单一出口，#126/#127（同步/设备管理）复用此契约。
// 损坏恢复沿 E1 口径：JSON 解析失败或字段非法 → 移除键按未配对处理（纯本地可用性不受影响）。

import { STORAGE_KEYS, readRawValue, writeValue, deleteValue } from './useDataInfra'
import type { FamilyStatus } from '../../shared/onboarding-metrics'

/** 设备角色（#84）：家长设备 / 孩子设备，配对时选定 */
export type DeviceRole = 'parent' | 'child'

export interface DeviceCredential {
  device_id: string
  secret: string
  role: DeviceRole
  name: string
  /** Device-local latest confirmation only; absent on legacy credentials means unknown. */
  familyStatus?: FamilyStatus
}

// #168 收编入册：键名现由登记册单一来源，导出保持兼容
export const DEVICE_CREDENTIAL_KEY = STORAGE_KEYS.deviceCredential

function isDeviceCredential(value: unknown): value is DeviceCredential {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.device_id === 'string' &&
    v.device_id.length > 0 &&
    typeof v.secret === 'string' &&
    v.secret.length > 0 &&
    (v.role === 'parent' || v.role === 'child') &&
    typeof v.name === 'string'
  )
}

/** 读取凭据：未配对 → null；JSON 损坏或字段非法 → 移除键回 null（损坏恢复 E1 口径） */
export function readDeviceCredential(): DeviceCredential | null {
  const raw = readRawValue(DEVICE_CREDENTIAL_KEY)
  if (raw === null) return null
  try {
    const value = JSON.parse(raw)
    if (isDeviceCredential(value)) {
      // An invalid analytics hint must not invalidate otherwise usable credentials.
      if (value.familyStatus !== 'joined' && value.familyStatus !== 'unjoined') delete value.familyStatus
      return value
    }
    console.warn(`[star-quiz] 数据键 ${DEVICE_CREDENTIAL_KEY} 值非法，已删除（按未配对处理）`)
    deleteValue(DEVICE_CREDENTIAL_KEY)
    return null
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[star-quiz] 数据键 ${DEVICE_CREDENTIAL_KEY} 损坏，已删除（原因：${reason} JSON 解析失败）`)
    deleteValue(DEVICE_CREDENTIAL_KEY)
    return null
  }
}

/** 写入凭据（JSON 落盘，与仓内键口径一致）；仅在配对成功时调用 */
export function writeDeviceCredential(credential: DeviceCredential, status?: 'active' | 'pending'): void {
  writeValue(DEVICE_CREDENTIAL_KEY, status === undefined ? credential : {
    ...credential, familyStatus: status === 'active' ? 'joined' : 'unjoined',
  })
}

/** Use existing authoritative responses, never an extra telemetry identity probe.
 * A blind pending poll / generic 401 cannot prove a previously joined device was removed.
 * Compare credentials after await: a stale response must not relabel a replacement device.
 */
export function confirmFamilyStatus(credential: DeviceCredential, status: 'active' | 'pending'): void {
  try {
    const current = readDeviceCredential()
    if (!current || current.device_id !== credential.device_id || current.secret !== credential.secret) return
    if (status === 'pending' && current.familyStatus === 'joined') return
    const familyStatus = status === 'active' ? 'joined' : 'unjoined'
    if (current.familyStatus !== familyStatus) writeValue(DEVICE_CREDENTIAL_KEY, { ...current, familyStatus })
  } catch {
    // Metrics bookkeeping must not turn a successful pairing/sync into a failure.
  }
}

/** 删除凭据（回未配对态）：设备管理页撤销本机设备时调用（#168 收口，页面不再直碰存储） */
export function deleteDeviceCredential(): void {
  deleteValue(DEVICE_CREDENTIAL_KEY)
}
