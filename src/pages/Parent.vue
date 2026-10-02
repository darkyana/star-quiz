<script setup lang="ts">
// 家长页（Spec REQ-1 / REQ-3 / REQ-4 / 设计方案 §3-§7）
// 标题「家长页」+ 返回孩子端（无确认）+ 双管理入口按钮；
// 数据管理弹窗（题库+兑换项，数据包 A）/ 流水管理弹窗（星星流水，数据包 B）：导出 + 导入（原子拒绝 + 二次确认 + 全量覆盖）。
// 无可见入口（B1）：仅首页页脚「配置」链接可达（C3Re1 起星星手势删除）；#/parent URL 直访沿用 R1/R2 契约不加守卫。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LearningExport, EconomyExport } from '../types'
import { questions, questionResults } from '../composables/useLearningData'
import { downloadDataExport, downloadLedgerExport } from '../composables/useExport'
// 导入编排收口进 useImport（架构评审 20260829 候选 2）：页面只留浏览器交互（读文件 / 弹窗 / 提示），校验与落库归模块
// #212 粘贴导入：剥壳校验收口契约层 validateLearningPasteImport（页面只取 textarea 文本），落库复用现有编排零改动
import {
  validateLearningImport,
  validateEconomyImport,
  validateLearningPasteImport,
  applyLearningImport,
  applyEconomyImport,
  importErrorText,
  type LearningImportMode,
} from '../composables/useImport'
// #172 未配对设备导入确认前自动全量备份（已配对不弹文件），按配对状态分流收口在 useExport
import { autoBackupBeforeImport } from '../composables/useExport'
import { IS_MINITOOL } from '../minitool'
import { reportOnboarding } from '../cloud/onboardingMetrics'
import { useDeviceRole } from '../composables/useDeviceRole'
import { useEntryVisibilityStateRef, writeEntryVisibilityValue, refreshEntryVisibilityStates, entryRemainingText, type EntryVisibilityState } from '../composables/useEntryVisibility'
import { useTriviaStarToggleRef, writeTriviaStarEarns } from '../composables/useTriviaStarToggle'
import { TRIVIA_ENTRY_ID, hasStarRule, triviaSetRef } from '../data/trivia-set'
import { GAME_SLOT } from '../data/playable-games'
import SuperPowerCard from '../components/SuperPowerCard.vue'
import StarNavBar from '../components/StarNavBar.vue'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarSegmentTabs from '../components/StarSegmentTabs.vue'
import StarModalStandard from '../components/StarModalStandard.vue'
import { copy } from '../copy'

const router = useRouter()
const route = useRoute()
const deviceRole = useDeviceRole()

type ModalKind = 'data' | 'ledger'

const activeModal = ref<ModalKind | null>(null)
const confirmState = ref<ModalKind | null>(null)
const pendingData = ref<LearningExport | null>(null)
const pendingLedger = ref<EconomyExport | null>(null)
const importError = ref('')
const importSuccess = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
// #212 粘贴视图（仅数据管理弹窗）：pasteView = 弹窗内视图开关，pasteText = 粘贴原文草稿（不持久化，返回/成功即清）
const pasteView = ref(false)
const pasteText = ref('')

// #311 出题指令 → 导入闭环接住：出题指令页「去导入题目」带 ?import=paste 直达——
// 进页自动开数据管理弹窗并落在粘贴导入视图（家长从外部 AI 回来不用记路径）；
// 消费后 replace 清掉 query，刷新/返回不再重复弹。守卫只拦 child 角色，未配对设备同口径可用。
if (route.query.import === 'paste') {
  activeModal.value = 'data'
  pasteView.value = true
  void router.replace({ path: '/parent' })
}

// R21（REQ-R21-1-1）：数据确认弹窗正文题数 N = pendingData.questionPool.length
const pendingQuestionCount = computed(() => pendingData.value?.questionPool.length ?? 0)

// R36（REQ-R36-6）：流水确认弹窗正文计数 M = 文件兑换项数、K = 文件流水条数
const pendingRewardCount = computed(() => pendingLedger.value?.rewards.length ?? 0)
const pendingLedgerCount = computed(() => pendingLedger.value?.starLedger.length ?? 0)
// R32（Spec D6 有意变更 / 自主决策 #6）：新增提议计数 P = 文件提议条数（EconomyExport.proposals 空位数组；
// 取数用 (... ?? []).length 惯用写法，避免 R36 验收守卫禁扫的 proposals 数组直读元素访问模式）
const pendingProposalCount = computed(() => (pendingLedger.value?.proposals ?? []).length)

function goBackChild(): void {
  void router.push('/')
}

// #38 需求 1：题库情况卡片（onMounted 计算，与现有 refresh 模式一致）
const questionSummary = ref('')
const lastAnsweredDate = ref<string | undefined>(undefined)
const freshQuestionCount = ref(0)
const totalQuestionCount = ref(0)

onMounted(() => {
  const all = questions()
  const results = questionResults()
  totalQuestionCount.value = all.length
  // 「新题」定义（老板拍板）：questionResults 中无记录的题（从未答过）
  freshQuestionCount.value = all.filter((q) => !(q.id in results)).length
  // 最近答题：所有记录的最大 timestamp（ISO 8601 字符串）→「X月X日」（无前导零）
  let maxTs = 0
  for (const list of Object.values(results)) {
    for (const r of list) {
      const t = Date.parse(r.timestamp)
      if (t > maxTs) maxTs = t
    }
  }
  if (maxTs > 0) {
    lastAnsweredDate.value = copy.common.monthDay(maxTs)
  }
  questionSummary.value = copy.parent.questionBankSummary(totalQuestionCount.value, freshQuestionCount.value, lastAnsweredDate.value)
})

/** R32 提议板入口（REQ-R32-1）：家长页 parent-actions 第 3 个按钮，跳转提议板列表页 */
function goProposals(): void {
  void router.push('/proposals')
}

// ===== #263 / #279 家长控制功能卡（每入口四态单选：关闭 / 保持 / 30分钟 / 1小时；经同步域 entry_visibility 全家生效）=====
// 档位态 = 单一出口的响应式 state ref（未设置 = 'off' 初始态）；选档写 sq_entry_visibility（writeValue 收口 →
// 同步引擎 outbox 攒行 LWW 推送）。写监听与到期推导（#278 纯函数）收编在 useEntryVisibility 内：
// 本机选档 / 云端拉合落库都经 writeValue 通知，state 自动重推导（家长多设备一致）；限时到期经推导回 'off'。
const gameEntryState = useEntryVisibilityStateRef(GAME_SLOT.id)
const triviaEntryState = useEntryVisibilityStateRef(TRIVIA_ENTRY_ID)

// #279 四态段位（拍板 A1：沿既有分段控件视觉模式，文案缩短硬排一段）——两入口共用同一选项组
const entryOptionItems = [
  { key: 'off', label: copy.parent.entryOptionOff },
  { key: 'keep-on', label: copy.parent.entryOptionKeepOn },
  { key: 'timed-30', label: copy.parent.entryOptionTimed30 },
  { key: 'timed-60', label: copy.parent.entryOptionTimed60 },
] as const

/** 记录档位 → 选中段位 key：限时进行中按剩余分钟就近映射（>30 分钟 = 1小时段，否则 30 分钟段）；到期推导回 'off' */
function selectedKeyOf(state: EntryVisibilityState): string {
  if (state.mode === 'keep-on') return 'keep-on'
  if (state.mode === 'timed' && state.visible) return (state.remainingMinutes ?? 0) > 30 ? 'timed-60' : 'timed-30'
  return 'off'
}

const gameEntrySelected = computed(() => selectedKeyOf(gameEntryState.value))
const triviaEntrySelected = computed(() => selectedKeyOf(triviaEntryState.value))

/** 限时进行中剩余文案（非限时 / 已到期 = 空串不渲染）；格式化走共享单一出口 entryRemainingText（#279 评审收口） */
function remainingTextOf(state: EntryVisibilityState): string {
  if (state.mode !== 'timed' || !state.visible) return ''
  return entryRemainingText(state.remainingMinutes ?? 0)
}
const gameEntryRemaining = computed(() => remainingTextOf(gameEntryState.value))
const triviaEntryRemaining = computed(() => remainingTextOf(triviaEntryState.value))

/** 选档即覆写生效（#279）：关闭显式落 false；保持落 true 无到期；限时按本机时钟起算到期时间戳 */
function onEntrySelect(entryId: string, key: string): void {
  if (key === 'keep-on') {
    writeEntryVisibilityValue(entryId, true)
  } else if (key === 'timed-30' || key === 'timed-60') {
    const durationMinutes = key === 'timed-30' ? 30 : 60
    writeEntryVisibilityValue(entryId, { visible: true, expires_at: Date.now() + durationMinutes * 60_000 })
  } else {
    writeEntryVisibilityValue(entryId, false)
  }
}

// #279 前台分钟粒度重算：每分钟触发单一出口重推导（剩余文案走分钟、到期回初始态）；卸载清理定时器
let visibilityTickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  visibilityTickTimer = setInterval(refreshEntryVisibilityStates, 60_000)
})
onUnmounted(() => {
  if (visibilityTickTimer !== null) clearInterval(visibilityTickTimer)
})

// ===== #290 惊喜条目两行组装 + 得星开关（单一事实源 = 现役题集对象与其规则，无自由文本字段）=====
// 主题行 / 奖励行由 triviaSetRef 全自动组装（题集未加载不渲染）；奖励行无规则显示「奖励：无」、
// 有规则经 copy 注册表按档渲染；得星开关仅当现役题集带规则时出现（键控惊喜入口，默认开，
// 经入口显隐同步域独立入口键全家生效）。
const triviaStarToggle = useTriviaStarToggleRef()
const triviaSetThemeLine = computed(() => {
  const set = triviaSetRef.value
  return set === null ? '' : copy.parent.triviaSetTheme(set.category, set.book, set.questions.length)
})
const triviaRewardLine = computed(() => {
  const set = triviaSetRef.value
  return set === null ? '' : set.starRule === undefined ? copy.parent.triviaRewardNone : copy.parent.triviaRewardRule(set.starRule)
})
const triviaHasRule = computed(() => hasStarRule(triviaSetRef.value?.starRule))
const triviaStarSelected = computed(() => (triviaStarToggle.value ? 'on' : 'off'))
const triviaStarOptionItems = [
  { key: 'on', label: copy.parent.triviaStarOptionOn },
  { key: 'off', label: copy.parent.triviaStarOptionOff },
] as const

/** 得星开关切换即覆写生效（写 sq_entry_visibility 独立入口键 → 写入即推，LWW 全家生效） */
function onTriviaStarSelect(key: string): void {
  writeTriviaStarEarns(key === 'on')
}

/** #136 出题指令入口：家长页 parent-actions 第 4 个按钮，跳转出题指令生成页 */
function goQuestionPrompt(): void {
  void router.push('/parent/question-prompt')
}

function openData(): void {
  activeModal.value = 'data'
}

function openLedger(): void {
  activeModal.value = 'ledger'
}

function closeModal(): void {
  activeModal.value = null
  importError.value = ''
  importSuccess.value = false
  // #212：关闭弹窗一并复位粘贴视图（草稿不留、不落任何数据）
  pasteView.value = false
  pasteText.value = ''
}

function onExportData(): void {
  downloadDataExport()
}

function onExportLedger(): void {
  downloadLedgerExport()
}

/** 点击「导入」：清除提示区（每次新导入操作开始时，AC3-12）→ 触发文件选择 */
function onImport(): void {
  importError.value = ''
  importSuccess.value = false
  fileInput.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  // 新导入操作开始：清除提示区（AC3-12，与 onImport 双路径一致）
  importError.value = ''
  importSuccess.value = false
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result ?? '')
    if (activeModal.value === 'data') {
      const result = validateLearningImport(text)
      if (result.ok) {
        // #172 未配对设备：导入确认前自动下载全量备份（已配对设备内部无动作）
        autoBackupBeforeImport()
        pendingData.value = result.data
        confirmState.value = 'data'
      } else {
        importError.value = importErrorText(result.code)
      }
    } else {
      const result = validateEconomyImport(text)
      if (result.ok) {
        autoBackupBeforeImport()
        pendingLedger.value = result.data
        confirmState.value = 'ledger'
      } else {
        importError.value = importErrorText(result.code)
      }
    }
  }
  reader.onerror = () => {
    // 文件读取失败 → 同样原子拒绝（AC3-13 / AC4 边界）；#172 归入「文件坏」档共用户文案
    importError.value = copy.parent.importFailChecked
  }
  reader.readAsText(file)
  input.value = '' // 允许重复选择同一文件
}

// ===== #212 粘贴导入（tracer bullet）：页面只留浏览器交互（切视图 / 取 textarea 文本 / 弹二次确认），校验与落库归编排与契约层 =====

/** 点击「粘贴导入」：清除提示区（新导入操作开始，同 onImport AC3-12 口径）→ 弹窗内切换粘贴视图 */
function onPasteImport(): void {
  importError.value = ''
  importSuccess.value = false
  pasteView.value = true
}

/** 解析：剥壳校验收口契约层单一纯函数（输入粘贴原文，输出与文件校验器同形 Validation）→ 成功进现有覆盖/追加二次确认；失败复用 importError 反馈（no-json 档文案） */
function onPasteParse(): void {
  importError.value = ''
  importSuccess.value = false
  const result = validateLearningPasteImport(pasteText.value)
  if (result.ok) {
    // #172 未配对设备：导入确认前自动全量备份（与文件导入 onFileChange 同口径）
    autoBackupBeforeImport()
    pendingData.value = result.data
    confirmState.value = 'data'
  } else {
    importError.value = importErrorText(result.code)
  }
}

/** 粘贴视图返回：回主视图，草稿与反馈全清，不落任何数据 */
function onPasteBack(): void {
  pasteView.value = false
  pasteText.value = ''
  importError.value = ''
  importSuccess.value = false
}

/**
 * R21（REQ-R21-2 / REQ-R21-3）：数据导入双模式落库——编排收口进 useImport（架构评审 20260829 候选 2），
 * 页面按内部错误码出两档文案（#172）；溢出与校验失败（ok:false）整次原子拒绝，不写任何键（REQ-R21-2-4）。
 */
function onImportMode(mode: LearningImportMode): void {
  if (!pendingData.value) return
  const result = applyLearningImport(pendingData.value, mode)
  if (!result.ok) {
    importError.value = importErrorText(result.code)
    confirmState.value = null
    pendingData.value = null
    return
  }
  importSuccess.value = true
  confirmState.value = null
  pendingData.value = null
  // #212：粘贴导入成功即完成，退出粘贴视图回主视图（与文件导入成功后的反馈位置一致）；落库失败保留粘贴视图与草稿供重试
  pasteView.value = false
  pasteText.value = ''
}

/** R36（REQ-R36-5）+ R32（REQ-R32-8-4）：经济文件覆盖式落库（无追加概念）——四键整体替换收口进 useImport；
 *  #172 写失败返回 write-failed → 写失败档文案，不显示导入成功 */
function confirmImport(): void {
  if (confirmState.value === 'ledger' && pendingLedger.value) {
    const result = applyEconomyImport(pendingLedger.value)
    if (result.ok) importSuccess.value = true
    else importError.value = importErrorText(result.code)
  }
  confirmState.value = null
  pendingData.value = null
  pendingLedger.value = null
}

function cancelImport(): void {
  confirmState.value = null
  pendingData.value = null
  pendingLedger.value = null
}

/** #132 家庭管理入口：家长页 parent-actions 第 5 个按钮，跳转家庭管理页（原管理区整段迁出） */
function goFamilyAdmin(): void {
  void router.push('/parent/family')
}

// #323 家长页「给家长的话」入口：第 6 个（末位）同权重主按钮，带显式来源参数 from=parent 进入
// 家长通知页的归档形态（渲染全部通知、无「知道了」、返回回家长页）。
// 【票面规则 #319/#323】全仓唯一允许写 from=parent 的地方就是下面这个 goParentGuide：
// 新增任何写 from=parent 的入口 = 新增一个归档入口，必须显式评审，不允许随手新增。
function goParentGuide(): void {
  // #324 归档入口价值计数：点击即报（尽力而为、不阻塞跳转）；非 from=parent 的进入不计。
  reportOnboarding('guide_archive')
  void router.push({ path: '/parent-guide', query: { from: 'parent' } })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (confirmState.value) cancelImport()
  else if (activeModal.value) closeModal()
}

// #263 同步到达重读已收编进 useEntryVisibilityRef（写监听管线归单一出口模块，评审 C 收口）

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div data-page="parent" class="page parent-page">
    <!-- 顶栏（C3Re1：StarNavBar 左 + 标题；#38：返回按钮统一为 StarButtonStandard standard×small，文案 copy.back） -->
    <StarNavBar :title="copy.parent.pageTitle">
      <template #left>
        <StarButtonStandard variant="standard" size="small" class="btn-back-child" @click="goBackChild">{{ copy.back }}</StarButtonStandard>
      </template>
    </StarNavBar>

    <main class="parent-main page-scroll">
      <!-- #38 需求 1：题库情况卡片（star-container 承载，一行三组「·」分隔） -->
      <div v-if="questionSummary" class="star-container question-summary">
        <p class="question-summary-text">{{ questionSummary }}</p>
      </div>
      <!-- 家长超能力卡（#266 收敛：无总开关，卡内唯一元素为常驻「超能力奖励」按钮） -->
      <SuperPowerCard />
      <!-- #263 / #279 家长控制功能卡（#261 入口显隐：位置在「家长超能力」卡下方；游戏 / 惊喜每入口一个四态单选组
           关闭 / 保持 / 30分钟 / 1小时，未选档 = 关闭（默认隐藏语义）；选档经云同步全家生效，限时组内显示剩余时间） -->
      <section class="star-container parent-control-card">
        <div class="card-info">
          <h2 class="card-title">{{ copy.parent.parentControlTitle }}</h2>
          <div class="entry-block">
            <div class="card-info">
              <h3 class="entry-title">{{ copy.parent.gameEntryTitle }}</h3>
              <p class="card-desc">{{ copy.parent.gameEntryDesc }}</p>
            </div>
            <StarSegmentTabs
              class="entry-mode-tabs"
              aria-label="game-entry-mode"
              :model-value="gameEntrySelected"
              :items="[...entryOptionItems]"
              @update:model-value="onEntrySelect(GAME_SLOT.id, $event)"
            />
            <p v-if="gameEntryRemaining" class="entry-remaining">{{ gameEntryRemaining }}</p>
          </div>
          <div class="entry-block">
            <div class="card-info">
              <h3 class="entry-title">{{ copy.parent.triviaEntryTitle }}</h3>
              <p class="card-desc">{{ copy.parent.triviaEntryDesc }}</p>
            </div>
            <StarSegmentTabs
              class="entry-mode-tabs"
              aria-label="trivia-entry-mode"
              :model-value="triviaEntrySelected"
              :items="[...entryOptionItems]"
              @update:model-value="onEntrySelect(TRIVIA_ENTRY_ID, $event)"
            />
            <p v-if="triviaEntryRemaining" class="entry-remaining">{{ triviaEntryRemaining }}</p>
            <!-- #290 惊喜条目两行组装：题集对象 + 规则单一事实源（题集未加载不渲染）；带规则才显得星开关 -->
            <template v-if="triviaSetThemeLine">
              <p class="trivia-set-line trivia-set-theme">{{ triviaSetThemeLine }}</p>
              <p class="trivia-set-line trivia-set-reward">{{ triviaRewardLine }}</p>
              <StarSegmentTabs
                v-if="triviaHasRule"
                class="entry-mode-tabs"
                aria-label="trivia-star-toggle"
                :model-value="triviaStarSelected"
                :items="[...triviaStarOptionItems]"
                @update:model-value="onTriviaStarSelect"
              />
            </template>
          </div>
        </div>
      </section>
      <!-- #38 需求 2：操作区大按钮竖排（standard×large；edgeInset=false 贴边——页面壳 .page 已留 --space-page，
           默认留边会双重收窄 40px，与 star-container 卡片不等宽，2026-09-03 老板拍板对齐）；
           #132 起 5 按钮（末位家庭管理入口，管理区整段迁往 /parent/family）；#323 起第 6 按钮末位「给家长的话」，纵向堆叠零重排 -->
      <div class="parent-actions">
        <StarButtonStandard variant="standard" size="large" :edge-inset="false" class="btn-data-manage" @click="openData">{{ copy.parent.dataManage }}</StarButtonStandard>
        <!-- 小工具构建：流水管理只有文件导出/导入（容器禁文件下载、文件选择器仅可选图视频），入口整段不渲染 -->
        <StarButtonStandard v-if="!IS_MINITOOL" variant="standard" size="large" :edge-inset="false" class="btn-ledger-manage" @click="openLedger">{{ copy.parent.ledgerManage }}</StarButtonStandard>
        <StarButtonStandard variant="standard" size="large" :edge-inset="false" class="btn-proposals-entry" @click="goProposals">{{ copy.parent.proposalsEntry }}</StarButtonStandard>
        <StarButtonStandard variant="standard" size="large" :edge-inset="false" class="btn-question-prompt" @click="goQuestionPrompt">{{ copy.parent.questionPrompt.entryBtn }}</StarButtonStandard>
        <!-- 小工具构建：家庭管理页依赖云端接口（路由已整组移出），入口不渲染 -->
        <StarButtonStandard v-if="!IS_MINITOOL" variant="standard" size="large" :edge-inset="false" class="btn-family-admin" @click="goFamilyAdmin">{{ copy.parent.familyAdminEntry }}</StarButtonStandard>
        <!-- #323 「给家长的话」归档入口（第 6 个同权重主按钮，末位；全仓唯一写 from=parent 的地方，见 goParentGuide 注释）。
             小工具版照常渲染（归档形态不依赖云端，离线可用） -->
        <StarButtonStandard variant="standard" size="large" :edge-inset="false" class="btn-parent-guide" @click="goParentGuide">{{ copy.parent.parentGuideEntry }}</StarButtonStandard>
      </div>
      <!-- C1 组件库入口降级（2026-09-03 老板拍板）：开发者自检功能，由第 3 个大按钮改为 config-link 超链接
           （样式集在 components.css，与 Home 页脚「配置」共用）；parent-main flex 居中 + --space-md 间距 -->
      <router-link to="/components" class="config-link">{{ copy.parent.componentsLibrary }}</router-link>
    </main>

    <!-- 管理弹窗（数据管理 / 流水管理同构，Spec §3.6 元素契约；#59 收编 StarModalStandard：
         title/desc 副标题 + 右上关闭钮（emit close）+ 蒙层点击（emit cancel）；页面只剩业务编排） -->
    <StarModalStandard
      v-if="activeModal"
      :title="activeModal === 'data' && pasteView ? copy.parent.pasteImportTitle : activeModal === 'data' ? copy.parent.dataManage : copy.parent.ledgerManage"
      :desc="activeModal === 'data' && !pasteView ? copy.parent.dataManageDesc : activeModal === 'ledger' ? copy.parent.ledgerManageDesc : ''"
      show-close
      :close-label="copy.parent.closeAriaLabel"
      @close="closeModal"
      @cancel="closeModal"
    >
      <!-- 自定义内容区：file input（隐藏触发器）+ #212 粘贴视图（textarea）+ 导入反馈区（两视图共用） -->
      <input ref="fileInput" type="file" accept=".json" class="file-input" hidden @change="onFileChange" />
      <!-- #212 粘贴视图（仅数据管理弹窗）：标题走弹窗 title 槽，正文 = 文本域（粘贴原文草稿，v-model 不持久化） -->
      <div v-if="activeModal === 'data' && pasteView" class="paste-view">
        <textarea
          v-model="pasteText"
          class="paste-input"
          rows="8"
          :aria-label="copy.parent.pasteImportTitle"
          :placeholder="copy.parent.pasteImportPlaceholder"
        ></textarea>
      </div>
      <div class="import-feedback" role="status">
        <p v-if="importError" class="import-error">{{ importError }}</p>
        <template v-else-if="importSuccess">
          <p class="import-success">{{ copy.parent.importSuccess }}</p>
          <template v-if="activeModal === 'data' && deviceRole === null">
            <p class="import-next">{{ copy.parentGuide.importNext }}</p>
            <p class="import-beta">{{ copy.parentGuide.betaMessage }}</p>
          </template>
        </template>
      </div>
      <template #actions>
        <!-- #212 粘贴视图动作：返回（standard）+ 解析（primary，视图主动作）；复用弹窗按钮行视觉模式 -->
        <template v-if="activeModal === 'data' && pasteView">
          <StarButtonStandard variant="standard" size="large" :edge-inset="false" class="btn-paste-back" @click="onPasteBack">{{ copy.parent.pasteImportBackBtn }}</StarButtonStandard>
          <StarButtonStandard variant="primary" size="large" :edge-inset="false" class="btn-paste-parse" @click="onPasteParse">{{ copy.parent.pasteImportParseBtn }}</StarButtonStandard>
        </template>
        <template v-else>
          <!-- 小工具构建：容器禁文件下载（a[download]）且文件选择器仅可选图视频（.json 不可选），
               导出/文件导入按钮不渲染；数据备份改走「粘贴导入」旁路，粘贴文本可先在备忘录留存 -->
          <StarButtonStandard v-if="!IS_MINITOOL" variant="primary" size="large" :edge-inset="false" class="btn-export" @click="activeModal === 'data' ? onExportData() : onExportLedger()">{{ copy.parent.exportBtn }}</StarButtonStandard>
          <StarButtonStandard v-if="!IS_MINITOOL" variant="standard" size="large" :edge-inset="false" class="btn-import" @click="onImport">{{ copy.parent.importBtn }}</StarButtonStandard>
          <!-- #212 与「导入」并列「粘贴导入」（仅数据管理弹窗，经济流水粘贴导入不捎带） -->
          <StarButtonStandard v-if="activeModal === 'data'" variant="standard" size="large" :edge-inset="false" class="btn-paste-import" @click="onPasteImport">{{ copy.parent.pasteImportBtn }}</StarButtonStandard>
        </template>
      </template>
    </StarModalStandard>

    <!-- 导入二次确认弹窗（复用 R2 视觉模式；#59 收编 StarModalStandard：正文 + 提示句进默认槽 + 三按钮 actions 槽） -->
    <StarModalStandard
      v-if="confirmState"
      class="confirm-modal"
      :message="confirmState === 'data'
        ? copy.parent.confirmLearningImport(pendingQuestionCount)
        : copy.parent.confirmEconomyImport(pendingRewardCount, pendingProposalCount, pendingLedgerCount)"
      @cancel="cancelImport"
    >
      <template #actions>
        <StarButtonStandard variant="standard" size="large" :edge-inset="false" class="confirm-cancel" @click="cancelImport">{{ copy.parent.cancel }}</StarButtonStandard>
        <StarButtonStandard v-if="confirmState === 'data'" variant="primary" size="large" :edge-inset="false" class="confirm-ok" @click="onImportMode('overwrite')">{{ copy.parent.importOverwrite }}</StarButtonStandard>
        <StarButtonStandard v-if="confirmState === 'data'" variant="primary" size="large" :edge-inset="false" class="confirm-ok" @click="onImportMode('append')">{{ copy.parent.importAppend }}</StarButtonStandard>
        <StarButtonStandard v-if="confirmState === 'ledger'" variant="primary" size="large" :edge-inset="false" class="confirm-ok" @click="confirmImport">{{ copy.parent.confirm }}</StarButtonStandard>
        <!-- R21（REQ-R21-1-1）：data 分支双动作按钮（点击即执行，无默认无预选）；ledger 分支维持取消 + 确认 -->
      </template>
    </StarModalStandard>
  </div>
</template>

<style scoped>
/* 返回孩子端 / 操作区按钮（#38）：全部改用 StarButtonStandard（standard×small 返回 / standard×large 操作区），私有按钮样式清零 */

/* #38 需求 1：题库情况卡片——star-container 承载，一行三组；此处理小字说明样式 */
.question-summary {
  width: 100%;
}

/* #263 家长控制功能卡骨架：卡片/描边/圆角由 star-container 承载，段位组由 StarSegmentTabs 组件（#183）承载，
   此处只留标题 + 两行「信息 + 开关」横排布局（无状态色变化——开/关都是中性 switch 形态） */
.parent-control-card {
  width: 100%;
}

.parent-control-card .card-info {
  min-width: 0;
}

.parent-control-card > .card-info > .card-title {
  margin: 0 0 var(--space-base);
  font-size: var(--font-size-body-lg);
  font-weight: 700;
  color: var(--color-text);
}

/* #279 四态单选（拍板 A1）：段位组复用 StarSegmentTabs 视觉模式，此处只留标题 + 信息 / 段位组 / 剩余文案的纵排布局 */
.entry-block {
  min-width: 0;
}

.entry-block + .entry-block {
  margin-top: var(--space-base);
}

/* #290 惊喜条目两行（主题行 / 奖励行）：信息小字、次级色（与剩余文案区分——两行是事实陈述非提示） */
.trivia-set-line {
  margin: var(--space-sm) 0 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  color: var(--color-text-secondary);
}

.entry-remaining {
  margin: var(--space-sm) 0 0;
  font-size: var(--font-size-info);
  font-weight: 700;
  color: var(--color-primary);
}

.entry-title {
  margin: 0 0 var(--space-base);
  font-size: var(--font-size-body);
  font-weight: 700;
  color: var(--color-text);
}

.question-summary-text {
  margin: 0;
  font-size: var(--font-size-info);
  font-weight: 400;
  color: var(--color-text-secondary);
  text-align: center;
}

/* 一屏展示批2（#52）：内容区唯一滚动容器，滚动四件套已收编全局 page-scroll 样式集（components.css，#68） */
.parent-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding-top: var(--space-lg);
  /* 滚动到底时末个大按钮 6px 唇边（hover 8px / 按压 +4px）留呼吸位 */
  padding-bottom: var(--space-md);
}

/* #38 需求 2：3 个大按钮竖排（宽度行为归组件：edge-inset=false 贴边 100%，与 star-container 卡片等宽，此处仅排布） */
.parent-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
}

/* ===== 弹窗（#59 收编 StarModalStandard）：壳 / 标题 / 副标题 / 正文 / 按钮行样式全归组件，页面零自绘 ===== */

/* 导入反馈区（弹窗自定义内容区）：上距小档 */
.import-feedback {
  margin-top: var(--space-sm);
}

.import-error {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 400;
  color: var(--color-error);
}

.import-success {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 400;
  color: var(--color-text);
}

.import-next,
.import-beta {
  margin: var(--space-base) 0 0;
  font-size: var(--font-size-info);
  line-height: var(--leading-body);
}
.import-beta {
  margin-bottom: var(--space-md);
  color: var(--color-text-secondary);
}

/* #212 粘贴视图文本域输入控件样式：升格跨页样式集（components.css，与 QuestionPrompt 页文本域输入控件共用） */

/* 家长页说明小字（R15 T15，样式预置；文案不新增，G9 约束下由既有 copy 提供或留空） */
.parent-note {
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
  text-align: center;
}

/* ===== 二次确认弹窗（#59 收编 StarModalStandard）：正文与按钮行归组件 ===== */

/* #132：原「设备与家庭」管理区样式（device-admin 系 / toast）已随模板整段迁往 FamilyAdmin.vue */
</style>
