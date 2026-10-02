<script setup lang="ts">
// 兑换页（Spec REQ-7 / 设计方案 §5.4）：列表（可兑 / 不可兑两态）+ 二次确认弹窗 + 成功 toast + 空态 + 记事本入口
// 逻辑层兜底 C3：useStarData.redeem 内部校验余额 ≥ 价格（AC7-7 由 useStarData 单测覆盖）
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RewardItem } from '../types'
import { rewards as readRewards, redeem, balance as getBalance } from '../composables/useStarData'
import { PROPOSAL_EMOJI_DEFAULT } from '../composables/useProposals'
import StarModalStandard from '../components/StarModalStandard.vue'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarToastStandard from '../components/StarToastStandard.vue'
import StarGlyph from '../components/StarGlyph.vue'
import StarEmptyState from '../components/StarEmptyState.vue'
import StarRewardItem from '../components/StarRewardItem.vue'
import { copy } from '../copy'

const router = useRouter()
const route = useRoute()

const rewards = ref<RewardItem[]>([])
const balance = ref(0)
const pendingReward = ref<RewardItem | null>(null)
/** 兑换成功 toast 文案（#139 T-Toast：计时由组件承担，页面 @expired 清空文案） */
const toastText = ref('')

function refresh(): void {
  rewards.value = readRewards()
  balance.value = getBalance()
}

/** #92 展示层派生数据：价格从少到多（Array#sort 稳定排序，同价沿用存储顺序）；
 *  仅渲染前派生，sq_rewards 落盘内容与顺序不变 */
const sortedRewards = computed(() => [...rewards.value].sort((a, b) => a.price - b.price))

onMounted(refresh)

function askRedeem(reward: RewardItem): void {
  pendingReward.value = reward
}

function closeModal(): void {
  pendingReward.value = null
}

function confirmRedeem(): void {
  const reward = pendingReward.value
  if (!reward) return
  const result = redeem(reward.id)
  if (result.ok) {
    balance.value = getBalance()
    pendingReward.value = null
    toastText.value = copy.redeem.toast
  } else {
    pendingReward.value = null
  }
}

function remainingAfter(reward: RewardItem): number {
  return balance.value - reward.price
}

function shortageOf(reward: RewardItem): number {
  return reward.price - balance.value
}

function goBack(): void {
  // Only the explicit internal source changes the default; arrays/unknown values stay safe.
  void router.push(route.query.from === 'parent-guide' ? '/parent-guide' : '/')
}

function goLedger(): void {
  void router.push('/star-log')
}

function goProposals(): void {
  void router.push('/child/proposals')
}

function goPrizes(): void {
  void router.push('/prizes')
}
</script>

<template>
  <div data-page="redeem" class="page redeem-page">
    <!-- 顶栏（C3Re1：StarNavBar 三区全——返回 + 标题 + 余额 chip，视觉零变化） -->
    <StarNavBar :title="copy.redeem.pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
      <template #right>
        <div class="balance-chip" role="status">
          <span>{{ balance }}</span>
          <!-- #195 星形本体收编 StarGlyph（sm 档 = 18px，微光内置） -->
          <StarGlyph size="sm" class="chip-star" />
        </div>
      </template>
    </StarNavBar>

    <main class="redeem-main page-scroll">
      <!-- #196 空态块收编 StarEmptyState（icon 默认 true → 内部 StarGlyph lg） -->
      <StarEmptyState v-if="rewards.length === 0">{{ copy.redeem.emptyState }}</StarEmptyState>

      <ul v-else class="reward-list">
        <!-- #202 奖品行组件化 StarRewardItem：两态渲染归组件，余额判定（locked/shortfall）与兑换确认留页面（受控）；
             #299 各兑换项显示自己的 emoji，无 emoji 兑换项兜底 🎁（兜底留页面，组件不传不渲染） -->
        <StarRewardItem
          v-for="reward in sortedRewards"
          :key="reward.id"
          :name="reward.name"
          :price="reward.price"
          :emoji="reward.emoji ?? PROPOSAL_EMOJI_DEFAULT"
          :locked="balance < reward.price"
          :shortfall="shortageOf(reward)"
          @redeem="askRedeem(reward)"
        />
      </ul>

      <div class="page-links">
        <StarButtonStandard variant="standard" size="small" class="ledger-link" @click="goLedger">{{ copy.redeem.ledgerLink }}</StarButtonStandard>
        <StarButtonStandard variant="standard" size="small" class="ledger-link" @click="goProposals">{{ copy.redeem.proposalsEntry }}</StarButtonStandard>
        <!-- R-72-1（#73）：第三入口「我的奖品」（standard × small 同款并列） -->
        <StarButtonStandard variant="standard" size="small" class="prizes-link" @click="goPrizes">{{ copy.prizes.entry }}</StarButtonStandard>
      </div>
    </main>

    <StarModalStandard
      v-if="pendingReward"
      :message="copy.redeem.confirmText(pendingReward.price, pendingReward.name, remainingAfter(pendingReward))"
      :cancel-text="copy.redeem.cancel"
      :confirm-text="copy.redeem.confirm"
      @cancel="closeModal"
      @confirm="confirmRedeem"
    />

    <!-- 兑换成功 toast（#139 T-Toast 组件：2400ms 自动消失由组件承担，@expired 清空文案） -->
    <StarToastStandard :message="toastText" @expired="toastText = ''" />

  </div>
</template>

<style scoped>
/* 一屏展示批2（#52）：内容区唯一滚动容器，滚动四件套已收编全局 page-scroll 样式集（components.css，#68）；
   底 padding 给滚动到底时的唇边阴影留呼吸位（沿 Quiz/Result 惯例） */
.redeem-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-bottom: var(--space-md);
}

.reward-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

/* #202 奖品行样式整体迁居 StarRewardItem 组件（probe #194 第 6 节定稿：价格展示 = StarGlyph sm + 金色文案，
   #152 G9 价签 pill 随组件化退役）；页面私有奖品行样式清零，仅保留上方列表容器的列布局；
   顶栏余额星 chip-star 类名保留为测试钩子，本体/尺寸/微光已归 StarGlyph（#195） */

/* R34 并列入口容器（REQ-R34-1-1）：入口同款 ledger-link，容器仅布局；
   R-72-1（#73）三钮并列：窄屏 flex-wrap 换行不挤压 */
.page-links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

/* 记事本入口（.ledger-link）与奖品入口（.prizes-link）样式收编进 StarButtonStandard（standard × small），类名保留为测试钩子 */

/* 空态块已收编 StarEmptyState（#196：结构/星形/文案样式归组件） */
</style>
