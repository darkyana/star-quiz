<script setup lang="ts">
// StarSegmentTabs（#183 C- 组件卡）：通用 N 项横向分段单选元组件（筛选分区等通用场景）。
// 与出题方式入口 StarModeEntry 并存不合并：那是领域专用三模式渐变卡（选中态渐变填充），
// 本组件是通用 N 项单选（选中态金描边），展示页并列呈现时视觉可区分。
// 可达性沿 StarModeEntry 既有 radiogroup / radio + aria-checked 口径。
defineProps<{
  modelValue: string
  items: Array<{ key: string; label: string }>
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()
</script>

<template>
  <div class="star-segment-tabs" role="radiogroup" :style="{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="radio"
      :aria-checked="item.key === modelValue"
      class="star-segment-tabs__item"
      :class="{ 'is-selected': item.key === modelValue }"
      @click="emit('update:modelValue', item.key)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style scoped>
/* 分段轨道（#183 直译）：grid 等分 N 列（列数随 items 数量走内联样式）、项间距 space-base（全令牌引用） */
.star-segment-tabs {
  display: grid;
  gap: var(--space-base);
  width: 100%;
}

/* 未选段：surface-dim 底 + outline 描边 + 次级字（#183 视觉直译）；
   最小高度约 42px → 最近触控令牌 touch-sm（44px），字号 font-size-info、字重 700、圆角 radius-md */
.star-segment-tabs__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--touch-sm);
  background-color: var(--color-surface-dim);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: var(--font-size-info);
  font-weight: 700;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-base) ease,
    color var(--duration-base) ease,
    border-color var(--duration-base) ease;
}

/* 选中段：surface-bright 底 + 价签金描边 + 主色字（与 StarModeEntry 渐变填充选中态视觉区分） */
.star-segment-tabs__item.is-selected {
  background-color: var(--color-surface-bright);
  border-color: var(--color-price-tag-border);
  color: var(--color-primary);
}

.star-segment-tabs__item:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
