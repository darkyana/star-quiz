<script setup lang="ts">
// 设备配对页（#125，R-P1c；#142 R-129a 申请化；#144 R-129c 重申请；#145 单屏化）：
// 码（6 位）/ 设备名字（默认可编辑建议名）/ 角色二选一 三字段同屏一个表单（形态参考 #136 出题指令单屏表单）+
// 底部主按钮「申请配对」（三项齐备才可点，禁用而非隐藏）→
// 提交 /api/pair（src/cloud/api.ts 薄封装）；200 同构响应按 status 分流：active 建家直入回首页（挂钩首同步）、
// pending（真申请与假等待同构，页面无从区分）落凭据进等待页 /pair-wait。
// 反馈只剩限流（服务端秒数换算分钟）与网络/未知兜底——码错/码重置类文案已删尽（存在性盲探测口径）。
// #192 双因子（R-130c）：家长角色选填「家庭口令」输入框——首台设备与家庭码成对直入用，留空走入家申请；孩子角色构造上无此输入。
// #144 重申请（reapply 模式）：等待页「重新申请」跳 /pair?reapply=1——放行已配对直达门禁、
// 预填旧申请名字/角色（码必重输，本地无码），提交带旧凭据（服务端替换语义删旧申请行，伞票场景 F）。
// 设计三层（票内预拍）：StarNavBar 标题+返回钮形态 + .star-container 样式集容器 + StarButtonStandard 主按钮；
// 角色二选一改用 StarSegmentTabs 分段单选组件（2026-09-09 拍板：替换原选项卡形态）、
// 输入框沿 ProposalEdit 页面私有先例——零新增令牌、零自绘跨页样式集。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarSegmentTabs from '../components/StarSegmentTabs.vue'
import { pairDevice, type PairErrorKind } from '../cloud/api'
import { onPaired } from '../cloud/sync'
import { readDeviceCredential, writeDeviceCredential, type DeviceRole } from '../composables/useDeviceCredential'
import { deviceRole } from '../composables/useDeviceRole'
import { copy } from '../copy'

const router = useRouter()
const route = useRoute()

const code = ref('')
const deviceName = ref(copy.pair.defaultDeviceName)
const role = ref<DeviceRole | null>(null)
// #192 双因子：家庭口令（家长角色选填，首台设备直入用；孩子角色构造上无此输入）
const passphrase = ref('')
const submitting = ref(false)
const errorKind = ref<PairErrorKind | null>(null)
/** 仅 locked：服务端提示的重试秒数（缺失按限流窗口上限 15 分钟兜底） */
const retrySeconds = ref<number | null>(null)

const codeValid = computed(() => /^[0-9]{6}$/.test(code.value))
const nameValid = computed(() => deviceName.value.trim() !== '')
// #145 单屏门禁：码非 6 位 / 名字空 / 角色未选 / 提交中 任一成立 → 主按钮禁用（表单回车提交共用同一守卫）
const submitDisabled = computed(() => !codeValid.value || !nameValid.value || role.value === null || submitting.value)

/** 角色二选一分段项（StarSegmentTabs items 契约：key=DeviceRole，label=角色名；未选时 modelValue 传空串全不选中） */
const roleItems = [
  { key: 'parent', label: copy.pair.roleParentName },
  { key: 'child', label: copy.pair.roleChildName },
]

function onRoleSelect(key: string): void {
  role.value = key as DeviceRole
}

/** 限流窗口上限（与 worker PAIR_WINDOW_MS 同口径的服务端兜底值，秒数缺失时换算用） */
const RATE_LIMIT_FALLBACK_SECONDS = 15 * 60

/** 错误反馈文案（文案集中 copy.ts；#142 后只剩限流（动态分钟）与网络/未知兜底） */
const errorText = computed<string>(() => {
  if (errorKind.value === null) return ''
  if (errorKind.value === 'locked') {
    const seconds = retrySeconds.value ?? RATE_LIMIT_FALLBACK_SECONDS
    return copy.pair.error.locked(Math.max(1, Math.ceil(seconds / 60)))
  }
  const fallback: Record<Exclude<PairErrorKind, 'locked'>, string> = {
    network: copy.pair.error.network,
    unknown: copy.pair.error.unknown,
  }
  return fallback[errorKind.value]
})

// 已配对设备直达 /pair：回首页（入口只在未配对时渲染，此为直达 URL 兜底）；
// #144 例外：?reapply=1（等待页「重新申请」跳入）放行重填，并预填旧申请的名字/角色（码必重输）
onMounted(() => {
  // #252 已配对判定（含损坏回未配对口径）走设备角色出口；凭据本体读取仅供预填
  const cred = readDeviceCredential()
  if (deviceRole() !== null && route.query.reapply !== '1') {
    void router.replace('/')
    return
  }
  if (cred !== null) {
    deviceName.value = cred.name
    role.value = cred.role
  }
})

function goBack(): void {
  void router.push('/')
}

async function onSubmit(): Promise<void> {
  // #145：单屏后回车（form submit）与点按钮共用同一门禁，禁用态不可被回车绕过；
  // 再显式判 role 供 TS 收窄（computed 布尔不携带 role 非空信息）
  if (submitDisabled.value || role.value === null) return
  submitting.value = true
  errorKind.value = null
  retrySeconds.value = null
  const name = deviceName.value.trim()
  // #144 替换语义：本地有旧凭据（reapply 重申请）即随提交携带——服务端先删旧申请行再评估；
  // 首申（无凭据）不带，行为与现状一致
  const previous = readDeviceCredential()
  // #192 双因子：家庭口令仅家长角色携带（孩子角色构造上无此输入），留空不传——请求体与旧契约逐字段一致
  const passphraseValue = role.value === 'parent' ? passphrase.value.trim() : ''
  const result = await pairDevice({
    code: code.value,
    deviceName: name,
    role: role.value,
    ...(passphraseValue !== '' ? { passphrase: passphraseValue } : {}),
    ...(previous !== null ? { previousCredential: previous } : {}),
  })
  submitting.value = false
  if (result.ok) {
    writeDeviceCredential({ device_id: result.deviceId, secret: result.secret, role: role.value, name }, result.status)
    if (result.status === 'active') {
      // 建家直入：跳过等待页回首页 + 首次同步挂钩（#126 换机云端为准；宏任务延迟首启，不与路由跳转争抢同帧）
      onPaired()
      void router.replace('/')
    } else {
      // pending：真申请与假等待同构，一律进等待页轮询（#142；批准闭环归 #143）
      void router.replace('/pair-wait')
    }
    return
  }
  errorKind.value = result.kind
  if (result.kind === 'locked') retrySeconds.value = result.retrySeconds ?? null
}
</script>

<template>
  <div data-page="pair" class="page pair-page">
    <StarNavBar :title="copy.pair.pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <!-- 一屏展示三段之二（ADR 0001）：内容区唯一滚动容器；排布节奏参考 #136 出题指令单屏表单（说明 → 表单卡） -->
    <main class="pair-scroll page-scroll">
      <p class="pair-hint">{{ copy.pair.intro }}</p>
      <form class="pair-form star-container" @submit.prevent="onSubmit">
        <!-- 家庭码（6 位数字，现有校验不变） -->
        <label class="pair-field">
          <span class="pair-field-label">{{ copy.pair.codeLabel }}</span>
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            maxlength="6"
            autocomplete="off"
            class="pair-code-input"
            :aria-label="copy.pair.codeLabel"
          />
        </label>

        <!-- 设备命名（默认建议名可编辑） -->
        <label class="pair-field">
          <span class="pair-field-label">{{ copy.pair.nameLabel }}</span>
          <input v-model="deviceName" type="text" class="pair-name-input" :aria-label="copy.pair.nameLabel" />
        </label>

        <!-- 角色二选一（StarSegmentTabs 分段单选；aria-label 透传 radiogroup 根） -->
        <div class="pair-field">
          <span class="pair-field-label">{{ copy.pair.roleLabel }}</span>
          <StarSegmentTabs
            :model-value="role ?? ''"
            :items="roleItems"
            :aria-label="copy.pair.roleLabel"
            @update:model-value="onRoleSelect"
          />
          <p v-if="errorKind !== null" class="pair-error" role="alert">{{ errorText }}</p>
        </div>

        <!-- #192 家庭口令（家长角色选填）：首台设备与家庭码成对直入用，日常入家申请留空；孩子角色构造上无此输入 -->
        <label v-if="role === 'parent'" class="pair-field">
          <span class="pair-field-label">{{ copy.pair.passphraseLabel }}</span>
          <input
            v-model="passphrase"
            type="text"
            maxlength="4"
            autocomplete="off"
            class="pair-passphrase-input"
            :placeholder="copy.pair.passphrasePlaceholder"
            :aria-label="copy.pair.passphraseLabel"
          />
        </label>
      </form>
    </main>

    <!-- 一屏展示三段之三：底部操作栏常驻（唯一主按钮「申请配对」，三项齐备才可点） -->
    <footer class="bottom-action-bar">
      <StarButtonStandard type="button" variant="primary" size="large" :edge-inset="false" class="pair-submit-btn" :disabled="submitDisabled" @click="onSubmit">{{ submitting ? copy.pair.submittingBtn : copy.pair.submitBtn }}</StarButtonStandard>
    </footer>
  </div>
</template>

<style scoped>
/* ===== 一屏展示三段结构（ADR 0001）：顶栏 StarNavBar / 内容区 pair-scroll / 底部 bottom-action-bar 全局样式集 ===== */
.pair-page {
  padding: 0;
}

.pair-scroll {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-gutter) var(--space-page) var(--space-md);
}

/* 表单卡：容器视觉由全局 star-container 样式集提供，此处只留纵向布局 */
.pair-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.pair-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}

.pair-field-label {
  font-size: var(--font-size-body);
  font-weight: 700;
  color: var(--color-text);
}

/* 输入框页面私有样式（ProposalEdit 先例，全令牌引用；#192 口令输入复用家庭码输入既有形态，零新令牌） */
.pair-code-input,
.pair-name-input,
.pair-passphrase-input {
  font-family: inherit;
  font-size: var(--font-size-body-lg);
  padding: var(--space-sm);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  color: var(--color-text);
}

.pair-code-input {
  letter-spacing: var(--letter-spacing-title);
}

.pair-code-input:focus-visible,
.pair-name-input:focus-visible,
.pair-passphrase-input:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

/* 表单上方申请说明（#145 移出表单卡：排布沿 #136 出题指令 intro 形态，居中次色小字） */
.pair-hint {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  line-height: 1.5;
  text-align: center;
  color: var(--color-text-secondary);
}

/* 失败反馈：错误色提示（role=alert 已达性声明） */
.pair-error {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 600;
  color: var(--color-error);
}
</style>
