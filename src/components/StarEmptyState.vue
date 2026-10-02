<script setup lang="ts">
// StarEmptyState（#196 C- 组件卡；视觉真相源 = probe #194 第 2 节）：空态块元组件——
// 页面级空态区块统一收编（Redeem / Prizes 走 icon=true；Proposals 走 icon=false）。
// props: icon?: boolean（默认 true → 内部调 StarGlyph lg，禁止自绘星形；false = 纯文案态）；
// default slot 承文案（灵活容纳强调文案等富文本）；页面级区块不挂 star-container，纵向居中 + 既有间距令牌。
import StarGlyph from './StarGlyph.vue'

withDefaults(
  defineProps<{
    /** 是否渲染空态大星（默认 true → 内部 StarGlyph lg；false = 纯文案态） */
    icon?: boolean
  }>(),
  {
    icon: true,
  },
)
</script>

<template>
  <div class="star-empty-state">
    <StarGlyph v-if="icon" size="lg" />
    <p class="star-empty-text"><slot /></p>
  </div>
</template>

<style scoped>
/* 空态块（probe #194 第 2 节直译，全令牌引用）：纵向居中 + 既有间距令牌；页面级区块不挂 star-container */
.star-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xl) var(--space-gutter);
  text-align: center;
}

/* 空态文案：body 档 + 次级文字色（probe 直译） */
.star-empty-text {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 400;
  color: var(--color-text-secondary);
}
</style>
