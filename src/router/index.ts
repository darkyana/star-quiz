import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import Home from '../pages/Home.vue'
import Quiz from '../pages/Quiz.vue'
import Result from '../pages/Result.vue'
import Redeem from '../pages/Redeem.vue'
import Parent from '../pages/Parent.vue'
import QuestionPrompt from '../pages/QuestionPrompt.vue'
import ParentGuide from '../pages/ParentGuide.vue'
import FamilyAdmin from '../pages/FamilyAdmin.vue'
import StarLog from '../pages/StarLog.vue'
import ComponentsList from '../pages/ComponentsList.vue'
import ComponentShowcase from '../pages/ComponentShowcase.vue'
import Proposals from '../pages/Proposals.vue'
import ProposalEdit from '../pages/ProposalEdit.vue'
import ProposalDetail from '../pages/ProposalDetail.vue'
import Prizes from '../pages/Prizes.vue'
import Pair from '../pages/Pair.vue'
import PairWait from '../pages/PairWait.vue'
import { deviceRole } from '../composables/useDeviceRole'
import { onNavigationSync } from '../cloud/sync'
import { IS_MINITOOL } from '../minitool'

// 小工具构建（IS_MINITOOL）：云端三页整组不注册——容器纯离线，配对/轮询/家庭管理接口不可达；
// 页面组件 import 随条件展开的 DCE 一并移出产物。日常构建（PWA）零改动
const cloudRoutes: RouteRecordRaw[] = [
  // #132 家庭管理页：家长页「设备与家庭」管理区整段搬迁（批准块置顶 / 名册 / 家庭码 / 快照四段，各独立容器）；
  // 组件级 canManageDevices 防线保留，child 守卫沿 /parent 子路径惯例不加
  { path: '/parent/family', component: FamilyAdmin },
  // #125（R-P1c）：设备配对页——输码 / 命名 / 选角色 / 提交 /api/pair；入口在 Home 页脚（仅未配对时渲染）
  { path: '/pair', component: Pair },
  // #142（R-129a）：申请等待页——pending 申请（真/假同构）每 ~5 秒轮询状态，批准后回首页；无凭据直达回配对页
  { path: '/pair-wait', component: PairWait },
]

// hash 路由契约表（Spec §3.1）：6 行 + 未知路径重定向 #/
// C1 组件库预览页（定义单 §6）：/components 列表页 + /components/:componentKey 展示页，插在 catch-all 之前
// R32 提议空间（Spec 20260827-R32 REQ-R32-1）：提议板列表 + 新建/编辑表单（复用同组件）+ 详情，/proposals/new 静态段优先于 /proposals/:id
// R34 孩子端提议板（Spec 20260828-R34 REQ-R34-1）：独立路由组 /child/proposals 复用同三页面组件，
// meta.view='child' 视角标记（页面按此渲染孩子视角），家长端既有路由路径与语义零改动；静态段顺序同家长端
const routes: RouteRecordRaw[] = [
  { path: '/', component: Home },
  { path: '/quiz', component: Quiz },
  { path: '/result', component: Result },
  { path: '/redeem', component: Redeem },
  // #308 Informational guide is local-only and available in minitool too.
  { path: '/parent-guide', component: ParentGuide },
  { path: '/parent', component: Parent },
  // #136 家长页「出题指令」生成器：/parent 子路径（child 守卫只拦 /parent 本身，子路径沿既有惯例不加守卫）
  { path: '/parent/question-prompt', component: QuestionPrompt },
  ...(IS_MINITOOL ? [] : cloudRoutes),
  { path: '/star-log', component: StarLog },
  // R-72-1（#73）：「我的奖品」（进行中兑换券列表），入口在兑换页底部链接区
  { path: '/prizes', component: Prizes },
  { path: '/components', component: ComponentsList },
  { path: '/components/:componentKey', component: ComponentShowcase },
  { path: '/proposals', component: Proposals },
  { path: '/proposals/new', component: ProposalEdit },
  { path: '/proposals/:id/edit', component: ProposalEdit },
  { path: '/proposals/:id', component: ProposalDetail },
  { path: '/child/proposals', component: Proposals, meta: { view: 'child' } },
  { path: '/child/proposals/new', component: ProposalEdit, meta: { view: 'child' } },
  { path: '/child/proposals/:id/edit', component: ProposalEdit, meta: { view: 'child' } },
  { path: '/child/proposals/:id', component: ProposalDetail, meta: { view: 'child' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// #125 家长入口 gating（#84）：孩子设备构造上不存在家长入口——/parent 重定向回首页；
// 未配对设备维持现状（配置链接照常在，纯本地形态零改动，#120 口径）
// #252 设备角色统一出口：守卫维持同步即时读口径，取值换 deviceRole()
// #208 导航驱动拉取（唯一新触发收口点，全局守卫一处）：每次导航触发一轮同步（引擎侧自做
// 未配对 gating 与进行中去重 + 短节流 trailing）；守卫不等待拉取结果（AC6 导航零阻塞）
router.beforeEach((to) => {
  // 小工具构建：导航拉取随云端能力一并移出
  if (!IS_MINITOOL) onNavigationSync()
  if (to.path === '/parent' && deviceRole() === 'child') {
    return { path: '/' }
  }
})

export default router
