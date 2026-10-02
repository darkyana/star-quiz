<script setup lang="ts">
// StarFeedbackBar（#198 C- 组件卡）：答题反馈条三态元组件——组件只管按 tone 渲染，
// 何时出现/消失、文案内容判定留页面（受控边界，ADR-0008：组件只管渲染，判定留页面）。
// 视觉真相源 = probe #194 第 8 节直译（icon ✓/✕/— 三枚内联 SVG 属本组件规格）。
defineProps<{
  /** 三态：correct 金渐变 + 星光呼吸 / wrong 红系纯文字 / skipped 灰系纯文字 */
  tone: 'correct' | 'wrong' | 'skipped'
  /** 反馈文案（页面判定后传入，组件不持文案） */
  text: string
}>()
</script>

<template>
  <div class="star-feedback-bar" :class="`star-feedback-bar--${tone}`">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        v-if="tone === 'correct'"
        d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
        fill="currentColor"
      />
      <path
        v-else-if="tone === 'wrong'"
        d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"
        fill="currentColor"
      />
      <path v-else d="M5 11h14v2H5z" fill="currentColor" />
    </svg>
    <span>{{ text }}</span>
  </div>
</template>

<style scoped>
/* 三态共用骨架（probe #194 第 8 节直译）：flex 行 + 48px 最小触达 + lg 圆角 + info 档基础字重 */
.star-feedback-bar {
  display: flex;
  align-items: center;
  gap: var(--space-base);
  font-size: var(--font-size-info);
  font-weight: 700;
  min-height: 48px;
  padding: 0 18px;
  border-radius: var(--radius-lg);
}

.star-feedback-bar svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* 答对态（probe 直译）：金深边框 + 金渐变填充双通道 + 星光光晕呼吸
   （动效预算：星光系——星光照亮反馈，复用呼吸节奏档 --duration-breath） */
.star-feedback-bar--correct {
  border: var(--border-thin) solid var(--color-star-deep);
  background:
    linear-gradient(90deg, rgba(255, 209, 102, 0.24), rgba(255, 209, 102, 0.04) 72%),
    rgba(255, 209, 102, 0.07);
  color: var(--color-star);
  font-size: var(--font-size-body);
  font-weight: 800;
  letter-spacing: var(--letter-spacing-title);
  animation: feedback-glow var(--duration-breath) ease-in-out infinite;
}

/* 星光呼吸：内透（填充呼吸感）+ 外晕（光晕扩散）两级同步起伏 */
@keyframes feedback-glow {
  0%,
  100% {
    box-shadow:
      inset 0 0 12px rgba(255, 209, 102, 0.05),
      0 0 6px rgba(255, 209, 102, 0.18);
  }
  50% {
    box-shadow:
      inset 0 0 18px rgba(255, 209, 102, 0.15),
      0 0 16px rgba(255, 209, 102, 0.45);
  }
}

/* 答错 / 不会两态：纯文字着色（probe 仅定义答对态填充）；透明描边对齐三态同骨架盒 */
.star-feedback-bar--wrong {
  color: var(--color-error);
  border: var(--border-thin) solid transparent;
}

.star-feedback-bar--skipped {
  color: var(--color-text-secondary);
  border: var(--border-thin) solid transparent;
}
</style>
