<script setup lang="ts">
// StarProposalCamps（#203 C- 提议卡拆件，领域件 Proposals 专用）：提议卡双阵营区容器
// 视觉真相源 = probe #194 第 9 节直译：双 camp 槽（surface-dim 圆角块各一），槽位内容
// （CampAvatar + 阵营态文字）由页面组装——阵营就绪与否的判定留页面（ADR-0008 受控红线）。
// 「对方恒左 / 自己恒右」的视角换序由页面决定两侧槽位内容，本组件不持视角概念、零 props。
// 阵营态文字由页面经槽位传入（含就绪态修饰类），样式走 slotted 通道随组件走（页面零内联提议卡样式）。
</script>

<template>
  <div class="camp-sides">
    <div class="camp-side"><slot name="left" /></div>
    <div class="camp-side"><slot name="right" /></div>
  </div>
</template>

<style scoped>
/* 双阵营区骨架（probe #194 第 9 节直译）：两阵营样式一致，横向排布 */
.camp-sides {
  display: flex;
  gap: var(--space-sm);
}

/* 单阵营块：surface-dim 圆角底，头像与状态文案两端对齐 */
.camp-side {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  background: var(--color-surface-dim);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-gutter);
}

/* 阵营态文字（页面槽位内容）：label 档 700 次级文字色，右对齐 */
:slotted(.camp-state) {
  font-size: var(--font-size-label);
  font-weight: 700;
  color: var(--color-text-secondary);
  text-align: right;
}

/* 就绪态（页面挂 is-agree 类）：go 系金色 */
:slotted(.camp-state.is-agree) {
  color: var(--color-go-text);
}
</style>
