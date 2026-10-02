<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarModalStandard from '../components/StarModalStandard.vue'
import { copy } from '../copy'
import { parentGuideNotifications, type ParentGuideNotification } from '../data/parent-guide-notifications'
import { markParentGuideNotificationRead, useUnreadParentGuideNotifications } from '../composables/useParentGuideReadLedger'

import { IS_MINITOOL } from '../minitool'
import { reportOnboarding } from '../cloud/onboardingMetrics'

const router = useRouter()
const route = useRoute()
const notice = ref<'beta' | 'statistics' | null>(null)
const statisticsTrigger = ref<HTMLAnchorElement | null>(null)
const betaTrigger = ref<InstanceType<typeof StarButtonStandard> | null>(null)
const noticeModal = ref<InstanceType<typeof StarModalStandard> | null>(null)

// #323 一页两形态：显式来源参数区分，缺省恒为通知视图（沿用 #317「显式来源 + 合法值白名单」形状——
// 严格全等 'parent' 才是归档，缺失/非法/重复（重复 from 解析为数组）/外部值一律降级通知视图）。
// 参数双重含义：from=parent = 归档形态 + 返回回家长页。全仓唯一写这个值的地方是家长页
// 「给家长的话」按钮（Parent.vue goParentGuide）；新增写 from=parent 的入口 = 新增归档入口，必须显式评审。
const isArchiveForm = computed(() => route.query.from === 'parent')

// 返回目标：归档（家长页来）→ 回家长页；其余（含非法/缺失降级为通知视图）→ 回首页
function goBack(): void {
  if (isArchiveForm.value) { void router.push('/parent'); return }
  reportOnboarding('guide_back'); void router.push('/')
}

// #321 通知视图：默认形态只渲染未读通知（已读账 = 家庭级，见 useParentGuideReadLedger）；
// 只有点「知道了」才写状态，进入页面与阅读都不写（不存在「打开即已读」）。
const unreadNotifications = useUnreadParentGuideNotifications()
// #323 归档形态数据源：渲染全部通知（已读未读渲染完全一致、零痕迹）；进入与浏览都不写任何已读
// （归档里没有「知道了」，markParentGuideNotificationRead 在归档下无从触发）。
const visibleNotifications = computed(() => isArchiveForm.value ? parentGuideNotifications : unreadNotifications.value)
// 收尾空态文本节点（tabindex=-1 可编程聚焦）：点掉最后一条「知道了」后焦点落到这里，不悬空
const emptyState = ref<HTMLElement | null>(null)
// 「知道了」按钮引用（v-for 函数 ref 按通知 id 捕获）：非最后一条被移除后，焦点移到下一条剩余卡片的按钮上
const dismissButtons = new Map<string, InstanceType<typeof StarButtonStandard>>()
function captureDismissButton(notification: ParentGuideNotification): (element: unknown) => void {
  return (element: unknown): void => {
    if (element === null) dismissButtons.delete(notification.id)
    else dismissButtons.set(notification.id, element as InstanceType<typeof StarButtonStandard>)
  }
}

async function acknowledge(notification: ParentGuideNotification): Promise<void> {
  // #324 消费计数：点「知道了」才算被消费；尽力而为，不影响已读写入与焦点收尾
  // （归档形态无此按钮，无从触发；失败按既有口径静默吞掉）。
  reportOnboarding('guide_dismiss')
  const wasLast = unreadNotifications.value.length === 1
  const dismissedIndex = unreadNotifications.value.findIndex(n => n.id === notification.id)
  markParentGuideNotificationRead(notification.id)
  await nextTick()
  if (wasLast) {
    // 被移除的「知道了」按钮不再持有焦点：空态渲染后立即聚焦空态文本
    emptyState.value?.focus()
  } else {
    // 键盘焦点不悬空（spec #319 故事 29）：移除的不是最后一条时，焦点移到下一条剩余卡片的
    // 「知道了」（移除的是剩余末条时，落到新的末条）；仅当目标卡未被渲染（归档形态无从触发）才不做。
    const remaining = unreadNotifications.value
    const target = remaining[Math.min(dismissedIndex, remaining.length - 1)]
    if (target !== undefined) dismissButtons.get(target.id)?.$el?.focus()
  }
}

// #320 通知数据驱动：按钮文案、埋点名与去向全部来自通知数据（src/data/parent-guide-notifications.ts）。
function runNotificationAction(notification: ParentGuideNotification): void {
  reportOnboarding(notification.actionMetric)
  const action = notification.action
  if (action.kind === 'route') {
    void router.push(action.query === undefined ? { path: action.path } : { path: action.path, query: action.query })
  } else {
    void openBeta()
  }
}

// 弹窗关闭后焦点回到触发按钮：beta-notice 入口的按钮在 v-for 里，用函数 ref 捕获。
function captureBetaTrigger(element: unknown): void {
  betaTrigger.value = (element ?? null) as InstanceType<typeof StarButtonStandard> | null
}

async function openBeta(): Promise<void> {
  notice.value = 'beta'
  await nextTick()
  noticeModal.value?.$el.querySelector('button')?.focus()
}
async function openStatistics(): Promise<void> {
  reportOnboarding('guide_statistics')
  notice.value = 'statistics'
  await nextTick()
  noticeModal.value?.$el.querySelector('button')?.focus()
}
async function closeNotice(): Promise<void> {
  const trigger = notice.value === 'statistics' ? statisticsTrigger.value : betaTrigger.value?.$el
  notice.value = null
  await nextTick()
  trigger?.focus()
}
function onKeydown(event: KeyboardEvent): void {
  if (notice.value === null) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeNotice()
  } else if (event.key === 'Tab') {
    // This notice has one action; keep keyboard focus in the dialog until dismissed.
    event.preventDefault()
    noticeModal.value?.$el.querySelector('button')?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// Lucide pencil / star / gift / message-circle (ISC), as approved in #309.
const stepPaths = [
  ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.499z', 'm15 5 4 4'],
  ['M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.164.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.394 21.01a.53.53 0 0 1-.77-.56l.881-5.14a2.12 2.12 0 0 0-.611-1.878L2.158 9.795a.53.53 0 0 1 .294-.906l5.163-.755a2.12 2.12 0 0 0 1.597-1.16z'],
  ['M3 8h18v4H3z', 'M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8', 'M12 8v13', 'M12 8H7.5A2.5 2.5 0 1 1 10 5.5L12 8Z', 'M12 8h4.5A2.5 2.5 0 1 0 14 5.5L12 8Z'],
  ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
]
</script>

<template>
  <div data-page="parent-guide" class="page parent-guide">
    <StarNavBar :title="copy.parentGuide.pageTitle">
      <template #left>
        <StarButtonStandard type="button" variant="standard" size="small" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>
    <main class="guide-scroll page-scroll" :inert="notice !== null || undefined">
      <ol class="guide-steps">
        <li v-for="(step, index) in copy.parentGuide.steps" :key="step" class="guide-step">
          <span class="guide-step__badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="path in stepPaths[index]" :key="path" :d="path" />
            </svg>
          </span>
          <span>{{ step }}</span>
        </li>
      </ol>
      <!-- #323 归档形态渲染全部通知且永不出现空态（isArchiveForm 短路在前）；通知视图读空才落收尾空态 -->
      <div v-if="isArchiveForm || unreadNotifications.length > 0" class="guide-cards">
        <section v-for="notification in visibleNotifications" :key="notification.id" class="guide-card" :aria-labelledby="notification.headingId">
          <div class="guide-card__text">
            <h2 :id="notification.headingId">{{ notification.title }}</h2>
            <div v-if="notification.body.kind === 'paragraphs' && notification.body.note !== undefined">
              <p v-for="paragraph in notification.body.paragraphs" :key="paragraph">{{ paragraph }}</p>
              <p class="guide-note">{{ notification.body.note }}</p>
            </div>
            <template v-else-if="notification.body.kind === 'paragraphs'">
              <p v-for="paragraph in notification.body.paragraphs" :key="paragraph">{{ paragraph }}</p>
            </template>
            <ul v-else class="guide-parent-items">
              <li v-for="item in notification.body.items" :key="item">{{ item }}</li>
            </ul>
          </div>
          <StarButtonStandard :ref="notification.action.kind === 'beta-notice' ? captureBetaTrigger : undefined" type="button" variant="standard" size="large" :edge-inset="false" @click="runNotificationAction(notification)">{{ notification.actionLabel }}</StarButtonStandard>
          <!-- 「知道了」只存在于通知视图（#323 归档形态不渲染——回看不等于重新确认，已读未读渲染一致零痕迹） -->
          <StarButtonStandard v-if="!isArchiveForm" :ref="captureDismissButton(notification)" type="button" variant="standard" size="large" :edge-inset="false" @click="acknowledge(notification)">{{ copy.parentGuide.dismiss }}</StarButtonStandard>
        </section>
      </div>
      <!-- #321 收尾空态：未读一条不剩时的正向收尾（主句 + 说明），不配按钮，离开走既有返回栏 -->
      <div v-else ref="emptyState" class="guide-empty" tabindex="-1">
        <p class="guide-empty__title">{{ copy.parentGuide.allReadTitle }}</p>
        <p class="guide-empty__hint">{{ copy.parentGuide.allReadHint }}</p>
      </div>
      <p class="guide-help">{{ copy.parentGuide.help }}</p>
      <p v-if="!IS_MINITOOL" class="guide-statistics"><a ref="statisticsTrigger" href="#data-statistics" aria-haspopup="dialog" @click.prevent="openStatistics">{{ copy.parentGuide.statisticsTitle }}</a></p>
    </main>
    <StarModalStandard v-if="notice !== null" ref="noticeModal" class="guide-notice"
      :title="notice === 'beta' ? copy.parentGuide.betaTitle : copy.parentGuide.statisticsTitle"
      :message="notice === 'beta' ? copy.parentGuide.betaMessage : undefined"
      variant="notice" notice-button-variant="standard" :confirm-text="copy.parentGuide.dismiss" @confirm="closeNotice" @cancel="closeNotice">
      <div v-if="notice === 'statistics'" class="statistics-copy">
        <p v-for="paragraph in copy.parentGuide.statisticsParagraphs" :key="paragraph">{{ paragraph }}</p>
      </div>
    </StarModalStandard>
  </div>
</template>

<style scoped>
.parent-guide {
  display: flex;
  flex-direction: column;
}
.guide-scroll {
  padding-top: var(--space-md);
  padding-bottom: var(--space-md);
  font-size: var(--font-size-body);
  line-height: var(--leading-body);
}
.guide-scroll p,
.guide-scroll h2 {
  margin: 0;
}
.guide-steps {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  list-style: none;
  margin: 0 0 var(--space-lg);
  padding: 0;
}
.guide-steps::before {
  content: '';
  position: absolute;
  top: calc(var(--touch-sm) / 2);
  left: 12.5%;
  right: 12.5%;
  border-top: var(--border-thin) solid var(--color-star);
}
.guide-step {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-base);
  font-size: var(--font-size-label);
  text-align: center;
}
.guide-step__badge {
  display: grid;
  place-items: center;
  width: var(--touch-sm);
  height: var(--touch-sm);
  border-radius: var(--radius-full);
  background: var(--color-star);
  color: var(--color-on-star);
}
.guide-step__badge svg {
  width: var(--touch-xs);
  height: var(--touch-xs);
}
.guide-cards,
.guide-card,
.guide-card__text {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.guide-card {
  padding: var(--space-md) var(--space-gutter);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  text-align: left;
}
.guide-card__text {
  gap: var(--space-gutter);
}
.guide-card h2 {
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  line-height: var(--leading-tight);
}
.guide-note,
.guide-help {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}
/* #321 收尾空态：复用既有令牌；正向收尾措辞居中呈现（与 guide-help 同一构图语言） */
.guide-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
  padding: var(--space-lg) var(--space-gutter);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  text-align: center;
}
.guide-empty__title {
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  line-height: var(--leading-tight);
}
.guide-empty__hint {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}
.guide-empty:focus-visible {
  outline: var(--border-thin) solid var(--color-star);
  outline-offset: var(--space-xs);
}
.guide-parent-items {
  margin: 0;
  padding-left: var(--space-page);
}
.guide-parent-items li + li {
  margin-top: var(--space-base);
}
.guide-scroll .guide-help {
  margin-top: var(--space-md);
  text-align: center;
}
.guide-scroll .guide-statistics {
  margin-top: var(--space-base);
  text-align: center;
  font-size: var(--font-size-label);
}
.guide-statistics a {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-sm);
  color: var(--color-text-secondary);
  text-decoration: underline;
  text-underline-offset: var(--space-xs);
}
@media (hover: hover) and (pointer: fine) {
  .guide-statistics a:hover { color: var(--color-text); }
}
.guide-statistics a:focus-visible {
  outline: var(--border-thin) solid var(--color-star);
  outline-offset: var(--space-xs);
}
.guide-notice :deep(.star-modal__card) {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - var(--space-md) * 2);
}
.statistics-copy {
  min-height: 0;
  overflow-y: auto;
  font-size: var(--font-size-body);
  line-height: var(--leading-body);
  color: var(--color-text);
}
.statistics-copy p { margin: 0 0 var(--space-md); }
</style>
