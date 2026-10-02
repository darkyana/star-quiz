<script setup lang="ts">
// 答题页（Spec REQ-5 / 设计方案 §5.2 + R7 放弃答题）：进度 + 题干 + 三态判分 + 重新开始/放弃二次确认 + 防刷分守卫
// 无返回按钮（AC5-9）；离开作废（onUnmounted → abandonQuiz，finish/放弃后除外）；直访守卫（AC3-12 / AC3-13）
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { QuizSession } from '../types'
import { readSession, startQuiz, answerQuiz, finishQuiz, abandonQuiz } from '../composables/useQuiz'
import { isFlagged as checkFlagged, toggleFlag } from '../composables/useFlag'
import { grade } from '../utils/quizEngine'
import StarModalStandard from '../components/StarModalStandard.vue'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarIconBtn from '../components/StarIconBtn.vue'
import StarChip from '../components/StarChip.vue'
import StarFeedbackBar from '../components/StarFeedbackBar.vue'
import StarOptionRow from '../components/StarOptionRow.vue'
import StarProgressBar from '../components/StarProgressBar.vue'
import { copy } from '../copy'

const route = useRoute()
const router = useRouter()

const session = ref<QuizSession | null>(null)
const currentIndex = ref(0)
const answered = ref(false)
const feedback = ref<'correct' | 'wrong' | 'skipped' | null>(null)
const lastSelected = ref<number | null>(null)
// 二次确认弹窗（R7）：'restart' | 'abandon' 单值互斥——同一时刻至多一个 role="dialog"
const confirmModal = ref<'restart' | 'abandon' | null>(null)
// #156 滚入兜底：反馈条元素引用（判分后渲染，滚入前须等 nextTick 挂载）
const feedbackEl = ref<HTMLElement | null>(null)
let finishing = false
// R25 红旗旗钮（REQ-R25-1/3；数据规则修订见 #69：条目只记 flaggedAt，correct 已废止）：isFlagged 两态；hoist 仅用户点击标记时挂上（DR25-4 重遇已标题不重播升旗动画）
const isFlagged = ref(false)
const hoistFlag = ref(false)

const question = computed(() => session.value?.questions[currentIndex.value] ?? null)
const total = computed(() => session.value?.questions.length ?? 0)
const answeredCount = computed(() => currentIndex.value + (answered.value ? 1 : 0))
const progressPercent = computed(() => (total.value === 0 ? 0 : Math.round((answeredCount.value / total.value) * 100)))
// "第 X / N 题"：X 从 1 起，末题作答后显示"第 N / N 题"（Spec §6 D8 / 设计方案 §4.3 边界）
const progressLabel = computed(() =>
  copy.quiz.progressLabel(Math.min(answeredCount.value + 1, total.value), total.value),
)
const isLast = computed(() => currentIndex.value >= total.value - 1)
const nextLabel = computed(() => (isLast.value ? copy.quiz.viewResult : copy.quiz.nextLabel))

function applySession(s: QuizSession): void {
  session.value = s
  currentIndex.value = s.currentIndex
  answered.value = false
  feedback.value = null
  lastSelected.value = null
  syncFlagState()
}

/** R25 旗钮初态（REQ-R25-3）：进入题目时读 sq_flagged 定已标/未标（经 useFlag.isFlagged，#69）；hoist 清空（动画仅点击标记时播放） */
function syncFlagState(): void {
  const qid = question.value?.id
  isFlagged.value = qid !== undefined && checkFlagged(qid)
  hoistFlag.value = false
}

onMounted(() => {
  const hasStart = route.query.start === '1'
  const existing = readSession()
  if (hasStart && !existing) {
    // 非法路径 4（AC3-13）：带 start=1 却无会话 → 重定向首页，不自动开新会话
    void router.replace('/')
    return
  }
  if (!hasStart) {
    // 非法路径 1（AC3-12）：刷新 / 直访无 start=1 → 残留会话作废 + 重新抽题；题池空重定向首页
    abandonQuiz()
    const fresh = startQuiz(Math.random, existing?.scope)
    if (!fresh) {
      void router.replace('/')
      return
    }
    applySession(fresh)
    return
  }
  if (existing) applySession(existing)
})

onUnmounted(() => {
  if (!finishing) abandonQuiz()
})

function onAnswer(index: number | null): void {
  if (answered.value || !session.value || !question.value) return
  answerQuiz(index)
  feedback.value = grade(index, question.value.answerIndex)
  lastSelected.value = index
  answered.value = true
  scrollFeedbackIntoView()
  // #69 起答题动作不碰旗子数据（原 REQ-R25-5 作答补写 correct 已废止；对错由 questionResults 承担）
}

/** R25 旗钮切换（REQ-R25-1/4；数据规则修订见 #69）：切换经 useFlag.toggleFlag——标记写 { flaggedAt }、取消删该键；返回值驱动两态与升旗动画；作答后仍可标（自主决策 #2） */
function onToggleFlag(): void {
  const qid = question.value?.id
  if (!qid) return
  const nowFlagged = toggleFlag(qid)
  isFlagged.value = nowFlagged
  hoistFlag.value = nowFlagged
}

/** #156 滚入兜底：判分后反馈条滚入可视区（最近距离）；系统开启「减弱动态效果」时免动画滚动（behavior: auto）。
   jsdom 无布局引擎也无 scrollIntoView：守卫缺函数直接跳过，测试经 stub 断言调用。 */
function scrollFeedbackIntoView(): void {
  void nextTick(() => {
    const el = feedbackEl.value
    if (!el || typeof el.scrollIntoView !== 'function') return
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  })
}

/** #199 受控元组件（ADR-0008 红线）：判分逻辑留页面——映射选项四态枚举，渲染归 StarOptionRow */
type OptionState = 'normal' | 'correct' | 'wrong' | 'reveal'
function optionState(i: number): OptionState {
  const q = question.value
  if (!q || !answered.value) return 'normal'
  const isAnswer = i === q.answerIndex
  const isSelected = lastSelected.value === i
  if (feedback.value === 'correct') return isAnswer ? 'correct' : 'normal'
  if (feedback.value === 'wrong') return isAnswer ? 'reveal' : isSelected ? 'wrong' : 'normal'
  return isAnswer ? 'reveal' : 'normal'
}

function onNext(): void {
  if (!answered.value) return
  if (isLast.value) {
    finishing = true
    finishQuiz()
    void router.push('/result')
    return
  }
  currentIndex.value += 1
  answered.value = false
  feedback.value = null
  lastSelected.value = null
  syncFlagState()
}

function askRestart(): void {
  confirmModal.value = 'restart'
}

function askAbandon(): void {
  confirmModal.value = 'abandon'
}

function cancelConfirm(): void {
  confirmModal.value = null
}

function confirmRestart(): void {
  confirmModal.value = null
  abandonQuiz()
  const fresh = startQuiz(Math.random, session.value?.scope)
  if (fresh) applySession(fresh)
  else void router.replace('/')
}

/** 确认放弃（R7）：作废会话 + 跳首页，本轮不获星不写流水；finishing 短路防 onUnmounted 重复作废 */
function confirmAbandon(): void {
  confirmModal.value = null
  finishing = true
  abandonQuiz()
  void router.push('/')
}
</script>

<template>
  <div data-page="quiz" class="page quiz-page">
    <!-- 顶栏（C3Re1：StarNavBar 三区全——放弃/重新开始拆左右，标题居中统一化） -->
    <StarNavBar :title="copy.quiz.pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="abandon-btn" @click="askAbandon">{{ copy.quiz.abandon }}</StarButtonStandard>
      </template>
      <template #right>
        <StarButtonStandard variant="standard" size="small" class="restart-btn" @click="askRestart">{{ copy.quiz.restart }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <template v-if="question">
      <!-- 一屏展示三段之二（#49 / ADR 0001）：内容区，唯一滚动容器；长题干仅此处滚动 -->
      <div class="quiz-scroll page-scroll">
        <!-- #200 进度条升 registry（StarProgressBar）：sticky 吸顶与轨道/填充/文字视觉归组件内置，页面只接线计数与布局间距 -->
        <StarProgressBar class="quiz-head-gap" :value="progressPercent" :max="100" :label="progressLabel" />

        <div class="star-container question-card">
          <!-- C5（#56）：红旗钮收编 StarIconBtn——热区/hover/focus 归组件；二态填充与升旗动效留页面 -->
          <!-- #146 圆润红旗（饱满圆润版：圆头旗杆 + 弧线旗面；两态见下方 scoped 样式） -->
          <StarIconBtn
            class="flag-btn"
            :class="{ flagged: isFlagged, hoist: hoistFlag }"
            :aria-pressed="isFlagged ? 'true' : 'false'"
            :aria-label="isFlagged ? copy.quiz.flag.btnAriaLabelActive : copy.quiz.flag.btnAriaLabel"
            @click="onToggleFlag"
          >
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path class="flag-pole" d="M14 6 V43" />
              <path class="flag-icon" d="M14 8 Q26 5.5 38 11 Q27 16 14 18 Z" />
            </svg>
          </StarIconBtn>
          <!-- 题类型标签（C4Re1：StarChip default × sm，字号 13→12px 统一化） -->
          <StarChip>{{ copy.quiz.typeLabel[question.type] }}</StarChip>
          <p class="question-text">{{ question.prompt }}</p>
        </div>

        <!-- 选项块（#199 受控元组件：判分留页面 optionState，四态渲染归 StarOptionRow；
             跳过钮无专属样式——probe 定稿复用 normal 态（禁用复用 disabled），普通调用表达） -->
        <div class="options">
          <StarOptionRow
            v-for="(opt, i) in question.options"
            :key="i"
            :label="opt"
            :state="optionState(i)"
            :disabled="answered"
            @select="onAnswer(i)"
          />
          <StarOptionRow :label="copy.quiz.skip" state="normal" :disabled="answered" @select="onAnswer(null)" />
        </div>

        <!-- 反馈文案留内容区（#40 决策 3）；三态条渲染归 StarFeedbackBar（#198 受控：出现时机 / 文案判定留页面） -->
        <div v-if="answered" class="feedback-area" ref="feedbackEl">
          <StarFeedbackBar
            :tone="feedback as 'correct' | 'wrong' | 'skipped'"
            :text="copy.quiz.feedback[feedback as 'correct' | 'wrong' | 'skipped']"
          />
        </div>
      </div>

      <!-- 一屏展示三段之三（#49 AC2）：底部操作栏常驻，未作答禁用而非隐藏（CONTEXT.md「底部操作栏」） -->
      <footer class="bottom-action-bar">
        <StarButtonStandard variant="primary" size="large" :edge-inset="false" class="next-btn" :disabled="!answered" @click="onNext">{{ nextLabel }}</StarButtonStandard>
      </footer>
    </template>

    <!-- 二次确认弹窗：重新开始 / 放弃共用 StarModalStandard 实例，单值状态互斥（同一时刻至多一个 dialog） -->
    <StarModalStandard
      v-if="confirmModal"
      :message="confirmModal === 'restart' ? copy.quiz.restartConfirm : copy.quiz.abandonConfirm"
      :cancel-text="copy.quiz.cancel"
      :confirm-text="confirmModal === 'restart' ? copy.quiz.confirmRestart : copy.quiz.confirmAbandon"
      @cancel="cancelConfirm"
      @confirm="confirmModal === 'restart' ? confirmRestart() : confirmAbandon()"
    />

  </div>
</template>

<style scoped>
/* ===== 一屏展示三段结构（#49 / ADR 0001，试点页）=====
   段一 顶栏 = StarNavBar（页内普通流，锁高后视觉等效固定）
   段二 内容区 = quiz-scroll（唯一滚动容器）
   段三 底部操作栏 = bottom-action-bar（常驻，未作答禁用） */
.quiz-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  /* 批2（#52）起全局 [data-page] 已自带三件套，此处显式声明保持试点语义（锁高外壳 + 根清 padding） */
  min-height: 0;
  /* 根 padding 移交内容区与底栏 */
  padding: 0;
  /* #152 G6 屏顶氛围光：探针 s-quiz 顶部暖色 radial 直译（--color-ambient α 0.1 克制档，
     「一盏灯」的方向感；transparent 区透出外壳夜幕与星子层） */
  background: radial-gradient(120% 46% at 50% 0%, var(--color-ambient), transparent 58%);
}

/* 一屏展示批2（#52）：内容区唯一滚动容器，滚动四件套已收编全局 page-scroll 样式集（components.css，#68）；
   底部操作栏样式已收编全局 bottom-action-bar 样式集（components.css，#68） */
.quiz-scroll {
  padding: var(--space-gutter) var(--space-page) var(--space-md);
}

.quiz-page :deep(.page-header) {
  flex-shrink: 0;
}

/* #200 进度条升 registry（StarProgressBar）：sticky 吸顶与轨道/填充/文字视觉归组件内置；
   页面仅留吸顶行的布局间距（原行 margin 随之保留，吸顶契约随组件走，#49 AC3 不变） */
.quiz-head-gap {
  margin-bottom: var(--space-gutter);
}

/* R25 红旗旗钮（REQ-R25-1/2 + 设计 DR25-1/2/3）：右上角绝对定位，右侧 padding 让位防遮挡
   #41：背景/描边/圆角/内边距由全局 .star-container 提供；#146 起题卡是夜色中的米白纸面
   （纸面渐变 + 透明描边保持占位），深底高对比自持可读，无挂件符号
   #152 G5 题卡纸面质感 + G12 发光探针档：渐变纸色（两枚纸面令牌为端点）+
   顶部暖光 inset（「灯下纸片」体积感，探针 question-card box-shadow 直译）+ 卡投影 + 唇边极淡光 */
.question-card {
  position: relative;
  padding-right: 64px;
  margin-bottom: var(--space-md);
  background: linear-gradient(180deg, var(--color-paper) 0%, var(--color-paper-deep) 100%);
  border-color: transparent;
  box-shadow: var(--shadow-card), var(--glow-paper-top), var(--glow-edge);
}

/* C5（#56）：热区 44 / 透明底 / hover 洗底 / focus 环收编 StarIconBtn，此处只剩定位 */
.flag-btn {
  position: absolute;
  top: var(--space-base);
  right: var(--space-base);
}

.flag-btn svg {
  width: 24px;
  height: 24px;
}

/* 圆润红旗两态（#146 重画，DR25-2 语义保持：未标 = 纸面中性淡 / 已标 = 暖红纸面旗色） */
.flag-pole {
  fill: none;
  stroke: color-mix(in srgb, var(--color-morning-text) 55%, transparent);
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke var(--duration-base) ease;
}

.flag-icon {
  fill: var(--color-paper);
  stroke: color-mix(in srgb, var(--color-morning-text) 45%, transparent);
  stroke-width: 2;
  stroke-linejoin: round;
  transition:
    fill var(--duration-base) ease,
    stroke var(--duration-base) ease;
}

/* 已标 = 暖红填充（纸面旗色）+ 同族加深描边 --color-flag-stroke */
.flag-btn.flagged .flag-pole {
  stroke: var(--color-warm-deep);
}

.flag-btn.flagged .flag-icon {
  fill: var(--color-warm-deep);
  stroke: var(--color-flag-stroke);
}

/* 升旗动画仅点击标记时播放（DR25-3/4：重遇已标题不重播，取消不播动画） */
.flag-btn.hoist svg {
  animation: hoist 0.28s ease;
}

@keyframes hoist {
  0% {
    transform: translateY(3px) rotate(0deg);
  }
  45% {
    transform: translateY(-4px) rotate(-10deg);
  }
  75% {
    transform: translateY(-2px) rotate(7deg);
  }
  100% {
    transform: translateY(0) rotate(0deg);
  }
}

.question-text {
  margin: var(--space-sm) 0 0;
  font-size: var(--font-size-question);
  font-weight: 800;
  letter-spacing: var(--letter-spacing-title);
  line-height: 1.3;
  color: var(--color-morning-text);
}

.options {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

/* #156 宽档两列（≥1024 视口，外壳 760 档）：选项 2×2 grid，「跳过」保持整行次要位；
   行高仍由各按钮 min-height 触控 md 档保证（热区不缩）。每列宽推导：
   外壳 760 减内容区左右内边距与列间距后对半 ≈ 354px，不低于 340px 下限 */
@media (min-width: 1024px) {
  .options {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-sm);
  }

  .options > :last-child {
    grid-column: 1 / -1;
  }
}

.feedback-area {
  margin-top: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
</style>
