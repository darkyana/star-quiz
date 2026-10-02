/**
 * 一屏展示·票 A：外壳锁高与答题页试点（#49，父票 #40，ADR 0001）
 * 样式字符串断言 seam（沿用 styles-r15.test.ts 先例，批1 决策）。
 * #68：跨页四件套/底栏样式收编 components.css 样式集——布局链/令牌声明继续源码文本锁定，
 * 提取源跟随搬家（quizVue → componentsCss），模板结构断言留在页面源。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appVue = readFileSync(resolve(srcDir, 'App.vue'), 'utf-8')
const quizVue = readFileSync(resolve(srcDir, 'pages/Quiz.vue'), 'utf-8')
const componentsCss = readFileSync(resolve(srcDir, 'styles/components.css'), 'utf-8')
const progressBarVue = readFileSync(resolve(srcDir, 'components/StarProgressBar.vue'), 'utf-8')

/** 提取某选择器（类名，不含点）的首个规则块声明文本（剥离注释，只断言声明） */
function extractRule(css: string, className: string): string {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`, 's')
  const m = css.match(re)
  return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : ''
}

describe('AC1 外壳锁高三段结构（App.vue，ADR 0001）', () => {
  it('.app-shell 高度链 100%（html/body 100% + overflow hidden；#54 真机修正：iOS standalone 下 dvh 失准）', () => {
    const shell = extractRule(appVue, 'app-shell')
    expect(shell).toContain('height: 100%')
    expect(shell).not.toContain('dvh')
    expect(shell).toContain('display: flex')
    expect(shell).toContain('flex-direction: column')
    expect(shell).toContain('box-sizing: border-box')
    const htmlBody = appVue.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(htmlBody).toContain('height: 100%')
    expect(htmlBody).toContain('overflow: hidden')
    expect(htmlBody).toContain('overscroll-behavior: none')
    // 百分比链补遗：#app 无高度则外壳的 100% 对 auto 父级失效，壳被内容撑高、页内滚动失效
    expect(appVue).toMatch(/(?:^|\n)#app\s*\{[^}]*height: 100%/)
  })

  it('AC4 壳级 safe-area 避让：padding 含 env(safe-area-inset-top/bottom)', () => {
    const shell = extractRule(appVue, 'app-shell')
    expect(shell).toContain('env(safe-area-inset-top)')
    expect(shell).toContain('env(safe-area-inset-bottom)')
  })

  it('AC6-3 外壳三阶段不回归（#156）：基础块 480px + margin-inline auto 同块，≥600px 放宽到 640，≥1024px 放宽到 760', () => {
    const shell = extractRule(appVue, 'app-shell')
    expect(shell).toContain('max-width: 480px')
    expect(shell).toContain('margin-inline: auto')
    const stage600 = appVue.match(/@media \(min-width: 600px\)\s*\{[\s\S]*?\.app-shell\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(stage600).toContain('max-width: 640px')
    expect(stage600).not.toContain('max-width: 760px')
    const stage1024 = appVue.match(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.app-shell\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(stage1024).toContain('max-width: 760px')
    expect(stage1024).not.toContain('margin-inline')
  })

  it('零 position: fixed（ADR 0001）：外壳与答题页均无 fixed 定位', () => {
    expect(appVue).not.toContain('position: fixed')
    expect(quizVue).not.toContain('position: fixed')
  })
})

describe('AC1 答题页试点三段结构（Quiz.vue）', () => {
  it('.quiz-page 填满外壳：flex: 1 + flex 纵向 + 中和 [data-page] min-height + 清根 padding', () => {
    const page = extractRule(quizVue, 'quiz-page')
    expect(page).toContain('flex: 1')
    expect(page).toContain('display: flex')
    expect(page).toContain('flex-direction: column')
    expect(page).toContain('min-height: 0')
    expect(page).toContain('padding: 0')
  })

  it('.quiz-scroll 内容区独占滚动：四件套声明收编 components.css 的 page-scroll 样式集（#68），quiz-scroll 块仅留页面特有 padding', () => {
    const scroll = extractRule(componentsCss, 'page-scroll')
    expect(scroll).toContain('flex: 1')
    expect(scroll).toContain('min-height: 0')
    expect(scroll).toContain('overflow-y: auto')
    expect(scroll).toContain('overscroll-behavior: contain')
    expect(extractRule(quizVue, 'quiz-scroll')).toContain('padding:')
  })

  it('.quiz-scroll 自身无 transform/filter/will-change（#40 决策 10：fixed 覆盖层不错位）', () => {
    const scroll = extractRule(quizVue, 'quiz-scroll')
    expect(scroll).not.toContain('transform')
    expect(scroll).not.toContain('filter')
    expect(scroll).not.toContain('will-change')
  })

  it('顶栏不收缩恒可见：页内导航 flex-shrink: 0', () => {
    const nav = extractRule(quizVue, 'quiz-page :deep(.page-header)')
    expect(nav).toContain('flex-shrink: 0')
  })

  it('模板：题干/选项/反馈包在 .quiz-scroll 内容区内（#68 起并列挂 page-scroll 样式集类）', () => {
    expect(quizVue).toContain('class="quiz-scroll page-scroll"')
  })
})

describe('AC3 进度条吸顶（#200 升 registry：sticky 内置 StarProgressBar）', () => {
  it('组件内置 sticky 吸顶：position: sticky + top: 0（AC3 契约随组件走）', () => {
    const progress = extractRule(progressBarVue, 'star-progress-area')
    expect(progress).toContain('position: sticky')
    expect(progress).toContain('top: 0')
  })

  it('Quiz 页接线：内容区内挂 StarProgressBar（组件在唯一滚动容器内吸顶）', () => {
    expect(quizVue).toContain('<StarProgressBar')
  })
})

describe('AC2 底部操作栏常驻 + 未作答禁用（Quiz.vue）', () => {
  /** 提取模板中某标签的整块文本（含闭合；tag 含属性时闭合只用标签名） */
  function extractTag(source: string, tag: string): string {
    const name = tag.split(/\s+/)[0]
    return source.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${name}>`))?.[0] ?? ''
  }

  it('模板：footer.bottom-action-bar 常驻于题目区（不挂 v-if="answered"），内含主按钮流转 onNext', () => {
    const footer = extractTag(quizVue, 'footer class="bottom-action-bar"')
    expect(footer).toBeTruthy()
    expect(footer).toContain('class="next-btn"')
    expect(footer).toContain('<StarButtonStandard')
    expect(footer).toContain('@click="onNext"')
    expect(footer).not.toContain('v-if')
  })

  it('AC2 禁用态：next-btn 绑定 :disabled="!answered"（可见但禁用，作答后启用）', () => {
    const footer = extractTag(quizVue, 'footer class="bottom-action-bar"')
    expect(footer).toContain(':disabled="!answered"')
  })

  it('反馈文案留内容区：feedback-area 内挂 StarFeedbackBar 组件调用、无 next-btn（按钮已上移底栏，#198 组件化）', () => {
    const feedback = extractTag(quizVue, 'div v-if="answered" class="feedback-area"')
    expect(feedback).toBeTruthy()
    expect(feedback).toContain('<StarFeedbackBar')
    expect(feedback).not.toContain('next-btn')
  })

  it('.bottom-action-bar 不收缩恒可见：flex-shrink: 0（#68 收编 components.css 样式集）', () => {
    expect(extractRule(componentsCss, 'bottom-action-bar')).toContain('flex-shrink: 0')
  })

  it('AC5 既有锁定不回归：置灰规则收编进 StarButtonStandard disabled 态（去饱和 + 降透明 + not-allowed）', () => {
    const btnVue = readFileSync(resolve(srcDir, 'components/StarButtonStandard.vue'), 'utf-8')
    const disabled = btnVue.match(/\.star-button:disabled\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(disabled).toContain('cursor: not-allowed')
    expect(disabled).toContain('opacity')
  })
})
