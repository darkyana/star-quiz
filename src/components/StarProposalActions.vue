<script setup lang="ts">
// StarProposalActions（#203 C- 提议卡拆件，领域件 Proposals 专用）：提议卡操作行容器
// probe #194 第 9 节直译：右对齐 flex 行；内容（本方 mini 头像 + 表态钮 / 改提议 / 发布、
// 终态查看详情 / 删除）完全由页面组装——动作 emit 与显隐判定全部留页面（ADR-0008 受控红线），
// 钮一律 StarButtonStandard，禁止自绘按钮样式。零 props 零 emits。
</script>

<template>
  <div class="card-actions"><slot /></div>
</template>

<style scoped>
/* 操作行骨架（probe #194 第 9 节直译）：最底一行整体靠右 */
.card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
