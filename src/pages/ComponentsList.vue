<script setup lang="ts">
// 组件库列表页（定义单 §6 框架）：只读注册表按 componentGroups 分组渲染条目（#214），每项进单组件展示页
import { useRouter } from 'vue-router'
import { componentGroups, componentRegistry } from '../components/registry'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import { copy } from '../copy'

const router = useRouter()

/** 按组定稿顺序取组内条目（#214）：页面零改动契约——新组件只需 registry 加条目 + 并入组 order */
function entriesOf(order: string[]) {
  return order.map((key) => componentRegistry.find((e) => e.key === key)!)
}

function goBack(): void {
  void router.push('/parent')
}
</script>

<template>
  <div data-page="components" class="page components-page">
    <!-- 顶栏（C3Re1：StarNavBar 左返回钮 + 标题；header-spacer 占位收归组件） -->
    <StarNavBar :title="copy.parent.componentsListTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <main class="components-main page-scroll">
      <!-- #214 分组分区：组标题 + 组内顺序只读 componentGroups；条目小字展示代码文件名 -->
      <section v-for="group in componentGroups" :key="group.key" class="component-group">
        <h2 class="group-title">{{ group.title }}</h2>
        <router-link
          v-for="entry in entriesOf(group.order)"
          :key="entry.key"
          :to="`/components/${entry.key}`"
          class="component-row star-container"
        >
          <div class="component-id">
            <span class="component-name">{{ entry.name }}</span>
            <span class="component-file">{{ entry.file }}</span>
          </div>
          <span class="component-key">{{ entry.key }}</span>
        </router-link>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* 一屏展示批2（#52）：内容区唯一滚动容器，滚动四件套已收编全局 page-scroll 样式集（components.css，#68） */
.components-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding-top: var(--space-md);
  /* 滚动到底时末行卡 4px 唇边留呼吸位 */
  padding-bottom: var(--space-md);
}

/* 分组区块（#214）：组间留白大于组内条目间距，标题小字次级色 */
.component-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.component-group + .component-group {
  margin-top: var(--space-lg);
}

.group-title {
  margin: 0;
  font-size: var(--font-size-label);
  font-weight: 700;
  color: var(--color-text-secondary);
}

/* 组件条目行（设计方案 §3.2 入口行）：容器视觉由全局 star-container 样式集提供，此处保留触控热区与 hover/active 位移语言 */
.component-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: var(--touch-md);
  text-decoration: none;
  transition: transform var(--duration-fast) ease;
}

@media (hover: hover) {
.component-row:hover {
  transform: translateY(-2px);
}
}

.component-row:active {
  transform: translateY(4px);
}

.component-id {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

.component-name {
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  color: var(--color-text);
}

/* 代码名小字（#214）：组件文件名展示在展示名下方 */
.component-file {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}

.component-key {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}
</style>
