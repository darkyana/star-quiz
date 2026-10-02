<script setup lang="ts">
// StarBatchBar（#184 C- 组件卡）：批量操作条壳元组件——批量选择类场景（改题 / 导出 / 删除等）的通用壳。
// 组件只管壳与布局，逻辑留页面（ADR-0008 受控边界）：选中集与具体动作全由使用方组装，
// 动作区一律经 actions 槽注入（通常为 StarButtonStandard），组件内部禁止自绘任何按钮样式；
// 「取消选择」= components.css 既有 config-link 样式集（button 加类，不自绘）。
// 出现 / 消失由使用方 v-if 控制，组件不做动画承诺；sticky 吸附最近滚动容器底部。
import { copy } from '../copy'

withDefaults(
  defineProps<{
    /** 已选数量（计数行展示） */
    count: number
    /** 数量单位（默认「题」，导出等场景可换「项」） */
    unit?: string
    /** 反馈文案（传了才渲染 feedback 行） */
    feedback?: string
  }>(),
  {
    unit: copy.components.batchBar.unitQuestion,
  },
)

const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div class="star-batch-bar">
    <div class="star-batch-count">
      <span class="star-batch-count-text">{{ copy.components.batchBar.selectedPrefix }} <span class="star-batch-count-num">{{ count }}</span> {{ unit }}</span>
      <!-- star-batch-clear 仅为页面 / 测试锚点类（沿 star-section-refresh 等锚点类惯例），不挂任何样式规则 -->
      <button type="button" class="config-link star-batch-clear" @click="emit('clear')">{{ copy.components.batchBar.clear }}</button>
    </div>
    <div v-if="$slots.actions" class="star-batch-actions"><slot name="actions" /></div>
    <p v-if="feedback" class="star-batch-feedback">{{ feedback }}</p>
  </div>
</template>

<style scoped>
/* 票内视觉直译（全令牌引用）：sticky 底栏壳——surface-bright 底 + outline 上描边 + 深色上抛阴影；
   水平内边距 space-page，底部 safe-area 兼容（StarToastStandard 同款 env 避让先例） */
.star-batch-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-page) calc(var(--space-sm) + env(safe-area-inset-bottom));
  background-color: var(--color-surface-bright);
  border-top: var(--border-thin) solid var(--color-outline);
  box-shadow: 0 calc(-1 * var(--shadow-md)) var(--shadow-md) var(--color-surface-shadow);
}

/* 计数行：左计数右取消选择，两端对齐 */
.star-batch-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

/* 计数文字：info 档次级色；数字强调——body-lg 档 + 700 + 主色（票内直译） */
.star-batch-count-text {
  font-size: var(--font-size-info);
  color: var(--color-text-secondary);
}

.star-batch-count-num {
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  color: var(--color-primary);
}

/* 动作区：纯布局容器（内容自由，通常为使用方塞入的按钮组件） */
.star-batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

/* 反馈文案行：info 档次级色（仅传了 feedback 才渲染） */
.star-batch-feedback {
  margin: 0;
  font-size: var(--font-size-info);
  color: var(--color-text-secondary);
}
</style>
