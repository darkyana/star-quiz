<script setup lang="ts">
// StarNavBar（C3 组件卡；原契约文档 docs/components/C3-StarNavBar.md 已随 _Archived_docs/ 移出仓库、仅存 git 历史，行为契约现以本组件与测试为准）
// 纯结构导航栏：title prop（传空不渲染标题元素）+ left/right 具名 slot
// 无业务逻辑、不 emit 事件；返回 / 手势 / 跳转由父页面在槽位内容上实现
// 三区 grid（left | title | right）：空槽位由组件内部对称占位 → 标题恒几何居中（接管 .header-spacer 职责）
withDefaults(
  defineProps<{
    title?: string
  }>(),
  {
    title: '',
  },
)
</script>

<template>
  <header class="star-nav-bar page-header">
    <div class="star-nav-bar__side star-nav-bar__side--left">
      <slot name="left" />
    </div>
    <h1 v-if="title" class="page-title">{{ title }}</h1>
    <div class="star-nav-bar__side star-nav-bar__side--right">
      <slot name="right" />
    </div>
  </header>
</template>

<style scoped>
/* 三区布局（定义单 §3.2）：1fr auto 1fr，左右列恒等宽 → 标题几何居中、与左右内容宽度无关；
   scoped 特异性覆盖全局 .page-header 的 flex/space-between；容器规格（min-height 64px / padding）继承全局 */
.star-nav-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
}

.star-nav-bar__side {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.star-nav-bar__side--left {
  justify-content: flex-start;
}

.star-nav-bar__side--right {
  justify-content: flex-end;
}
</style>
