<script setup lang="ts">
// 星星宝藏箱页（#295 奖品聚合格子，#293 拍板 / #294 二轮原型拍板终稿）：同名奖品按名称聚成一格格卡
// （emoji 48px + 星光金胶囊「×N」角标挂 emoji 右上角、×1 不渲染），格卡日期 = 组内剩余记录中 createdAt
// 最大一条（人性化相对措辞走 copy 槽位），最近兑换的聚合在前；唯一动作「用一个」（二次确认口语版）
// 按先进先出消耗组内最早一张，数量减一、减到零整格缩小淡出。#293 拍板：删除路径（原「放弃」）彻底移除，
// 奖品唯一终态为使用；使用全程星星账本零变动（宝物是已付款凭证）。布局/动效权威参考为原型分支
// prototype/294-prize-aggregate（不并入）：两列格卡、无入场 stagger（角标挂载弹跳为进场唯一反馈）、
// 角标 N→N-1 弹跳（:key 重挂重放）、清空 0.32s 缩小淡出；#298 复审令牌化：scoped 样式裸值收口为
// variables.css 令牌（--duration-prize-fx 等，#294 拍板数值零改动）。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ActiveRedemption } from '../types'
import { list as listRedemptions, complete as completeRedemption } from '../composables/useActiveRedemptions'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarModalStandard from '../components/StarModalStandard.vue'
import StarToastStandard from '../components/StarToastStandard.vue'
import StarEmptyState from '../components/StarEmptyState.vue'
import { copy } from '../copy'

const router = useRouter()

const records = ref<ActiveRedemption[]>([])

onMounted(() => {
  records.value = listRedemptions()
})

interface PrizeGroup {
  name: string
  emoji: string
  count: number
  /** 组内剩余记录中 createdAt 最大（= 最近一次未消耗的获得日期，先进先出语义） */
  latestTs: number
  /** 组内 createdAt 最早一条（先进先出：「用一个」先消耗它） */
  oldest: ActiveRedemption
}

// 按名称聚合（#293 拍板：聚合键为快照 name，不按兑换项 id——同名即同堆，目录改名/重发布不影响归属），
// 组间按最大 createdAt 降序——最近兑换的聚合在前
const groups = computed<PrizeGroup[]>(() => {
  const byName = new Map<string, ActiveRedemption[]>()
  for (const r of records.value) {
    const list = byName.get(r.name) ?? []
    list.push(r)
    byName.set(r.name, list)
  }
  return [...byName.entries()]
    .map(([name, list]) => ({
      name,
      emoji: list[0].emoji,
      count: list.length,
      latestTs: Math.max(...list.map((r) => r.createdAt)),
      oldest: [...list].sort((a, b) => a.createdAt - b.createdAt)[0],
    }))
    .sort((a, b) => b.latestTs - a.latestTs)
})

/** 「X月X日」无前导零，本地时间（沿 Parent 最近答题日期惯例；21 天+ 兜底措辞用）——文案收口批起改走单一出口 copy.common.monthDay */
const monthDay = copy.common.monthDay

/** 日历日差（#294 二轮拍板：相对日期按日历日算，本地零点切日；取正午做锚点避开夏令时偏移） */
function calendarDays(ts: number): number {
  const startOf = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  return Math.round((startOf(Date.now()) - startOf(ts)) / 86_400_000)
}

function redeemedAt(ts: number): string {
  return copy.prizes.redeemedAt(calendarDays(ts), monthDay(ts))
}

function goBack(): void {
  void router.push('/redeem')
}

// 「用一个」（#74 原核销 → #295 聚合语义）：二次确认（口语版带剩余数量）→ 先进先出消耗最早一张。
// 组内只剩最后一张时先把格子挂 leaving 播放缩小淡出（0.32s），动效结束后才真正删记录完成使用——
// 与原型一致：数据删除时机跟视觉消失对齐，期间按钮 pointer-events:none 防重复触发。
const pendingAction = ref<PrizeGroup | null>(null)
const leavingNames = ref<Set<string>>(new Set())

// 聚合清空动效时长：与 CSS 令牌 --duration-prize-fx（0.32s）同值对齐（跨语言，JS 不引用 CSS 变量）
const PRIZE_LEAVE_MS = 320

function closePending(): void {
  pendingAction.value = null
}

// 用掉一个 toast（#139 T-Toast 组件：2400ms 自动消失由组件承担，@expired 清空文案）
const toastText = ref('')

function confirmPending(): void {
  const group = pendingAction.value
  if (!group) return
  pendingAction.value = null
  if (group.count > 1) {
    // 先进先出：数量减一（角标随 :key 重挂弹跳）
    completeRedemption(group.oldest.id)
    records.value = listRedemptions()
  } else {
    // 减到零：整格缩小淡出后再删记录（PRIZE_LEAVE_MS 与 CSS 动效时长对齐）
    const name = group.name
    leavingNames.value.add(name)
    setTimeout(() => {
      leavingNames.value.delete(name)
      completeRedemption(group.oldest.id)
      records.value = listRedemptions()
    }, PRIZE_LEAVE_MS)
  }
  toastText.value = copy.prizes.useUpToast(group.name)
}
</script>

<template>
  <div data-page="prizes" class="page prizes-page">
    <!-- 顶栏（StarNavBar 三区：返回 + 标题） -->
    <StarNavBar :title="copy.prizes.pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <main class="prizes-main page-scroll">
      <!-- #196 空态块收编 StarEmptyState（icon 默认 true → 内部 StarGlyph lg） -->
      <StarEmptyState v-if="groups.length === 0">{{ copy.prizes.emptyState }}</StarEmptyState>

      <!-- #295 两列聚合格卡：×N 角标挂 emoji 右上角（×1 不渲染）；单「用一个」按钮沉底 -->
      <ul v-else class="prize-grid">
        <li
          v-for="g in groups"
          :key="g.name"
          class="prize-card star-container"
          :class="{ 'prize-card--leave': leavingNames.has(g.name) }"
        >
          <div class="prize-card__body">
            <span class="prize-card__emoji-wrap">
              <span class="prize-emoji" aria-hidden="true">{{ g.emoji }}</span>
              <!-- :key 随数量变化重挂 → N→N-1 弹跳动画重放；挂载时也弹一下（无入场 stagger 下的进场唯一反馈） -->
              <span v-if="g.count > 1" :key="`${g.name}-${g.count}`" class="prize-badge">×{{ g.count }}</span>
            </span>
            <!-- 名字完整展示自然换行（不截断），与日期组成弹性块；按钮 margin-top:auto 沉底 -->
            <span class="prize-name">{{ g.name }}</span>
            <span class="prize-date">{{ redeemedAt(g.latestTs) }}</span>
          </div>
          <StarButtonStandard variant="primary" size="small" class="btn-useup" @click="pendingAction = g">{{ copy.prizes.useUpBtn }}</StarButtonStandard>
        </li>
      </ul>
    </main>

    <!-- 「用一个」二次确认（口语版带剩余数量；取消/确认文案沿 Redeem 弹窗惯例） -->
    <StarModalStandard
      v-if="pendingAction"
      :message="copy.prizes.useUpConfirm(pendingAction.name, pendingAction.count - 1)"
      :cancel-text="copy.redeem.cancel"
      :confirm-text="copy.redeem.confirm"
      @cancel="closePending"
      @confirm="confirmPending"
    />

    <!-- 用掉一个 toast（#139 T-Toast 组件，沿 Redeem 页 toast 行为） -->
    <StarToastStandard :message="toastText" @expired="toastText = ''" />

  </div>
</template>

<style scoped>
/* 一屏展示（ADR-0001）：内容区唯一滚动容器，滚动四件套由全局 page-scroll 样式集提供；
   底 padding 给滚动到底时的唇边阴影留呼吸位（沿 Redeem / StarLog 惯例） */
.prizes-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-bottom: var(--space-md);
}

/* #295 两列格卡（#294 二轮拍板）：容器视觉由全局 star-container 样式集提供 */
.prize-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-sm);
}

/* 聚合格卡：竖排（emoji+名字+日期弹性块 → 按钮沉底），名字一行/两行整体 layout 不变 */
.prize-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-sm);
}

.prize-card__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 图标与文字间距加大（#294 二轮拍板：space-sm + space-xs），呼吸感 */
  gap: calc(var(--space-sm) + var(--space-xs));
  width: 100%;
  flex: 1;
}

/* emoji 相对定位容器：×N 角标挂右上角（悬浮，×1 不渲染） */
.prize-card__emoji-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-prize-emoji-wrap);
}

.prize-card__emoji-wrap .prize-badge {
  position: absolute;
  top: var(--prize-badge-offset-y);
  right: var(--prize-badge-offset-x);
}

.prize-emoji {
  font-size: var(--font-size-prize-emoji);
  line-height: 1;
}

.prize-name {
  font-size: var(--font-size-body);
  font-weight: 600;
  text-align: center;
  width: 100%;
  word-break: break-all;
  line-height: 1.3;
}

.prize-date {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}

/* 按钮沉底：名字一行/两行时按钮始终对齐格底 */
.btn-useup {
  margin-top: auto;
}

/* ×N 数量角标：星光金胶囊（×1 不渲染） */
.prize-badge {
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: var(--font-size-btn-sm);
  font-weight: 700;
  padding: var(--prize-badge-pad-y) var(--prize-badge-pad-x);
  border-radius: var(--radius-full);
}

/* ===== 动效两件（#294 二轮拍板终稿；无入场 stagger） ===== */

/* 角标弹跳：×N → ×(N-1) 替换时（:key 重挂）弹一下；挂载时也弹（进场唯一反馈） */
.prize-card__emoji-wrap .prize-badge {
  animation: prize-badge-pop var(--duration-prize-fx) cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes prize-badge-pop {
  0% { transform: scale(0.4); }
  60% { transform: scale(1.25); }
  100% { transform: scale(1); }
}

/* 聚合清空：整格缩小淡出（--duration-prize-fx，与 confirmPending 的移除超时对齐） */
.prize-card--leave {
  animation: prize-card-leave var(--duration-prize-fx) ease forwards;
  pointer-events: none;
}
@keyframes prize-card-leave {
  to { opacity: 0; transform: scale(0.9); }
}

/* 空态块已收编 StarEmptyState（#196：结构/星形/文案样式归组件） */
</style>
