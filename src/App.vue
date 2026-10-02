<script setup lang="ts">
// #172 全局损坏恢复 Toast（外壳宿主）：useCorruptionNotice 模块级 ref 承载文案，
// StarToastStandard（#139 共享组件）自管 2400ms 计时；路由切换 = 「下次非答题时机」，补弹答题中被延后的提示。
// #174 数据安全持续横幅（外壳宿主）：useSafetyNotice 两类持续异常态（升级被拦 / 协议不兼容），
// 样式集 .safety-banner（components.css），故障解除自动消失，不阻塞任何页面操作。
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import StarToastStandard from './components/StarToastStandard.vue'
import { corruptionNotice, clearCorruptionNotice, flushCorruptionNotice } from './composables/useCorruptionNotice'
import { dataUpgradeBlocked, syncProtocolIncompatible } from './composables/useSafetyNotice'
import { copy } from './copy'

const route = useRoute()
const notice = corruptionNotice()

const safetyNotice = computed(() => {
  if (dataUpgradeBlocked.value) return copy.dataSafety.upgradeBlocked
  if (syncProtocolIncompatible.value) return copy.dataSafety.syncIncompatible
  return ''
})

watch(
  () => route.fullPath,
  () => {
    flushCorruptionNotice()
  },
)
</script>

<template>
  <div class="app-shell">
    <!-- 夜空星子层（#152 G1/G13）：全 app 共享背景装饰——散落四芒星微光 + twinkle 微闪，
         密度克制（探针 sky 观感）；pointer-events: none、层级 --z-sky（内容之下，水印/弹窗之下） -->
    <div class="app-sky" aria-hidden="true">
      <svg class="app-sky__spark" style="top: 11%; left: 13%" viewBox="0 0 24 24" width="13" height="13">
        <path d="M12 2 Q13.6 10.4 22 12 Q13.6 13.6 12 22 Q10.4 13.6 2 12 Q10.4 10.4 12 2 Z" fill="currentColor" />
      </svg>
      <svg class="app-sky__spark app-sky__spark--pale app-sky__spark--alt" style="top: 21%; right: 19%" viewBox="0 0 24 24" width="10" height="10">
        <path d="M12 2 Q13.6 10.4 22 12 Q13.6 13.6 12 22 Q10.4 13.6 2 12 Q10.4 10.4 12 2 Z" fill="currentColor" />
      </svg>
      <svg class="app-sky__spark app-sky__spark--pale" style="top: 38%; left: 7%; animation-delay: -2.4s" viewBox="0 0 24 24" width="9" height="9">
        <path d="M12 2 Q13.6 10.4 22 12 Q13.6 13.6 12 22 Q10.4 13.6 2 12 Q10.4 10.4 12 2 Z" fill="currentColor" />
      </svg>
      <svg class="app-sky__spark app-sky__spark--alt" style="top: 51%; right: 8%" viewBox="0 0 24 24" width="12" height="12">
        <path d="M12 2 Q13.6 10.4 22 12 Q13.6 13.6 12 22 Q10.4 13.6 2 12 Q10.4 10.4 12 2 Z" fill="currentColor" />
      </svg>
      <svg class="app-sky__spark app-sky__spark--pale" style="top: 68%; left: 24%; animation-delay: -1.2s" viewBox="0 0 24 24" width="10" height="10">
        <path d="M12 2 Q13.6 10.4 22 12 Q13.6 13.6 12 22 Q10.4 13.6 2 12 Q10.4 10.4 12 2 Z" fill="currentColor" />
      </svg>
      <svg class="app-sky__spark" style="top: 84%; left: 62%; animation-delay: -3s" viewBox="0 0 24 24" width="11" height="11">
        <path d="M12 2 Q13.6 10.4 22 12 Q13.6 13.6 12 22 Q10.4 13.6 2 12 Q10.4 10.4 12 2 Z" fill="currentColor" />
      </svg>
    </div>
    <!-- #174 数据安全持续横幅（全局唯一宿主，空串 = 不显示；升级被拦优先于协议不兼容） -->
    <div v-if="safetyNotice !== ''" class="safety-banner" role="alert">{{ safetyNotice }}</div>
    <router-view />
    <!-- #172 家底键损坏恢复提示（全局唯一 Toast 宿主，message 空 = 不显示） -->
    <StarToastStandard :message="notice" @expired="clearCorruptionNotice" />
  </div>
</template>

<style>
html,
body {
  margin: 0;
  /* 一屏展示批2（#52）：外壳锁高后页面外层永不滚动（ADR 0001 Consequence）；
     overscroll 封顶整页橡皮筋回弹与滚动链外传（#51 真机问题 B）。
     高度链（#54 真机修正）：html/body height:100% 替代视口单位——iOS standalone 下
     dvh 口径失准（外壳比真实可视区矮一截，底部露白、内容被顶起），而文档滚动已锁死、
     URL 栏永不折叠，100% 在 Safari 与主屏 standalone 两种模式下都精确等于可视高度。 */
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  /* #146 星夜童话：外壳夜幕纵深 = 顶部渐晕抬升一档（bg-lift）→ 夜空基准（bg）→ 底部渐深（bg-accent），
     与探针 P1-r2 手机框三段纵深同构；PWA 窗口底色与渐变底部 bg-accent 一致 */
  background:
    radial-gradient(120% 60% at 50% -10%, var(--color-bg-lift) 0%, transparent 60%),
    linear-gradient(180deg, var(--color-bg-lift) 0%, var(--color-bg) 46%, var(--color-bg-accent) 100%);
  color: var(--color-text);
  font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* 挂载根（#54 补遗）：html/body height:100% 的百分比链须经 #app 传递——
   #app 无高度时外壳的 height:100% 对 auto 父级失效、壳被内容撑高，
   页内 overflow-y:auto 永不触发滚动，超屏内容被 body overflow:hidden 裁掉（唇边阴影被切的根因） */
#app {
  height: 100%;
}

/* 一屏展示外壳（ADR 0001 / #49）：锁一屏高 + flex 纵向三段（顶栏 / 内容区滚动 / 底部操作栏）。
   顶栏不全局化，留在页内普通流，锁高后视觉等效固定；内容超出时仅内容区内部滚动。
   壳级 safe-area 避让：渐变背景从页面底层透出，不新增底色（#40 决策 5）。 */
.app-shell {
  position: relative;
  /* #155/#156 外壳列宽三阶段（宽度断点，orientation 无关）：视口 <600px 上限 480（手机档现状）；
     ≥600px 上限 640（单列内容超过 600 即显空旷的内容经验值，非设备型号值）；
     ≥1024px 上限 760（iPad 横屏宽档，配合答题页两列选项）。居中方式不变 */
  max-width: 480px;
  margin-inline: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
}

/* #155 阶段二：大屏视口放宽内容列上限（一屏锁高与三段结构不变，仍无 fixed 定位） */
@media (min-width: 600px) {
  .app-shell {
    max-width: 640px;
  }
}

/* #156 阶段三：≥1024px 宽视口（iPad 横屏档）放宽内容列上限至 760，
   配合答题页宽档两列选项；一屏锁高与三段结构不变，仍无 fixed 定位 */
@media (min-width: 1024px) {
  .app-shell {
    max-width: 760px;
  }
}

/* 页面骨架根元素（批2 收口 #52）：填满锁高外壳（flex:1 + min-height:0 三件套，弃批1 前的
   min-height:100dvh——与外壳 height:100dvh − safe-area insets 冲突致页面根溢出约 90px，首页页脚
   落到折叠线以下，#51 真机问题 A）；附带 flex 纵向骨架，顶栏留普通流恒可见，仅内容区滚动。
   统一背景透出顶部渐晕（Spec R15 AC-R15-1-4）
   #152 星子层 z 抬升：position + z-index 建立 stacking context，让页面内容整体绘制在
   外壳星子层（app-sky，--z-sky）之上——星子不遮内容；页内 fixed 覆盖层（水印/弹窗/toast）
   在本 context 内层级仍高于星子层，绘制顺序不受影响 */
[data-page] {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ===== 页面骨架（全 app 共用）===== */
/* 底 padding 归零（#54 补遗 2）：锁高链接通后这 64px 真正显形为页底渐变空条——
   挤掉滚动区高度（提议板列表提前截断）并顶掉 Home 一屏贴底页脚（配置/版本号）。
   底部呼吸改由各滚动容器自身 padding-bottom 承担（沿 Quiz/Result「根 padding 移交内容区」惯例），
   iOS 安全区避让仍在壳级 env(safe-area-inset-bottom) */
.page {
  padding: var(--space-gutter) var(--space-page) 0;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: var(--touch-lg);
  padding: var(--space-gutter) var(--space-page);
}

.page-title {
  margin: 0;
  font-size: var(--font-size-topbar);
  font-weight: 800;
  letter-spacing: var(--letter-spacing-title);
  color: var(--color-text);
  text-align: center;
}

/* ===== 样式三归宿（design-uniformity，2026-08-30 迁移）：本文件只承载外壳与页面骨架 =====
   全局 btn 系已收编 StarButtonStandard（C1）；答题选项（option / option-skip）随 Quiz 页 scoped；
   balance-chip（三页共用样式集）→ src/styles/components.css；首页字号档位类随 Home 页 scoped；
   brand（C3Re1 后零引用）和 btn-reward（宿主 btn 系退役后零引用）死代码删除。
   跨页复用样式集一律进 components.css；单页样式进各页 scoped；App.vue 不再新增其他规则
   （唯一例外：#152 拍板的夜空星子层——归宿即外壳背景层，全 app 共享装饰）。 */

/* ===== 夜空星子层（#152 G1/G13，探针 P1-r2 sky 层直译）=====
   散落四芒星（金星 + 米白 pale 两色）+ twinkle 微闪（透明度 + 缩放两级起伏，4s 档）；
   密度克制（全屏 6 颗，探针单屏 2–4 颗的并集观感）；纯装饰不参与交互；星子绘制在
   页面内容之下（--z-sky），不遮内容、不挡水印/弹窗 */
.app-sky {
  position: absolute;
  inset: 0;
  z-index: var(--z-sky);
  overflow: hidden;
  pointer-events: none;
}

.app-sky__spark {
  position: absolute;
  color: var(--color-star);
  animation: twinkle var(--duration-twinkle) ease-in-out infinite;
}

.app-sky__spark--pale {
  color: var(--color-star-pale);
}

.app-sky__spark--alt {
  animation-duration: calc(var(--duration-twinkle) * 1.5);
  animation-delay: -1.8s;
}

/* 星子微闪（探针 twinkle keyframes 直译：透明度 0.4↔0.9 + 缩放 0.86↔1） */
@keyframes twinkle {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.86);
  }
  50% {
    opacity: 0.9;
    transform: scale(1);
  }
}
</style>
