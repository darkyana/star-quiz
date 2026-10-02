<script setup lang="ts">
// StarSectionShell（#201 C- 组件卡）：分区卡壳元组件——管理分区同构骨架收编
//（FamilyAdmin：等家长批准的申请 / 设备名册 / 快照回滚；「家庭码」段不同构，照常走内容 slot）。
// 只收编结构，逻辑留页面（ADR-0008 受控边界）：error 文案与刷新 handler 由页面传 / 接（emit refresh），组件不持状态。
// 视觉真相源 = probe #194 第 4 节直译：容器视觉 = star-container 全局样式集（不自绘）；
// 标题为 prop 非 slot（标题样式组件内固定）；标题-内容间距组件内固定（--space-sm）。
// 刷新钮 = StarButtonStandard standard · small 组件内组装，禁止自绘按钮样式；
// star-section-refresh 仅为页面 / 测试锚点类（沿 btn-devices-refresh 等锚点类惯例），不挂任何样式规则。
import { Comment, Fragment, Text, useSlots } from 'vue'
import type { Slot, VNode, VNodeChild } from 'vue'
import StarButtonStandard from './StarButtonStandard.vue'
import { copy } from '../copy'

defineProps<{
  /** 分区标题（prop 非 slot，标题样式组件内固定） */
  title: string
  /** 错误文案（传了才渲染错误行 + 刷新钮；文案与重试判定留页面） */
  error?: string
  /** 空态文案（传了且内容 slot 无可见内容才渲染；空态判定数据留页面） */
  empty?: string
}>()

const emit = defineEmits<{ refresh: [] }>()

const slots = useSlots()

/** 子节点是否可见（注释占位 / 空白文本 / 空数组不算——v-if 关闭时是注释占位） */
function isVisibleChild(child: VNodeChild): boolean {
  if (child === null || child === undefined || typeof child === 'boolean') return false
  if (typeof child === 'string' || typeof child === 'number') return String(child).trim() !== ''
  if (Array.isArray(child)) return child.some(isVisibleChild)
  const vnode = child as VNode
  if (vnode.type === Comment) return false
  if (vnode.type === Fragment) return Array.isArray(vnode.children) && vnode.children.some(isVisibleChild)
  if (vnode.type === Text) return typeof vnode.children === 'string' && vnode.children.trim() !== ''
  return true
}

/** default slot 是否有可见内容（渲染期调用：空态行仅在没有内容时出现） */
function hasContent(slot: Slot | undefined): boolean {
  if (!slot) return false
  return slot().some(isVisibleChild)
}
</script>

<template>
  <section class="star-container star-section-shell">
    <h2 class="star-section-title">{{ title }}</h2>
    <template v-if="error">
      <p class="star-section-error" role="alert">{{ error }}</p>
      <StarButtonStandard variant="standard" size="small" class="star-section-refresh" @click="emit('refresh')">{{ copy.components.sectionShell.refresh }}</StarButtonStandard>
    </template>
    <template v-else>
      <slot />
      <p v-if="empty && !hasContent(slots.default)" class="star-section-empty">{{ empty }}</p>
    </template>
  </section>
</template>

<style scoped>
/* 分区卡壳骨架（probe #194 第 4 节直译，全令牌引用）：纵向 flex + 标题-内容固定间距（--space-sm）；
   容器视觉（底色圆角唇边内边距）归 star-container 全局样式集，本组件只留分区内部结构 */
.star-section-shell {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

/* 段标题：层级对齐家长页卡标题（body-lg 档） */
.star-section-title {
  margin: 0;
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  color: var(--color-text);
}

/* 错误行：alert 语义 + error 系令牌 */
.star-section-error {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 600;
  color: var(--color-error);
}

/* 空态行：info 令牌 + 次级文字色 */
.star-section-empty {
  margin: 0;
  font-size: var(--font-size-info);
  color: var(--color-text-secondary);
}
</style>
