<script setup lang="ts">
// 单组件展示页（定义单 §6 框架）：按路由 :componentKey 查注册表，showcase 平铺渲染组件实例
// 未知 key 重定向列表页；每格标注形态与参数
// openTrigger 交互（C2 起通用能力）：弹窗类全屏组件经「打开」触发器 v-if 展开，confirm/cancel 事件反馈到格内
// slots 渲染（C3 起通用能力）：showcase 条目带 slots 字段时，以 h() 渲染实例并注入具名槽位，槽位内可点元素经 ctx.notify 格内提示
import { computed, h, reactive } from 'vue'
import type { VNode } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { componentRegistry, type ShowcaseCase, type ShowcaseSlotContext } from '../components/registry'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarNavBar from '../components/StarNavBar.vue'
import { copy } from '../copy'

const route = useRoute()
const router = useRouter()

const entry = computed(() => componentRegistry.find((e) => e.key === route.params.componentKey))

if (!entry.value) {
  void router.replace('/components')
}

const open = reactive<Record<string, boolean>>({})
const feedback = reactive<Record<string, string>>({})
// interactive 展示格（#183）：每格独立接 v-model，点击 emit update:modelValue 即切换选中态
const modelValues = reactive<Record<string, string>>({})

/** interactive 格 v-model 更新：写回格内状态，选中段随之切换 */
function onModelUpdate(item: ShowcaseCase, value: unknown): void {
  modelValues[item.label] = value as string
}

function openModal(item: ShowcaseCase): void {
  open[item.label] = true
}

/** confirm / cancel / close 事件：格内提示 + 关闭弹窗（展示不真的执行动作） */
function onModalEvent(item: ShowcaseCase, event: 'confirm' | 'cancel' | 'close'): void {
  feedback[item.label] = copy.showcase.eventTriggered(event)
  open[item.label] = false
}

/** openTrigger 实例渲染（#59 起支持 slots）：v-if 展开弹窗实例，有 slots 时注入具名槽位（槽位内可点元素经 ctx.notify 格内提示）；confirm / cancel / close 事件反馈到格内并关闭 */
function renderOpenCase(item: ShowcaseCase): VNode {
  const entryVal = entry.value
  if (!entryVal) {
    // 模板 v-if="entry" 已保证到达渲染时 entry 非空；此处仅兜底类型守卫
    return h('div')
  }
  const events = {
    onConfirm: () => onModalEvent(item, 'confirm'),
    onCancel: () => onModalEvent(item, 'cancel'),
    onClose: () => onModalEvent(item, 'close'),
  }
  if (!item.slots) {
    // 无 slots：不注入默认槽位（弹窗类组件默认槽位 = 自定义内容区，勿混入组件名占位文本）
    return h(entryVal.component, { ...item.props, ...events })
  }
  const ctx: ShowcaseSlotContext = {
    notify: (message: string) => {
      feedback[item.label] = message
    },
  }
  const slotFns: Record<string, () => VNode[]> = {}
  for (const [name, factory] of Object.entries(item.slots)) {
    slotFns[name] = () => [factory(ctx)].flat()
  }
  return h(entryVal.component, { ...item.props, ...events }, slotFns)
}

/** 渲染 showcase 实例：无 slots 时默认 slot 注入组件名（保持 C1 既有行为）；有 slots 时按工厂注入具名槽位（C3 起） */
function renderCase(item: ShowcaseCase): VNode {
  const entryVal = entry.value
  if (!entryVal) {
    // 模板 v-if="entry" 已保证到达渲染时 entry 非空；此处仅兜底类型守卫
    return h('div')
  }
  const comp = entryVal.component
  const ctx: ShowcaseSlotContext = {
    notify: (message: string) => {
      feedback[item.label] = message
    },
  }
  if (item.slots) {
    const slotFns: Record<string, () => VNode[]> = {}
    for (const [name, factory] of Object.entries(item.slots)) {
      slotFns[name] = () => [factory(ctx)].flat()
    }
    return h(comp, item.props, slotFns)
  }
  if (item.interactive) {
    // interactive 格（#183）：modelValue 取格内状态（初值回退 props），点击切换选中段
    const current = modelValues[item.label] ?? item.props.modelValue
    return h(comp, { ...item.props, modelValue: current, 'onUpdate:modelValue': (value: unknown) => onModelUpdate(item, value) }, () => entryVal.name)
  }
  return h(comp, item.props, () => entryVal.name)
}

/** 返回组件列表页（#207）：确定性落点 push（沿无效 key 重定向 replace('/components') 惯例），不再回跳家长页 */
function goBack(): void {
  void router.push('/components')
}
</script>

<template>
  <div data-page="component-showcase" class="page showcase-page">
    <!-- 顶栏（C3Re1：StarNavBar 左返回钮 + 标题；header-spacer 占位收归组件） -->
    <StarNavBar :title="entry?.name ?? ''">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <!-- 代码名小字（#214）：组件文件名展示在导航栏下方 -->
    <p v-if="entry" class="showcase-file">{{ entry.file }}</p>

    <main v-if="entry" class="showcase-main page-scroll">
      <div
        v-for="item in entry.showcase"
        :key="item.label"
        class="showcase-cell"
        :class="{ 'showcase-cell--full': item.fullWidth }"
      >
        <span class="showcase-label">{{ item.label }}</span>
        <template v-if="item.openTrigger">
          <StarButtonStandard type="button" size="small" @click="openModal(item)">{{ copy.showcase.open }}</StarButtonStandard>
          <component v-if="open[item.label]" :is="renderOpenCase(item)"></component>
        </template>
        <div v-else class="showcase-render">
          <component :is="renderCase(item)" />
        </div>
        <!-- 格内反馈（openTrigger 弹窗事件 / slots 槽位点击提示共用） -->
        <span v-if="feedback[item.label]" class="showcase-feedback">{{ feedback[item.label] }}</span>
      </div>
      <!-- 组件级专属展示区（#217）：平铺展示格下方，标题 + 实例 + 说明文字 -->
      <div v-if="entry.showcaseSection" class="showcase-section">
        <span class="showcase-label">{{ entry.showcaseSection.title }}</span>
        <div class="showcase-section-render">
          <component :is="renderCase(item)" v-for="item in entry.showcaseSection.items" :key="item.label" />
        </div>
        <span class="showcase-section-note">{{ entry.showcaseSection.note }}</span>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 一屏展示批2（#52）：内容区唯一滚动容器（grid 布局同样承载滚动语义），滚动四件套已收编全局 page-scroll 样式集（components.css，#68） */
.showcase-main {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-sm);
  padding-top: var(--space-md);
  /* 滚动到底时末行格卡 4px 唇边留呼吸位 */
  padding-bottom: var(--space-md);
}

/* 代码名小字（#214）：导航栏下方的组件文件名说明 */
.showcase-file {
  margin: var(--space-md) var(--space-gutter) 0;
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}

/* 每格：浮层卡语言 + 底部唇边，与全局深度体系一致 */
.showcase-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-gutter);
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow);
}

.showcase-label {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
  text-align: center;
}

/* 满宽格（issue #9）：导航栏等满宽组件跨全宽渲染，避免两列挤压 */
.showcase-cell--full {
  grid-column: 1 / -1;
}

.showcase-feedback {
  font-size: var(--font-size-label);
  color: var(--color-primary);
  text-align: center;
}

/* 槽位渲染实例容器（C3 起）：block 容器内组件根（grid header）自动撑满格宽，视觉与页面内一致 */
.showcase-render {
  width: 100%;
}

/* 组件级专属展示区（#217）：跨全宽卡，标题/说明沿用格标注小字语言 */
.showcase-section {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-gutter);
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: 0 var(--shadow-sm) 0 var(--color-surface-shadow);
}

.showcase-section-render {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-sm);
}

.showcase-section-note {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
  text-align: center;
}
</style>
