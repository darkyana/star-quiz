<script setup lang="ts">
import { reportOnboarding } from '../cloud/onboardingMetrics'
// 首页（Spec REQ-4 / 设计方案 §5.1）：品牌顶栏 + 余额 + 出题方式入口 + 双按钮（#108 定稿 D 起 tagline 移除）
// 家长入口 = 页脚「配置」链接（产品负责人 2026-08-21：Safari PWA 手势被系统占用；C3Re1 起星星手势按钮删除）
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ledger as readStars, computeBalance } from '../composables/useStarData'
import { questions as readQuestions } from '../composables/useLearningData'
import { startQuiz } from '../composables/useQuiz'
import { readQuizMode, writeQuizMode } from '../composables/useQuizMode'
import { useEntryVisibilityStateRef, refreshEntryVisibilityStates, entryRemainingText } from '../composables/useEntryVisibility'
import { TRIVIA_ENTRY_ID, TRIVIA_SET_SLOT, triviaSetRef, warmTriviaSet } from '../data/trivia-set'
import { readDeviceCredential } from '../composables/useDeviceCredential'
import { useDeviceRole } from '../composables/useDeviceRole'
// #322 家长请看贴纸改通知角标：未读集合单一出口（T2 #321 的已读账 composable）
import { useUnreadParentGuideNotifications } from '../composables/useParentGuideReadLedger'
import { useGameSession } from '../composables/useGameSession'
import { fetchFamilyCode } from '../cloud/api'
import { registerSyncCompleteListener } from '../cloud/sync'
import { IS_MINITOOL } from '../minitool'
import { registerWriteListener, STORAGE_KEYS } from '../composables/useDataInfra'
import type { QuizMode } from '../types'
import { APP_VERSION } from '../data/app-version'
import StarButtonStandard from '../components/StarButtonStandard.vue'
import StarNavBar from '../components/StarNavBar.vue'
import StarModeEntry from '../components/StarModeEntry.vue'
import StarGlyph from '../components/StarGlyph.vue'
import { copy } from '../copy'
import StarIconBtn from '../components/StarIconBtn.vue'
import StarIconClose from '../components/StarIconClose.vue'
import StarEmptyState from '../components/StarEmptyState.vue'
import StarModalStandard from '../components/StarModalStandard.vue'
import StarToastStandard from '../components/StarToastStandard.vue'
import { GAME_SLOT } from '../data/playable-games'
// Explicit asset import keeps the approved sticker bundled even with minitool publicDir disabled.
import parentStickerUrl from '../../public/parent/megaphone.svg?url'
import offlineHomeStarUrl from '../../public/home-star.png?url'
import offlineTriviaIconUrl from '../../public/trivia/current/icon.svg?url'

// 游戏会话子系统已整体抽至 useGameSession（#253）：扣星开局、加载看门狗与超时退星、iframe postMessage 协议校验、
// 防重放注册表、退出退星、重玩协议全在模块内私有；首页只保留接线——说明弹窗门禁（#264 起只剩余额档）、
// iframe 挂载点与成功后关弹窗。星星流水仍经 useStarData，行为数值零变化。
// 每次人工付费后才建新 frame；挂载点由页面模板持有，模块经注入校验消息来源并回发授权。
const gameFrame = ref<HTMLIFrameElement | null>(null)
const homeStarUrl = IS_MINITOOL ? offlineHomeStarUrl : `${import.meta.env.BASE_URL}home-star.png`
const gameUrl = `${import.meta.env.BASE_URL}${GAME_SLOT.path}`
// #230 贴纸图标外置：游戏目录内静态 SVG，路径读槽位配置
const gameIconUrl = `${import.meta.env.BASE_URL}${GAME_SLOT.icon}`

// #266 会话级超能力总开关删除：首页不再读取超能力——#264 开局时窗已删，门禁只剩星余额（越窗参数已无残留）
const showGameInfo = ref(false)
// #264 开局时窗删除：门禁只剩星余额（入口可见 + 星够 = 任何时刻可开局）
const gameBlockedReason = computed(() => balance.value < GAME_SLOT.price ? copy.home.game.shortage : '')
function openGameInfo(): void {
  gameToast.value = ''
  refresh()
  showGameInfo.value = true
}

// 消息接线：frame 即协议来源校验与授权回发的挂载点；扣星被拒 → 页面刷新门禁（onBlocked）；重玩 → 重开说明（onReplay）
const { phase: gamePhase, toast: gameToast, start: startPaidRound, exit: exitGame, failLoad: gameLoadFailed } = useGameSession({
  frame: gameFrame,
  onBlocked: refresh,
  onReplay: openGameInfo,
})
function startGame(): void {
  if (!showGameInfo.value) return
  // #263 关闭游戏入口后孩子无法新开局：入口已被家长拨关（弹窗关闭有 watch 兜底，双保险）→ 拒绝开局，不扣星
  if (!gameEntryShown.value) return
  // 扣星成功才关说明弹窗；被拒（onBlocked 已刷新门禁）或写失败保持打开供重试
  if (startPaidRound()) showGameInfo.value = false
}

const router = useRouter()

const balance = ref(0)
const poolEmpty = ref(false)
// 出题方式（#103 / #108 定稿 D）：tagline 原位入口；切换写 sq_quiz_mode，只影响下一轮（startQuiz 时读）
const quizMode = ref<QuizMode>(readQuizMode())
watch(quizMode, (next) => writeQuizMode(next))

// #272 惊喜会话永远新题优先：原按 kind 分流的惊喜偏好记忆（sq_quiz_mode 对象形状）已整体拆除，首页不再提供惊喜出题方式切换
// #280 限时显隐：两入口显隐改走 #278 到期推导（保持开启恒显；限时且未到期显、归零后隐；
// 关闭/未设置隐藏）。#279 评审收口：页面不再自建 entryTick 版本号双轨——改消费单一出口模块的
// 响应式 state ref（写监听跟随：本机切换 / 云端落库都经 writeValue 通知自动重推导，重推导每次
// 重取本地当前时间，同毫秒写入也会生成新 state 对象触发响应性，既有行为不回退）；聚焦 / 回前台 /
// 同步完成等人工重读路径统一走 refreshEntryVisibilityStates（模块内全量重推导）。
const gameEntryState = useEntryVisibilityStateRef(GAME_SLOT.id)
const triviaEntryState = useEntryVisibilityStateRef(TRIVIA_ENTRY_ID)
function rederiveEntries(): void {
  refreshEntryVisibilityStates()
}
const gameEntryShown = computed(() => gameEntryState.value.visible)
const triviaEntryShown = computed(() => triviaEntryState.value.visible)
// #280 弹窗倒计时文案：限时生效期间显示剩余时间（分钟粒度，「剩余 X 分钟」/「不到 1 分钟」）；
// 非限时开启（保持开启/关闭/未设置）remainingMinutes = null → 无倒计时行。格式化走共享单一出口。
const gameCountdownText = computed(() => countdownText(gameEntryState.value))
const triviaCountdownText = computed(() => countdownText(triviaEntryState.value))
function countdownText(state: { remainingMinutes: number | null }): string {
  return state.remainingMinutes === null ? '' : entryRemainingText(state.remainingMinutes)
}
// #263 关闭游戏入口后孩子无法新开局：入口不可见（开关拨关或限时归零，本机或同步落库）→ 已打开的说明弹窗
// 即时关闭，且开局入口被门禁拦下（见 startGame），弹窗关不关都开不了新局。
watch(gameEntryShown, (shown) => {
  if (!shown) showGameInfo.value = false
})

// #271/#287 惊喜贴纸入口：贴纸画作随现役题集文件夹分发（public/trivia/current/，TRIVIA_SET_SLOT 提供路径），
// 宿主统一施加令牌描边（与游戏贴纸同规，见下方 .sticker-art 共享样式）；点击弹说明弹窗（介绍文案 + 一键开局）。
const triviaIconUrl = IS_MINITOOL ? offlineTriviaIconUrl : `${import.meta.env.BASE_URL}${TRIVIA_SET_SLOT.icon}`
const showTriviaInfo = ref(false)
// #287 介绍文案随题集对象分发（trivia-set 响应式状态）：未加载/缺失/损坏 → 兜底文案 + 重试钮，不与入口显隐耦合
const triviaInfoMessage = computed(() => triviaSetRef.value?.intro ?? copy.home.trivia.loadFailed)
function openTriviaInfo(): void {
  showTriviaInfo.value = true
  // 打开兜底态时顺手再预热一次（内容可能刚部署好）；warm 内部吞错，成功则弹窗响应式切回介绍态
  if (triviaSetRef.value === null) void warmTriviaSet()
}
async function onRetryTriviaSet(): Promise<void> {
  await warmTriviaSet()
}
// #263/#271/#280 惊喜入口不可见（开关拨关或限时归零）→ 已打开的说明弹窗即时关闭，
// 且开局被门禁拦下（见 onStartTrivia）；进行中的一局不受影响（入口级门禁不拆会话）。
watch(triviaEntryShown, (shown) => {
  if (!shown) showTriviaInfo.value = false
})

// ===== 检查更新（版本号可点击）：构建身份（git 短哈希）比对云端 version.json =====
// 业务版本号不参与判定（人工 bump 不可靠）：本机构建身份经 vite define 注入（__BUILD_ID__），
// 云端构建收尾落 dist/version.json；fetch(no-store) 绕过 iOS PWA 页面快照取最新部署，比对 build 字段。
// 小工具构建无 version.json（publicDir 关闭），入口恒不渲染。
const BUILD_ID: string = __BUILD_ID__
type UpdateCheckState = 'checking' | 'new' | 'latest' | 'error'
const showUpdateModal = ref(false)
const updateState = ref<UpdateCheckState>('checking')
const remoteVersion = ref('')
const updateMessage = computed(() => {
  switch (updateState.value) {
    case 'checking': return copy.home.update.checking
    case 'new': return copy.home.update.newVersion(remoteVersion.value || APP_VERSION)
    case 'latest': return copy.home.update.latest
    case 'error': return copy.home.update.error
  }
})
const updateConfirmText = computed(() => {
  switch (updateState.value) {
    case 'new': return copy.home.update.update
    case 'latest': return copy.home.update.reload
    default: return copy.home.update.dismiss // checking 期按钮即可见（弹窗即时反馈），语义收口为关闭
  }
})
async function openUpdateCheck(): Promise<void> {
  if (IS_MINITOOL) return
  updateState.value = 'checking'
  remoteVersion.value = ''
  showUpdateModal.value = true
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`version.json ${res.status}`)
    const data = (await res.json()) as { version?: unknown; build?: unknown }
    remoteVersion.value = typeof data.version === 'string' ? data.version : ''
    updateState.value = data.build !== BUILD_ID ? 'new' : 'latest'
  } catch {
    updateState.value = 'error'
  }
}
function onUpdateConfirm(): void {
  if (updateState.value === 'new' || updateState.value === 'latest') location.reload()
  else showUpdateModal.value = false
}

function refresh(): void {
  balance.value = computeBalance(readStars())
  poolEmpty.value = readQuestions().length === 0
  // #280 聚焦 / 回前台 / 同步落库重读路径一并重推入口推导：后台到点后回前台即时呈关闭态
  rederiveEntries()
}

// #125 设备配对态：null = 未配对（页脚出「配对」入口）；小工具构建：无配对概念，配对入口不渲染（/pair 路由同已整组移出）
// #252 设备角色统一出口：从挂载快照升级为响应式跟随——配对落凭据后页脚即时显隐，不再押在路由重挂载上
const deviceRole = useDeviceRole()
const showConfigLink = computed(() => deviceRole.value !== 'child')
const showPairLink = computed(() => deviceRole.value === null && !IS_MINITOOL)

// #322 「家长请看」贴纸 = 通知角标（spec #319 故事 39，本票显式修订 #308/#316 的「入口对所有设备可见」口径）：
// 渲染条件 = 非游戏会话中 且 家长通知存在未读 且 本机不是已入队孩子设备。
// ——孩子设备不显示这枚贴纸（受众是家长，通知由家长消费）：这是口径修订而非回归 bug，请勿「修」回 #316。
// 未配对设备（无凭据）与待批准/状态未知设备照常显示（与 #308/#309 时代一致）；
// 判据 = role 'child' 且 familyStatus 'joined'（待批准 child 落 'unjoined'/缺席，照常显示）。
// 未读清零贴纸即消失；后续版本新增一条通知（append-only id）未读集合转非空，贴纸自动回来。
// 不做未读数/红点/数字角标：有未读就是整枚贴纸，没有就没有。
const unreadParentGuideNotifications = useUnreadParentGuideNotifications()
const hasUnreadParentGuide = computed(() => unreadParentGuideNotifications.value.length > 0)
// 已入队孩子设备快照：跟随凭据键写入（配对落凭据 / 批准轮询 confirmFamilyStatus 都走 writeValue 通知）
const joinedChildDevice = ref(isJoinedChildDevice())
function isJoinedChildDevice(): boolean {
  const credential = readDeviceCredential()
  return credential?.role === 'child' && credential.familyStatus === 'joined'
}
const showParentSticker = computed(() => gamePhase.value === 'idle' && hasUnreadParentGuide.value && !joinedChildDevice.value)

// 页脚「当前家庭」字段（2026-09-09 老板拍板）：未配对 → 尚未加入家庭；已配对（任何角色）→
// 现役家庭码「家庭：XXXXXX」（经 GET /api/family，码常显放宽原「平时不显示」口径）。
// 取码失败（断网/凭据失效）→ 字段隐藏保守落地（不误显「尚未加入家庭」），下次挂载重试，不阻塞页面其余功能。
const familyCode = ref<string | null>(null)
const familyText = computed(() => {
  // 小工具构建：无家庭/云端概念，页脚家庭字段整段隐藏
  if (IS_MINITOOL) return ''
  if (deviceRole.value === null) return copy.home.familyNone
  return familyCode.value === null ? '' : copy.home.familyLabel(familyCode.value)
})

// #208 拉取完成广播订阅：停留在首页时远端共享数据落库 → 重读本地静默刷新（AC1/AC5 核心场景：星星数量）
// 页面只订阅 + 重读本地，不引入数据层抽象；引擎侧未落库不广播，重读幂等无感
let unregisterSyncListener: (() => void) | null = null
let unregisterWrite: (() => void) | undefined
let entryTimer: number | undefined

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') refresh()
}
function onStorageChange(event: StorageEvent): void {
  if (event.key === null || event.key === STORAGE_KEYS.stars) refresh()
}

onMounted(() => {
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('storage', onStorageChange)
  refresh()
  // #252 角色显隐已由 useDeviceRole 跟随；此处读取凭据本体仅为家庭码接口携带
  const credential = readDeviceCredential()
  // 已配对设备取现役家庭码（异步静默；失败隐藏字段）；小工具构建无云端，跳过（fetch 调用随 DCE 移出）
  if (credential !== null && !IS_MINITOOL) {
    void fetchFamilyCode({ credential }).then((result) => {
      if (result.ok) familyCode.value = result.code
    })
  }
  // #208 拉取完成广播订阅：小工具构建同步引擎不启动、无广播来源，不订阅
  unregisterSyncListener = IS_MINITOOL ? null : registerSyncCompleteListener(refresh)
  unregisterWrite = registerWriteListener(key => {
    if (key === STORAGE_KEYS.stars) refresh()
    // #280 显隐记录落库（本机切换或云同步拉合）→ 重推入口推导（可见性与剩余分钟一并跟随）
    if (key === STORAGE_KEYS.entryVisibility) rederiveEntries()
    // #322 凭据键写入（配对落凭据 / 批准轮询）→ 通知角标的孩子设备门禁即时跟随
    if (key === STORAGE_KEYS.deviceCredential) joinedChildDevice.value = isJoinedChildDevice()
  })
  // #280 前台分钟粒度重算：每分钟重推一次推导，限时归零时入口即时消失、已开弹窗随 watch 即时关闭
  entryTimer = window.setInterval(rederiveEntries, 60_000)
})

onUnmounted(() => {
  // 游戏看门狗与消息监听已由 useGameSession 模块内部成对清理（#253），此处只清页面监听（#264：时窗定时器随窗口删除）
  unregisterWrite?.()
  // #280 分钟粒度重算定时器随页面卸载清理
  if (entryTimer !== undefined) window.clearInterval(entryTimer)
  window.removeEventListener('focus', refresh)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('storage', onStorageChange)
  unregisterSyncListener?.()
  unregisterSyncListener = null
})

function onStart(): void {
  if (poolEmpty.value) return
  const session = startQuiz()
  if (session) {
    reportOnboarding('quiz_start')
    void router.push({ path: '/quiz', query: { start: '1' } })
  }
}

// #271/#287 惊喜题库入口：点贴纸弹说明弹窗，点「开始惊喜答题」按现役题集的分册直开惊喜会话跳答题页
// （内置集独立于用户题池，空学科池也能开；不扣星、无门禁——与游戏付费门禁不同源）。
// 题集缺失/损坏时题库按空处理：开局无题返回 null 不跳转，弹窗保持兜底态（重试钮可见）；不崩溃。
// 入口拨关后不再开新局（弹窗已随 watch 即时关闭，此处双保险）。
function onStartTrivia(): void {
  if (!triviaEntryShown.value || triviaSetRef.value === null) return
  const session = startQuiz(Math.random, { kind: 'trivia', category: triviaSetRef.value.category, book: triviaSetRef.value.book })
  if (session) {
    showTriviaInfo.value = false
    void router.push({ path: '/quiz', query: { start: '1' } })
  }
}

function onParentGuide(): void {
  reportOnboarding('guide_entry')
  void router.push('/parent-guide')
}

function onRedeem(): void {
  void router.push('/redeem')
}
</script>

<template>
  <div data-page="home" class="page home">
    <!-- 夜云（#146 星夜童话：令牌换值自动成夜云；#152 G2 动效对齐探针档——极慢漂移恢复，aria-hidden 纯装饰） -->
    <div class="clouds" aria-hidden="true">
      <span class="cloud cloud-1"></span>
      <span class="cloud cloud-2"></span>
    </div>

    <!-- 品牌顶栏（C3Re1：StarNavBar 仅标题形态；星星手势按钮已删除，家长入口 = 页脚「配置」）
         #258 游戏会话全屏化：非 idle 阶段宿主 UI 让位，顶栏不渲染（v-if 而非 CSS 隐藏） -->
    <StarNavBar v-if="gamePhase === 'idle'" :title="copy.home.brand" />

    <!-- 一屏展示批2（#52）：滚动容器包主体与页脚——页脚在内容流末尾贴底，一屏内可见无需下拉 -->
    <div v-show="gamePhase === 'idle'" class="home-scroll page-scroll">
      <main class="home-main">
        <!-- #147 余额区简化：星径（五星弧线 + 四芒星子 + 虚线弧）整体移除，改一颗大星星居中
             （#146 星径落地后的追加反馈，2026-09-04）：星上数下保守构图，主视觉档 112px（96–120 区间平衡档），
             发光圆润母型无描边（探针 P1-r2 同款 path，fill+stroke 同色 + 圆角 join），保留呼吸微光动画 -->
        <!-- 小工具构建：游戏跑在 iframe（容器全禁 iframe），游戏贴纸入口不渲染。
             #230 贴纸图标外置为游戏目录内静态 SVG（宿主按槽位配置 icon 路径引用）；
             #231 贴纸图标准线分家：外部 SVG 是游戏自备画作（游戏自身颜色、不画外描边），
             贴纸描边由宿主统一施加（见下方贴纸图标样式，令牌驱动、随主题自动跟随） -->
        <!-- #275 首页贴纸构图组（#274 定稿 B3 修订版）：游戏偏右上、惊喜相对左移下移错落；
             贴纸各自独立定位，显隐互不挪位（单贴纸/两张均隐藏均不跳位）。
             小工具构建：游戏跑在 iframe（容器全禁 iframe），游戏贴纸不渲染、惊喜贴纸照常渲染。
             #230/#231 贴纸图标外置静态 SVG（各自槽位配置提供路径），画作自备颜色不画外描边，
             描边由宿主统一施加（令牌驱动，见下方贴纸 art 样式） -->
        <div class="home-stickers">
          <StarIconBtn v-if="!IS_MINITOOL && gameEntryShown" class="game-sticker" :aria-label="GAME_SLOT.name" @click="openGameInfo">
            <img class="sticker-art game-sticker__art" :src="gameIconUrl" alt="" aria-hidden="true">
            <span class="sticker-capsule" aria-hidden="true">{{ GAME_SLOT.name }}</span>
          </StarIconBtn>
          <StarIconBtn v-if="triviaEntryShown" class="trivia-sticker" :aria-label="copy.home.trivia.label" @click="openTriviaInfo">
            <img class="sticker-art trivia-sticker__art" :src="triviaIconUrl" alt="" aria-hidden="true">
            <span class="sticker-capsule" aria-hidden="true">{{ copy.parentGuide.triviaCapsule }}</span>
          </StarIconBtn>
          <!-- #322 通知角标（修订 #316「所有设备可见」口径）：非游戏会话中且有未读才渲染；孩子设备不显示（见上方注释）。
               可见胶囊与无障碍名均保持「家长请看」（票面：文案不改成通知措辞，无障碍名允许多带通知含义——此处取不动，避免扩大改动面）；无未读数/红点/数字角标。 -->
          <StarIconBtn v-if="showParentSticker" class="parent-sticker" :aria-label="copy.parentGuide.sticker" @click="onParentGuide">
            <img class="sticker-art" :src="parentStickerUrl" alt="" aria-hidden="true">
            <span class="sticker-capsule" aria-hidden="true">{{ copy.parentGuide.sticker }}</span>
          </StarIconBtn>
        </div>
        <div class="balance-chip" role="status">
          <!-- 首页主视觉使用画师素材，沿用原有尺寸与呼吸动画；其他星星图标仍用 StarGlyph -->
          <img :src="homeStarUrl" class="home-big-star" alt="" aria-hidden="true">
          <div class="balance-num-row">
            <span class="star-value">{{ balance }}</span>
            <span class="balance-label">{{ copy.home.balanceLabel }}</span>
          </div>
        </div>

        <!-- 出题方式入口（#108 定稿 D 槽位；#152 G3 改三分段直显切换器）：点选即切换写 sq_quiz_mode、只影响下一轮 -->
        <StarModeEntry v-model="quizMode" />

        <!-- 双按钮 edgeInset=false 贴边（2026-09-03 老板拍板）：页面壳已留 --space-page，默认留边双重收窄，与 StarModeEntry 卡等宽 -->
        <StarButtonStandard type="button" variant="primary" size="large" :edge-inset="false" :disabled="poolEmpty" @click="onStart">{{ copy.home.startQuiz }}</StarButtonStandard>
        <p v-if="poolEmpty" class="home-hint">{{ copy.home.poolEmptyHint }}</p>

        <StarButtonStandard type="button" variant="standard" size="large" :edge-inset="false" @click="onRedeem">{{ copy.home.redeem }}</StarButtonStandard>
      </main>

      <!-- 页脚：版本号 + 当前家庭字段（2026-09-09）+ 家长入口 + 配对入口
           （#125：配对仅未配对时渲染、置于「配置」前（老板拍板 2026-09-09）；孩子设备不渲染配置链接，#84；
            取码失败的已配对设备隐藏家庭字段——空串不渲染） -->
      <footer class="app-footer">
        <!-- 版本号可点击 = 检查更新入口（构建哈希比对，不依赖人工 bump）；小工具构建无 version.json 恒不可点 -->
        <button v-if="!IS_MINITOOL" type="button" class="version-text version-btn"
          :aria-label="copy.home.update.ariaLabel" @click="openUpdateCheck">
          {{ copy.home.versionLabel(APP_VERSION) }}
        </button>
        <span v-else class="version-text">{{ copy.home.versionLabel(APP_VERSION) }}</span>
        <span v-if="familyText !== ''" class="family-text">{{ familyText }}</span>
        <router-link v-if="showPairLink" to="/pair" class="config-link">{{ copy.pair.entryLink }}</router-link>
        <router-link v-if="showConfigLink" to="/parent" class="config-link" :aria-label="copy.home.configAriaLabel">{{ copy.home.configLink }}</router-link>
      </footer>
    </div>

    <!-- #258 游戏会话全屏化：loading/failed = 深蓝底居中空态块 + 小号「退出」；running/ended = 整页只有游戏 iframe，
         右上角常驻半透明 X 复用既有退出流程（无确认）；toast 保留且层级高于 iframe。
         loading 期 iframe 照常挂载（协议握手来源，#253 形状：仅 idle/failed 不渲染），被空态块覆盖不可见 -->
    <section v-if="gamePhase !== 'idle'" class="game-session" :aria-label="GAME_SLOT.name">
      <iframe v-if="gamePhase !== 'failed'" ref="gameFrame" class="game-frame" :src="gameUrl" :title="GAME_SLOT.name" @error="gameLoadFailed" />
      <div v-if="gamePhase === 'loading' || gamePhase === 'failed'" class="game-hold" role="status">
        <StarEmptyState>{{ gamePhase === 'loading' ? copy.home.game.loading : copy.home.game.failed }}</StarEmptyState>
        <StarButtonStandard variant="standard" size="small" @click="exitGame">{{ copy.home.game.exitShort }}</StarButtonStandard>
      </div>
      <!-- X 图标钮：壳归 StarIconBtn，18px 关闭图标走 StarIconClose 共享件（与 StarModalStandard 关闭钮同源）；
           半透明常驻（--opacity-muted 令牌）、hover/聚焦提亮 -->
      <StarIconBtn v-else class="game-exit" :aria-label="copy.home.game.exit" @click="exitGame">
        <StarIconClose />
      </StarIconBtn>
    </section>
    <StarToastStandard :message="gameToast" @expired="gameToast = ''" />

    <!-- #271/#287 惊喜题库说明弹窗（共享标准弹窗）：介绍文案随题集对象分发（缺失/损坏时兜底提示 + 重试钮）、
         「开始惊喜答题」一键开局（不扣星无门禁）+ 右上关闭钮；显隐开关拨关时随 watch 即时关闭 -->
    <StarModalStandard v-if="showTriviaInfo" :title="copy.home.trivia.label" :message="triviaInfoMessage"
      show-close :close-label="copy.home.trivia.close" @cancel="showTriviaInfo = false" @close="showTriviaInfo = false">
      <!-- #280 限时剩余（分钟粒度）：仅限时开启显示，非限时开启无倒计时行 -->
      <p v-if="triviaCountdownText" class="home-hint" role="status">{{ triviaCountdownText }}</p>
      <template #actions>
        <!-- #287 题集就绪 → 一键开局；未就绪 → 重试（重新预热，成功后响应式切回介绍态） -->
        <StarButtonStandard v-if="triviaSetRef !== null" variant="primary" size="large" @click="onStartTrivia">{{ copy.home.trivia.start }}</StarButtonStandard>
        <StarButtonStandard v-else variant="primary" size="large" @click="onRetryTriviaSet">{{ copy.home.trivia.retry }}</StarButtonStandard>
      </template>
    </StarModalStandard>

    <StarModalStandard v-if="showGameInfo" :title="GAME_SLOT.name" :message="GAME_SLOT.instructions"
      @cancel="showGameInfo = false">
      <p class="game-price"><StarGlyph size="sm" />{{ copy.home.game.price(GAME_SLOT.price) }}</p>
      <!-- #280 限时剩余（分钟粒度）：仅限时开启显示，非限时开启无倒计时行 -->
      <p v-if="gameCountdownText" class="home-hint" role="status">{{ gameCountdownText }}</p>
      <p v-if="gameBlockedReason" class="home-hint" role="status">{{ gameBlockedReason }}</p>
      <template #actions>
        <StarButtonStandard variant="standard" size="large" @click="showGameInfo = false">{{ copy.home.game.cancel }}</StarButtonStandard>
        <StarButtonStandard variant="primary" size="large" :disabled="!!gameBlockedReason" @click="startGame">{{ copy.home.game.start }}</StarButtonStandard>
      </template>
    </StarModalStandard>

    <!-- 检查更新弹窗：checking/new/latest/error 四态同壳（共享标准弹窗）；new = confirm 双钮（立即更新=reload），
         latest/error = notice 单钮 + 右上关闭；reload 即绕过 iOS PWA 页面快照强制刷新（no-cache 头保证拿到新外壳） -->
    <StarModalStandard v-if="showUpdateModal" :title="copy.home.update.title" :message="updateMessage"
      :variant="updateState === 'new' ? 'confirm' : 'notice'"
      :confirm-text="updateConfirmText" :cancel-text="copy.home.update.dismiss"
      show-close :close-label="copy.home.update.dismiss"
      @confirm="onUpdateConfirm" @cancel="showUpdateModal = false" @close="showUpdateModal = false" />

  </div>
</template>

<style scoped>
.home {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 一屏展示批2（#52）：内容区唯一滚动容器——包主体与页脚；滚动四件套已收编全局 page-scroll 样式集（components.css，#68）；
   页脚 margin-top:auto 在此 flex 容器内仍生效（内容不足时贴容器底 = 屏底，溢出时随内容流末尾） */
.home-scroll {
  display: flex;
  flex-direction: column;
}

/* 夜云（#146 星夜童话：令牌换值自动成夜云；#152 G2 动效预算对齐探针档——极慢漂移恢复：
   --duration-drift 26s 往返横移，云属夜空叙事层） */
.clouds {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 0;
  pointer-events: none;
}

.cloud {
  position: absolute;
  width: 96px;
  height: 48px;
  background: color-mix(in srgb, var(--color-surface) 85%, transparent);
  border-radius: 50%;
  animation: cloud-drift var(--duration-drift) ease-in-out infinite;
}

.cloud::before,
.cloud::after {
  content: '';
  position: absolute;
  background: color-mix(in srgb, var(--color-surface) 85%, transparent);
  border-radius: 50%;
}

.cloud::before {
  width: 48px;
  height: 48px;
  top: -18px;
  left: 18px;
}

.cloud::after {
  width: 36px;
  height: 36px;
  top: -10px;
  left: 52px;
}

.cloud-1 {
  top: 56px;
  left: -24px;
}

.cloud-2 {
  top: 96px;
  right: -32px;
  animation-direction: reverse;
  animation-duration: calc(var(--duration-drift) * 1.25);
}

/* #152 G2 云朵极慢漂移（探针档 26s）：往返横移 ±24px，两云错向错速避免同频 */
@keyframes cloud-drift {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(24px);
  }
}

/* #275 首页贴纸构图（#274 定稿 B3 修订版）：两贴纸同在内容区右侧随手错落——游戏偏右上，
   惊喜相对游戏左移 --space-lg、下移 --size-star-hero，固定构图表达随手贴感，不随进入首页抽随机坐标。
   容器全幅锚定（inset: 0）+ 装饰层不拦点击，各贴纸独立绝对定位：
   留位语义——每张贴纸的位置只由自身构图决定、与另一张显隐无关，单贴纸/两张均隐藏均不跳位。 */
.home-stickers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.home-stickers > * {
  pointer-events: auto;
}

/* #275 B3 定稿坐标：游戏 `right: 0; top: var(--space-xl)`；入场动画见 sticker-land（下方） */
.game-sticker {
  position: absolute;
  top: var(--space-xl);
  right: 0;
  animation: sticker-land var(--duration-slow) ease-out both;
}

/* #275 B3 定稿坐标：惊喜 `right: var(--space-lg); top: calc(var(--space-xl) + var(--size-star-hero))`
   （对游戏左移 40px 档、下移 112px 档）；入场错开 --duration-fast 相位 */
.trivia-sticker {
  position: absolute;
  top: calc(var(--space-xl) + var(--size-star-hero));
  right: var(--space-lg);
  animation: sticker-land var(--duration-slow) ease-out var(--duration-fast) both;
}

/* #309 keeps the existing game/trivia artwork anchors; captions extend the clickable sticker below. */
.parent-sticker {
  position: absolute;
  top: var(--space-xl);
  left: var(--space-lg);
  animation: sticker-land var(--duration-slow) ease-out both;
}
.sticker-capsule {
  position: absolute;
  top: calc(100% + var(--space-xs));
  padding: var(--space-xs) var(--space-base);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-label);
  font-weight: 600;
  line-height: var(--leading-tight);
  white-space: nowrap;
}
.game-sticker .sticker-capsule {
  right: 0;
}

@keyframes sticker-land {
  0% {
    transform: translateY(calc(-1 * var(--space-md)));
  }
  65% {
    transform: translateY(var(--space-xs));
  }
  85% {
    transform: translateY(calc(-1 * var(--space-xs)));
  }
  100% {
    transform: translateY(0);
  }
}

/* #275 减弱动态守卫：系统 prefers-reduced-motion: reduce 时整层入场动画静止、直接静态落位 */
@media (prefers-reduced-motion: reduce) {
  .game-sticker,
  .trivia-sticker,
  .parent-sticker {
    animation: none;
  }
}

/* #231 贴纸画作共享样式（#276 review fixes 收口：游戏/惊喜两贴纸同形，页面私有样式内提取，不动全局 components.css）：
   同尺寸令牌 + 沿画作 alpha 轮廓的形状描边——drop-shadow 八向叠加近似等宽描边（斜向滑板形状不能用矩形边框），
   颜色走文本令牌，令牌换值自动跟随；游戏资产不需要知道宿主主题。
   描边偏移保留裸 px（2px / 1.4px）：drop-shadow 偏移是像素级描边宽度微调，不对应任何间距/尺寸语义，
   现无合适令牌可指（新增令牌须老板批准，见 docs/agents/design-uniformity.md），故此处刻意不令牌化。 */
.sticker-art {
  width: var(--touch-sm);
  height: var(--touch-sm);
  filter:
    drop-shadow(2px 0 0 var(--color-text)) drop-shadow(-2px 0 0 var(--color-text))
    drop-shadow(0 2px 0 var(--color-text)) drop-shadow(0 -2px 0 var(--color-text))
    drop-shadow(1.4px 1.4px 0 var(--color-text)) drop-shadow(1.4px -1.4px 0 var(--color-text))
    drop-shadow(-1.4px 1.4px 0 var(--color-text)) drop-shadow(-1.4px -1.4px 0 var(--color-text));
}

/* #271 惊喜贴纸画作：与游戏贴纸同规（共享 .sticker-art），仅图片路径不同，无自有样式 */

.game-session {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* #258 loading/failed 空态块：整幅覆盖（loading 期盖住仍在挂载的 iframe），app 深蓝底色令牌透出 + 纵横居中；
   failed 与 loading 同构仅文案不同 */
.game-hold {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-base);
  background-color: var(--color-bg);
}

.game-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
}

/* #258 running 态右上角常驻半透明 X：默认低调半透明（--opacity-muted 令牌），hover/聚焦提亮至全显；
   定位归页面（StarIconBtn 只管壳）；层级靠 DOM 顺序（.game-session 末子元素，绘制于 iframe 之上，
   与 .game-hold 互斥渲染不叠层），低于 toast（--z-toast 令牌）——评审收口：不建 z-index 层 */
.game-exit {
  position: absolute;
  top: var(--space-base);
  right: var(--space-base);
  opacity: var(--opacity-muted);
  transition: opacity var(--duration-fast) ease;
}

/* #131 触屏防护：hover 提亮包 hover-capable 媒体查询 */
@media (hover: hover) {
.game-exit:hover:not(:disabled) {
  opacity: 1;
}
}

.game-exit:focus-visible {
  opacity: 1;
}

.game-price {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-base);
  margin-bottom: var(--space-md);
  font-size: var(--font-size-body);
}

.home-main {
  position: relative;
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding-top: var(--space-xl);
  text-align: center;
}

/* 页脚：版本号小字 + 「配置」家长入口（触控 ≥ 44px，L3） */
.app-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  margin-top: auto;
  padding-top: var(--space-md);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}

/* config-link 样式已收编 components.css 跨页样式集（2026-09-03：Parent 组件库入口共用） */

/* 版本号可点击（检查更新入口）：视觉与纯文本版本号同形，仅加可点暗示（下划线）+ 按钮语义重置 */
.version-btn {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}

/* ===== 首页字号档位 class（自 App.vue 全局迁入，单页私有；#146 星夜童话：余额数字升 display 档 + 发光）===== */
.star-value {
  font-size: var(--font-size-display);
  line-height: 1;
  font-weight: 800;
  letter-spacing: var(--letter-spacing-title);
  color: var(--color-star);
  /* 发光预算三类之一：余额大数字 */
  text-shadow: var(--glow-num);
}

.balance-label {
  font-size: var(--font-size-label);
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* 星径余额区（#146）：balance-chip 样式集（components.css）在首页局部改纵向布局
   #147 星径移除：星上数下垂直构图，大星与数字行间距 --space-gutter */
.home-main .balance-chip {
  flex-direction: column;
  gap: var(--space-gutter);
  padding: 0;
}

.balance-num-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-base);
}

/* 余额大星：画师 PNG 素材 + 静态两级光晕令牌；
   呼吸微光动画接管 filter（微光两级起伏），动画未启动时静态令牌兜底
   主视觉档尺寸走 --size-star-hero 令牌（#153 令牌化：96–120px 区间平衡档 112px） */
.home-big-star {
  display: block;
  width: var(--size-star-hero);
  height: var(--size-star-hero);
  filter: var(--glow-star-svg);
  animation: star-breath var(--duration-breath) ease-in-out infinite;
}

/* 余额大星呼吸微光（#147 星径星群动画收编至大星独享：透明度 + 星光 drop-shadow 同步呼吸，探针 P1-r2 直译） */
@keyframes star-breath {
  0%,
  100% {
    opacity: 0.72;
    filter: drop-shadow(0 0 3px rgba(255, 209, 102, 0.4));
  }
  50% {
    opacity: 1;
    filter: drop-shadow(0 0 8px rgba(255, 209, 102, 0.85));
  }
}

.home-hint {
  font-size: var(--font-size-info);
  font-weight: 400;
}
</style>
