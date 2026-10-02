<script setup lang="ts">
// StarModeEntry（#103 组件卡 → #108 r2 定稿 D chip+弹窗 → #152 G3 三分段直显切换器）：
// 出题方式入口改为探针 P1-r2 分段控件形态——label「出题方式」弱 + 三模式分段直显
// （普通 / 新题优先 / 错题优先），点选即切换（v-model 更新），选中态星光金渐变段。
// 首页语义保持「切换写 sq_quiz_mode、只影响下一轮」（Home → useQuizMode 持久化）；
// 可达性沿 radiogroup / radio + aria-checked 口径。
import { QUIZ_MODE_META } from '../composables/useQuizMode'
import type { QuizMode } from '../types'
import { copy } from '../copy'

const mode = defineModel<QuizMode>({ required: true })

const modes = QUIZ_MODE_META
</script>

<template>
  <div class="star-mode-entry">
    <span id="star-mode-entry-label" class="star-mode-entry__label">{{ copy.quiz.mode.label }}</span>
    <div class="star-mode-entry__switch" role="radiogroup" :aria-label="copy.quiz.mode.label" aria-labelledby="star-mode-entry-label">
      <button
        v-for="m in modes"
        :key="m.key"
        type="button"
        role="radio"
        :aria-checked="m.key === mode"
        class="star-mode-entry__pill"
        :class="{ 'is-active': m.key === mode }"
        @click="mode = m.key"
      >
        {{ m.shortName ?? m.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 分段切换器（#152 G3，探针 P1-r2 mode-field / mode-switch / mode-pill 直译；全令牌引用） */
.star-mode-entry {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: var(--space-base);
}

.star-mode-entry__label {
  font-size: var(--font-size-label);
  font-weight: 600;
  letter-spacing: var(--letter-spacing-title);
  color: var(--color-text-secondary);
  text-align: center;
}

.star-mode-entry__switch {
  display: flex;
  gap: var(--space-xs);
  padding: var(--space-xs);
  background-color: var(--color-surface-dim);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-full);
}

.star-mode-entry__pill {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--touch-sm);
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  font-family: inherit;
  font-size: var(--font-size-btn-sm);
  font-weight: 700;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-base) ease,
    color var(--duration-base) ease,
    box-shadow var(--duration-base) ease;
}

/* 选中段：星光金渐变 + 深蓝字 + 柔光（探针 is-active 直译；#152 G12 发光探针档之一） */
.star-mode-entry__pill.is-active {
  background: linear-gradient(180deg, var(--color-star), var(--color-star-deep));
  color: var(--color-on-star);
  font-weight: 800;
  box-shadow: var(--glow-star-soft);
}

@media (hover: hover) {
.star-mode-entry__pill:hover:not(.is-active) {
  color: var(--color-text);
}
}

.star-mode-entry__pill:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
