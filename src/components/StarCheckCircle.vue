<script setup lang="ts">
// StarCheckCircle（#182 组件卡）：圆形勾选标记纯展示元组件，所有「圆形选中标记」场景的原子图形
// 两档尺寸枚举封死（sm 22 / md 28px，默认 md；列表行内用 sm，独立场景用 md）
// 受控组件：选中状态归调用方管理，组件只按 checked 渲染——无点击切换逻辑 / 无内部状态翻转 / 无 emits
// 视觉纯令牌直译：未选透明底 + 2px 描边 --color-outline；选中底与描边同色 --color-primary、
// 内部 ✓ 字符 --color-on-primary、字重 700；原子图形不挂 star-container 样式集（那是容器规格）
withDefaults(
  defineProps<{
    checked: boolean
    size?: 'sm' | 'md'
  }>(),
  {
    size: 'md',
  },
)
</script>

<template>
  <span class="star-check-circle" :class="[`star-check-circle--${size}`, { 'star-check-circle--checked': checked }]">
    <span v-if="checked" class="star-check-circle__tick" aria-hidden="true">✓</span>
  </span>
</template>

<style scoped>
/* 基础（票面视觉直译）：透明底 + 2px 描边 outline 色，圆形行内块，为 ✓ 字符居中铺垫 */
.star-check-circle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background-color: transparent;
  border: 2px solid var(--color-outline);
  border-radius: 50%;
}

/* 选中态：底与描边同色 primary，✓ 字符 on-primary 色 + 字重 700 */
.star-check-circle--checked {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
}

/* ===== size 两档矩阵（票面直译：md 28 / sm 22px；对勾字号走既有令牌——票面 12/14px 为表外字号，
被令牌收口门禁禁用，保守取最近档：sm=--font-size-caption、md=--font-size-info，缺口待验收补拍板）===== */
.star-check-circle--md {
  width: 28px;
  height: 28px;
  font-size: var(--font-size-info);
}

.star-check-circle--sm {
  width: 22px;
  height: 22px;
  font-size: var(--font-size-caption);
}
</style>
