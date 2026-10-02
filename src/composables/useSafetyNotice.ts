// #174 T-本次 8→9 数据升级保障·数据安全持续提示（外壳横幅状态源）：
// 两类「数据安全优先」的持续性异常态在此集中承载，App.vue 全局横幅读取显示——
//   1. dataUpgradeBlocked：升级前恢复副本保存/校验失败，本次启动已拒绝修改原数据（下次启动自动重试）；
//   2. syncProtocolIncompatible：云端 Worker 协议版本不兼容，同步已暂停（本地离线可用、数据与配对不动）。
// 与 #172 useCorruptionNotice（瞬时 Toast）区分：这两类状态持续存在直到故障解除，不适合 2400ms Toast。

import { ref } from 'vue'

/** 升级前恢复副本保存/校验失败（迁移本次未执行；数据未改动） */
export const dataUpgradeBlocked = ref(false)

/** 云端同步协议不兼容（同步暂停；本地数据与配对信息不受影响） */
export const syncProtocolIncompatible = ref(false)

/** 仅供测试：复位两个提示态 */
export function __resetSafetyNoticeForTests(): void {
  dataUpgradeBlocked.value = false
  syncProtocolIncompatible.value = false
}
