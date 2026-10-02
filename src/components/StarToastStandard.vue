<script setup lang="ts">
// T-Toast（#139）：全站共享瞬时反馈 toast——组件吞定时器（2400ms 私有常量，不开 duration prop），
// 页面契约：单一文案 ref 传入 message，监听 expired 清空（否则同文案第二次弹不触发 watch——原型实踩坑）。
// 静态挂载初值非空 = 常显不计时（watch 不带 immediate，组件展示页靠此形态静态展示）。
import { onUnmounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ message: string; icon?: boolean }>(), { icon: false })
const emit = defineEmits<{ expired: [] }>()

const DURATION = 2400
const visible = ref(props.message !== '')
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.message,
  (msg) => {
    if (msg === '') {
      // 页面主动清空（如复制失败分支）→ 立即隐藏（沿旧页面 showToast 置 false 行为）
      visible.value = false
      if (timer) clearTimeout(timer)
      timer = null
      return
    }
    visible.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      visible.value = false
      timer = null
      emit('expired')
    }, DURATION)
  },
)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div v-if="visible" class="star-container toast" role="status">
    <svg v-if="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="currentColor" />
    </svg>
    <span>{{ message }}</span>
  </div>
</template>

<style scoped>
/* #139 样式归属拍板：容器形态（底色/描边/圆角/glow）由全局 star-container 样式集承担，组件零重复声明；
   此处只写 toast 私有增量——fixed 底部居中（safe-area）/ 层级 / 限宽 / 纵向内距收紧 / 提示字号字重 */
.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--space-md) + env(safe-area-inset-bottom));
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: var(--space-base);
  max-width: min(440px, calc(100vw - 2 * var(--space-page)));
  padding: var(--space-sm) var(--space-gutter);
  font-size: var(--font-size-info);
  font-weight: 700;
}
</style>
