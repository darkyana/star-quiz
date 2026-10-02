<script setup lang="ts">
// 出题指令生成页（#136）：家长填三参数（孩子水平 / 出题内容 / 题数）→ 显式点「生成指令」→
// 用构建时打包的模板（docs/question-tool/prompt.md，?raw 单一真相源）生成完整指令 →
// 只读文本框展示 + 一键复制（成功 toast / 失败聚焦全选手动复制）。
// 截取 / 校验 / 占位符替换收口纯函数模块 questionPrompt.ts，页面只做交互编排。
// 校验交互（#141）：三输入框失焦即逐字段校验、错误就近显示在各自字段旁；任一字段报错 →
// 「生成指令」禁用；点生成时未失焦字段视同失焦做一次全量补校验（多字段错误可并存，各一行）。
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarToastStandard from '../components/StarToastStandard.vue'
import { copy } from '../copy'
import { IS_MINITOOL } from '../minitool'
import {
  buildQuestionPrompt,
  CONTENT_MAX,
  COUNT_DEFAULT,
  COUNT_MAX,
  COUNT_MIN,
  LEVEL_MAX,
} from '../utils/questionPrompt'

const router = useRouter()
const route = useRoute()

const level = ref('')
const content = ref('')
// type=number 的 v-model 会被 Vue 自动转型为 number（空值/非数字仍为字符串），统一按 string 持有、调用边界归一化
const countText = ref<string | number>(String(COUNT_DEFAULT))

// ===== 字段级校验（#141）：错误就近显示，空串 = 无错；文案集中 copy.ts =====
const levelError = ref('')
const contentError = ref('')
const countError = ref('')

/** 失焦校验单字段（规则与 questionPrompt.ts 一致：trim 判空 / ≤上限；题数 20–600 整数），通过则清错 */
function checkLevel(): void {
  const trimmed = level.value.trim()
  if (trimmed === '') levelError.value = copy.parent.questionPrompt.error.levelRequired
  else if (trimmed.length > LEVEL_MAX) levelError.value = copy.parent.questionPrompt.error.levelTooLong
  else levelError.value = ''
}

function checkContent(): void {
  const trimmed = content.value.trim()
  // #138：留空合法（材料直发外部 AI 场景），仅填写态限长
  if (trimmed.length > CONTENT_MAX) contentError.value = copy.parent.questionPrompt.error.contentTooLong
  else contentError.value = ''
}

function checkCount(): void {
  const trimmed = String(countText.value).trim()
  if (trimmed === '') countError.value = copy.parent.questionPrompt.error.countRequired
  else if (!/^\d+$/.test(trimmed) || Number(trimmed) < COUNT_MIN || Number(trimmed) > COUNT_MAX)
    countError.value = copy.parent.questionPrompt.error.countInvalid
  else countError.value = ''
}

/** 任一字段处于报错态 → 生成按钮禁用（未触碰字段无错可点，点击时全量补校验兜底） */
const hasFieldError = computed(
  () => levelError.value !== '' || contentError.value !== '' || countError.value !== '',
)

/** 非字段级错误的全局兜底（#141 后仅模板资产损坏一种；生成成功即清空） */
const formError = ref('')

/** 生成结果：非空才渲染只读文本框 + 复制按钮（显式生成，非实时预览） */
const generatedPrompt = ref('')

/** 模板资产损坏文案（文案集中 copy.ts） */
const TEMPLATE_BROKEN_TEXT: string = copy.parent.questionPrompt.templateBroken

// ===== #311 复制后就地接住：点「复制指令」后本页出现后续步骤指引 + 直达导入入口 =====
/** 已点过复制（成功 / 手动复制路径都算）：控制后续步骤指引块的渲染，直到重新生成 */
const copied = ref(false)

/** 直达导入：跳家长页数据管理弹窗的粘贴导入视图（?import=paste 由 Parent 页识别自动打开；未配对设备同口径可用） */
function goImport(): void {
  void router.push({ path: '/parent', query: { import: 'paste' } })
}

function onGenerate(): void {
  // 全量补校验（未失焦字段视同失焦）：有错就地补齐后禁止生成
  checkLevel()
  checkContent()
  checkCount()
  if (hasFieldError.value) {
    formError.value = ''
    generatedPrompt.value = ''
    return
  }
  const result = buildQuestionPrompt(level.value, content.value, String(countText.value))
  if (!result.ok) {
    // 字段校验已全过，失败原因只剩模板资产损坏 → 全局兜底提示
    formError.value = TEMPLATE_BROKEN_TEXT
    generatedPrompt.value = ''
    return
  }
  formError.value = ''
  generatedPrompt.value = result.prompt
  // #311：重新生成 = 新一轮出题流程，上一轮的「回来去哪导入」指引随之收起
  copied.value = false
}

// ===== #311 复制后就地接住：点「复制指令」后本页出现后续步骤指引 + 直达导入入口 =====

// ===== 复制（标准 Clipboard API）：成功 toast（#139 T-Toast 组件，2400ms 自动消失由组件承担）=====
/** 复制成功 toast 文案（@expired 清空；失败分支清空 = 立即隐藏） */
const toastText = ref('')

/** 复制失败提示（role=alert；成功或再次生成时清空） */
const copyError = ref('')

const promptBox = ref<HTMLTextAreaElement | null>(null)

async function onCopy(): Promise<void> {
  // #311：点了复制（无论走哪条路径）就就地接住——指引块立即出现，家长离开网站前已知道回来去哪
  copied.value = true
  // 小工具构建：容器禁 Clipboard API（禁用能力清单），直接走手动复制路径（提示 + 聚焦全选文本框）
  if (IS_MINITOOL) {
    copyError.value = copy.parent.questionPrompt.copyFail
    toastText.value = ''
    promptBox.value?.focus()
    promptBox.value?.select()
    return
  }
  try {
    await navigator.clipboard.writeText(generatedPrompt.value)
    copyError.value = ''
    toastText.value = copy.parent.questionPrompt.copyToast
  } catch {
    // 失败 → 提示 + 清空 toast 文案（立即隐藏）+ 聚焦全选文本框，方便长按手动复制
    copyError.value = copy.parent.questionPrompt.copyFail
    toastText.value = ''
    promptBox.value?.focus()
    promptBox.value?.select()
  }
}

function goBack(): void {
  // Only the explicit internal source changes the default; never navigate to a supplied URL.
  void router.push(route.query.from === 'parent-guide' ? '/parent-guide' : '/parent')
}
</script>

<template>
  <div data-page="question-prompt" class="page question-prompt-page">
    <!-- 顶栏（StarNavBar 三区：返回 + 标题） -->
    <StarNavBar :title="copy.parent.questionPrompt.pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="back-btn" @click="goBack">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <main class="question-prompt-main page-scroll">
      <p class="question-prompt-intro">{{ copy.parent.questionPrompt.intro }}</p>

      <!-- 参数表单（容器视觉归全局 star-container 样式集；#141 失焦逐字段校验，错误就近显示在各字段内） -->
      <div class="prompt-form star-container">
        <div class="prompt-field" data-field="level">
          <label class="prompt-label" for="prompt-level">{{ copy.parent.questionPrompt.levelLabel }}</label>
          <input
            id="prompt-level"
            v-model="level"
            type="text"
            class="prompt-input"
            :placeholder="copy.parent.questionPrompt.levelPlaceholder"
            @blur="checkLevel"
          />
          <p v-if="levelError" class="prompt-error" role="alert">{{ levelError }}</p>
        </div>
        <div class="prompt-field" data-field="content">
          <label class="prompt-label" for="prompt-content">{{ copy.parent.questionPrompt.contentLabel }}</label>
          <textarea id="prompt-content" v-model="content" rows="3" class="prompt-textarea" :placeholder="copy.parent.questionPrompt.contentPlaceholder" @blur="checkContent"></textarea>
          <p v-if="contentError" class="prompt-error" role="alert">{{ contentError }}</p>
        </div>
        <div class="prompt-field" data-field="count">
          <label class="prompt-label" for="prompt-count">{{ copy.parent.questionPrompt.countLabel }}</label>
          <input id="prompt-count" v-model="countText" type="number" :min="COUNT_MIN" :max="COUNT_MAX" step="1" inputmode="numeric" class="prompt-input" @blur="checkCount" />
          <!-- 建议量提示（2026-09-09）：就近常显在题数输入框下；与校验错误并存（错误行 role=alert 在后） -->
          <p class="prompt-hint">{{ copy.parent.questionPrompt.countHint }}</p>
          <p v-if="countError" class="prompt-error" role="alert">{{ countError }}</p>
        </div>
        <p v-if="formError" class="prompt-error" role="alert">{{ formError }}</p>
        <StarButtonStandard variant="primary" size="large" :edge-inset="false" :disabled="hasFieldError" class="btn-generate" @click="onGenerate">{{ copy.parent.questionPrompt.generateBtn }}</StarButtonStandard>
      </div>

      <!-- 生成结果：生成成功才渲染（只读文本框 + 复制按钮） -->
      <div v-if="generatedPrompt" class="prompt-result star-container">
        <textarea
          ref="promptBox"
          v-model="generatedPrompt"
          rows="12"
          readonly
          class="prompt-output"
          :aria-label="copy.parent.questionPrompt.outputLabel"
        ></textarea>
        <p v-if="copyError" class="prompt-error" role="alert">{{ copyError }}</p>
        <StarButtonStandard variant="primary" size="large" :edge-inset="false" class="btn-copy" @click="onCopy">{{ copy.parent.questionPrompt.copyBtn }}</StarButtonStandard>
        <!-- #311 复制后就地接住：后续步骤指引 + 直达粘贴导入入口（重新生成即收起） -->
        <div v-if="copied" class="prompt-next-steps" data-next-steps>
          <p class="next-steps-text">{{ copy.parent.questionPrompt.nextStepHint }}</p>
          <StarButtonStandard variant="standard" size="large" :edge-inset="false" class="btn-go-import" @click="goImport">{{ copy.parent.questionPrompt.goImportBtn }}</StarButtonStandard>
        </div>
      </div>
    </main>

    <!-- 复制成功 toast（#139 T-Toast 组件，沿 Prizes/Redeem 页同款行为） -->
    <StarToastStandard :message="toastText" @expired="toastText = ''" />
  </div>
</template>

<style scoped>
/* 一屏展示（ADR-0001）：内容区唯一滚动容器，滚动四件套由全局 page-scroll 样式集提供；
   底 padding 给滚动到底时的唇边阴影留呼吸位（沿 Redeem / Prizes 惯例） */
.question-prompt-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-bottom: var(--space-md);
}

.question-prompt-intro {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  line-height: 1.5;
  text-align: center;
  color: var(--color-text-secondary);
}

/* 表单与结果区：容器视觉归全局 star-container 样式集，此处仅排布 */
.prompt-form,
.prompt-result {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
}

.prompt-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.prompt-label {
  font-size: var(--font-size-label);
  font-weight: 600;
  color: var(--color-text);
}

/* 输入控件（#136 三层清点：components.css 无 input/textarea 样式集 → 单页私有 scoped；
   颜色/字号/圆角/描边全令牌引用，零硬编码） */
.prompt-input,
.prompt-textarea,
.prompt-output {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: var(--space-base) var(--space-sm);
  font-family: inherit;
  font-size: var(--font-size-body);
  line-height: 1.5;
  color: var(--color-text);
  background-color: var(--color-surface-dim);
  border: var(--border-thin) solid var(--color-outline);
  border-radius: var(--radius-md);
}

.prompt-input:focus,
.prompt-textarea:focus,
.prompt-output:focus {
  outline: none;
  border-color: var(--color-primary);
}

.prompt-textarea,
.prompt-output {
  resize: vertical;
}

.prompt-error {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 600;
  color: var(--color-error);
}

/* #311 复制后就地接住：指引块与复制按钮间留一档间距，说明小字走次级色（中性引导非报错） */
.prompt-next-steps {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.next-steps-text {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

/* 建议量提示（2026-09-09）：中性次级小字（区别于错误行 error 色 600 字重），全令牌引用 */
.prompt-hint {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  color: var(--color-text-secondary);
}
</style>
