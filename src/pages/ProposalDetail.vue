<script setup lang="ts">
// 提议详情页（R32 T7，Spec 20260827-R32 §REQ-R32-4 / §REQ-R32-8；R34 T6 视角改造，Spec 20260828-R34 §REQ-R34-6 / 非目标「不显示 initiator」）：
// 字段 + 双方表态状态 + 整体状态展示（双端一致）；全字段展示（时间分钟级截断不显示秒）；
// 操作区按视角：「编辑」入口双端可见（仅非终态，自主决策 #4——已作废不可修订）、作废入口仅家长视角（StarModalStandard 二次确认，作废不可恢复）；
// 终态（已发布 / 已作废）无作废按钮与编辑入口、不展示家长 / 孩子状态（推导表 N/A 不展示）；发起人不展示（R34 非目标，简报 4.3.10）。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ProposalRecord } from '../types'
import { proposals, voidProposal, proposalEmoji } from '../composables/useProposals'
import { isTerminal as isTerminalState } from '../utils/proposalState'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarChip from '../components/StarChip.vue'
import StarModalStandard from '../components/StarModalStandard.vue'
import { copy } from '../copy'

const route = useRoute()
const router = useRouter()

const proposal = ref<ProposalRecord | null>(null)
const showVoidModal = ref(false)

/** 视角判定（REQ-R34-1-2）：孩子端路由组 meta.view='child'；家长端既有路由无标记 */
const isChildView = computed(() => route.meta.view === 'child')
const isParentView = computed(() => !isChildView.value)

/** 页面内跳转前缀（REQ-R34-1-4）：返回 / 编辑落同视角路由组 */
const viewPath = computed(() => (isChildView.value ? '/child/proposals' : '/proposals'))

/** 文案按视角（REQ-R34-9）：孩子视角取 childView 组，家长视角维持 R32 槽位 */
const pageTitle = computed(() =>
  isChildView.value ? copy.proposals.childView.detail.pageTitle : copy.proposals.detail.pageTitle,
)
// #38 3b/3c：返回文案不再区分视角，全局统一 copy.back
const backBtnText = computed(() => copy.back)

onMounted(() => {
  const id = route.params.id
  if (typeof id !== 'string') return
  proposal.value = proposals().find((p) => p.id === id) ?? null
})

/** 是否终态（已发布 / 已作废）：无作废 / 编辑入口，家长 / 孩子状态不展示。
 *  #66 终态判定统一出口（proposalState.isTerminal），页面只按视图包装 */
const isTerminal = computed(() => {
  const p = proposal.value
  return p !== null && isTerminalState(p)
})

/** 分钟级格式化（REQ-R32-4-1）：YYYY-MM-DD HH:mm，截断不显示秒（本地时区） */
function formatMinute(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function goBack(): void {
  void router.push(viewPath.value)
}

function onEdit(): void {
  if (proposal.value !== null) void router.push(`${viewPath.value}/${proposal.value.id}/edit`)
}

function onVoid(): void {
  showVoidModal.value = true
}

function confirmVoid(): void {
  showVoidModal.value = false
  if (proposal.value !== null) voidProposal(proposal.value.id)
}

function cancelVoid(): void {
  showVoidModal.value = false
}
</script>

<template>
  <div data-page="proposal-detail" class="page proposal-detail-page">
    <StarNavBar :title="pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ backBtnText }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <main v-if="proposal" class="detail-main page-scroll">
      <div class="detail-head">
        <!-- #299 图标随名称展示（proposalEmoji 单一出口：存量无 emoji 兜底 🎁；aria-hidden 装饰） -->
        <h2 class="detail-name"><span class="detail-emoji" aria-hidden="true">{{ proposalEmoji(proposal) }}</span>{{ proposal.name }}</h2>
        <StarChip size="md">{{ copy.proposals.statusBadge[proposal.status] }}</StarChip>
      </div>

      <dl class="detail-fields star-container">
        <div class="detail-row">
          <dt>{{ copy.proposals.detail.priceLabel }}</dt>
          <dd>{{ copy.proposals.priceLabel(proposal.price) }}</dd>
        </div>
        <div class="detail-row">
          <dt>{{ copy.proposals.detail.descriptionLabel }}</dt>
          <dd>{{ proposal.description }}</dd>
        </div>
        <div class="detail-row">
          <dt>{{ copy.proposals.detail.createdAtLabel }}</dt>
          <dd>{{ formatMinute(proposal.createdAt) }}</dd>
        </div>
        <div class="detail-row">
          <dt>{{ copy.proposals.detail.updatedAtLabel }}</dt>
          <dd>{{ formatMinute(proposal.updatedAt) }}</dd>
        </div>
        <!-- 发起人不展示（R34 非目标，简报 4.3.10 拍板本版本不显示 initiator） -->
        <template v-if="!isTerminal">
          <div class="detail-row">
            <dt>{{ copy.proposals.detail.parentStatusLabel }}</dt>
            <dd>{{ copy.proposals.agreementValue[proposal.parentStatus] }}</dd>
          </div>
          <div class="detail-row">
            <dt>{{ copy.proposals.detail.childStatusLabel }}</dt>
            <dd>{{ copy.proposals.agreementValue[proposal.childStatus] }}</dd>
          </div>
        </template>
        <div class="detail-row">
          <dt>{{ copy.proposals.detail.statusLabel }}</dt>
          <dd>{{ copy.proposals.statusBadge[proposal.status] }}</dd>
        </div>
      </dl>

      <!-- 操作区（REQ-R34-6-2）：编辑入口双端可见（仅非终态）；作废入口仅家长视角（REQ-R34-8-1 孩子端零作废） -->
      <div v-if="!isTerminal" class="detail-actions">
        <StarButtonStandard variant="standard" size="small" class="edit-btn" @click="onEdit">{{ copy.proposals.editBtn }}</StarButtonStandard>
        <StarButtonStandard v-if="isParentView" variant="standard" size="small" class="void-btn" @click="onVoid">{{ copy.proposals.voidBtn }}</StarButtonStandard>
      </div>
    </main>

    <!-- 作废二次确认（REQ-R32-4-2，作废不可恢复） -->
    <StarModalStandard
      v-if="showVoidModal && proposal"
      :message="copy.proposals.voidConfirm(proposal.name)"
      :cancel-text="copy.parent.cancel"
      :confirm-text="copy.parent.confirm"
      @cancel="cancelVoid"
      @confirm="confirmVoid"
    />
  </div>
</template>

<style scoped>
/* 一屏展示批2（#52）：内容区唯一滚动容器，滚动四件套已收编全局 page-scroll 样式集（components.css，#68） */
.detail-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-top: var(--space-md);
  /* 滚动到底时末个区块唇边留呼吸位 */
  padding-bottom: var(--space-md);
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.detail-name {
  margin: 0;
  font-size: var(--font-size-headline);
  font-weight: 700;
  color: var(--color-text);
  min-width: 0;
}

/* #299 图标前置（aria-hidden 装饰）：与名称同行，标题字号同档 */
.detail-emoji {
  margin-right: var(--space-xs);
}

.detail-fields {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.detail-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
}

.detail-row dt {
  flex-shrink: 0;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.detail-row dd {
  margin: 0;
  font-size: var(--font-size-body-lg);
  font-weight: 600;
  color: var(--color-text);
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

.detail-actions {
  display: flex;
  gap: var(--space-sm);
}

.void-btn {
  color: var(--color-error);
}
</style>
