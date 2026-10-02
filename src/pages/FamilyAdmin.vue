<script setup lang="ts">
// 家庭管理页（#132）：家长页「设备与家庭」管理区整段搬迁（源 #127 R-P1e / #143 R-129b），行为零变化——
// 等家长批准的申请（置顶）/ 设备名册（含移除设备）/ 家庭码+家庭口令（#192 成对出示/隐藏/重置轮换）/ 快照回滚（列表/回滚）。
// 四段分区卡壳 #201 起收编 StarSectionShell（容器与标题样式对齐家长页「家长超能力」卡）；
// 「家庭码」段不同构（无错误/刷新/列表骨架）照常走内容 slot（probe #194 第 4 节注）；
// 仅家长设备渲染——未配对无家庭可管理（四段整体不渲染）；孩子设备 /parent 已被 #125 child 守卫挡在路由层，
// 此处 role 判定为组件级回归防线（构造性不可达 #84）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteDeviceCredential, readDeviceCredential } from '../composables/useDeviceCredential'
import { useDeviceRole } from '../composables/useDeviceRole'
import { runAdminAction, useAdminSection } from '../composables/useAdminSection'
import {
  listDevices,
  revokeDevice,
  deleteRevokedDevices,
  showFamilyCode,
  resetFamilyCode,
  listSnapshots,
  restoreSnapshot,
  listPairRequests,
  approvePairRequest,
  rejectPairRequest,
  type AdminErrorKind,
  type DeviceRow,
  type PairRequestRow,
  type SnapshotRow,
} from '../cloud/admin'
import { formatRelativeTime } from '../utils/relativeTime'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarSectionShell from '../components/StarSectionShell.vue'
import StarModalStandard from '../components/StarModalStandard.vue'
import StarChip from '../components/StarChip.vue'
import StarToastStandard from '../components/StarToastStandard.vue'
import { copy } from '../copy'

const router = useRouter()

/** 返回家长页（沿 /parent 子路径页返回惯例，如出题指令页） */
function goBack(): void {
  void router.push('/parent')
}

// ===== 自 Parent.vue 管理区整段搬迁（#132）：不抽 composable，模板/状态/函数/样式原样，仅分段容器化 =====
const deviceCredential = ref(readDeviceCredential())
// #252 role 判定走设备角色统一出口（组件级回归防线仅数据来源迁移）；撤销本机的删除不走写监听，
// 「回未配对隐藏四段」由本地清空 deviceCredential 兜底（行为等价保留）
const deviceRole = useDeviceRole()
const canManageDevices = computed(() => deviceCredential.value !== null && deviceRole.value === 'parent')

// #251 拉取样板收敛：远端列表三件套（数据/错误/忙/刷新）各一个 useAdminSection 实例，
// 刷新器与动作函数的「busy 守卫 + 结果解包 + 错误赋值」样板不再页面手写；
// 解构别名保持模板与既有引用名不变（零行为变化，纯搬家）
const { rows: devices, error: devicesError, refresh: refreshDevices } = useAdminSection(listDevices, (result) => result.devices)
const { rows: snapshots, error: snapshotsError, refresh: refreshSnapshots } = useAdminSection(listSnapshots, (result) => result.snapshots)
const familyCode = ref<string | null>(null)
// #192 双因子：家庭口令与家庭码成对出示/隐藏/轮换（null = 未设置明确态；家庭码隐藏时同行掩码）
const familyPassphrase = ref<string | null>(null)
const codeError = ref<AdminErrorKind | null>(null)
const restoreNotice = ref('')

type AdminConfirmKind = 'revoke' | 'clear-revoked' | 'reset-code' | 'restore'
const adminConfirm = ref<AdminConfirmKind | null>(null)
const pendingRevokeDevice = ref<DeviceRow | null>(null)
const pendingRestoreSnapshot = ref<SnapshotRow | null>(null)
const adminBusy = ref(false)

/** 错误类别 → 中文反馈（文案集中 copy.ts；错误契约见 src/cloud/admin.ts） */
const ADMIN_ERROR_TEXT: Record<AdminErrorKind, string> = {
  unpaired: copy.parent.deviceAdmin.error.unpaired,
  forbidden: copy.parent.deviceAdmin.error.forbidden,
  conflict: copy.parent.deviceAdmin.error.conflict,
  'not-found': copy.parent.deviceAdmin.error.notFound,
  network: copy.parent.deviceAdmin.error.network,
  unknown: copy.parent.deviceAdmin.error.unknown,
}

/** 错误类别 → 分区卡壳 :error 文案（#201：null → undefined，shell 不渲染错误行与刷新钮） */
function errorText(kind: AdminErrorKind | null): string | undefined {
  return kind === null ? undefined : ADMIN_ERROR_TEXT[kind]
}

// ===== #143（R-129b）「等家长批准的申请」块：置顶；批准/拒绝无二次确认 =====

const { rows: pairRequests, error: requestsError, refresh: refreshRequests } = useAdminSection(listPairRequests, (result) => result.requests)
/** 操作反馈 toast 文案（已同意 / 已拒绝 / 刚被处理过；#139 T-Toast 组件吞计时，@expired 清空） */
const toastText = ref('')
const approvalsBusy = ref(false)

function appliedRoleText(request: PairRequestRow): string {
  return copy.parent.deviceAdmin.approvals.appliedRole(roleLabel(request.role))
}

function requestedAtText(request: PairRequestRow): string {
  return formatRelativeTime(request.paired_at, Date.now())
}

function isSelfDevice(row: DeviceRow): boolean {
  return row.device_id === deviceCredential.value?.device_id
}

function roleLabel(role: 'parent' | 'child'): string {
  return role === 'parent' ? copy.parent.deviceAdmin.roleParent : copy.parent.deviceAdmin.roleChild
}

function lastSeenText(row: DeviceRow): string {
  if (row.last_seen_at === null) return copy.parent.deviceAdmin.lastSeenUnknown
  return copy.parent.deviceAdmin.lastSeen(formatRelativeTime(row.last_seen_at, Date.now()))
}

function snapshotTime(snapshot: SnapshotRow): string {
  return formatRelativeTime(snapshot.taken_at, Date.now())
}

// ===== 清除已移除设备（CONTEXT.md 同名词条）：名册末尾批量硬删「已移除」墓碑行（ADR 0012） =====

/** 名册内已移除设备数（0 → 不渲染清除入口；拉取失败名册为空同隐藏） */
const revokedCount = computed(() => devices.value.filter((device) => device.revoked).length)

function askClearRevoked(): void {
  adminConfirm.value = 'clear-revoked'
}

async function confirmClearRevoked(): Promise<void> {
  await runAdminAction(adminBusy, deleteRevokedDevices, {
    // 确认弹窗收尾与结果无关：忙释放后即关（保持收敛前时机）
    onSettled: () => {
      adminConfirm.value = null
    },
    onSuccess: async (result) => {
      // 服务端删除数为准（并发后到可能少于名册快照的 revokedCount，0 台也如实提示）
      toastText.value = copy.parent.deviceAdmin.clearedToast(result.deleted)
      await refreshDevices()
    },
    onError: devicesError,
  })
}

async function onApprove(request: PairRequestRow): Promise<void> {
  await runAdminAction(approvalsBusy, () => approvePairRequest(request.device_id), {
    onSuccess: async () => {
      toastText.value = copy.parent.deviceAdmin.approvals.approvedToast(request.name)
      await refreshRequests()
      await refreshDevices() // 新成员入名册
    },
    onError: async (kind) => {
      if (kind === 'conflict') {
        // 另一家长刚处理完同一条：提示 + 刷新列表（toast 文案与 error.conflict 同源）
        toastText.value = copy.parent.deviceAdmin.approvals.conflictToast
        await refreshRequests()
        return
      }
      requestsError.value = kind
    },
  })
}

async function onReject(request: PairRequestRow): Promise<void> {
  await runAdminAction(approvalsBusy, () => rejectPairRequest(request.device_id), {
    onSuccess: async () => {
      toastText.value = copy.parent.deviceAdmin.approvals.rejectedToast
      await refreshRequests()
    },
    onError: async (kind) => {
      if (kind === 'conflict') {
        toastText.value = copy.parent.deviceAdmin.approvals.conflictToast
        await refreshRequests()
        return
      }
      requestsError.value = kind
    },
  })
}

onMounted(() => {
  if (canManageDevices.value) {
    void refreshRequests()
    void refreshDevices()
    void refreshSnapshots()
  }
})

async function onShowFamilyCode(): Promise<void> {
  await runAdminAction(adminBusy, showFamilyCode, {
    onSuccess: (result) => {
      familyCode.value = result.code
      familyPassphrase.value = result.passphrase // #192：口令随码成对出示
      codeError.value = null
    },
    onError: codeError,
  })
}

function onHideFamilyCode(): void {
  familyCode.value = null
  familyPassphrase.value = null
  codeError.value = null
}

function askRevoke(row: DeviceRow): void {
  pendingRevokeDevice.value = row
  adminConfirm.value = 'revoke'
}

function askResetCode(): void {
  adminConfirm.value = 'reset-code'
}

function askRestore(snapshot: SnapshotRow): void {
  pendingRestoreSnapshot.value = snapshot
  adminConfirm.value = 'restore'
}

function cancelAdminConfirm(): void {
  adminConfirm.value = null
  pendingRevokeDevice.value = null
  pendingRestoreSnapshot.value = null
}

async function confirmRevoke(): Promise<void> {
  const target = pendingRevokeDevice.value
  if (target === null) return
  await runAdminAction(adminBusy, () => revokeDevice(target.device_id), {
    onSettled: () => {
      adminConfirm.value = null
      pendingRevokeDevice.value = null
    },
    onSuccess: async () => {
      if (isSelfDevice(target)) {
        // 保守拍板（票内）：移除的恰是本机设备 → 清空本机设备凭据键回未配对态
        //（配对入口复现），本地数据保留不擦除（CONTEXT.md 移除设备语义）
        deleteDeviceCredential()
        deviceCredential.value = null
        return
      }
      await refreshDevices()
    },
    onError: devicesError,
  })
}

async function confirmResetCode(): Promise<void> {
  await runAdminAction(adminBusy, resetFamilyCode, {
    onSettled: () => {
      adminConfirm.value = null
    },
    onSuccess: (result) => {
      familyCode.value = result.code
      familyPassphrase.value = result.passphrase // #192：新码+新口令成对轮换，同屏更新
      codeError.value = null
    },
    onError: codeError,
  })
}

async function confirmRestore(): Promise<void> {
  const target = pendingRestoreSnapshot.value
  if (target === null) return
  await runAdminAction(adminBusy, () => restoreSnapshot(target.snapshot_id), {
    onSettled: () => {
      adminConfirm.value = null
      pendingRestoreSnapshot.value = null
    },
    onSuccess: async () => {
      restoreNotice.value = copy.parent.deviceAdmin.restoreDone
      await refreshSnapshots()
    },
    onError: snapshotsError,
  })
}

function onAdminConfirm(): void {
  if (adminConfirm.value === 'revoke') void confirmRevoke()
  else if (adminConfirm.value === 'clear-revoked') void confirmClearRevoked()
  else if (adminConfirm.value === 'reset-code') void confirmResetCode()
  else if (adminConfirm.value === 'restore') void confirmRestore()
}

const adminConfirmTitle = computed(() => {
  const c = copy.parent.deviceAdmin
  if (adminConfirm.value === 'revoke') return c.revokeConfirmTitle
  if (adminConfirm.value === 'clear-revoked') return c.clearRevokedBtn
  if (adminConfirm.value === 'reset-code') return c.codeResetConfirmTitle
  return c.restoreConfirmTitle
})

const adminConfirmMessage = computed(() => {
  const c = copy.parent.deviceAdmin
  if (adminConfirm.value === 'revoke') {
    const target = pendingRevokeDevice.value
    if (target === null) return ''
    return isSelfDevice(target) ? c.revokeSelfConfirm(target.name) : c.revokeConfirm(target.name)
  }
  if (adminConfirm.value === 'clear-revoked') return c.clearRevokedConfirm(revokedCount.value)
  if (adminConfirm.value === 'reset-code') return c.codeResetConfirm
  const target = pendingRestoreSnapshot.value
  return target === null ? '' : c.restoreConfirm(snapshotTime(target))
})

// ===== #192 双因子：家庭口令行文案（隐藏=掩码不出对 / 未设置=明确未设置态 / 出示=带标签值） =====
const passphraseText = computed<string>(() => {
  if (familyCode.value === null) return copy.parent.deviceAdmin.passphraseHidden
  if (familyPassphrase.value === null) return copy.parent.deviceAdmin.passphraseUnset
  return copy.parent.deviceAdmin.passphraseValue(familyPassphrase.value)
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (adminConfirm.value) cancelAdminConfirm()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div data-page="family-admin" class="page family-admin-page">
    <!-- 顶栏（StarNavBar 三区：返回家长页 + 标题「家庭管理」） -->
    <StarNavBar :title="copy.parent.familyAdminTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <!-- 四段分区卡壳（#201 StarSectionShell：容器 + 标题 + 错误行/刷新钮/空态骨架收编组件，列表与业务样式留页面）：
         仅家长设备渲染——未配对无家庭可管理（四段整体不渲染）；孩子设备构造性不可达（#84，路由 child 守卫 + 组件级防线） -->
    <main class="family-admin-main page-scroll">
      <template v-if="canManageDevices">
        <!-- #143 等家长批准的申请（置顶）：行 = 名字 · 申请成为：角色 · 时间；批准/拒绝无二次确认 -->
        <StarSectionShell
          :title="copy.parent.deviceAdmin.approvals.title"
          :error="errorText(requestsError)"
          :empty="copy.parent.deviceAdmin.approvals.empty"
          @refresh="refreshRequests"
        >
          <ul v-if="pairRequests.length > 0" class="device-admin-list">
            <li v-for="request in pairRequests" :key="request.device_id" class="device-admin-row">
              <div class="device-admin-main">
                <span class="device-admin-name">{{ request.name }}</span>
                <span class="device-admin-applied-role">{{ appliedRoleText(request) }}</span>
              </div>
              <div class="device-admin-side">
                <span class="device-admin-request-time">{{ requestedAtText(request) }}</span>
                <StarButtonStandard variant="primary" size="small" class="btn-approve-request" :disabled="approvalsBusy" @click="onApprove(request)">{{ copy.parent.deviceAdmin.approvals.approveBtn }}</StarButtonStandard>
                <StarButtonStandard variant="standard" size="small" class="btn-reject-request" :disabled="approvalsBusy" @click="onReject(request)">{{ copy.parent.deviceAdmin.approvals.rejectBtn }}</StarButtonStandard>
              </div>
            </li>
          </ul>
        </StarSectionShell>

        <!-- 设备名册：名字 / 角色 chip / 本机标识 / 最后活跃；已移除设备行打 chip、不出移除按钮（空名册渲染空列表，无空态文案）；
             末尾「删除已移除设备」批量硬删墓碑行（无已移除设备不渲染；ADR 0012 / CONTEXT.md 清除已移除设备） -->
        <StarSectionShell
          :title="copy.parent.deviceAdmin.devicesTitle"
          :error="errorText(devicesError)"
          @refresh="refreshDevices"
        >
          <ul class="device-admin-list">
            <li v-for="device in devices" :key="device.device_id" class="device-admin-row">
              <div class="device-admin-main">
                <span class="device-admin-name">{{ device.name }}</span>
                <StarChip>{{ roleLabel(device.role) }}</StarChip>
                <StarChip v-if="isSelfDevice(device)" variant="ghost">{{ copy.parent.deviceAdmin.selfDevice }}</StarChip>
                <StarChip v-if="device.revoked" variant="ghost">{{ copy.parent.deviceAdmin.revokedChip }}</StarChip>
              </div>
              <div class="device-admin-side">
                <span class="device-admin-last-seen">{{ lastSeenText(device) }}</span>
                <StarButtonStandard v-if="!device.revoked" variant="standard" size="small" class="btn-revoke-device" :disabled="adminBusy" @click="askRevoke(device)">{{ copy.parent.deviceAdmin.revokeBtn }}</StarButtonStandard>
              </div>
            </li>
          </ul>
          <p v-if="revokedCount > 0" class="clear-revoked-row">
            <StarButtonStandard variant="standard" size="small" class="btn-clear-revoked" :disabled="adminBusy" @click="askClearRevoked">{{ copy.parent.deviceAdmin.clearRevokedBtn }}</StarButtonStandard>
          </p>
        </StarSectionShell>

        <!-- 家庭码：平时隐藏（掩码 + 出示按钮），出示后可见 6 位码；重置走确认弹窗 -->
        <!-- 不同构段（probe #194 第 4 节注）：无错误/刷新/列表骨架，照常走内容 slot、不出 error/empty props；
             错误行留页面（重试通道 = 出示 / 重置钮，非刷新钮） -->
        <StarSectionShell :title="copy.parent.deviceAdmin.codeTitle">
          <p class="family-code-value">{{ familyCode ?? copy.parent.deviceAdmin.codeHidden }}</p>
          <!-- #192 家庭口令行：与家庭码成对出示/隐藏（复用家庭码区现有展示样式）；未设置显示明确未设置态文案 -->
          <p class="family-code-value family-passphrase-value">{{ passphraseText }}</p>
          <p v-if="codeError !== null" class="family-code-error" role="alert">{{ ADMIN_ERROR_TEXT[codeError] }}</p>
          <div class="device-admin-actions">
            <StarButtonStandard v-if="familyCode === null" variant="standard" size="small" class="btn-code-show" :disabled="adminBusy" @click="onShowFamilyCode">{{ copy.parent.deviceAdmin.codeShowBtn }}</StarButtonStandard>
            <StarButtonStandard v-else variant="standard" size="small" class="btn-code-hide" @click="onHideFamilyCode">{{ copy.parent.deviceAdmin.codeHideBtn }}</StarButtonStandard>
            <StarButtonStandard variant="standard" size="small" class="btn-code-reset" :disabled="adminBusy" @click="askResetCode">{{ copy.parent.deviceAdmin.codeResetBtn }}</StarButtonStandard>
          </div>
        </StarSectionShell>

        <!-- 快照回滚：近 30 天每日快照（时间点）；回滚走强确认弹窗 -->
        <StarSectionShell
          :title="copy.parent.deviceAdmin.snapshotsTitle"
          :error="errorText(snapshotsError)"
          :empty="copy.parent.deviceAdmin.snapshotsEmpty"
          @refresh="refreshSnapshots"
        >
          <p v-if="restoreNotice !== ''" class="device-admin-notice" role="status">{{ restoreNotice }}</p>
          <ul v-if="snapshots.length > 0" class="device-admin-list">
            <li v-for="snapshot in snapshots" :key="snapshot.snapshot_id" class="device-admin-row">
              <span class="device-admin-snapshot-time">{{ snapshotTime(snapshot) }}</span>
              <StarButtonStandard variant="standard" size="small" class="btn-restore-snapshot" :disabled="adminBusy" @click="askRestore(snapshot)">{{ copy.parent.deviceAdmin.restoreBtn }}</StarButtonStandard>
            </li>
          </ul>
        </StarSectionShell>
      </template>
    </main>

    <!-- 管理确认弹窗（StarModalStandard confirm 带标题形态）：移除设备 / 重置家庭码 / 快照回滚强确认 -->
    <StarModalStandard
      v-if="adminConfirm"
      class="admin-confirm-modal"
      :title="adminConfirmTitle"
      :message="adminConfirmMessage"
      variant="confirm"
      @cancel="cancelAdminConfirm"
      @confirm="onAdminConfirm"
    />

    <!-- #143 批准操作反馈 toast（已同意 / 已拒绝 / 刚被处理过；#139 T-Toast 组件吞计时，@expired 清空） -->
    <StarToastStandard :message="toastText" @expired="toastText = ''" />
  </div>
</template>

<style scoped>
/* 页面主区（贴家长页既有节奏：卡片纵排 --space-md 间距，顶距 --space-lg、底部唇边呼吸位） */
.family-admin-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-top: var(--space-lg);
  /* 滚动到底时末段留呼吸位 */
  padding-bottom: var(--space-md);
}

/* ===== 管理区四段（#201 起卡壳骨架归 StarSectionShell：容器视觉 star-container 样式集 + 分区内部结构组件内固定）；
   此处只留各段列表 / 业务样式；颜色字号全令牌 ===== */
.device-admin-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 清除已移除设备行：单独占一行（StarButtonStandard 组件自带视觉，此处只留段落复位） */
.clear-revoked-row {
  margin: 0;
}

.device-admin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-base) 0;
  border-bottom: var(--border-thin) solid var(--color-outline);
}

.device-admin-list .device-admin-row:last-child {
  border-bottom: none;
}

.device-admin-main {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.device-admin-name {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--color-text);
}

.device-admin-side {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-xs);
}

.device-admin-last-seen,
.device-admin-snapshot-time {
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

.device-admin-actions {
  display: flex;
  gap: var(--space-sm);
}

/* #192 家庭码+家庭口令行：口令行复用家庭码区现有展示样式（同组选择器，零新令牌零新规则） */
.family-code-value,
.family-passphrase-value {
  margin: 0;
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  letter-spacing: var(--letter-spacing-title);
  color: var(--color-text);
}

/* 家庭码段错误行（#201 不同构段：无刷新重试通道，错误行留页面；令牌对齐卡壳错误行 info + 600 + error 系） */
.family-code-error {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 600;
  color: var(--color-error);
}

.device-admin-notice {
  margin: 0;
  font-size: var(--font-size-info);
  color: var(--color-primary);
}

/* #143 申请行：申请角色标注与时间小字（贴名册行 last-seen 档位；颜色字号全令牌） */
.device-admin-applied-role {
  font-size: var(--font-size-body);
  font-weight: 400;
  color: var(--color-text-secondary);
}

.device-admin-request-time {
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}
</style>
