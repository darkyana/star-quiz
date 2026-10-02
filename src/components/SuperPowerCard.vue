<script setup lang="ts">
// 家长超能力卡（#266 收敛：会话级总开关删除，卡内唯一元素为常驻「超能力奖励」按钮——无开关、无状态圆点、无开启态）；
// 卡骨架（star-container 卡 + 标题 + 一句描述 + 按钮）沿既有 section-card 形态，样式与家长页其他卡一致。
// 奖励弹窗（沿 #77 既有形态）：StarModalStandard 默认槽两字段表单（星数 1–99 + 原因必填）+ actions 槽取消/确认；
// 确认前校验（非法则确认钮不可用，沿表单惯例）；点确认 → 二次确认（星数 + 原因摘要）直接在弹窗正文呈现，
// 再确认即 grant 真实落账（无撤销路径），成功后关弹窗。
import { computed, ref } from 'vue'
import { grant } from '../composables/useStarData'
import StarButtonStandard from './StarButtonStandard.vue'
import StarModalStandard from './StarModalStandard.vue'
import { copy } from '../copy'

/** 奖励弹窗显隐（v-if 控制，沿 StarModalStandard 打开/关闭惯例） */
const showRewardModal = ref(false)
/** 二次确认阶段快照（null = 表单阶段；星数 + 原因在确认瞬间冻结） */
const pending = ref<{ amount: number; reason: string } | null>(null)

const amountInput = ref('')
const reasonInput = ref('')

/** 表单校验（与 grant 模块内校验同规则）：星数 1–99 正整数 + 原因 trim 非空 */
const formValid = computed(() => {
  const amount = Number(amountInput.value)
  return Number.isInteger(amount) && amount >= 1 && amount <= 99 && reasonInput.value.trim() !== ''
})

function openReward(): void {
  showRewardModal.value = true
}

/** 关闭奖励弹窗：取消 / 蒙层点击 / 落账成功共用；表单与确认态复位 */
function closeReward(): void {
  showRewardModal.value = false
  pending.value = null
  amountInput.value = ''
  reasonInput.value = ''
}

/** 表单阶段确认：校验通过 → 冻结星数 + 原因进入二次确认（正文直接切换，弹窗不关） */
function askConfirm(): void {
  if (!formValid.value) return
  pending.value = { amount: Number(amountInput.value), reason: reasonInput.value.trim() }
}

/** actions 槽确认按钮：表单阶段 → 进二次确认；二次确认阶段 → grant 落账，成功关弹窗 */
function onConfirm(): void {
  if (pending.value === null) {
    askConfirm()
    return
  }
  if (grant({ amount: pending.value.amount, reason: pending.value.reason })) closeReward()
}
</script>

<template>
  <section class="star-container super-power-card">
    <div class="card-info">
      <h2 class="card-title">{{ copy.superPower.cardTitle }}</h2>
      <p class="card-desc">{{ copy.superPower.cardDesc }}</p>
      <!-- 卡内唯一元素：超能力奖励单按钮（常驻可用；无开关 / 无能力清单 / 无提示行） -->
      <StarButtonStandard variant="standard" size="small" class="reward-btn" @click="openReward">
        {{ copy.superPower.rewardBtn }}
      </StarButtonStandard>
    </div>
  </section>

  <!-- 超能力奖励弹窗：表单阶段（默认槽两字段）→ 确认 → 二次确认正文（星数 + 原因摘要）→ 确认落账 -->
  <StarModalStandard
    v-if="showRewardModal"
    :title="copy.superPower.rewardTitle"
    :message="pending === null ? undefined : copy.superPower.rewardConfirm(pending.amount, pending.reason)"
    @cancel="closeReward"
  >
    <form v-if="pending === null" class="reward-form" @submit.prevent="onConfirm">
      <label class="form-field">
        <span class="field-label">{{ copy.superPower.rewardAmountLabel }}</span>
        <input v-model="amountInput" type="number" min="1" max="99" class="form-input form-input--num" />
      </label>
      <label class="form-field">
        <span class="field-label">{{ copy.superPower.rewardReasonLabel }}</span>
        <input v-model="reasonInput" type="text" class="form-input" />
      </label>
    </form>
    <template #actions>
      <StarButtonStandard variant="standard" size="small" @click="closeReward">{{ copy.superPower.cancel }}</StarButtonStandard>
      <StarButtonStandard
        variant="primary"
        size="small"
        :disabled="pending === null && !formValid"
        @click="onConfirm"
      >
        {{ copy.superPower.confirm }}
      </StarButtonStandard>
    </template>
  </StarModalStandard>
</template>

<style scoped>
/* 卡片骨架：背景/描边/圆角/内边距由全局 star-container 提供，此处只留布局 */
.super-power-card {
  width: 100%;
}

.card-info {
  min-width: 0;
}

.card-title {
  margin: 0 0 var(--space-base);
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  color: var(--color-text);
}

.card-desc {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

/* 奖励按钮（上距一档与描述分隔） */
.reward-btn {
  margin-top: var(--space-sm);
}

/* 奖励表单（弹窗默认槽）：字段结构沿 ProposalEdit 表单惯例 */
.reward-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: 0 0 var(--space-md);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}

.field-label {
  font-size: var(--font-size-body);
  font-weight: 700;
  color: var(--color-text);
}

/* 等宽修复（2026-09-09）：弹窗内两输入框统一满宽（原星数 48px 固定宽与原因输入满宽不一致）；
   border-box 防 padding/描边外溢（沿 paste-input 输入控件样式集同款口径） */
.form-input {
  box-sizing: border-box;
  width: 100%;
  font-family: inherit;
  font-size: var(--font-size-body-lg);
  padding: var(--space-sm);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  color: var(--color-text);
}

.form-input--num {
  text-align: center;
}

.form-input:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
