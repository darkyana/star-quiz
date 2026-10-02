<script setup lang="ts">
// 提议新建 / 编辑表单页（R32 T7，Spec 20260827-R32 §REQ-R32-3；R34 T5 视角改造，Spec 20260828-R34 §REQ-R34-3 / §REQ-R34-5 页面侧）：
// /proposals/new 新建、/proposals/:id/edit 编辑，复用同一组件；孩子端路由组 /child/proposals/* 同组件（meta.view='child'）；
// 新建按视角传发起人（孩子 initiator:'child' 自动同意自己 / 家长 R32 回归）、编辑按视角传修订方（对方重置）；
// 三字段（名称非空 / 消耗正整数 / 说明可空），校验失败显示提示槽位且零写入（R34 完全沿用，零特判）；
// 终态（已发布 / 已作废）或不存在的提议不渲染表单（REQ-R32-3-5，零写入路径不存在）。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ProposalInitiator, ProposalRecord } from '../types'
import { proposals, create, update, proposalEmoji, PROPOSAL_EMOJI_DEFAULT } from '../composables/useProposals'
import { isTerminal as isTerminalState } from '../utils/proposalState'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import { copy } from '../copy'

const route = useRoute()
const router = useRouter()

/** 视角判定（REQ-R34-1-2）：孩子端路由组 meta.view='child'；家长端既有路由无标记 */
const isChildView = computed(() => route.meta.view === 'child')

/** 本视角发起 / 修订角色（REQ-R34-3-2 / REQ-R34-5-1）：孩子视角 'child'、家长视角 'parent' */
const role = computed<ProposalInitiator>(() => (isChildView.value ? 'child' : 'parent'))

/** 页面内跳转前缀（REQ-R34-1-4）：保存 / 返回落同视角列表页 */
const viewPath = computed(() => (isChildView.value ? '/child/proposals' : '/proposals'))

/** 文案按视角（REQ-R34-9）：孩子视角取 childView 组，家长视角维持 R32 槽位 */
const pageTitle = computed(() =>
  isChildView.value ? copy.proposals.childView.form.pageTitle : copy.proposals.form.pageTitle,
)
const saveBtnText = computed(() =>
  isChildView.value ? copy.proposals.childView.form.saveBtn : copy.proposals.form.saveBtn,
)
// #38 3b/3c：返回文案不再区分视角，全局统一 copy.back
const backBtnText = computed(() => copy.back)

/** 编辑目标（null = 新建模式 / 终态与不存在拒绝渲染） */
const editing = ref<ProposalRecord | null>(null)
const formVisible = ref(true)

const name = ref('')
const price = ref('')
const description = ref('')
const showHint = ref(false)

// ===== #299 提议图标（#300 原型方案 B 定稿：行内收起/展开宫格）=====
/** 宫格候选清单（#300 定稿 30 个奖励系，默认 🎁 首位） */
const EMOJI_CANDIDATES = [
  '🎁', '🍦', '🍕', '🍔', '🍟', '🍿', '🍭', '🍫', '🧁', '🍩',
  '🍪', '🎂', '🍰', '🦄', '🎠', '⚽', '🏀', '🎮', '🕹️', '🚲',
  '🧩', '🎯', '🎨', '🎧', '🎵', '📚', '🛼', '🏊', '🎪', '🏆',
] as const

/** 当前选中图标（新建缺省 🎁；编辑态 onMounted 经 proposalEmoji 回填——存量无 emoji 兜底 🎁） */
const selectedEmoji = ref<string>(PROPOSAL_EMOJI_DEFAULT)
/** #299 存量零补键：编辑加载时的回填初值 / 加载记录本身是否无 emoji 键。
 *  保存时若「记录无 emoji 键且选中值仍为回填初值」→ 不落 emoji 键（保持缺省，不物理补键）；
 *  用户改选任何值（含选回初值之外）则照常落键——经回填初值比较区分「没改过」与「显式选过」 */
const initialEmoji = ref<string>(PROPOSAL_EMOJI_DEFAULT)
const editingEmojiAbsent = ref(false)
/** 宫格展开态（#300 方案 B：收起时一行「{当前emoji} 换一个」，展开后单选高亮 + 「收起」） */
const gridOpen = ref(false)

onMounted(() => {
  const id = route.params.id
  if (typeof id !== 'string' || id === '') return // 新建模式
  const found = proposals().find((p) => p.id === id)
  if (found === undefined || isTerminalState(found)) {
    formVisible.value = false // 终态 / 不存在：不渲染表单（零写入；#66 终态判定统一出口）
    return
  }
  editing.value = found
  name.value = found.name
  price.value = String(found.price)
  description.value = found.description
  // #299 编辑态回填：当前 emoji 选中（proposalEmoji 单一出口，存量无 emoji 兜底 🎁）；
  // 记录回填初值与「无键」事实，供保存时判定是否保持缺省不落键
  initialEmoji.value = proposalEmoji(found)
  editingEmojiAbsent.value = found.emoji === undefined
  selectedEmoji.value = initialEmoji.value
})

/** 校验（REQ-R32-3-4）：名称非空字符串、消耗正整数；非法 → true */
function isInvalid(): boolean {
  const parsed = Number(price.value)
  return name.value.trim() === '' || !Number.isInteger(parsed) || parsed <= 0
}

/** 底部操作栏前置条件（#53）：必填两项（名称/消耗）全空 → 保存禁用而非隐藏；
 *  部分填写但非法时仍可点，走 REQ-R32-3-4 校验提示槽位（点击路径与现状一致，零写入） */
const formBlank = computed(() => name.value.trim() === '' && price.value.trim() === '')

/** 保存（REQ-R34-3-2 / REQ-R34-5-1）：新建按视角传发起人、编辑按视角传修订方；成功后回同视角列表页。
 *  #299：emoji 属提议内容随表单携带——改 emoji 与改名称/消耗/说明同走修订即认同单一语义；
 *  编辑存量无 emoji 记录且未改选（仍为回填初值）→ 不携带 emoji 键（保持缺省零补键，与 spec「存量零迁移」对齐） */
function onSave(): void {
  if (isInvalid()) {
    showHint.value = true
    return
  }
  showHint.value = false
  const emojiKeptDefault =
    editing.value !== null && editingEmojiAbsent.value && selectedEmoji.value === initialEmoji.value
  const input = {
    name: name.value,
    price: Number(price.value),
    description: description.value,
    ...(!emojiKeptDefault ? { emoji: selectedEmoji.value } : {}),
  }
  if (editing.value === null) {
    create(input, { initiator: role.value })
  } else {
    update(editing.value.id, input, role.value)
  }
  void router.push(viewPath.value)
}

function goBack(): void {
  void router.push(viewPath.value)
}
</script>

<template>
  <div data-page="proposal-edit" class="page proposal-edit-page">
    <StarNavBar :title="pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ backBtnText }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <template v-if="formVisible">
      <!-- 一屏展示三段之二（#53 / ADR 0001）：内容区，唯一滚动容器；长表单仅此处滚动 -->
      <main class="edit-scroll">
        <form class="proposal-form star-container" @submit.prevent="onSave">
          <label class="form-field">
            <span class="field-label">{{ copy.proposals.form.nameLabel }}</span>
            <input v-model="name" type="text" class="form-name-input" />
          </label>
          <!-- #299 提议图标（#300 方案 B）：名称之后一行「{当前emoji} 换一个」，点击展开/收起 6 列宫格单选 -->
          <div class="form-field">
            <span class="field-label">{{ copy.proposals.form.emojiLabel }}</span>
            <button type="button" class="emoji-toggle-row" :aria-expanded="gridOpen" @click="gridOpen = !gridOpen">
              <span class="emoji-current" aria-live="polite">{{ selectedEmoji }}</span>
              <span class="emoji-toggle-hint">{{ gridOpen ? copy.proposals.form.emojiCollapseBtn : copy.proposals.form.emojiSwapBtn }}</span>
            </button>
            <div v-if="gridOpen" class="emoji-grid" role="radiogroup" :aria-label="copy.proposals.form.ariaEmojiGroup">
              <button
                v-for="e in EMOJI_CANDIDATES"
                :key="e"
                type="button"
                class="emoji-cell"
                :class="{ 'is-selected': e === selectedEmoji }"
                role="radio"
                :aria-checked="e === selectedEmoji"
                @click="selectedEmoji = e"
              >{{ e }}</button>
            </div>
          </div>
          <label class="form-field">
            <span class="field-label">{{ copy.proposals.form.priceLabel }}</span>
            <input v-model="price" type="text" inputmode="numeric" class="form-price-input" />
          </label>
          <label class="form-field">
            <span class="field-label">{{ copy.proposals.form.descriptionLabel }}</span>
            <textarea v-model="description" rows="3" class="form-desc-input"></textarea>
          </label>
          <p v-if="showHint" class="form-validation-hint" role="alert">{{ copy.proposals.form.validationHint }}</p>
        </form>
      </main>

      <!-- 一屏展示三段之三（#53）：底部操作栏常驻，必填全空禁用而非隐藏（CONTEXT.md「底部操作栏」） -->
      <footer class="bottom-action-bar">
        <StarButtonStandard variant="primary" size="large" :edge-inset="false" class="form-save-btn" :disabled="formBlank" @click="onSave">{{ saveBtnText }}</StarButtonStandard>
      </footer>
    </template>
  </div>
</template>

<style scoped>
/* ===== 一屏展示三段结构（#53 / ADR 0001，沿用 Quiz 页内三件套）=====
   段一 顶栏 = StarNavBar（页内普通流，锁高后视觉等效固定）
   段二 内容区 = edit-scroll（唯一滚动容器）
   段三 底部操作栏 = bottom-action-bar（常驻，必填全空禁用） */
.proposal-edit-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  /* 中和全局 [data-page] min-height: 100dvh，改为填满锁高外壳 */
  min-height: 0;
  /* 根 padding 移交内容区与底栏 */
  padding: 0;
}

.edit-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 自身禁用 transform/filter/will-change（#40 决策 10：水印/弹窗/toast fixed 覆盖层不错位） */
  padding: var(--space-gutter) var(--space-page) var(--space-md);
}

.proposal-edit-page :deep(.page-header) {
  flex-shrink: 0;
}

/* 底部操作栏段三样式已收编全局 bottom-action-bar 样式集（components.css，#68） */

/* 表单卡：容器视觉（白底/描边/圆角/padding）由全局 star-container 样式集提供，此处只留纵向布局 */
.proposal-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}

.field-label {
  font-size: var(--font-size-body);
  font-weight: 700;
  color: var(--color-text);
}

.form-name-input,
.form-price-input,
.form-desc-input {
  font-family: inherit;
  font-size: var(--font-size-body-lg);
  padding: var(--space-sm);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  color: var(--color-text);
}

.form-name-input:focus-visible,
.form-price-input:focus-visible,
.form-desc-input:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

.form-validation-hint {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 600;
  color: var(--color-error);
}

/* ===== #299 提议图标宫格（#300 方案 B 定稿；全令牌，选中态沿 StarListSelectable/StarSegmentTabs 既有口径）===== */

/* 收起行：与表单输入件同款容器视觉（描边/圆角/底色），左当前 emoji 右切换文案 */
.emoji-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-base);
  padding: var(--space-sm);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  cursor: pointer;
}

.emoji-toggle-row:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

.emoji-current {
  font-size: var(--font-size-body-lg);
  line-height: 1.2;
}

.emoji-toggle-hint {
  font-size: var(--font-size-info);
  color: var(--color-text-secondary);
}

/* 6 列平铺宫格（#300 定稿） */
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--space-sm);
}

.emoji-cell {
  font-size: var(--font-size-body-lg);
  line-height: 1.2;
  padding: var(--space-sm) 0;
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  cursor: pointer;
}

/* 选中态：主色描边 + 同色外环（StarListSelectable 选中口径）+ surface-bright 提亮底（StarSegmentTabs 选中口径） */
.emoji-cell.is-selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
  background-color: var(--color-surface-bright);
}

.emoji-cell:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
