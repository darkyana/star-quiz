<script setup lang="ts">
// 结算页（Spec REQ-6 / 设计方案 §5.3）：挂载先结算（幂等）→ 得分角标 + 得星主视觉（发光大星 + rAF 滚动数字）+ 四档文案
// #146 星夜童话：彩纸随动效预算移除（星星系之外装饰动画清零），满分庆祝由文案 + 发光主视觉承担
// 非法直访（无会话 / in_progress）重定向首页（AC3-11）；唯一出口"回到首页"（AC6-6）
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { readSession, settleQuiz, clearSession, sessionEarnsStars } from '../composables/useQuiz'
import StarChip from '../components/StarChip.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarGlyph from '../components/StarGlyph.vue'
import { copy } from '../copy'
import { reportOnboarding } from '../cloud/onboardingMetrics'

const router = useRouter()

const score = ref(0)
const earnedStars = ref(0)
const total = ref(0)
const display = ref(0)
// #288 无得星规则惊喜轮：不产星——主结果行改「答对 X / Y 题」，无得星数字与星光雨；
// 文案档位仍按折算分档共用。#289 接规则后经 sessionEarnsStars 恢复得星视觉。
const carriesStars = ref(true)
let rafId = 0

// 折算 10 分制（Spec §6 D9）：round(correctCount / 本轮题数 × 10)
const scaledScore = computed(() => (total.value === 0 ? 0 : Math.round((score.value / total.value) * 10)))
const message = computed(() => {
  // R24 差一题满分档：correctCount === totalCount − 1（精确差一题，泛化到任意总题数）
  // #289 文案随票修正：无规则惊喜轮不产星，差一题档改用无星变体（「3 颗奖励星」许诺不落在惊喜无星轮上）；学科轮沿用原文案
  if (score.value === total.value - 1) {
    return carriesStars.value ? copy.result.message.nearFullMark : copy.result.message.nearFullMarkStarless
  }
  const s = scaledScore.value
  if (s === 10) return copy.result.message.fullMark
  if (s >= 7) return copy.result.message.good
  if (s >= 1) return copy.result.message.practice
  return copy.result.message.encourage
})

/* ===== 满分星光雨（#153）：一轮全对（折算 10 分档）专属庆祝 =====
   金色星形自上而下飘落带微光，一次性约 3s 自清；非满分档（含差一题 9/10 档）零庆祝动效 */
const isFullMark = computed(() => scaledScore.value === 10)
const showStarRain = ref(false)
/** 自清时长：单颗下落 2.4s + 最大错拍 0.46s，3s 全部落尽 */
const STAR_RAIN_MS = 3000
let rainTimer = 0

/** 星光雨散布表：位置 / 尺寸 / 错拍 delay / 漂移与旋转终点（沿 App 星子层内联散布直落先例） */
const STAR_RAIN_DROPS = [
  { left: '5%', size: 13, delay: '0s', drift: '34px', spin: '120deg' },
  { left: '14%', size: 17, delay: '0.28s', drift: '-40px', spin: '-150deg' },
  { left: '24%', size: 11, delay: '0.1s', drift: '26px', spin: '90deg' },
  { left: '33%', size: 15, delay: '0.4s', drift: '-30px', spin: '-110deg' },
  { left: '43%', size: 18, delay: '0.05s', drift: '38px', spin: '140deg' },
  { left: '52%', size: 12, delay: '0.33s', drift: '-26px', spin: '-90deg' },
  { left: '62%', size: 16, delay: '0.18s', drift: '30px', spin: '130deg' },
  { left: '72%', size: 11, delay: '0.46s', drift: '-34px', spin: '-120deg' },
  { left: '82%', size: 15, delay: '0.08s', drift: '24px', spin: '100deg' },
  { left: '90%', size: 13, delay: '0.36s', drift: '-28px', spin: '-140deg' },
] as const

function dropStyle(drop: (typeof STAR_RAIN_DROPS)[number]): Record<string, string> {
  return {
    left: drop.left,
    width: `${drop.size}px`,
    height: `${drop.size}px`,
    animationDelay: drop.delay,
    '--sr-drift': drop.drift,
    '--sr-spin': drop.spin,
  }
}

/** 得星数字 0→N 滚动（CSS + 少量 rAF，easeOutCubic 900ms，不引动画库） */
function animateEarn(target: number): void {
  display.value = 0
  if (target === 0) return
  let start = 0
  const duration = 900
  const tick = (now: number): void => {
    if (start === 0) start = now
    const p = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - p, 3)
    display.value = Math.round(eased * target)
    if (p < 1) rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  const session = readSession()
  if (!session || session.status === 'in_progress') {
    // 非法直访 #/result（AC3-11）：重定向首页，不写流水
    void router.replace('/')
    return
  }
  const settlement = settleQuiz()
  if (settlement === 'settled' && session.scope?.kind === 'subject'
    && session.questions.length === 10 && session.answers.length === 10 && session.currentIndex === 10) {
    reportOnboarding('quiz_complete_10')
  }
  const s = readSession() ?? session
  score.value = s.score ?? s.correctCount
  earnedStars.value = s.earnedStars ?? 0
  total.value = s.questions.length
  carriesStars.value = sessionEarnsStars(s)
  if (carriesStars.value) animateEarn(earnedStars.value)
  // 满分档启动星光雨（一次性庆祝，到点自清；#288 无规则惊喜轮零庆祝）
  if (carriesStars.value && isFullMark.value) {
    showStarRain.value = true
    rainTimer = window.setTimeout(() => {
      showStarRain.value = false
    }, STAR_RAIN_MS)
  }
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  if (rainTimer) clearTimeout(rainTimer)
})

function goHome(): void {
  clearSession()
  void router.push('/')
}
</script>

<template>
  <div data-page="result" class="page result-page">
    <!-- 结算页无导航栏（C3Re1 老板拍板：header 整块删除） -->

    <!-- 一屏展示三段之二（#53 / ADR 0001）：内容区，唯一滚动容器 -->
    <main class="result-scroll">
      <div class="result-main">
        <!-- 得分徽章（C4Re1：StarChip default × sm，8×16 主文字 → 普通小 Chip，老板拍板统一化） -->
        <StarChip>{{ copy.result.scoreBadge(score, total) }}</StarChip>

        <!-- #195 星形本体收编 StarGlyph（lg 档基座）；132px 主视觉档 + 强光晕 + 漂浮动画仍归页面私有覆写 -->
        <StarGlyph size="lg" class="big-star" />

        <!-- #288 无得星规则惊喜轮：「答对 X / Y 题」主结果行（无得星数字与星光雨）；有星轮原样 -->
        <p v-if="!carriesStars" class="trivia-correct-line">{{ copy.result.triviaResult(score, total) }}</p>
        <div v-else class="earn-visual">
          <!-- #195 星形本体收编 StarGlyph（sm 档基座）；20px 得星小星档仍归页面私有覆写 -->
          <StarGlyph size="sm" />
          <span class="earn-number">+{{ display }}</span>
          <span class="earn-unit">{{ copy.result.earnUnit }}</span>
        </div>

        <p class="result-message">{{ message }}</p>
      </div>
    </main>

    <!-- 满分星光雨（#153）：一轮全对专属庆祝——金星下落带微光，一次性约 3s 自清；非满分档不渲染
         #195 星形本体收编 StarGlyph（多 glyph + keyframes 属页面装饰留页面；散布尺寸仍由 dropStyle 内联直落） -->
    <div v-if="showStarRain" class="star-rain" aria-hidden="true">
      <StarGlyph
        v-for="(drop, i) in STAR_RAIN_DROPS"
        :key="i"
        class="star-rain__drop"
        :style="dropStyle(drop)"
      />
    </div>

    <!-- 一屏展示三段之三（#53）：底部操作栏常驻可点（结果页无前置条件，CONTEXT.md「底部操作栏」） -->
    <footer class="bottom-action-bar">
      <StarButtonStandard variant="primary" size="large" :edge-inset="false" class="go-home-btn" @click="goHome">{{ copy.result.goHome }}</StarButtonStandard>
    </footer>

  </div>
</template>

<style scoped>
/* ===== 一屏展示三段结构（#53 / ADR 0001，沿用 Quiz 页内三件套）=====
   结算页无顶栏（C3Re1）：段二内容区 result-scroll + 段三底部操作栏 */
.result-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  /* 中和全局 [data-page] 的整屏最小高，改为填满锁高外壳 */
  min-height: 0;
  /* 根 padding 移交内容区与底栏 */
  padding: 0;
  /* 整页定位基准（历史：满分彩纸覆盖层；#146 彩纸移除后保留以防内层定位回退） */
  position: relative;
}

.result-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 自身禁用 transform/filter/will-change（#40 决策 10：水印/弹窗/toast fixed 覆盖层不错位） */
  padding: 0 var(--space-page) var(--space-md);
}

/* 底部操作栏段三样式已收编全局 bottom-action-bar 样式集（components.css，#68） */

.result-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding-top: var(--space-xl);
  text-align: center;
  position: relative;
}

/* #146 星夜童话得星主视觉：发光大星（发光预算三类之一：星星）+ 漂浮幅度收敛 4px */
.big-star {
  width: 132px;
  height: 132px;
  filter: var(--glow-star-svg);
  animation: result-star-float var(--duration-float) ease-in-out infinite;
}

@keyframes result-star-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

.earn-visual {
  display: flex;
  align-items: center;
  gap: var(--space-base);
}

.earn-visual svg {
  width: 20px;
  height: 20px;
  /* #195 得星小星档：本体与微光归 StarGlyph（sm 档内置），20px 页面私有尺寸档覆写保留 */
}

.earn-number {
  font-size: var(--font-size-star-lg);
  font-weight: 800;
  color: var(--color-star);
  /* 发光预算三类之一：得星大数字 */
  text-shadow: var(--glow-num);
}

.earn-unit {
  font-size: var(--font-size-label);
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* #288 无规则惊喜轮主结果行：与 earn-number 同字号档的「答对 X / Y 题」，主文字色不携星色 */
.trivia-correct-line {
  margin: 0;
  font-size: var(--font-size-star-lg);
  font-weight: 800;
  color: var(--color-text-primary);
}

.result-message {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  letter-spacing: var(--letter-spacing-info);
  color: var(--color-text-secondary);
}

/* ===== 满分星光雨（#153）：满分档专属庆祝层 =====
   金色星形（圆润发光母型，同 big-star path）自上而下飘落 + 横向漂移缓旋；
   微光走小星单级令牌（星星系动效口径）；下落时长 = 漂浮档 0.75 倍率（2.4s，错拍 0–0.46s）；
   散布参数（left / 尺寸 / delay / 漂移终点）由散布表内联直落——沿 App 星子层散布先例；
   纯装饰不挡交互；一次性 3s 由脚本自清（showStarRain），非满分档不渲染 */
.star-rain {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.star-rain__drop {
  position: absolute;
  top: -10%;
  filter: var(--glow-star-svg-soft);
  animation: star-rain-fall calc(var(--duration-float) * 0.75) ease-in forwards;
}

@keyframes star-rain-fall {
  0% {
    transform: translate3d(0, 0, 0) rotate(0deg);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  100% {
    transform: translate3d(var(--sr-drift), 120vh, 0) rotate(var(--sr-spin));
    opacity: 1;
  }
}

/* 动效豁免（#153）：系统 reduce 动效偏好下整层不播——庆祝为纯装饰，无信息损失 */
@media (prefers-reduced-motion: reduce) {
  .star-rain {
    display: none;
  }
}
</style>
