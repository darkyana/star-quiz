<script setup lang="ts">
// 星星记事本（Spec REQ-8 / 设计方案 §5.5）：倒序流水（获得 + / 兑换 −）+ 相对时间 + 空态 + 顶栏返回与余额 chip
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { StarEntry } from '../types'
import { ledger as readStars, computeBalance } from '../composables/useStarData'
import { formatRelativeTime } from '../utils/relativeTime'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarGlyph from '../components/StarGlyph.vue'
import { copy } from '../copy'

const router = useRouter()

const entries = ref<StarEntry[]>([])
const now = ref(Date.now())

onMounted(() => {
  entries.value = readStars()
})

const balance = computed(() => computeBalance(entries.value))
const sorted = computed(() => [...entries.value].sort((a, b) => b.timestamp - a.timestamp))

function relativeTime(timestamp: number): string {
  return formatRelativeTime(timestamp, now.value)
}

function goBack(): void {
  void router.push('/redeem')
}
</script>

<template>
  <div data-page="star-log" class="page star-log-page">
    <!-- 顶栏（C3Re1：StarNavBar 三区全——返回 + 标题 + 余额 chip，视觉零变化） -->
    <StarNavBar :title="copy.starLog.pageTitle">
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

    <main class="log-main page-scroll">
      <div v-if="sorted.length === 0" class="empty-state">
        <!-- #195 星形本体收编 StarGlyph（lg 档 = 48px 空态大星，微光内置） -->
        <StarGlyph size="lg" />
        <p class="empty-text">{{ copy.starLog.emptyState }}</p>
      </div>

      <ul v-else class="ledger-list">
        <li
          v-for="entry in sorted"
          :key="entry.id"
          class="ledger-row"
          :class="entry.type === 'earn' ? 'earn' : 'redeem'"
        >
          <span class="stamp" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                v-if="entry.type === 'earn'"
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="var(--color-star)"
                stroke-width="3"
                stroke-linecap="round"
              />
              <path
                v-else
                d="M5 12h14"
                fill="none"
                stroke="var(--color-text-secondary)"
                stroke-width="3"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="row-source">{{ entry.source }}</span>
          <span class="log-time">{{ relativeTime(entry.timestamp) }}</span>
          <span class="row-amount" :class="entry.type === 'earn' ? 'amount-earn' : 'amount-redeem'">
            {{ entry.type === 'earn' ? copy.starLog.earnSign : copy.starLog.redeemSign }}{{ entry.amount }}
          </span>
        </li>
      </ul>
    </main>

  </div>
</template>

<style scoped>
/* 一屏展示批2（#52）：内容区唯一滚动容器，滚动四件套已收编全局 page-scroll 样式集（components.css，#68） */
.log-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  /* 滚动到底时末行卡 4px 唇边留呼吸位 */
  padding-bottom: var(--space-md);
}

.ledger-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.ledger-row {
  display: grid;
  grid-template-columns: 40px 1fr auto auto;
  align-items: center;
  gap: var(--space-sm);
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  border-bottom: var(--border-thin) solid var(--color-outline);
  padding: var(--space-sm) var(--space-gutter);
}

.stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background-color: var(--color-secondary);
}

.stamp svg {
  width: 20px;
  height: 20px;
}

.row-source {
  font-size: var(--font-size-body);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-time {
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
  margin-top: 0;
}

.row-amount {
  font-size: var(--font-size-num);
  font-weight: 800;
}

.amount-earn {
  color: var(--color-star);
}

.amount-redeem {
  color: var(--color-text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xl) var(--space-gutter);
  text-align: center;
}

/* 空态大星与顶栏余额星微光已收编进 StarGlyph（#195：本体/尺寸/微光归组件），余额星类名保留为测试钩子 */

.empty-text {
  margin: 0;
  font-size: var(--font-size-body-lg);
  color: var(--color-text-secondary);
}
</style>
