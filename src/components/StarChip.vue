<script setup lang="ts">
// StarChip（C4 组件卡；原契约文档 docs/components/C4-StarChip.md 已随 _Archived_docs/ 移出仓库、仅存 git 历史，行为契约现以本组件与测试为准）
// 纯展示胶囊标签：variant（default 面底 / ghost 透明底）× size（sm 12px / md 14px，字号随 size）
// 状态扩展（#186）：selected 选中态（surface-bright 底 + outline 描边 + text 字色）；tone 纯字色档（go/mist/warm = 难度易/中/难，#217 起对全部四变体组合生效，只着字色底/形不变）
// 非交互元素：不 emit 事件、无 hover/active（点击切换由调用方承载，原生 click 经 Vue attrs 默认透传）；默认 slot 承载文本；原生属性（role / aria-* 等）透传
withDefaults(
  defineProps<{
    variant?: 'default' | 'ghost'
    size?: 'sm' | 'md'
    selected?: boolean
    tone?: 'go' | 'mist' | 'warm'
  }>(),
  {
    variant: 'default',
    size: 'sm',
  },
)
</script>

<template>
  <span
    class="star-chip"
    :class="[
      `star-chip--${variant}`,
      `star-chip--${size}`,
      { 'star-chip--selected': selected, [`star-chip--tone-${tone}`]: tone },
    ]"
  >
    <slot />
  </span>
</template>

<style scoped>
/* 基础胶囊（定义单 §3）：圆角胶囊 + inline-flex 居中 + 字重 600；非交互元素无阴影（AC-R15-3-1） */
.star-chip {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-full);
  font-weight: 600;
}

/* ===== variant × size 矩阵（定义单 §3，四格全写；字号随 size：sm caption / md btn-sm，走令牌引用）===== */
.star-chip--default.star-chip--sm {
  padding: 4px 12px;
  font-size: var(--font-size-caption);
  background-color: var(--color-surface-dim);
  color: var(--color-text-secondary);
}

.star-chip--default.star-chip--md {
  padding: 8px 16px;
  font-size: var(--font-size-btn-sm);
  background-color: var(--color-surface-dim);
  color: var(--color-text-secondary);
}

.star-chip--ghost.star-chip--sm {
  padding: 4px 12px;
  font-size: var(--font-size-caption);
  background-color: transparent;
  color: var(--color-text-secondary);
}

.star-chip--ghost.star-chip--md {
  padding: 8px 16px;
  font-size: var(--font-size-btn-sm);
  background-color: transparent;
  color: var(--color-text-secondary);
}

/* ===== tone 文字着色（#186；#217 方案 A：tone 是可叠加在任意变体上的纯字色档，非与 default/sm 并行的另一套体系）
   选择器带上 variant 提到与矩阵同特异性（0,2,0），否则被 default/sm 矩阵规则覆盖永不生效；置于矩阵之后按源序取胜 ===== */
.star-chip--default.star-chip--tone-go,
.star-chip--ghost.star-chip--tone-go {
  color: var(--color-go-text);
}

.star-chip--default.star-chip--tone-mist,
.star-chip--ghost.star-chip--tone-mist {
  color: var(--color-mist);
}

.star-chip--default.star-chip--tone-warm,
.star-chip--ghost.star-chip--tone-warm {
  color: var(--color-warm);
}

/* ===== selected 选中态（#186，筛选标签场景，常与 ghost 底组合；同特异性提到 0,2,0 并置后覆盖 tone 字色）===== */
.star-chip--default.star-chip--selected,
.star-chip--ghost.star-chip--selected {
  background-color: var(--color-surface-bright);
  border: 1px solid var(--color-outline);
  color: var(--color-text);
}
</style>
