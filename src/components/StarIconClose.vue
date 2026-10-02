<script setup lang="ts">
// StarIconClose（#258 评审收口）：18px 关闭 X 图标共享件——原 StarModalStandard 关闭钮 / Home .game-exit /
// registry 展示位三处逐字重复的 path 收敛于此（评审项：抽共享关闭图标，进 registry 老板已批）。
// 薄装饰件零 props：尺寸走 --icon-size-sm 令牌、fill 走 currentColor（颜色归使用处）；
// aria-hidden 装饰语义固定（可达名归承载它的 StarIconBtn 等）。
</script>

<template>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" fill="currentColor" />
  </svg>
</template>

<style scoped>
/* 尺寸走令牌（与原两处 width/height="18" 属性同值，视觉零变化） */
svg {
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
}
</style>
