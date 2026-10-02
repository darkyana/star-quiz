<script setup lang="ts">
// StarIconBtn（C5，#56）：透明底圆形图标钮——薄组件无变体派（原型 2026-08-30 拍板：A + 提议全收）
// 零 variant / 零 size prop：热区恒 44px、透明底、hover surface-dim 洗底、focus-visible 3px 主色环、
// 无位移反馈（角落轻操作非 CTA）；图标尺寸 / 颜色 / 二态全归 slot 内容（svg 自带 width/height + currentColor 或页面 class）；
// aria-label / aria-pressed / disabled 等经 attrs 透传，使用处必传 aria-label（纯图标无文本）；
// 定位（absolute 等）与业务动效由使用处 class 负责（红旗二态 / 升旗动画留 Quiz 页）。
</script>

<template>
  <button type="button" class="star-icon-btn">
    <slot />
  </button>
</template>

<style scoped>
.star-icon-btn {
  border: 0;
  padding: 0;
  width: var(--touch-sm);
  height: var(--touch-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
}

/* hover：surface-dim 洗底（统一两处历史形态：Parent 关闭钮原为只变色，入库即抹平）；#131 包 hover-capable 媒体查询，触屏无粘性 hover 态 */
@media (hover: hover) {
.star-icon-btn:hover:not(:disabled) {
  background-color: var(--color-surface-dim);
}
}

/* focus-visible：3px 主色环 + 2px offset（补齐原 Quiz 红旗钮键盘可达性缺口，A11y 同 C1） */
.star-icon-btn:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

/* disabled：与 StarButtonStandard 同口径（去饱和 + 降透明 + not-allowed） */
.star-icon-btn:disabled {
  filter: saturate(0.45);
  opacity: 0.62;
  cursor: not-allowed;
}
</style>
