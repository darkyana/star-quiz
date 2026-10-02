<script setup lang="ts">
// StarProposalCardShell（#203 C- 提议卡拆件，领域件 Proposals 专用）：提议卡卡壳
// star-container 底 + 头部结构（名称 / 价格行 / 右上徽章）+ 纵向间距骨架 + camps / actions 双槽。
// 视觉真相源 = probe #194 第 9 节（沟通中 / 已作废 / 已谈成三卡直译）。
// 受控红线（ADR-0008）：徽章文案与 tone、名称可点与否全由页面传入，组件不含业务判定。
// 已作废淡化按 probe 直译为「标题 + 价格文字淡化（非整卡降透明）」，由徽章 void tone 驱动。
// 价格行 = StarGlyph sm + 金色文案（copy.proposals.priceLabel，与 StarRewardItem 同款视觉语言）。
// 名称可点（家长点名称进详情）是页面判定：页面传 nameClickable 才渲染可点钮，点击 emit title-click。
import StarGlyph from './StarGlyph.vue'
import { copy } from '../copy'

withDefaults(
  defineProps<{
    /** 提议名称 */
    name: string
    /** 星形消耗（正整数），价格行文案经 copy.proposals.priceLabel 格式化 */
    price: number
    /** 提议图标（#299）：传值时渲染在名称前（aria-hidden 装饰）；不传不出现，布局不变 */
    emoji?: string
    /** 右上角状态徽章：done 金（已谈成）/ void 红（已作废）；不传即沟通中不出现 */
    badge?: { text: string; tone: 'done' | 'void' }
    /** 名称可点（家长视角详情入口；判定留页面），可点时点击 emit title-click */
    nameClickable?: boolean
  }>(),
  {
    emoji: undefined,
    badge: undefined,
    nameClickable: false,
  },
)

const emit = defineEmits<{ 'title-click': [] }>()
</script>

<template>
  <div class="star-container proposal-card" :class="{ 'is-voided': badge?.tone === 'void' }">
    <div class="card-head" :class="{ 'has-badge': badge !== undefined }">
      <!-- #299 图标行：emoji 传值时与名称同行前置（aria-hidden 装饰，语义归名称文本）；不传零元素布局不变 -->
      <div class="card-title-row">
        <span v-if="emoji" class="proposal-emoji" aria-hidden="true">{{ emoji }}</span>
        <button v-if="nameClickable" type="button" class="proposal-name is-clickable" @click="emit('title-click')">{{ name }}</button>
        <h3 v-else class="proposal-name">{{ name }}</h3>
      </div>
      <p class="proposal-price"><StarGlyph size="sm" />{{ copy.proposals.priceLabel(price) }}</p>
      <span v-if="badge" class="card-badge" :class="`is-${badge.tone}`">{{ badge.text }}</span>
    </div>
    <slot name="camps" />
    <slot name="actions" />
  </div>
</template>

<style scoped>
/* 卡壳骨架（probe #194 第 9 节直译）：容器视觉归 star-container 全局样式集，此处仅纵向布局与测试锚点；
   已作废淡化非整卡降透明，仅标题与价格文字淡化（0.45），由徽章 void tone 驱动 */
.proposal-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.proposal-card.is-voided .proposal-name,
.proposal-card.is-voided .proposal-emoji,
.proposal-card.is-voided .proposal-price {
  opacity: 0.45;
}

/* 头部：名称 + 价格行；右上角徽章绝对定位于头部 */
.card-head {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

/* 右上角徽章出现时头部右侧留位，防长名称与徽章重叠 */
.card-head.has-badge {
  padding-right: calc(var(--space-gutter) * 3);
}

.proposal-name {
  margin: 0;
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  color: var(--color-text);
  min-width: 0;
  text-align: left;
}

/* 图标行（#299）：emoji 与名称同行前置；不传 emoji 时仅名称独占，行内布局退化为原单元素形态 */
.card-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.proposal-emoji {
  font-size: var(--font-size-body-lg);
  line-height: 1.2;
  flex-shrink: 0;
}

/* 可点名称（页面传 nameClickable 才渲染）：文本钮重置 + hover 下划线提示可点 */
.proposal-name.is-clickable {
  border: 0;
  background: transparent;
  padding: 0;
  font-family: inherit;
  cursor: pointer;
}

@media (hover: hover) {
  .proposal-name.is-clickable:hover {
    text-decoration: underline;
  }
}

/* 价格行：StarGlyph sm + 金色文案（probe 定稿 inline-flex 对齐，与 StarRewardItem 同款视觉语言） */
.proposal-price {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-num);
  font-weight: 800;
  color: var(--color-star);
}

/* 右上角状态徽章（纯彩色粗体文字）：已谈成金 / 已作废红 */
.card-badge {
  position: absolute;
  top: 0;
  right: 0;
  font-size: var(--font-size-label);
  font-weight: 800;
  letter-spacing: var(--letter-spacing-title);
}

.card-badge.is-done {
  color: var(--color-go-text);
}

.card-badge.is-void {
  color: var(--color-flag-stroke);
}
</style>
