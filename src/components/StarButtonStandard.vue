<script setup lang="ts">
// StarButtonStandard（C1 组件卡；原契约文档 docs/components/StarButtonStandard.md 已随 _Archived_docs/ 移出仓库、仅存 git 历史，行为契约现以本组件与测试为准）
// variant × size 2×2 全矩阵 + disabled + edgeInset（#33，2026-08-29 老板拍板）；
// 原生属性（type / aria-* / @click 等）走 attrs 透传，组件内不声明 type prop；
// 默认 slot 承载按钮文案。
withDefaults(
  defineProps<{
    variant?: 'primary' | 'standard'
    size?: 'large' | 'small'
    disabled?: boolean
    /** large 宽度行为（#33）：true 撑满父容器并左右各留 --space-page 页面边距；false 贴边 100%；small 不受影响（随文字） */
    edgeInset?: boolean
  }>(),
  {
    variant: 'standard',
    size: 'small',
    disabled: false,
    edgeInset: true,
  },
)
</script>

<template>
  <button
    class="star-button"
    :class="[
      `star-button--${variant}`,
      `star-button--${size}`,
      size === 'large' ? (edgeInset ? 'star-button--edge-inset' : 'star-button--edge-full') : '',
    ]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
/* 基础（设计方案 §3.3 / D-10）：零描边 + 底部实色唇边；圆角对齐探针 P1-r2 主按钮档（xl 20）
   box-sizing: border-box（#33：无全局 reset，large 撑满宽度 + 描边需防溢出） */
.star-button {
  border: 0;
  box-sizing: border-box;
  font-family: inherit;
  cursor: pointer;
  border-radius: var(--radius-xl);
  transition:
    transform var(--duration-fast) ease,
    box-shadow var(--duration-fast) ease,
    filter var(--duration-fast) ease;
}

/* ===== 变体矩阵（定义单 §3，四格全写）=====
   #152 G12 CTA 光晕层次：primary 系唇边之上叠微光（--glow-star-soft）。
   #215：阴影全矩阵统一采用 small 档形态（唇边 --shadow-sm / hover 增厚 --shadow-md），
   primary 用 --color-primary-shadow、standard 用 --color-surface-shadow——
   large 与 small 仅尺寸不同，阴影（box-shadow）完全一致 */
.star-button--primary.star-button--large {
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-primary-shadow), var(--glow-star-soft);
}

.star-button--primary.star-button--small {
  /* 修复现状「假主按钮」：.btn-sm 曾覆盖主色渲染为中性，此处为真主蓝底 */
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-primary-shadow), var(--glow-star-soft);
}

.star-button--standard.star-button--large {
  /* #33 融合方案：白底 + 细描边 --border-thin（复用 --color-secondary-shadow）+ 唇边阴影保留（hover 增厚 / active 下压不变）；#215 阴影对齐 small 档 */
  background-color: var(--color-surface);
  color: var(--color-text);
  border: var(--border-thin) solid var(--color-secondary-shadow);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow);
}

.star-button--standard.star-button--small {
  background-color: var(--color-surface);
  color: var(--color-text);
  border: var(--border-thin) solid var(--color-secondary-shadow);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow);
}

/* ===== 尺寸骨架（large 沿用 .btn-primary/.btn-secondary；small 沿用 .btn-sm）===== */
.star-button--large {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-size-btn);
  font-weight: 700;
  min-height: var(--touch-md);
}

.star-button--small {
  /* 小按钮圆角对齐探针小钮档（lg 16） */
  border-radius: var(--radius-lg);
  padding: var(--space-base) var(--space-sm);
  font-size: var(--font-size-btn-sm);
  font-weight: 600;
  min-height: var(--touch-sm);
}

/* ===== 宽度行为（#33，仅 large 生效）===== */
.star-button--large.star-button--edge-inset {
  /* 默认：撑满父容器 + 左右各留页面边距（--space-page 20px） */
  width: calc(100% - 2 * var(--space-page));
  margin-inline: auto;
}

.star-button--large.star-button--edge-full {
  /* edgeInset=false：贴边 100% */
  width: 100%;
}

/* #158 R-宽档控件封顶：主 CTA 与次要大按钮（large 尺寸档全变体 = primary × large 底栏主按钮 / 页内主按钮，
   与 standard × large 满宽入口大钮，2026-09-07 老板补拍板）是清单内真组件，封顶规则写进组件自身样式——
   ≥600 视口不比大手机更大（--control-max-width 令牌，与外壳第一阶段列宽同值同源），封顶后居中；
   <600 手机档与 small 档零变化；高度与触控热区（md 56）不动。
   居中健壮性（#158 修复 2）：button 默认 inline-block，auto 边距在非 flex 宿主下不居中——
   显式块级化，使居中只依赖自身声明；flex 宿主下块级化无视觉差异。
   复用外壳同一张 600/1024 断点表，不引入容器查询、不加新断点 */
@media (min-width: 600px) {
  .star-button--large {
    display: block;
    max-width: var(--control-max-width);
    margin-inline: auto;
  }
}

/* hover：上浮 2px + 唇边增厚（#215 全矩阵统一：一律 small hover 档 --shadow-md）；#131 包 hover-capable 媒体查询，触屏无粘性 hover 态；
   #152 G12：hover 增厚时光晕层次保持（CTA 光晕不随 hover 丢失） */
@media (hover: hover) {
.star-button--primary.star-button--large:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 var(--shadow-md) 0 var(--color-primary-shadow), var(--glow-star-soft);
}

.star-button--primary.star-button--small:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 var(--shadow-md) 0 var(--color-primary-shadow), var(--glow-star-soft);
}

.star-button--standard.star-button--large:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 var(--shadow-md) 0 var(--color-surface-shadow);
}

.star-button--standard.star-button--small:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 var(--shadow-md) 0 var(--color-surface-shadow);
}
}

/* active：下压 4px、唇边不归零（2026-08-27 老板拍板）；small 现状无此反馈，此处统一补齐 */
.star-button:active:not(:disabled) {
  transform: translateY(4px);
}

/* disabled：去饱和 0.45 + 透明度 0.62 + not-allowed（以首页「开始答题」禁用样式为准）；
   #215：disabled 不覆写 box-shadow——沿用各组合基础阴影（全矩阵已统一为 small 档形态） */
.star-button:disabled {
  filter: saturate(0.45);
  opacity: 0.62;
  cursor: not-allowed;
}

/* focus-visible：3px outline + 2px offset（设计方案 §3.3 / A11y2） */
.star-button:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
