<script setup lang="ts">
// 提议板列表页（R32 起源 / R34 视角渲染 / #63 双阵营卡重排，Spec #61 终稿 2026-08-30；#66 读端收口）：
// 卡结构自上而下——头部（名称 + ★消耗，家长点名称进详情）→ 右上角状态标识（已谈成绿 / 已作废红，仅两态出现）
// → 阵营区（对方恒左 / 自己恒右：卡通头像 + 状态文案；双侧同规则：还在考虑 / 刚刚提议 / 已修改提议 / 已点头）→ 操作行（整体靠右：
// 本方 mini 头像 + 表态钮（standard，文案随状态翻转：还在考虑→「同意」/ 已点头→「再想想」）
// + 「我要改改」（跳编辑表单）+ 「发布兑换项」）。
// 发布：仅家长视角 · 门槛就绪即出现（#265 发布窗口已删除，发布门禁 = 发布门槛，任意时刻可发布）。
// 终态已作废：正常卡壳、标题/价格文字淡化、无阵营无表态；家长端留「查看详情」，孩子端无任何按钮。
// 排序分组（R32/R34）不变：非作废在前组内倒序、已作废整体最后；「已发布不进列表」是列表页展示例外（#66 拍板 Q3：
// 全站终态 = 已发布或已作废，终态判定走 proposalState.isTerminal 统一出口，仅本页不渲染已发布）；视角经路由 meta.view 判定，
// 页面内跳转按视角拼前缀（REQ-R34-1-4）；操作后重新读取 sq_proposals 刷新（数据层不缓存，页面自持快照）。
// #66 答案卡单一出口：阵营 / 徽章 / 门槛就绪判定全部经 deriveCardView（提议卡视图，页面查 copy 映射文案，零自拼判定、零兜底）；
// useProposals 壳已删，具名导入。
// #203 提议卡拆件：卡片展示件拆为三件组合（registry）——StarProposalCardShell 卡壳（头部/价格行/徽章/
// 淡化态）+ StarProposalCamps 阵营区（双 camp 槽）+ StarProposalActions 操作行；页面只组装槽位内容与判定。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ProposalInitiator, ProposalRecord } from '../types'
import { proposals, setAgreed, publish, publishGate, deleteProposal, proposalEmoji } from '../composables/useProposals'
import { deriveCardView, isTerminal, type ProposalCampState } from '../utils/proposalState'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarModalStandard from '../components/StarModalStandard.vue'
import CampAvatar from '../components/CampAvatar.vue'
import StarEmptyState from '../components/StarEmptyState.vue'
import StarProposalCardShell from '../components/StarProposalCardShell.vue'
import StarProposalCamps from '../components/StarProposalCamps.vue'
import StarProposalActions from '../components/StarProposalActions.vue'
import { copy } from '../copy'

const route = useRoute()
const router = useRouter()

// #266 已作废删除常驻化：删除不再依赖任何超能力状态，家长视角已作废卡常驻删除钮；孩子端路由组零接触删除逻辑

const list = ref<ProposalRecord[]>([])

/** 视角判定（REQ-R34-1-2）：孩子端路由组 meta.view='child'；家长端既有路由无标记 */
const isChildView = computed(() => route.meta.view === 'child')
const isParentView = computed(() => !isChildView.value)

/** 本视角表态角色（REQ-R34-2-2 各控各）：孩子视角控 childStatus、家长视角控 parentStatus */
const role = computed<ProposalInitiator>(() => (isChildView.value ? 'child' : 'parent'))

/** 对方角色（Spec #61：阵营恒「对方在左、自己在右」，随视角换序） */
const otherRole = computed<ProposalInitiator>(() => (isChildView.value ? 'parent' : 'child'))

/** 页面内跳转前缀（REQ-R34-1-4）：新建 / 编辑 / 详情落同视角路由组 */
const viewPath = computed(() => (isChildView.value ? '/child/proposals' : '/proposals'))

/** 文案按视角（REQ-R34-9）：孩子视角取 childView 组，家长视角维持 R32 槽位 */
const pageTitle = computed(() => (isChildView.value ? copy.proposals.childView.pageTitle : copy.proposals.pageTitle))
const createBtnText = computed(() =>
  isChildView.value ? copy.proposals.childView.createProposal : copy.proposals.createProposal,
)
const emptyStateText = computed(() =>
  isChildView.value ? copy.proposals.childView.emptyState : copy.proposals.emptyState,
)
// #38 3b/3c：返回文案不再区分视角，全局统一 copy.back（childView/parent back 字段已 [DEPRECATED]）
const backBtnText = computed(() => copy.back)

/** 角色对应的头像 kind（数据角色 parent/child → glyph adult/child）；CampAvatar 自 #197 起升 registry（../components/CampAvatar.vue） */
function avatarKind(r: ProposalInitiator): 'child' | 'adult' {
  return r === 'child' ? 'child' : 'adult'
}

/** 头像 aria 标签（Spec #61：阵营头像带无障碍名，取 copy 槽位） */
function avatarLabel(r: ProposalInitiator): string {
  return r === 'child' ? copy.proposals.ariaChildSide : copy.proposals.ariaParentSide
}

onMounted(() => {
  reload()
})

/** 分组排序（REQ-R32-2-3 + R34 REQ-R34-7-1）：非作废且未发布（沟通中 / 已达成一致）在前、组内创建时间倒序；已作废整体排最后。
 *  #66 展示例外显式写明：全站终态 = 已发布或已作废，本列表页仅不渲染「已发布」（已发布流转为兑换项，提议卡上无后续动作），
 *  已作废照常进列表挂红徽章 */
const sorted = computed(() => {
  const active = list.value
    .filter((p) => p.status !== 'voided' && p.status !== 'published')
    .sort((a, b) => b.createdAt - a.createdAt)
  const voided = list.value.filter((p) => p.status === 'voided').sort((a, b) => b.createdAt - a.createdAt)
  return [...active, ...voided]
})

function reload(): void {
  list.value = proposals()
}

/** 返回目标按视角（REQ-R34-1-3）：孩子视角回兑换页，家长视角回家长页 */
function goBack(): void {
  void router.push(isChildView.value ? '/redeem' : '/parent')
}

function onCreate(): void {
  void router.push(`${viewPath.value}/new`)
}

function onDetail(id: string): void {
  void router.push(`${viewPath.value}/${id}`)
}

/** 家长点标题进详情（Spec #61 终稿：详情入口仅家长，载体为标题点击） */
function onTitle(p: ProposalRecord): void {
  if (isParentView.value) onDetail(p.id)
}

/** 「我要改改」：直接进编辑表单（两视角都有；键名 changeBtn＝沟通中要改提案本身，非常规编辑） */
function onEdit(id: string): void {
  void router.push(`${viewPath.value}/${id}/edit`)
}

/** 本视角是否已点头（各控各：视角决定看哪一方开关） */
function selfAgreed(p: ProposalRecord): boolean {
  return role.value === 'child' ? p.childStatus === 'agreed' : p.parentStatus === 'agreed'
}

/** 对方是否已点头 */
function otherAgreed(p: ProposalRecord): boolean {
  return otherRole.value === 'child' ? p.childStatus === 'agreed' : p.parentStatus === 'agreed'
}

/** 表态钮文案＝下一步动作（Spec #61 终稿）：还在考虑 →「同意」/ 已点头 →「再想想」 */
function stanceBtnText(p: ProposalRecord): string {
  return selfAgreed(p) ? copy.proposals.rethinkBtn : copy.proposals.agreeBtn
}

/** 阵营文案映射（#66 Q1：计算器给判定枚举、页面查 copy 映射文案） */
const CAMP_STATE_TEXT: Record<ProposalCampState, string> = {
  notAgreed: copy.proposals.campStateNotAgreed,
  proposed: copy.proposals.campStateProposed,
  changed: copy.proposals.campStateChanged,
  agreed: copy.proposals.campStateAgreed,
}

/** 阵营状态文案（单一出口 deriveCardView 按侧取判定枚举，页面映射 copy；零自拼判定、零兜底） */
function campText(p: ProposalRecord, side: ProposalInitiator): string {
  const view = deriveCardView(p)
  return CAMP_STATE_TEXT[side === 'child' ? view.childCamp : view.parentCamp]
}

/** 右上角状态徽章（卡壳 prop）：done 金（已谈成）/ void 红（已作废）；沟通中为 undefined 不出现 */
function badge(p: ProposalRecord): { text: string; tone: 'done' | 'void' } | undefined {
  const b = deriveCardView(p).badge
  if (b === 'done') return { text: copy.proposals.campStateDone, tone: 'done' }
  if (b === 'voided') return { text: copy.proposals.statusBadge.voided, tone: 'void' }
  return undefined
}

/** 表态：点击翻转本视角开关（同意 ↔ 再想想），各控各不碰对方（REQ-R34-4） */
function onToggleStance(p: ProposalRecord): void {
  setAgreed(p.id, role.value, !selfAgreed(p))
  reload()
}

/** 发布兑换项（Spec #61 终稿：仅家长视角 · 已谈成 · 门槛就绪即出现；REQ-R32-7-1；
 *  #265 发布门禁 = 发布门槛单一判定，无发布窗口；#266 起页面不传任何超能力旁路） */
function onPublish(p: ProposalRecord): void {
  publish(p.id)
  reload()
}

/** 发布按钮显隐（#66 改用答案卡字段）：家长视角 && 门槛就绪（deriveCardView.publishReady）&& 发布门禁放行
 *  （#265 起发布门禁 = 发布门槛，页面共用同一判定不自拼） */
function showPublishBtn(p: ProposalRecord): boolean {
  return isParentView.value && deriveCardView(p).publishReady && publishGate(p).allowed
}

/** #266 已作废删除常驻化（原 #77 REQ-77-3）：已作废卡家长视角「查看详情」旁常驻删除钮，不再依赖任何开关；
 *  列表页终态必为已作废（published 不进列表），status 双保险判 voided */
function showDeleteBtn(p: ProposalRecord): boolean {
  return isParentView.value && p.status === 'voided'
}

/** 删除二次确认目标（null = 无弹窗；StarModalStandard confirm 形态沿作废确认惯例） */
const deleteTarget = ref<ProposalRecord | null>(null)

function onDelete(p: ProposalRecord): void {
  deleteTarget.value = p
}

/** 确认删除（REQ-77-3-3）：物理移除记录（仅 voided，收口 deleteProposal），孩子端提议板同步消失 */
function confirmDelete(): void {
  if (deleteTarget.value !== null) deleteProposal(deleteTarget.value.id)
  deleteTarget.value = null
  reload()
}

function cancelDelete(): void {
  deleteTarget.value = null
}
</script>

<template>
  <div data-page="proposals" class="page proposals-page">
    <StarNavBar :title="pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ backBtnText }}</StarButtonStandard>
      </template>
      <template #right>
        <StarButtonStandard variant="standard" size="small" class="create-btn" @click="onCreate">{{ createBtnText }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <main class="proposals-main page-scroll">
      <!-- #196 空态块收编 StarEmptyState（纯文案态 icon=false） -->
      <StarEmptyState v-if="sorted.length === 0" :icon="false">{{ emptyStateText }}</StarEmptyState>
      <template v-else>
        <ul class="proposal-list">
          <li v-for="p in sorted" :key="p.id">
            <StarProposalCardShell
              :data-proposal-id="p.id"
              :name="p.name"
              :price="p.price"
              :emoji="proposalEmoji(p)"
              :badge="badge(p)"
              :name-clickable="isParentView"
              @title-click="onTitle(p)"
            >
              <!-- 阵营区（非终态）：对方恒左 / 自己恒右，头像 + 状态文案由页面组装（判定留页面） -->
              <template #camps>
                <StarProposalCamps v-if="!isTerminal(p)">
                  <template #left>
                    <CampAvatar :kind="avatarKind(otherRole)" :label="avatarLabel(otherRole)" />
                    <span class="camp-state" :class="{ 'is-agree': otherAgreed(p) }">{{ campText(p, otherRole) }}</span>
                  </template>
                  <template #right>
                    <CampAvatar :kind="avatarKind(role)" :label="avatarLabel(role)" />
                    <span class="camp-state" :class="{ 'is-agree': selfAgreed(p) }">{{ campText(p, role) }}</span>
                  </template>
                </StarProposalCamps>
              </template>

              <!-- 操作行（最底一行，右对齐容器由操作行件提供）：本方 mini 头像 + 表态钮 + 改提议 + 发布（条件）；
                   终态：家长端仅「查看详情」，孩子端无任何按钮 -->
              <template #actions>
                <StarProposalActions>
                  <template v-if="!isTerminal(p)">
                    <CampAvatar :kind="avatarKind(role)" class="camp-avatar--mini" />
                    <StarButtonStandard variant="standard" size="small" class="stance-btn" @click="onToggleStance(p)">
                      {{ stanceBtnText(p) }}
                    </StarButtonStandard>
                    <StarButtonStandard variant="standard" size="small" class="change-btn" @click="onEdit(p.id)">
                      {{ copy.proposals.changeBtn }}
                    </StarButtonStandard>
                    <StarButtonStandard v-if="showPublishBtn(p)" variant="primary" size="small" class="publish-btn" @click="onPublish(p)">
                      {{ copy.proposals.publishBtn }}
                    </StarButtonStandard>
                  </template>
                  <!-- 终态：家长端「查看详情」+ #266 常驻删除钮（仅已作废）；孩子端无任何按钮 -->
                  <template v-else-if="isParentView">
                    <StarButtonStandard
                      variant="standard"
                      size="small"
                      class="detail-btn"
                      @click="onDetail(p.id)"
                    >
                      {{ copy.proposals.viewDetail }}
                    </StarButtonStandard>
                    <StarButtonStandard
                      v-if="showDeleteBtn(p)"
                      variant="standard"
                      size="small"
                      class="delete-btn"
                      @click="onDelete(p)"
                    >
                      {{ copy.proposals.deleteBtn }}
                    </StarButtonStandard>
                  </template>
                </StarProposalActions>
              </template>
            </StarProposalCardShell>
          </li>
        </ul>
      </template>
    </main>

    <!-- #266 删除二次确认常驻保留（StarModalStandard confirm 形态沿作废确认惯例，文案含不可恢复） -->
    <StarModalStandard
      v-if="deleteTarget"
      :message="copy.proposals.deleteConfirm(deleteTarget.name)"
      @cancel="cancelDelete"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
/* 一屏展示批2（#52）：内容区唯一滚动容器，滚动四件套已收编全局 page-scroll 样式集（components.css，#68） */
.proposals-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding-top: var(--space-md);
  /* 滚动到底时末张提议卡 4px 唇边留呼吸位 */
  padding-bottom: var(--space-md);
}

/* 空态块已收编 StarEmptyState（#196：结构/星形/文案样式归组件） */

.proposal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

/* 提议卡视觉（卡壳/头部/价格行/徽章/阵营区/操作行）已随 #203 拆件迁出：
   三件组件 scoped 持有各自样式，页面零内联提议卡样式；卡片承载视觉由卡壳件内置 */
</style>
