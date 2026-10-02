<script setup lang="ts">
// CampAvatar（#197 阵营头像升 registry；自 Proposals.vue 内联 defineComponent 原样搬家，接口不变、视觉零变化，
// 视觉真相源 = probe #194 第 5 节）：孩子 = 发梢卷 + 点点眼 + 微笑，家长 = 弧发 + 圆框眼镜 + 鼻梁镜腿 + 微笑；
// 底 --color-secondary、描边 --color-on-secondary。传 label 时 role=img（无障碍名由调用方传），
// 无 label 即 aria-hidden（mini 用法默认此态）。尺寸档：默认 44（touch-sm）、mini 24（touch-xs）——
// 调用方以 mini 修饰类降档（既有类名照搬，不自创新档）。
withDefaults(
  defineProps<{
    kind: 'child' | 'adult'
    label?: string
  }>(),
  {
    label: '',
  },
)

const stroke = 'var(--color-on-secondary)'
</script>

<template>
  <svg
    class="camp-avatar"
    viewBox="0 0 40 40"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <circle cx="20" cy="20" r="19" fill="var(--color-secondary)" />
    <template v-if="kind === 'child'">
      <path d="M20 6c4.5-3 7 1 3.5 3.5" fill="none" :stroke="stroke" stroke-width="2" stroke-linecap="round" />
      <circle cx="14.5" cy="19" r="1.9" :fill="stroke" />
      <circle cx="25.5" cy="19" r="1.9" :fill="stroke" />
      <path d="M14 25q6 5 12 0" fill="none" :stroke="stroke" stroke-width="2" stroke-linecap="round" />
    </template>
    <template v-else>
      <path d="M7.5 15Q20 2.5 32.5 15" fill="none" :stroke="stroke" stroke-width="2" stroke-linecap="round" />
      <circle cx="14.5" cy="19.5" r="3.6" fill="none" :stroke="stroke" stroke-width="2" />
      <circle cx="25.5" cy="19.5" r="3.6" fill="none" :stroke="stroke" stroke-width="2" />
      <path
        d="M18.1 19.5h3.8M8.5 18.5 6 17.5M31.5 18.5 34 17.5"
        :stroke="stroke"
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path d="M15 27q5 4 10 0" fill="none" :stroke="stroke" stroke-width="2" stroke-linecap="round" />
    </template>
  </svg>
</template>

<style scoped>
/* 尺寸档（自 Proposals.vue 随组件迁入，令牌原样）：默认 44 触控档，flex none 防挤压 */
.camp-avatar {
  width: var(--touch-sm);
  height: var(--touch-sm);
  flex: none;
}

/* mini 24 档：调用方加 mini 修饰类降档（类名沿用既有约定） */
.camp-avatar--mini {
  width: var(--touch-xs);
  height: var(--touch-xs);
}
</style>
