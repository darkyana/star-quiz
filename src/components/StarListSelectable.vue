<script setup lang="ts">
import StarCheckCircle from './StarCheckCircle.vue'

// StarListSelectable（#187 C- 组件卡）：可选择列表项元组件——所有「列表行可勾选」场景的通用行组件。
// 结构：左勾选圆 + 中主体（flex 纵排）+ 右 action 槽；行内元信息（难度胶囊 / 题型 / 错对点等）
// 由调用方经 default 槽组装，组件不关心内容（ADR-0008 受控边界：选中状态归调用方）。
// 勾选圆 = 内部调用 StarCheckCircle（size sm），禁止自绘同貌样式（本票核心约束）。
// 交互契约：点击主体区 emit toggle（disabled 时不 emit）；action 槽点击 stopPropagation 不触发 toggle。
withDefaults(
  defineProps<{
    /** 是否选中（受控：状态归调用方） */
    selected: boolean
    /** 禁用：降透明度且不响应 toggle */
    disabled?: boolean
  }>(),
  {
    disabled: false,
  },
)

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <div
    class="star-container star-list-selectable"
    :class="{ 'star-list-selectable--selected': selected, 'star-list-selectable--disabled': disabled }"
    @click="!disabled && emit('toggle')"
  >
    <!-- 根元素挂 star-container 样式集（白底灰描边内容承载区）；选中态描边与外环走本组件 scoped 覆盖 -->
    <StarCheckCircle class="star-list-selectable__check" :checked="selected" size="sm" />
    <div class="star-list-selectable__body">
      <slot />
    </div>
    <!-- action 槽：右侧操作区（如编辑按钮）；stopPropagation 保证槽内点击不触发 toggle -->
    <div v-if="$slots.action" class="star-list-selectable__action" @click.stop>
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
/* 行布局：左勾选圆 + 中主体 + 右 action 槽；最小高度 touch-md，内边距 space-sm（纵向）+ space-gutter（横向，
   star-container 默认 space-gutter 四向，此处纵向收窄为 space-sm——票面直译） */
.star-list-selectable {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: var(--touch-md);
  padding: var(--space-sm) var(--space-gutter);
  cursor: pointer;
}

/* 选中视觉（票面直译）：描边 color-primary + 外圈 1px 同色环（box-shadow 展开，覆盖 star-container 默认描边与唇边光） */
.star-list-selectable--selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}

/* disabled：降透明度（StarButtonStandard / StarIconBtn 同口径 0.62）且不响应 toggle（脚本守卫 + not-allowed） */
.star-list-selectable--disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

/* 主体：flex 纵排，占满剩余宽度（行内内容由调用方组装，如题干 + 元信息胶囊） */
.star-list-selectable__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

/* action 槽：纯布局容器（右侧操作区，内容自由），flex none 不被主体挤压 */
.star-list-selectable__action {
  flex: none;
  display: flex;
  align-items: center;
}
</style>
