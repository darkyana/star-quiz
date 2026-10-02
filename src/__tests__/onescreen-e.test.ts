/**
 * 一屏展示·票 E：编辑提议与结果页底部操作栏（#53，父票 #40，ADR 0001）
 * 模板/样式字符串断言沿用 styles-onescreen.test.ts 先例；页面收口行为用挂载 DOM 断言（批2 决策，r15-dom 先例）。
 * 禁用粒度说明：保存按钮在「必填两项全空」时禁用而非隐藏；部分填写但非法时仍可点，
 * 走 R32 校验提示槽位（REQ-R32-3-4 点击路径与现状一致，零写入）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ProposalEdit from '../pages/ProposalEdit.vue'
import Result from '../pages/Result.vue'
import type { ProposalRecord, Question, QuizSession } from '../types'
import { router } from '../router'
import { copy } from '../copy'
import { init as initAppState } from '../composables/useDataInfra'
import { writeProposals, proposals as readProposals } from '../composables/useProposals'
import '../composables/useStarData'
import '../composables/useLearningData'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const editVue = readFileSync(resolve(srcDir, 'pages/ProposalEdit.vue'), 'utf-8')
const resultVue = readFileSync(resolve(srcDir, 'pages/Result.vue'), 'utf-8')
// #68：底栏样式收编 components.css 样式集，flex-shrink 断言提取源跟随搬家
const componentsCss = readFileSync(resolve(srcDir, 'styles/components.css'), 'utf-8')

/** 提取某选择器（类名，不含点）的首个规则块声明文本（剥离注释，只断言声明） */
function extractRule(css: string, className: string): string {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`, 's')
  const m = css.match(re)
  return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : ''
}

/** 提取模板中某标签的整块文本（含闭合；tag 含属性时闭合只用标签名） */
function extractTag(source: string, tag: string): string {
  const name = tag.split(/\s+/)[0]
  return source.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${name}>`))?.[0] ?? ''
}

function makeProposal(id: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id,
    name: `提议${id}`,
    price: 3,
    description: `说明${id}`,
    status: 'discussing',
    createdAt: 1000,
    updatedAt: 1000,
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

function makeQuestions(count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q_${i}`,
    type: 'zh2en',
    prompt: `题目${i}`,
    options: ['A', 'B', 'C', 'D'],
    answerIndex: 0,
    wordId: `w_${i}`,
  }))
}

function seedSession(partial: Partial<QuizSession>, count = 10): void {
  const session: QuizSession = {
    quizId: 'quiz_e',
    status: 'pending',
    questions: makeQuestions(count),
    currentIndex: count,
    answers: makeQuestions(count).map((q) => ({ questionId: q.id, selectedIndex: 0, correct: true })),
    correctCount: 0,
    createdAt: 1_000_000,
    ...partial,
  }
  localStorage.setItem('sq_session', JSON.stringify(session))
}

/** 同步推进 rAF：得星数字动画在挂载断言前收敛到终值 */
function stubRaf(): void {
  let now = 0
  vi.stubGlobal(
    'requestAnimationFrame',
    ((cb: (t: number) => void): number => {
      now += 100
      cb(now)
      return now
    }) as typeof requestAnimationFrame,
  )
}

async function mountEdit(): Promise<VueWrapper> {
  const wrapper = mount(ProposalEdit, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  localStorage.setItem('sq_stars', JSON.stringify([]))
  router.replace('/')
  vi.unstubAllGlobals()
})

describe('AC1 ProposalEdit 一屏三段结构（模板/样式）', () => {
  it('.proposal-edit-page 填满外壳：flex: 1 + flex 纵向 + 中和 [data-page] min-height + 清根 padding', () => {
    const page = extractRule(editVue, 'proposal-edit-page')
    expect(page).toContain('flex: 1')
    expect(page).toContain('display: flex')
    expect(page).toContain('flex-direction: column')
    expect(page).toContain('min-height: 0')
    expect(page).toContain('padding: 0')
  })

  it('.edit-scroll 内容区独占滚动：flex: 1 + min-height: 0 + overflow-y: auto，且自身无 transform/filter/will-change', () => {
    const scroll = extractRule(editVue, 'edit-scroll')
    expect(scroll).toContain('flex: 1')
    expect(scroll).toContain('min-height: 0')
    expect(scroll).toContain('overflow-y: auto')
    expect(scroll).not.toContain('transform')
    expect(scroll).not.toContain('filter')
    expect(scroll).not.toContain('will-change')
  })

  it('顶栏不收缩恒可见：页内导航 flex-shrink: 0', () => {
    const nav = extractRule(editVue, 'proposal-edit-page :deep(.page-header)')
    expect(nav).toContain('flex-shrink: 0')
  })

  it('.bottom-action-bar 不收缩恒可见：flex-shrink: 0（#68 收编 components.css 样式集）', () => {
    expect(extractRule(componentsCss, 'bottom-action-bar')).toContain('flex-shrink: 0')
  })

  it('模板：长表单主内容包在 .edit-scroll 内容区内', () => {
    expect(editVue).toContain('class="edit-scroll"')
  })
})

describe('AC1 ProposalEdit 底部操作栏常驻 + 前置条件禁用（模板/样式）', () => {
  it('footer.bottom-action-bar 常驻（自身无 v-if），内含主按钮 form-save-btn 流转 onSave', () => {
    const footer = extractTag(editVue, 'footer class="bottom-action-bar"')
    expect(footer).toBeTruthy()
    expect(footer).toContain('class="form-save-btn"')
    expect(footer).toContain('<StarButtonStandard')
    expect(footer).toContain('@click="onSave"')
    expect(footer).not.toContain('v-if')
  })

  it('禁用态绑定：主按钮 :disabled="formBlank"（必填全空禁用而非隐藏）', () => {
    const footer = extractTag(editVue, 'footer class="bottom-action-bar"')
    expect(footer).toContain(':disabled="formBlank"')
  })

  it('表单卡内不含主按钮：proposal-form（#58 已挂 star-container 样式集）保留三字段与校验提示槽位，无 form-save-btn', () => {
    const form = extractTag(editVue, 'form class="proposal-form star-container"')
    expect(form).toBeTruthy()
    expect(form).toContain('form-name-input')
    expect(form).toContain('form-price-input')
    expect(form).toContain('form-validation-hint')
    expect(form).not.toContain('form-save-btn')
  })
})

describe('AC1 ProposalEdit 底部操作栏行为（挂载 DOM）', () => {
  it('新建空表单：保存常驻底栏但禁用（前置条件未满足 → 禁用而非隐藏）；填入名称后启用', async () => {
    await router.replace('/proposals/new')
    const wrapper = await mountEdit()
    const save = wrapper.get('.bottom-action-bar .form-save-btn')
    expect(save.text()).toBe(copy.proposals.form.saveBtn)
    expect((save.element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('.form-name-input').setValue('乐高')
    expect((wrapper.get('.bottom-action-bar .form-save-btn').element as HTMLButtonElement).disabled).toBe(false)
    wrapper.unmount()
  })

  it('部分填写非法（消耗 0）：按钮可点 → 校验提示槽位显示 + 零写入 + 不跳转（点击路径与现状一致）', async () => {
    await router.replace('/proposals/new')
    const wrapper = await mountEdit()
    await wrapper.get('.form-name-input').setValue('乐高')
    await wrapper.get('.form-price-input').setValue('0')
    const save = wrapper.get('.bottom-action-bar .form-save-btn')
    expect((save.element as HTMLButtonElement).disabled).toBe(false)
    await save.trigger('click')
    await flushPromises()
    expect(wrapper.find('.form-validation-hint').exists()).toBe(true)
    expect(readProposals()).toHaveLength(0)
    expect(router.currentRoute.value.path).toBe('/proposals/new')
    wrapper.unmount()
  })

  it('合法表单点底栏「保存」→ 追加 1 条 + 返回同视角列表（点击行为不变）', async () => {
    await router.replace('/proposals/new')
    const wrapper = await mountEdit()
    await wrapper.get('.form-name-input').setValue('公园野餐')
    await wrapper.get('.form-price-input').setValue('5')
    await wrapper.get('.form-desc-input').setValue('周六去')
    await wrapper.get('.bottom-action-bar .form-save-btn').trigger('click')
    await flushPromises()
    expect(readProposals()).toHaveLength(1)
    expect(readProposals()[0]!.name).toBe('公园野餐')
    expect(router.currentRoute.value.path).toBe('/proposals')
    wrapper.unmount()
  })

  it('终态提议：表单不渲染时底部操作栏随之不渲染（REQ-R32-3-5 零写入路径）', async () => {
    writeProposals([makeProposal('p1', { status: 'published' })])
    await router.replace('/proposals/p1/edit')
    const wrapper = await mountEdit()
    expect(wrapper.find('.proposal-form').exists()).toBe(false)
    expect(wrapper.find('.bottom-action-bar').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('AC1 Result 一屏三段结构（模板/样式）', () => {
  it('.result-page 填满外壳：flex: 1 + flex 纵向 + 中和 [data-page] min-height + 清根 padding', () => {
    const page = extractRule(resultVue, 'result-page')
    expect(page).toContain('flex: 1')
    expect(page).toContain('display: flex')
    expect(page).toContain('flex-direction: column')
    expect(page).toContain('min-height: 0')
    expect(page).toContain('padding: 0')
  })

  it('.result-scroll 内容区独占滚动：flex: 1 + min-height: 0 + overflow-y: auto，且自身无 transform/filter/will-change', () => {
    const scroll = extractRule(resultVue, 'result-scroll')
    expect(scroll).toContain('flex: 1')
    expect(scroll).toContain('min-height: 0')
    expect(scroll).toContain('overflow-y: auto')
    expect(scroll).not.toContain('transform')
    expect(scroll).not.toContain('filter')
    expect(scroll).not.toContain('will-change')
  })

  it('.bottom-action-bar 不收缩恒可见：flex-shrink: 0（#68 收编 components.css 样式集）', () => {
    expect(extractRule(componentsCss, 'bottom-action-bar')).toContain('flex-shrink: 0')
  })
})

describe('AC1/AC3 Result 底部操作栏常驻可点 + 彩带结构（模板/样式）', () => {
  it('footer.bottom-action-bar 常驻（无 v-if），内含主按钮 go-home-btn 流转 goHome', () => {
    const footer = extractTag(resultVue, 'footer class="bottom-action-bar"')
    expect(footer).toBeTruthy()
    expect(footer).toContain('class="go-home-btn"')
    expect(footer).toContain('<StarButtonStandard')
    expect(footer).toContain('@click="goHome"')
    expect(footer).not.toContain('v-if')
  })

  it('结果页无前置条件：footer 主按钮不绑 :disabled（常驻可点）', () => {
    const footer = extractTag(resultVue, 'footer class="bottom-action-bar"')
    expect(footer).not.toContain(':disabled')
  })

  it('内容区不含主按钮与彩带：result-scroll 内保留结算主视觉，无 go-home-btn / confetti（彩带已上移页面根）', () => {
    const main = extractTag(resultVue, 'main class="result-scroll"')
    expect(main).toBeTruthy()
    expect(main).toContain('result-main')
    expect(main).not.toContain('confetti')
    expect(main).not.toContain('go-home-btn')
  })

  it('AC3 彩带已随 #146 动效预算移除（星星系之外装饰动画清零）：confetti 模板 / 规则 / 关键帧零残留防回潮', () => {
    expect(resultVue).not.toContain('confetti')
    expect(resultVue).not.toContain('@keyframes confetti-fall')
    expect(resultVue).not.toContain('pieceStyle')
    // 整页定位基准保留（防内层定位回退）
    const page = extractRule(resultVue, 'result-page')
    expect(page).toContain('position: relative')
  })
})

describe('AC1/AC2 Result 底部操作栏行为（挂载 DOM）', () => {
  it('满分结算：回到首页常驻底栏可点、内容区无按钮、全页唯一按钮', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 10, correctCount: 10, earnedStars: 13, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    const btn = wrapper.get('.bottom-action-bar .go-home-btn')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    expect(btn.text()).toBe(copy.result.goHome)
    expect(wrapper.find('.result-main button').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(1)
    // #146 动效预算：满分也不再渲染彩带（满分庆祝由文案 + 发光主视觉承担）
    expect(wrapper.find('.confetti').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点击底栏「回到首页」→ 清会话 + 回首页（点击行为不变）', async () => {
    stubRaf()
    seedSession({ status: 'settled', score: 8, correctCount: 8, earnedStars: 8, settledAt: 2_000_000 })
    await router.replace('/result')
    const wrapper = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('.bottom-action-bar .go-home-btn').trigger('click')
    await flushPromises()
    expect(localStorage.getItem('sq_session')).toBeNull()
    expect(router.currentRoute.value.path).toBe('/')
    wrapper.unmount()
  })
})

describe('ADR 0001 硬约束', () => {
  it('两页零 position: fixed', () => {
    expect(editVue).not.toContain('position: fixed')
    expect(resultVue).not.toContain('position: fixed')
  })
})
