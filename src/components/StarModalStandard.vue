<script setup lang="ts">
// StarModalStandard（C2 组件卡；原契约文档 docs/components/C2-StarModalStandard.md 已随 _Archived_docs/ 移出仓库、仅存 git 历史，行为契约现以本组件与测试为准）
// variant 类型驱动：confirm = 双按钮（standard×small 左 + primary×small 右）/ notice = 单按钮全宽
// 打开/关闭由父组件 v-if 控制（对齐现状 confirmModal 用法），组件无内部显示状态
// 主按钮 emit confirm；取消路径（左按钮 / 蒙层点击）emit cancel
// #59 扩展（管理形态收编，保守 API——既有使用不传新 props 时 DOM 零变化）：
//   desc 副标题（title 之下正文之上）/ showClose 右上关闭钮（StarIconBtn，emit close）/
//   默认 slot 自定义内容区（正文之下按钮行之上，无 slot 零渲染痕迹）/
//   actions 具名 slot 覆盖内置按钮行（Parent 确认弹窗三按钮场景）；message 变可选（管理弹窗无正文）
import { computed, onMounted, onUpdated, ref } from 'vue'
import StarButtonStandard from './StarButtonStandard.vue'
import StarIconBtn from './StarIconBtn.vue'
import StarIconClose from './StarIconClose.vue'
import { copy } from '../copy'

// #216 三按钮形态判定：actions 行内实渲染按钮数 = 3 时纵向满宽堆叠（布局落位组件层，调用方零改动）。
// 计数取挂载后的真实 DOM（onMounted + onUpdated 跟随 v-if / pasteView 等动态分支），不走 slot 源码摊平——
// 编译产物里 v-if 分支 Fragment 的 children 形态不保证可静态计数，DOM 计数对任意调用方组装方式都成立
const actionsEl = ref<HTMLElement | null>(null)
const stacked = ref(false)

function measureStacked(): void {
  stacked.value = (actionsEl.value?.querySelectorAll('.star-button').length ?? 0) === 3
}

onMounted(measureStacked)
onUpdated(measureStacked)

const props = withDefaults(
  defineProps<{
    message?: string
    title?: string
    desc?: string
    variant?: 'confirm' | 'notice'
    cancelText?: string
    confirmText?: string
    noticeButtonVariant?: 'primary' | 'standard'
    showClose?: boolean
    closeLabel?: string
  }>(),
  {
    message: undefined,
    title: undefined,
    desc: undefined,
    variant: 'confirm',
    cancelText: copy.components.modal.cancel,
    confirmText: copy.components.modal.confirm,
    noticeButtonVariant: 'primary',
    showClose: false,
    closeLabel: copy.components.modal.close,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
  close: []
}>()

// 可达名称：有正文沿用既有 star-modal-text id 结构（现状零变化）；无正文退回标题；desc 并入 aria 描述
const labelledby = computed(() => (props.message ? 'star-modal-text' : props.title ? 'star-modal-title' : undefined))
const describedby = computed(() => (props.desc ? 'star-modal-desc' : undefined))

function onCancel(): void {
  emit('cancel')
}

function onConfirm(): void {
  emit('confirm')
}

function onClose(): void {
  emit('close')
}

function onScrimClick(): void {
  emit('cancel')
}
</script>

<template>
  <div class="star-modal" role="dialog" aria-modal="true" :aria-labelledby="labelledby" :aria-describedby="describedby">
    <!-- 蒙层点击 = cancel：绑定在 scrim 自身（@click.self 会被全屏 scrim 拦截永不触发，Quiz.vue 现状同构缺陷，组件内修复） -->
    <div class="star-modal__scrim" @click="onScrimClick"></div>
    <div class="star-modal__card">
      <!-- 右上关闭钮（showClose 开启）：视觉与热区归 StarIconBtn（C5），18px 关闭图标与原 Parent 自绘同源，定位归组件 -->
      <StarIconBtn v-if="showClose" class="star-modal__close" :aria-label="closeLabel" @click="onClose">
        <StarIconClose />
      </StarIconBtn>
      <h2 v-if="title" id="star-modal-title" class="star-modal__title">{{ title }}</h2>
      <p v-if="desc" id="star-modal-desc" class="star-modal__desc">{{ desc }}</p>
      <p v-if="message" id="star-modal-text" class="star-modal__text">{{ message }}</p>
      <!-- 默认 slot：自定义内容区（正文之下按钮行之上）；无 slot 零渲染痕迹 -->
      <slot v-if="$slots.default" />
      <div ref="actionsEl" class="star-modal__actions" :class="{ 'star-modal__actions--stacked': stacked }">
        <!-- actions 具名 slot：覆盖内置按钮行（slot 内容落位同一 flex 容器，等宽规则同样生效）；无 slot 走内置 confirm/notice -->
        <!-- #216 三按钮形态（stacked）：纵向满宽堆叠，布局落位组件层，调用方零改动 -->
        <slot v-if="$slots.actions" name="actions" />
        <template v-else-if="variant === 'confirm'">
          <StarButtonStandard type="button" variant="standard" size="small" @click="onCancel">{{ cancelText }}</StarButtonStandard>
          <StarButtonStandard type="button" variant="primary" size="small" @click="onConfirm">{{ confirmText }}</StarButtonStandard>
        </template>
        <StarButtonStandard v-else type="button" :variant="noticeButtonVariant" size="small" @click="onConfirm">{{ confirmText }}</StarButtonStandard>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 弹窗视觉与 Quiz.vue 弹窗区（设计方案 §4.1）零变化：scrim / card / text / actions 规格一致 */
.star-modal {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md);
}

.star-modal__scrim {
  position: absolute;
  inset: 0;
  background-color: var(--color-scrim);
  opacity: 0.9;
  transition: opacity var(--duration-base) ease;
}

.star-modal__card {
  position: relative;
  width: 100%;
  max-width: var(--modal-max);
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow);
  padding: var(--space-md);
}

/* 右上关闭钮定位（视觉对齐原 Parent 自绘：上右各留小档间距；热区与状态归 StarIconBtn） */
.star-modal__close {
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm);
}

.star-modal__title {
  margin: 0 0 var(--space-sm);
  font-size: var(--font-size-headline);
  font-weight: 700;
  text-align: center;
}

/* 副标题（管理形态说明文字）：视觉对齐原 Parent 自绘（正文字号 / 次要色 / 居中 / 1.5 行高） */
.star-modal__desc {
  margin: 0 0 var(--space-md);
  font-size: var(--font-size-body);
  font-weight: 400;
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 1.5;
}

/* 管理形态（标题 + 副标题组合）：组合间距还原页面原紧排档（标题默认底距让位 4px） */
.star-modal__title + .star-modal__desc {
  margin-top: calc(var(--space-base) - var(--space-sm));
}

.star-modal__text {
  margin: 0 0 var(--space-md);
  font-size: var(--font-size-body-lg);
  font-weight: 600;
  text-align: center;
  line-height: 1.5;
}

.star-modal__actions {
  display: flex;
  gap: var(--space-sm);
}

/* 双按钮等宽 / 单按钮全宽：flex: 1（定义单 §3，天然实现，非视觉覆盖；actions 槽内组件按钮同样生效） */
.star-modal__actions :deep(.star-button) {
  flex: 1;
}

/* #216 三按钮形态：纵向满宽堆叠（取消该方向上的 flex 伸展，改占满横宽；间距沿用容器 gap） */
.star-modal__actions--stacked {
  flex-direction: column;
}

.star-modal__actions--stacked :deep(.star-button) {
  flex: 0 0 auto;
  width: 100%;
}
</style>
