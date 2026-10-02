/**
 * 一屏展示·票 D：浏览页与首页收口（#52，父票 #40，ADR 0001）
 * 批2 seam = 页面挂载 DOM 断言（先例 r15-dom.test.ts）+ 样式声明断言（先例 styles-onescreen.test.ts）。
 * 覆盖 #51 真机移交两问题：
 *   A 首页页脚落到折叠线以下 → [data-page] 弃 min-height:100dvh，改填满锁高外壳（flex:1 + min-height:0）
 *   B 内容不足一屏整页橡皮筋回弹 → html/body overflow hidden + overscroll-behavior none，
 *     各页滚动容器 overscroll-behavior contain
 * #68 断言分层重构：滚动四件套收编 components.css .page-scroll 样式集——
 *   (a) 样式集四件套声明（源码文本锁定）；(b) 各浏览页模板挂 page-scroll 类（挂载 DOM）；
 *   (c) 各页自身滚动块保留 no-transform/filter/will-change 负断言（源码文本锁定）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { ProposalRecord, QuizSession } from '../../types'
import Home from '../Home.vue'
import Redeem from '../Redeem.vue'
import StarLog from '../StarLog.vue'
import Proposals from '../Proposals.vue'
import ProposalDetail from '../ProposalDetail.vue'
import Parent from '../Parent.vue'
import ComponentsList from '../ComponentsList.vue'
import ComponentShowcase from '../ComponentShowcase.vue'
import Quiz from '../Quiz.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeProposals } from '../../composables/useProposals'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readSrc = (rel: string): string => readFileSync(resolve(srcDir, rel), 'utf-8')
const appVue = readSrc('App.vue')
const componentsCss = readSrc('styles/components.css')
const homeVue = readSrc('pages/Home.vue')

/** 提取某选择器（类名，不含点）的首个规则块声明文本（剥离注释，只断言声明）——沿 styles-onescreen 先例 */
function extractRule(css: string, className: string): string {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`, 's')
  const m = css.match(re)
  return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : ''
}

/** 滚动容器样式集四件套断言（#68 收编 components.css：内容区唯一滚动 + 滚动链不外传 + flex 收口） */
function expectScrollContainer(css: string, className: string): void {
  const rule = extractRule(css, className)
  expect(rule, `.${className} 规则块应存在`).toBeTruthy()
  expect(rule).toContain('flex: 1')
  expect(rule).toContain('min-height: 0')
  expect(rule).toContain('overflow-y: auto')
  expect(rule).toContain('overscroll-behavior: contain')
  // #40 决策 10：滚动容器自身禁用 transform/filter/will-change（fixed 覆盖层不错位）
  expect(rule).not.toContain('transform')
  expect(rule).not.toContain('filter')
  expect(rule).not.toContain('will-change')
}

function makeProposal(id: string): ProposalRecord {
  return {
    id,
    name: `提议${id}`,
    price: 5,
    description: `说明${id}`,
    status: 'discussing',
    createdAt: 1000,
    updatedAt: 1000,
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
  }
}

function seedQuizSession(): void {
  const session: QuizSession = {
    quizId: 'quiz_52',
    status: 'in_progress',
    questions: [
      {
        id: 'q_0',
        type: 'zh2en',
        prompt: '题目0',
        options: ['A', 'B', 'C', 'D'],
        answerIndex: 0,
        wordId: 'w_0',
      },
    ],
    currentIndex: 0,
    answers: [],
    correctCount: 0,
    createdAt: 1_000_000,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

/** 收口页表：路径 + data-page + 滚动容器类 + 挂载前种子 */
const CASES = [
  { path: '/', dataPage: 'home', scroll: '.home-scroll' },
  { path: '/redeem', dataPage: 'redeem', scroll: '.redeem-main' },
  { path: '/star-log', dataPage: 'star-log', scroll: '.log-main' },
  { path: '/proposals', dataPage: 'proposals', scroll: '.proposals-main' },
  { path: '/proposals/p1', dataPage: 'proposal-detail', scroll: '.detail-main' },
  { path: '/parent', dataPage: 'parent', scroll: '.parent-main' },
  { path: '/components', dataPage: 'components', scroll: '.components-main' },
  { path: '/components/star-button-standard', dataPage: 'component-showcase', scroll: '.showcase-main' },
] as const

const COMPONENTS = {
  '/': Home,
  '/redeem': Redeem,
  '/star-log': StarLog,
  '/proposals': Proposals,
  '/proposals/p1': ProposalDetail,
  '/parent': Parent,
  '/components': ComponentsList,
  '/components/star-button-standard': ComponentShowcase,
} as const

/** 9 个浏览页自身滚动块（#68 四件套搬出后页内仅留页面特有声明）：源文件 + 类名（负断言用） */
const SCROLL_BLOCKS = [
  { file: 'pages/Home.vue', cls: 'home-scroll' },
  { file: 'pages/Redeem.vue', cls: 'redeem-main' },
  { file: 'pages/StarLog.vue', cls: 'log-main' },
  { file: 'pages/Proposals.vue', cls: 'proposals-main' },
  { file: 'pages/ProposalDetail.vue', cls: 'detail-main' },
  { file: 'pages/Parent.vue', cls: 'parent-main' },
  { file: 'pages/ComponentsList.vue', cls: 'components-main' },
  { file: 'pages/ComponentShowcase.vue', cls: 'showcase-main' },
  { file: 'pages/Quiz.vue', cls: 'quiz-scroll' },
] as const

async function mountAt(path: string): Promise<VueWrapper> {
  if (path === '/proposals/p1') writeProposals([makeProposal('p1')])
  await router.replace(path)
  const wrapper = mount(COMPONENTS[path as keyof typeof COMPONENTS], { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('AC1 浏览页收口：页面根填满外壳、滚动语义落在内容区（挂载 DOM）', () => {
  for (const { path, dataPage, scroll } of CASES) {
    it(`${dataPage}：滚动容器 ${scroll} 是页面根直接子元素，顶栏不在滚动容器内（恒可见）`, async () => {
      const wrapper = await mountAt(path)
      const root = wrapper.get(`[data-page="${dataPage}"]`)
      const scrollEl = root.get(scroll)
      // 滚动容器位于页面根之下（顶栏之外的内容区）
      expect(scrollEl.element.parentElement).toBe(root.element)
      // 顶栏在页面根普通流（滚动容器之外），锁高后视觉等效固定（ADR 0001 决策 2）
      expect(root.find('.page-header').exists()).toBe(true)
      expect(scrollEl.find('.page-header').exists()).toBe(false)
      wrapper.unmount()
    })
  }

  it('答题页试点结构保持：quiz-scroll 为页面根直接子元素、顶栏不在其内', async () => {
    seedQuizSession()
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = mount(Quiz, { global: { plugins: [router] } })
    await flushPromises()
    const root = wrapper.get('[data-page="quiz"]')
    const scrollEl = root.get('.quiz-scroll')
    expect(scrollEl.element.parentElement).toBe(root.element)
    expect(scrollEl.find('.page-header').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('AC2 首页：页脚在结构上位于滚动容器内且贴底（挂载 DOM + 声明）', () => {
  it('页脚与主体同在 .home-scroll 内，页脚是最后一个子元素（贴底结构位）', async () => {
    const wrapper = await mountAt('/')
    const root = wrapper.get('[data-page="home"]')
    const scrollEl = root.get('.home-scroll')
    const footer = scrollEl.get('.app-footer')
    // 版本配置行（v0.13.0）随内容流，一屏内无需下拉可见（#52 真机问题 A）
    expect(footer.text()).toContain('V0.14.0')
    expect(scrollEl.element.querySelector('.home-main')).not.toBeNull()
    // 贴底：页脚是滚动容器最后一个子元素 + margin-top:auto（下方声明断言）
    const children = scrollEl.element.children
    expect(children[children.length - 1]).toBe(footer.element)
    // 云朵装饰留在页面根（滚动容器外）：不随内容滚动、不溢出不裁切
    expect(root.get('.clouds').element.parentElement).toBe(root.element)
    wrapper.unmount()
  })

  it('贴底声明：.home-scroll 页面特有纵向布局（#68 四件套已收编 components.css）+ .app-footer margin-top: auto + .home-main flex 伸展（滚动容器内仍生效）', () => {
    expect(extractRule(homeVue, 'home-scroll')).toContain('display: flex')
    expect(extractRule(homeVue, 'home-scroll')).toContain('flex-direction: column')
    expect(extractRule(homeVue, 'app-footer')).toContain('margin-top: auto')
    expect(extractRule(homeVue, 'home-main')).toContain('flex: 1 0 auto')
  })
})

describe('AC3 外壳收口点（App.vue 声明）', () => {
  it('html/body 溢出与回弹双向封口：overflow: hidden + overscroll-behavior: none（#52 真机问题 B）', () => {
    const htmlBody = appVue.match(/html,\s*\r?\n\s*body\s*\{[^}]*\}/)?.[0] ?? ''
    expect(htmlBody).toContain('overflow: hidden')
    expect(htmlBody).toContain('overscroll-behavior: none')
  })

  it('[data-page] 填满锁高外壳三件套：flex:1 + min-height:0 + flex 纵向，弃 min-height:100dvh（问题 A）', () => {
    const page = appVue.match(/\[data-page\]\s*\{[^}]*\}/)?.[0] ?? ''
    expect(page).toContain('flex: 1')
    expect(page).toContain('min-height: 0')
    expect(page).toContain('display: flex')
    expect(page).toContain('flex-direction: column')
    expect(page).not.toContain('min-height: 100dvh')
  })
})

describe('滚动容器四件套收口（#68 断言分层：样式集声明 / 挂载挂类 / 页内负断言）', () => {
  it('(a) 样式集声明：components.css 的 page-scroll 块含四件套，且自身无 transform/filter/will-change（fixed 覆盖层不错位）', () => {
    expectScrollContainer(componentsCss, 'page-scroll')
  })

  it('(b) 挂载 DOM：9 个浏览页模板滚动容器均挂 page-scroll 类（样式集生效钩子）', async () => {
    for (const { path, dataPage, scroll } of CASES) {
      const wrapper = await mountAt(path)
      const scrollEl = wrapper.get(`[data-page="${dataPage}"]`).get(scroll)
      expect(
        scrollEl.element.classList.contains('page-scroll'),
        `${dataPage} 的 ${scroll} 应挂 page-scroll 类`,
      ).toBe(true)
      wrapper.unmount()
    }
    seedQuizSession()
    await router.replace({ path: '/quiz', query: { start: '1' } })
    const wrapper = mount(Quiz, { global: { plugins: [router] } })
    await flushPromises()
    const scrollEl = wrapper.get('[data-page="quiz"]').get('.quiz-scroll')
    expect(scrollEl.element.classList.contains('page-scroll'), 'quiz 的 .quiz-scroll 应挂 page-scroll 类').toBe(true)
    wrapper.unmount()
  })

  it('(c) 页内负断言：各浏览页自身滚动块保留 no-transform/filter/will-change（#40 决策 10：fixed 覆盖层不错位）', () => {
    for (const { file, cls } of SCROLL_BLOCKS) {
      const rule = extractRule(readSrc(file), cls)
      expect(rule, `${file} 的 .${cls} 规则块应存在（页面特有声明留页内）`).toBeTruthy()
      expect(rule, `${file} 的 .${cls} 不得含 transform`).not.toContain('transform')
      expect(rule, `${file} 的 .${cls} 不得含 filter`).not.toContain('filter')
      expect(rule, `${file} 的 .${cls} 不得含 will-change`).not.toContain('will-change')
    }
  })
})
