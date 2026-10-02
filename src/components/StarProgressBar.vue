<script setup lang="ts">
// StarProgressBar（#200 C- 组件卡）：吸顶进度条元组件——sticky 吸顶与 aria progressbar 内置，
// 填充宽由 value/max 驱动；文字区双通道：简单场景 label prop 一句话，复杂内容走 default slot
// （slot 优先，两者皆无则不渲染文字区）。视觉真相源 = probe #194 第 3 节直译：
// 填充纯 color-primary 实心（#200 定稿，非金渐变无星光），轨道 surface-dim + outline 描边。
import { computed } from 'vue'

const props = defineProps<{
  /** 当前进度值（aria-valuenow 同源） */
  value: number
  /** 满档值（aria-valuemax 同源） */
  max: number
  /** 简单场景一句话文字（复杂内容走 default slot，slot 优先） */
  label?: string
}>()

/** 填充宽百分比：value/max 直算并夹取 0-100（max 非正数防除零，回落 0%） */
const percent = computed(() => (props.max <= 0 ? 0 : Math.min(100, Math.max(0, (props.value / props.max) * 100))))
</script>

<template>
  <div class="star-progress-area">
    <div
      class="star-progress-bar"
      role="progressbar"
      :aria-valuemin="0"
      :aria-valuemax="max"
      :aria-valuenow="value"
    >
      <div class="star-progress-fill" :style="{ width: `${percent}%` }"></div>
    </div>
    <span v-if="$slots.default" class="star-progress-label"><slot /></span>
    <span v-else-if="label" class="star-progress-label">{{ label }}</span>
  </div>
</template>

<style scoped>
/* probe #194 第 3 节直译 + #200 sticky 内置：行容器（轨道 + 文字），吸顶于最近滚动容器顶部 */
.star-progress-area {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

/* 轨道：surface-dim 底 + outline 细描边 + full 圆角 + 内阴影（probe 直译） */
.star-progress-bar {
  flex: 1;
  height: 16px;
  background-color: var(--color-surface-dim);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-full);
  overflow: hidden;
  box-shadow: inset 0 var(--shadow-xs) 0 var(--color-surface-shadow);
}

/* 填充：纯 color-primary 实心（#200 probe 定稿）+ full 圆角 + 宽度过渡（Quiz 既有动画保留） */
.star-progress-fill {
  height: 100%;
  background-color: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width var(--duration-base) ease;
}

/* 文字区：label prop 与 default slot 共用骨架（probe 两种形态同 span 直译） */
.star-progress-label {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
  white-space: nowrap;
}
</style>
