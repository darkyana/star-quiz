<script setup lang="ts">
// 等待页（#142，R-129a；#144 R-129c 补重申请）：申请已发出（pending，真申请与假等待同构）后的等待屏。
// 挂载即轮询一次、其后每 ~5 秒 GET /api/pair/status（服务端盲口径：查无此行也回 pending）；
// active（#143 家长批准落定后）→ 回首页并挂钩首同步；网络失败只提示小字、不清凭据、无限重试（共识 15）；
// 2 分钟长等提示引导线下沟通。「重新申请」按钮（#144）→ 回配对页重填（/pair?reapply=1），
// 本地凭据保留——提交时带旧凭据，服务端按替换语义删旧申请行（伞票共识 14 / 场景 F）。
// 设计三层（票内预拍）：StarNavBar 仅标题形态（库）+ .star-container 样式集容器 +
// StarButtonStandard 重申请按钮（库·standard×large）+ 全令牌文字——
// 零新增令牌、零自绘跨页样式集、零新组件；布局样式页面私有 scoped（沿 Pair.vue 先例）。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import { fetchPairStatus } from '../cloud/api'
import { onPaired } from '../cloud/sync'
import { readDeviceCredential } from '../composables/useDeviceCredential'
import { deviceRole } from '../composables/useDeviceRole'
import { copy } from '../copy'

/** 轮询间隔（伞票 #129 共识 15：~5 秒） */
const POLL_INTERVAL_MS = 5_000
/** 长等提示阈值（伞票 #129 UI 文案初稿：2 分钟小字） */
const LONG_WAIT_MS = 2 * 60 * 1000

const router = useRouter()

const deviceName = ref('')
const roleText = ref('')
/** 网络不稳小字：失败显现、恢复（任一次轮询成功）自动消隐；永不清凭据 */
const networkUnstable = ref(false)
/** 2 分钟长等提示：出现后常驻（等待可能确实很久，批准闭环归 #143） */
const longWait = ref(false)

let pollTimer: ReturnType<typeof setTimeout> | null = null
let longWaitTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false

function stopTimers(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  if (longWaitTimer !== null) {
    clearTimeout(longWaitTimer)
    longWaitTimer = null
  }
}

async function poll(): Promise<void> {
  if (disposed) return
  // #252 未配对判定走设备角色出口（null ⇔ 无凭据，同源等价）；凭据本体读取供轮询请求携带
  const cred = readDeviceCredential()
  if (deviceRole() === null || cred === null) {
    void router.replace('/pair')
    return
  }
  const result = await fetchPairStatus(cred)
  if (disposed) return
  if (result.ok && result.status === 'active') {
    stopTimers()
    // 批准落定：回首页 + 首次同步挂钩（引擎宏任务延迟首启，不与路由跳转争抢同帧）
    onPaired()
    void router.replace('/')
    return
  }
  networkUnstable.value = !result.ok
  pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
}

/** 重申请（#144）：回配对页重填——reapply 标记放行已配对直达门禁；凭据不动（提交时携带替换） */
function onReapply(): void {
  void router.push({ path: '/pair', query: { reapply: '1' } })
}

onMounted(() => {
  // #252 未配对判定走设备角色出口（null ⇔ 无凭据）；凭据本体读取仅供回显
  const cred = readDeviceCredential()
  if (deviceRole() === null || cred === null) {
    // 无凭据直达（未申请 / 凭据损坏已被读取口清理）：回配对页重新申请
    void router.replace('/pair')
    return
  }
  // 回显名字/角色：读凭据单一来源（申请时已落盘），不依赖路由传参
  deviceName.value = cred.name
  roleText.value = cred.role === 'parent' ? copy.pair.roleParentName : copy.pair.roleChildName
  longWaitTimer = setTimeout(() => {
    longWait.value = true
  }, LONG_WAIT_MS)
  void poll()
})

onBeforeUnmount(() => {
  disposed = true
  stopTimers()
})
</script>

<template>
  <!-- 一屏展示三段之二（ADR 0001）：内容区唯一滚动容器 -->
  <div data-page="pair-wait" class="page pair-wait-page">
    <StarNavBar :title="copy.pair.wait.pageTitle" />
    <main class="pair-wait-scroll page-scroll">
      <div class="pair-wait-card star-container">
        <p class="pair-wait-main">{{ copy.pair.wait.main }}</p>
        <p class="pair-wait-echo">{{ deviceName }} · {{ roleText }}</p>
        <p v-if="longWait" class="pair-wait-hint">{{ copy.pair.wait.longWaitHint }}</p>
        <p v-if="networkUnstable" class="pair-wait-hint" role="status">{{ copy.pair.wait.networkRetry }}</p>
        <StarButtonStandard
          type="button"
          variant="standard"
          size="large"
          class="pair-wait-reapply-btn"
          @click="onReapply"
        >{{ copy.pair.wait.reapplyBtn }}</StarButtonStandard>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* ===== 一屏展示三段结构（ADR 0001）：顶栏 StarNavBar / 内容区 pair-wait-scroll（page-scroll 样式集） ===== */
.pair-wait-page {
  padding: 0;
}

.pair-wait-scroll {
  padding: var(--space-gutter) var(--space-page) var(--space-md);
}

/* 等待卡：容器视觉由全局 star-container 样式集提供，此处只留纵向布局 */
.pair-wait-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}

.pair-wait-main {
  margin: 0;
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  color: var(--color-text);
}

.pair-wait-echo {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--color-primary);
}

.pair-wait-hint {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  color: var(--color-text-secondary);
}
</style>
