<script setup lang="ts">
// StarGlyph（#195 组件卡；视觉真相源 = probe #194 第 1 节）：星形 glyph 纯展示元组件，全仓同 path 星形的单一来源
// 三档尺寸枚举封死（sm 18 / md 24 / lg 48px，默认 md）；fill/stroke 恒 --color-star（全仓星星一色，不加 tone）
// 星光微光 --glow-star-svg-soft 内置；无 emits / 无 slots；class / style 等原生属性透传（页面私有尺寸档与动效覆写走此通道）
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
  }>(),
  {
    size: 'md',
  },
)
</script>

<template>
  <svg class="star-glyph" :class="`star-glyph--${size}`" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.5 L14.2 8.9 L21 9.1 L15.6 13.2 L17.6 19.7 L12 15.8 L6.4 19.7 L8.4 13.2 L3 9.1 L9.8 8.9 Z"
      fill="var(--color-star)"
      stroke="var(--color-star)"
      stroke-width="3"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
/* 基础 glyph（probe #194 第 1 节直译）：行内块 + 不被 flex 拉伸 + 星光微光内置 */
.star-glyph {
  display: inline-block;
  flex: none;
  filter: var(--glow-star-svg-soft);
}

/* ===== size 三档矩阵（probe #194 第 1 节直译：18 / 24 / 48px）===== */
.star-glyph--sm {
  width: 18px;
  height: 18px;
}

.star-glyph--md {
  width: 24px;
  height: 24px;
}

.star-glyph--lg {
  width: 48px;
  height: 48px;
}
</style>
