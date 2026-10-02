// 设备角色唯一出口（#252）：「这台设备是家长还是孩子」的判定双口径由本模块统一提供——
// 同步读 deviceRole()：导航瞬间取值场合（路由守卫 / 挂载一次性门禁 / 轮询判定）；
// 响应式 useDeviceRole()：页面订阅，凭据键写入后经 useDataInfra 写监听自动跟随。
// 角色数据源仍是 useDeviceCredential（存储语义 / 凭据形状 / 损坏口径零改动，本模块只消费读取）；
// 未配对（无凭据 / 损坏回未配对）= null 是合法值，各消费点现状语义保持。
// 删除（设备管理页撤销本机）不触发写监听（删除原语无通知口径）：跟随不覆盖删除，
// 该场景由消费点既有「本地清空 / 跳转重挂载」语义兜底（行为等价）。
import { readonly, ref, type Ref } from 'vue'
import { registerWriteListener, STORAGE_KEYS } from './useDataInfra'
import { readDeviceCredential, type DeviceRole } from './useDeviceCredential'

/** 同步读口径：导航瞬间取值场合；每次调用即时读存储现值 */
export function deviceRole(): DeviceRole | null {
  return readDeviceCredential()?.role ?? null
}

// 响应式口径的共享载体：全部订阅者共用一份（角色是设备级单值），写监听是唯一跟随通道
const roleRef = ref<DeviceRole | null>(null)

function refreshRole(): void {
  roleRef.value = deviceRole()
}

registerWriteListener((key) => {
  if (key === STORAGE_KEYS.deviceCredential) refreshRole()
})

/** 响应式口径：页面订阅角色，凭据键写入后自动跟随；返回只读 ref，未配对 = null */
export function useDeviceRole(): Readonly<Ref<DeviceRole | null>> {
  // 订阅时校准：捕获上次订阅以来不经写监听的删键 / 直写 / 损坏清理（校准 = 重读真值，只会更准）
  refreshRole()
  return readonly(roleRef)
}
