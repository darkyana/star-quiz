<script setup lang="ts">
// StarOptionRow（#199 C- 组件卡）：答题选项块四态受控元组件——组件只按 state 渲染，
// 哪个选项 correct / wrong / reveal 的判分逻辑留页面（受控边界，ADR-0008：组件只管渲染，判定留页面）。
// 视觉真相源 = probe #194 第 7 节直译；跳过钮无专属样式，复用 normal 态（禁用时 disabled），由页面以普通调用表达。
withDefaults(
  defineProps<{
    /** 选项文案（页面判定后传入，组件不持文案） */
    label: string
    /** 四态：normal 深蓝待选 / correct·reveal 金高亮（同貌）/ wrong 红系选中错项 */
    state: 'normal' | 'correct' | 'wrong' | 'reveal'
    /** 禁用（答后其余项变淡：surface-dim 底 + 次级文字 + 无阴影，禁点） */
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="star-option"
    :class="state !== 'normal' && `star-option--${state}`"
    :disabled="disabled"
    @click="emit('select')"
  >
    {{ label }}
  </button>
</template>

<style scoped>
/* ===== 四态骨架（probe #194 第 7 节直译；#146 三态双通道：边框 + 填充，色弱可辨；
   #147 圆角升档 12→16 对齐探针：选项行引用 --radius-lg，防 --radius-md 令牌值回潮）===== */
.star-option {
  border: var(--border-thin) solid var(--color-outline);
  box-sizing: border-box;
  background-color: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow);
  padding: var(--space-sm) var(--space-gutter);
  min-height: var(--touch-md);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-body);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--duration-fast) ease,
    box-shadow var(--duration-fast) ease;
}

/* hover 悬停（#131 触屏防护：包 hover-capable 媒体查询，触屏无粘性 hover） */
@media (hover: hover) {
  .star-option:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 var(--shadow-md) 0 var(--color-surface-shadow);
  }
}

/* 不可用态（答后其余项变淡：凹陷槽底 + 次级文字，不用整体透明度保小字对比度） */
.star-option:disabled {
  background-color: var(--color-surface-dim);
  color: var(--color-text-secondary);
  border-color: var(--color-outline);
  box-shadow: none;
  cursor: not-allowed;
}

/* 结果态置于不可用态之后并提级特异性（组件化回归修复，2026-09-08）：答后整题禁用锁定，
   选中项以对/错结果身份呈现、不变淡——禁用变淡只落未选中的其余项（原 Quiz 页级联语义直译）。
   答对高亮 / 揭晓正确答案（同貌，#146 星光金体系，不引入绿色）：金填充 + 深金描边 + 深蓝字（明度 + 色相双通道） */
.star-option.star-option--correct,
.star-option.star-option--reveal {
  background-color: var(--color-go);
  border-color: var(--color-go-shadow);
  color: var(--color-on-go);
  font-weight: 700;
  box-shadow: 0 var(--shadow-sm) 0 var(--color-go-shadow);
}

/* 选中错项：暖红暗槽底 + 亮红描边（明度 + 色相双通道） */
.star-option.star-option--wrong {
  background-color: var(--color-error-container);
  border-color: var(--color-warm);
  color: var(--color-error);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-error-shadow);
}

/* #158 R-宽档控件封顶：宽度上限是控件固有属性，随组件化迁入自身样式（StarButtonStandard 同款先例，
   原 components.css 600 媒体块 option 系清单项退役）；仅 ≥600 视口生效，手机档渲染零变化。
   等宽修复（2026-09-09）：button 块级化后仍是内容收缩宽、auto 边距又压掉 flex stretch——
   各选项按文案长短各自定宽。显式 width: 100% 使封顶前一律满宽（两列 grid 下填满所在列，同列等宽） */
@media (min-width: 600px) {
  .star-option {
    display: block;
    width: 100%;
    max-width: var(--control-max-width);
    margin-inline: auto;
  }
}
</style>
