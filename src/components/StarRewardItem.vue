<script setup lang="ts">
// StarRewardItem（#202 C- 组件卡）：奖品行受控元组件——组件只按 locked 渲染两态，
// 余额判定与兑换动作留页面（受控边界，ADR-0008：组件只管渲染，判定留页面）。
// 视觉真相源 = probe #194 第 6 节直译。内部组装禁止自绘：不足提示 = StarChip ghost × sm、
// 价签星 = StarGlyph sm、兑换钮 = StarButtonStandard primary × small、容器 = star-container + 圆角 xl 覆写；
// 价格展示 probe 定稿 = 星形 + 金色文案，非边框 pill（#152 G9 价签 pill 随本组件化退役）。
import StarButtonStandard from './StarButtonStandard.vue'
import StarChip from './StarChip.vue'
import StarGlyph from './StarGlyph.vue'
import { copy } from '../copy'

withDefaults(
  defineProps<{
    /** 奖品名称（页面判定后传入，组件不持文案） */
    name: string
    /** 图标（#299 兑换链路）：页面传入（无 emoji 兑换项由页面兜底 🎁）；不传零元素布局不变（同 StarProposalCardShell 口径） */
    emoji?: string
    /** 价格（颗数，组件以 copy.redeem.price 渲染「N 颗星」） */
    price: number
    /** 锁态（余额不足）：surface-dim 底 + 名称转次级 + 兑换钮禁用 + 不足提示 chip */
    locked?: boolean
    /** 不足提示差值（price - 余额）：判定留页面，锁定态传入才渲染「还差 N 颗」（#202 Spec 缺口保守落地，票面未定义该 prop） */
    shortfall?: number
  }>(),
  {
    emoji: undefined,
    locked: false,
    shortfall: undefined,
  },
)

const emit = defineEmits<{ redeem: [] }>()
</script>

<template>
  <li class="star-reward-item star-container" :class="{ 'is-locked': locked }">
    <div class="star-reward-info">
      <div class="star-reward-title">
        <!-- #299 图标：emoji 传值时与名称同行前置（aria-hidden 装饰，语义归名称文本）；不传零元素布局不变 -->
        <span v-if="emoji" class="star-reward-emoji" aria-hidden="true">{{ emoji }}</span>
        <span class="star-reward-name">{{ name }}</span>
        <!-- 余额不足提示（C4Re1 起走 StarChip ghost × sm；差值由页面传入，组件不持余额逻辑） -->
        <StarChip v-if="locked && shortfall !== undefined" variant="ghost" size="sm">{{ copy.redeem.shortage(shortfall) }}</StarChip>
      </div>
      <!-- 价格展示（probe #194 第 6 节定稿）：StarGlyph sm + 金色文案，非边框 pill -->
      <span class="star-reward-price">
        <StarGlyph size="sm" />
        <span>{{ copy.redeem.price(price) }}</span>
      </span>
    </div>
    <StarButtonStandard variant="primary" size="small" class="star-reward-redeem" :disabled="locked" @click="emit('redeem')">
      {{ copy.redeem.redeemBtn }}
    </StarButtonStandard>
  </li>
</template>

<style scoped>
/* ===== 奖品行骨架（probe #194 第 6 节直译）：容器视觉由全局 star-container 样式集提供
   （#152 起叠加唇边极淡光 --glow-edge）；圆角升档 xl 20（探针 reward-card 档）；
   padding 保持 sm+gutter 覆写（#58 保守不改密度）===== */
.star-reward-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-gutter);
  border-radius: var(--radius-xl);
}

/* #202 锁态（probe 第 6 节直译）：暗槽底 + 名称次级色表达淡化（不降整体透明度，小字保 ≥ 4.5:1）；
   兑换按钮置灰由 StarButtonStandard disabled 态（去饱和 + 降透明 + not-allowed）接管（R15 设计规则 8） */
.star-reward-item.is-locked {
  background-color: var(--color-surface-dim);
}

.star-reward-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.star-reward-title {
  display: flex;
  align-items: center;
  gap: var(--space-base);
}

.star-reward-name {
  font-size: var(--font-size-body);
  font-weight: 600;
}

/* 图标（#299）：emoji 与名称同行前置（令牌口径同 StarProposalCardShell.proposal-emoji）；
   不传 emoji 时仅名称独占，行内布局退化为原单元素形态 */
.star-reward-emoji {
  font-size: var(--font-size-body-lg);
  line-height: 1.2;
  flex-shrink: 0;
}

.star-reward-item.is-locked .star-reward-name {
  color: var(--color-text-secondary);
}

/* 价格展示（probe 第 6 节直译）：num 字号 + 800 字重 + 星光金 + info 字距；星形本体/尺寸/微光归 StarGlyph */
.star-reward-price {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-num);
  font-weight: 800;
  letter-spacing: var(--letter-spacing-info);
  color: var(--color-star);
}

/* #158 R-宽档控件封顶：整行内容卡（原 components.css 600 媒体块 reward-item 清单项随组件化退役，
   StarOptionRow / StarButtonStandard 同款先例）；容器 flex 布局照常胜出（原页内 scoped 同理），
   封顶只承载 max-width + 居中；仅 ≥600 视口生效，手机档渲染零变化。
   等宽修复（2026-09-09）：flex 宿主下 cross 轴 auto 边距压掉 stretch，行卡退回按内容定宽——
   显式 width: 100% + border-box（本卡自带 padding）使各行封顶前满宽、封顶后统一 480 居中 */
@media (min-width: 600px) {
  .star-reward-item {
    box-sizing: border-box;
    width: 100%;
    max-width: var(--control-max-width);
    margin-inline: auto;
  }
}
</style>
