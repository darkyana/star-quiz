/**
 * 页面样式行为契约（#95 归并：原 styles-r2 / styles-r15 / styles-r25 的行为与布局断言）
 * 覆盖：字号档位落位映射 / hover 态 / 组件视觉两态 / 星形 SVG 平星契约 / 页面局部规则；
 * 纯令牌存在性与取值断言已收拢至 styles-tokens.test.ts，本文件不再重复。
 * 全部为样式文件文本断言（Spec §8 风险表：不依赖 jsdom 布局计算）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const variablesCss = readFileSync(resolve(srcDir, 'styles/variables.css'), 'utf-8')
const appVue = readFileSync(resolve(srcDir, 'App.vue'), 'utf-8')
const quizVue = readFileSync(resolve(srcDir, 'pages/Quiz.vue'), 'utf-8')
const homeVue = readFileSync(resolve(srcDir, 'pages/Home.vue'), 'utf-8')
const resultVue = readFileSync(resolve(srcDir, 'pages/Result.vue'), 'utf-8')
const redeemVue = readFileSync(resolve(srcDir, 'pages/Redeem.vue'), 'utf-8')
const prizesVue = readFileSync(resolve(srcDir, 'pages/Prizes.vue'), 'utf-8')
const starLogVue = readFileSync(resolve(srcDir, 'pages/StarLog.vue'), 'utf-8')
const parentVue = readFileSync(resolve(srcDir, 'pages/Parent.vue'), 'utf-8')
const modalComponentVue = readFileSync(resolve(srcDir, 'components/StarModalStandard.vue'), 'utf-8')
const iconBtnVue = readFileSync(resolve(srcDir, 'components/StarIconBtn.vue'), 'utf-8')
const btnVue = readFileSync(resolve(srcDir, 'components/StarButtonStandard.vue'), 'utf-8')
const toastComponentVue = readFileSync(resolve(srcDir, 'components/StarToastStandard.vue'), 'utf-8')
const glyphVue = readFileSync(resolve(srcDir, 'components/StarGlyph.vue'), 'utf-8')
const feedbackBarVue = readFileSync(resolve(srcDir, 'components/StarFeedbackBar.vue'), 'utf-8')
const optionRowVue = readFileSync(resolve(srcDir, 'components/StarOptionRow.vue'), 'utf-8')
const rewardItemVue = readFileSync(resolve(srcDir, 'components/StarRewardItem.vue'), 'utf-8')
const componentsCss = readFileSync(resolve(srcDir, 'styles/components.css'), 'utf-8')

/** 提取 .vue 文件全部 style 段拼接（extractRule 只扫样式，避免模板插值被误匹配） */
function styleOf(text: string): string {
  const parts: string[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) parts.push(m[1])
  return parts.join('\n')
}

const quizStyle = styleOf(quizVue)
const homeStyle = styleOf(homeVue)

/** 提取某选择器（类名，不含点）的首个规则块声明文本 */
function extractRule(css: string, className: string): string {
  const re = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`, 's')
  const m = css.match(re)
  return m ? m[1] : ''
}

/** #131 触屏防护：扫描样式文本，返回全部含 hover 伪类的规则块头部及其是否处于 hover-capable 媒体查询内 */
function scanHoverRules(styleText: string): { header: string; guarded: boolean }[] {
  const text = styleText.replace(/\/\*[\s\S]*?\*\//g, '')
  const stack: string[] = []
  const found: { header: string; guarded: boolean }[] = []
  let header = ''
  for (const ch of text) {
    if (ch === '{') {
      if (header.includes(':hover')) {
        found.push({
          header: header.trim().replace(/\s+/g, ' '),
          guarded: stack.some((h) => /@media[^{]*\(\s*hover:\s*hover\s*\)/.test(h)),
        })
      }
      stack.push(header)
      header = ''
    } else if (ch === '}') {
      stack.pop()
      header = ''
    } else {
      header += ch
    }
  }
  return found
}

/* ===== 原styles-r2：按钮收编 / hover / chip 间距 / 首页档位（AC9-2 ~ AC9-5）===== */

describe('AC9-2 按钮零描边 + 唇边（样式三归宿迁移后，原 R2）', () => {
  it('全局 btn 系已收编 StarButtonStandard（App.vue 不再含 btn-primary / btn-secondary / btn-sm / icon-btn / star-btn 规则）', () => {
    expect(extractRule(appVue, 'btn-primary')).toBe('')
    expect(extractRule(appVue, 'btn-secondary')).toBe('')
    expect(extractRule(appVue, 'btn-sm')).toBe('')
    expect(extractRule(appVue, 'icon-btn')).toBe('')
    expect(extractRule(appVue, 'star-btn')).toBe('')
  })

  it('App.vue 纯外壳锁定（三归宿迁移）：不再含 option 系 / balance-chip / 首页档位类 / 死类规则（tagline 类已随 #108 定稿 D 退役删除）', () => {
    for (const cls of ['option', 'option-skip', 'balance-chip', 'star-value', 'brand', 'tagline', 'balance-label', 'home-hint', 'btn-reward']) {
      expect(extractRule(appVue, cls), `${cls} 类应已迁出 App.vue`).toBe('')
    }
  })

  it('选项行（#199 组件化 StarOptionRow，Quiz 页不再持有 option 系私有规则）唇边深度走 --shadow-sm 令牌', () => {
    const rule = extractRule(optionRowVue, 'star-option')
    expect(rule).toContain('box-shadow: 0 var(--shadow-sm) 0')
    // 跳过钮无专属样式（probe 定稿：复用 normal 态，禁用复用 disabled）——组件与 Quiz 页均无 skip 系规则
    expect(optionRowVue).not.toContain('option-skip')
    expect(extractRule(quizStyle, 'option-skip')).toBe('')
  })

  it('#147 选项行圆角升档：对齐探针 16px 档（--radius-lg 引用，防回潮 --radius-md；#199 后读 StarOptionRow 源码）', () => {
    // 取舍：改 --radius-md 令牌值会波及 8 处非选项元素，选项行换用 --radius-lg 引用（探针同款）
    const rule = extractRule(optionRowVue, 'star-option')
    expect(rule).toContain('border-radius: var(--radius-lg)')
    expect(rule).not.toContain('--radius-md')
  })
})

describe('AC9-3 hover 态（工艺债②，原 R2）', () => {
  it('选项存在 hover 规则且含 translateY(-2px) 与唇边加厚（#199 组件化后选项与按钮 hover 均读组件源码）', () => {
    const optionHover = extractRule(optionRowVue, 'star-option:hover:not(:disabled)')
    expect(optionHover).toContain('translateY(-2px)')
    expect(optionHover).toContain('box-shadow: 0 var(--shadow-md) 0')
    expect(btnVue).toMatch(/\.star-button--standard\.star-button--large:hover[^{]*\{[^}]*translateY\(-2px\)/)
  })

  it('#131 触屏防护：选项 hover 规则处于 hover-capable 媒体查询内（触屏无粘性 hover；跳过钮复用同款规则）', () => {
    const rule = scanHoverRules(styleOf(optionRowVue)).find((r) => r.header.startsWith('.star-option:hover'))
    expect(rule, 'star-option hover 规则应存在').toBeDefined()
    expect(rule?.guarded, 'star-option hover 应包 @media (hover: hover)').toBe(true)
  })
})

describe('AC9-4 chip / 角标间距归入 scale（工艺债④，原 R2）', () => {
  it('含 chip / badge / is-locked 规则的 padding / margin / gap 均为 4/8/12/16/20/24px 之一', () => {
    const blocks = `${appVue}\n${componentsCss}`.match(/[^{}]+\{[^{}]*\}/g) ?? []
    const badValues: string[] = []
    for (const block of blocks) {
      if (!/(chip|badge|is-locked)/.test(block)) continue
      const declarations = block.match(/(?:padding|margin|gap)(?:-[a-z]+)?\s*:\s*[^;]+/g) ?? []
      for (const decl of declarations) {
        const values = decl.match(/\d+(?:\.\d+)?(?:px)?/g) ?? []
        for (const v of values) {
          const n = parseFloat(v)
          if (n === 0) continue
          if (![4, 8, 12, 16, 20, 24].includes(n)) badValues.push(`${block.trim()} :: ${decl.trim()} :: ${v}`)
        }
      }
    }
    expect(badValues).toEqual([])
  })
})

describe('AC9-5 首页字号档位映射（工艺债③ + R15 T1-T15 分档，原 R2，文本断言）', () => {
  it('R15 分档落位（Home 页 scoped；#146 星径余额：star-value 升 display 档 + 发光）：star-value → display 档；home-hint → info 档；balance-label → label 档', () => {
    expect(extractRule(homeStyle, 'star-value')).toContain('var(--font-size-display)')
    expect(extractRule(homeStyle, 'star-value')).toContain('text-shadow: var(--glow-num)')
    expect(extractRule(homeStyle, 'tagline')).toBe('')
    expect(extractRule(homeStyle, 'balance-label')).toContain('var(--font-size-label)')
    expect(extractRule(homeStyle, 'home-hint')).toContain('var(--font-size-info)')
  })

  it('R15 主/次按钮字号为 btn 档：已组件化，由 StarButtonStandard large/small 档位保证', () => {
    expect(btnVue).toMatch(/\.star-button--large\s*\{[^}]*font-size: var\(--font-size-btn\)/s)
    expect(btnVue).toMatch(/\.star-button--small\s*\{[^}]*font-size: var\(--font-size-btn-sm\)/s)
  })
})

/* ===== 原styles-r15：星星平星 / 全局迁移 / 各页字号档位落位与状态（T3-T10）===== */

describe('星星圆润发光版迁移（#195 收编 StarGlyph：页面内联星形清零，母型单一来源）', () => {
  it('五个页面星形内联 path 清零 + 全部走 StarGlyph；母型质量（探针母型路径 + fill/stroke 同色 + 圆角 join）收拢至组件锁定', () => {
    // 防回潮：识别特征 = 探针 P1-r2 五角星路径，#195 收编后页面文件不再允许内联出现（单一来源 = StarGlyph）
    const starPath = /<path[\s\S]*?d="M12 2\.5 L14\.2 8\.9 L21 9\.1 L15\.6 13\.2 L17\.6 19\.7 L12 15\.8 L6\.4 19\.7 L8\.4 13\.2 L3 9\.1 L9\.8 8\.9 Z"[\s\S]*?\/>/g
    for (const page of [homeVue, resultVue, redeemVue, prizesVue, starLogVue]) {
      expect(page.match(starPath) ?? []).toHaveLength(0)
      // #196 等价改写（意图不削弱）：星形本体仍恒走 StarGlyph 单一来源——页面直接引 <StarGlyph，
      // 或经 <StarEmptyState 间接承接（其内部 StarGlyph 由 StarEmptyState.test.ts「禁止自绘星形」断言锁定）
      expect(page.includes('<StarGlyph') || page.includes('<StarEmptyState')).toBe(true)
    }
    // 母型质量契约（探针 P1-r2 直译：fill+stroke 同色加粗圆角 join = 圆润胖星，无可见描边）归组件单一来源
    //（d 断言用转义正则落笔，避免明文路径散落测试文件、污染「src 下 path 仅存组件文件」的验收 grep）
    expect(glyphVue).toMatch(/d="M12 2\.5 L14\.2 8\.9 L21 9\.1 L15\.6 13\.2 L17\.6 19\.7 L12 15\.8 L6\.4 19\.7 L8\.4 13\.2 L3 9\.1 L9\.8 8\.9 Z"/)
    expect(glyphVue).toContain('fill="var(--color-star)"')
    expect(glyphVue).toContain('stroke="var(--color-star)"')
    expect(glyphVue).toContain('stroke-width="3"')
    expect(glyphVue).toContain('stroke-linejoin="round"')
    // 深金描边令牌零残留（弃描边口径，防回潮）
    for (const page of [homeVue, resultVue, redeemVue, prizesVue, starLogVue]) {
      expect(page).not.toContain('var(--color-star-shadow)')
    }
  })

  it('AC-R15-1-3 无渐变 defs / 渐变引用 / fill=--color-primary 残留', () => {
    for (const page of [homeVue, resultVue, redeemVue, starLogVue]) {
      expect(page).not.toContain('<defs>')
      expect(page).not.toContain('url(#')
      // #226 已批准的滑板插画不是星形；仅排除这一具名 SVG，星形母型及其余页面的旧填色守卫不变。
      const starContent = page.replace(/<svg class="game-sticker__art"[\s\S]*?<\/svg>/, '')
      expect(starContent).not.toContain('fill="var(--color-primary)"')
      expect(starContent).not.toContain('fill="var(--color-outline)"')
    }
  })

  it('#147 首页星径移除：余额区一颗大星居中——星径零残留 + 大星档位落位 + 呼吸微光保留', () => {
    // 星径零残留（类名 / 弧线 SVG 特征 / 微闪动画全部消失）
    for (const token of ['star-path', 'path-line', 'path-star', 'path-spark', 'stroke-dasharray', 'star-twinkle']) {
      expect(homeVue, `星径残留: ${token}`).not.toContain(token)
    }
    // 星径画布 viewBox 与显示尺寸零残留
    expect(homeVue).not.toContain('0 0 336 172')
    expect(extractRule(homeStyle, 'star-path')).toBe('')
    // 大星档位落位：主视觉档 96–120px 区间（112px 平衡档）走 --size-star-hero 令牌（#153 令牌化），静态光晕走两级令牌
    const bigStar = extractRule(homeStyle, 'home-big-star')
    expect(bigStar).toContain('width: var(--size-star-hero)')
    expect(bigStar).toContain('height: var(--size-star-hero)')
    expect(bigStar).toContain('filter: var(--glow-star-svg)')
    // 呼吸微光动画保留（星星系动效，星星是主视觉不变）
    expect(bigStar).toContain('animation: star-breath var(--duration-breath) ease-in-out infinite')
    expect(homeVue).toContain('@keyframes star-breath')
  })
})

describe('App.vue 全局样式迁移 + 背景渐变（原 R15 T3）', () => {
  it('AC-R15-1-4 html/body 背景为 radial+linear 渐变且无 filter，app-shell 与 data-page 不再盖底色', () => {
    const htmlBody = appVue.match(/html,\s*\r?\n\s*body\s*\{[^}]*\}/)?.[0] ?? ''
    expect(htmlBody).toContain('background:')
    expect(htmlBody).toContain('radial-gradient')
    expect(htmlBody).toContain('linear-gradient')
    expect(htmlBody).not.toContain('filter')
    expect(appVue).not.toMatch(/\.app-shell[^{]*\{[^}]*background-color: var\(--color-bg\)/)
    expect(appVue).not.toMatch(/\[data-page\][^{]*\{[^}]*background-color: var\(--color-bg\)/)
  })

  it('AC-R15-2-5 page-title 用 --font-size-topbar 且字距走 --letter-spacing-title（brand 类已随 C3Re1 退役删除）', () => {
    expect(extractRule(appVue, 'page-title')).toContain('var(--font-size-topbar)')
    expect(extractRule(appVue, 'page-title')).toContain('letter-spacing: var(--letter-spacing-title)')
  })

  it('AC-R15-3-1 非交互 chip 去阴影（balance-chip 迁居 components.css 后无 box-shadow；result-score-badge 样式已随 C4Re1 清零）', () => {
    expect(extractRule(componentsCss, 'balance-chip')).not.toContain('box-shadow')
  })

  it('AC-R15-3-7 主按钮 min-height ≥ 56px（已组件化，StarButtonStandard large 走 --touch-md，令牌值回溯校验）', () => {
    const rule = btnVue.match(/(?:^|\n)\.star-button--large\s*\{([^}]*)\}/s)?.[1] ?? ''
    const token = rule.match(/min-height:\s*var\((--[\w-]+)\)/)?.[1]
    expect(token).toBe('--touch-md')
    const value = Number(variablesCss.match(new RegExp(`${token}:\\s*(\\d+)px`))?.[1] ?? 0)
    expect(value).toBeGreaterThanOrEqual(56)
  })
})

describe('Quiz 三态 + 反馈（原 R15 T5，文本断言）', () => {
  it('选项不可用态（#199 组件化后读 StarOptionRow 源码）：surface-dim 底 + 无阴影 + not-allowed', () => {
    const rule = extractRule(optionRowVue, 'star-option:disabled')
    expect(rule).toContain('background-color: var(--color-surface-dim)')
    expect(rule).toContain('cursor: not-allowed')
    expect(rule).not.toContain('box-shadow: 0')
  })

  it('答对/正确项转绿：#199 组件化后读 StarOptionRow 源码——correct 与 reveal 同貌用 --color-go 系', () => {
    const correct = extractRule(optionRowVue, 'star-option--correct')
    expect(correct).toContain('background-color: var(--color-go)')
    expect(correct).toContain('color: var(--color-on-go)')
    expect(correct).toContain('box-shadow: 0 var(--shadow-sm) 0 var(--color-go-shadow)')
    const reveal = extractRule(optionRowVue, 'star-option--reveal')
    expect(reveal).toContain('background-color: var(--color-go)')
  })

  it('反馈条基础档 info 15px/700（三态共用骨架）；答对态对齐探针：金深边框 + 金渐变填充 + 光晕呼吸动画（#198 组件化后读 StarFeedbackBar 源码）', () => {
    const bar = extractRule(feedbackBarVue, 'star-feedback-bar')
    expect(bar).toContain('font-size: var(--font-size-info)')
    expect(bar).toContain('font-weight: 700')
    expect(bar).not.toContain('background-color')
    const correct = extractRule(feedbackBarVue, 'star-feedback-bar--correct')
    expect(correct).toContain('border: var(--border-thin) solid var(--color-star-deep)')
    expect(correct).toContain('linear-gradient(90deg, rgba(255, 209, 102, 0.24), rgba(255, 209, 102, 0.04) 72%)')
    expect(correct).toContain('color: var(--color-star)')
    expect(correct).toContain('animation: feedback-glow var(--duration-breath) ease-in-out infinite')
    // 光晕呼吸关键帧落盘（内透 + 外晕两级）
    expect(feedbackBarVue).toContain('@keyframes feedback-glow')
    expect(feedbackBarVue.match(/@keyframes feedback-glow\s*\{[\s\S]*?\}/)?.[0] ?? '').toContain('inset 0 0')
    expect(extractRule(feedbackBarVue, 'star-feedback-bar--wrong')).toContain('color: var(--color-error)')
    expect(extractRule(feedbackBarVue, 'star-feedback-bar--skipped')).toContain('color: var(--color-text-secondary)')
    // 答错 / 不会两态保持纯文字（无填充，探针仅定义答对态）
    for (const cls of ['star-feedback-bar--wrong', 'star-feedback-bar--skipped']) {
      expect(extractRule(feedbackBarVue, cls)).not.toContain('background')
    }
  })

  it('反馈图标：StarFeedbackBar 模板含内联 SVG（aria-hidden，#198 组件化后读组件源码）', () => {
    const fbBar = feedbackBarVue.match(/class="star-feedback-bar"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(fbBar).toContain('<svg')
    expect(fbBar).toContain('aria-hidden="true"')
    expect(fbBar).toContain('fill="currentColor"')
  })
})

describe('Result 分档 + 补星图标（原 R15 T6，文本断言）', () => {
  it('AC-R15-2-6 earn-number：star-lg 56px/800 + star 色（T11）', () => {
    const num = extractRule(resultVue, 'earn-number')
    expect(num).toContain('font-size: var(--font-size-star-lg)')
    expect(num).toContain('font-weight: 800')
    expect(num).toContain('color: var(--color-star)')
  })

  it('AC-R15-2-6 result-message：info 15px/400 + text-secondary + 字距走 --letter-spacing-info（T9）', () => {
    const msg = extractRule(resultVue, 'result-message')
    expect(msg).toContain('font-size: var(--font-size-info)')
    expect(msg).toContain('font-weight: 400')
    expect(msg).toContain('color: var(--color-text-secondary)')
    expect(msg).toContain('letter-spacing: var(--letter-spacing-info)')
  })

  it('earn-unit：label 13px/600 + text-secondary（T14 标签）', () => {
    const unit = extractRule(resultVue, 'earn-unit')
    expect(unit).toContain('font-size: var(--font-size-label)')
    expect(unit).toContain('font-weight: 600')
    expect(unit).toContain('color: var(--color-text-secondary)')
  })

  it('CONFETTI_COLORS 已随 #146 动效预算删除（彩纸移除），resultVue 无 confetti 残留', () => {
    expect(resultVue).not.toContain('CONFETTI_COLORS')
    expect(resultVue).not.toContain('confetti')
  })

  it('#153 满分星光雨形态：满分条件渲染 + 下落关键帧 + 微光令牌 + 数量克制 + reduce 豁免', () => {
    // 满分档条件：折算 10 分驱动渲染（非满分档含差一题 9/10 档零庆祝动效）
    expect(resultVue).toContain('const isFullMark = computed(() => scaledScore.value === 10)')
    expect(resultVue).toContain('v-if="showStarRain"')
    // 星星数量克制：散布表 8–14 颗量级（当前 10 颗）
    const dropCount = (resultVue.match(/\{ left: '/g) ?? []).length
    expect(dropCount).toBeGreaterThanOrEqual(8)
    expect(dropCount).toBeLessThanOrEqual(14)
    // 下落关键帧 + 漂移/旋转终点（一次性自清由脚本 STAR_RAIN_MS 承担）
    expect(resultVue).toMatch(/@keyframes star-rain-fall/)
    expect(resultVue).toContain('translate3d(var(--sr-drift), 120vh, 0) rotate(var(--sr-spin))')
    // 星星系口径：微光走小星单级令牌；下落时长 = 漂浮档倍率（2.4s + 错拍 0–0.46s）
    expect(resultVue).toContain('filter: var(--glow-star-svg-soft)')
    expect(resultVue).toContain('animation: star-rain-fall calc(var(--duration-float) * 0.75) ease-in forwards')
    // 纯装饰不挡交互 + 系统 reduce 偏好整层不播
    expect(extractRule(resultVue, 'star-rain')).toContain('pointer-events: none')
    expect(resultVue).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('AC-R15-3-5 earn-visual 模板含 StarGlyph（#195 星形本体收编组件；fill/stroke 同色契约由组件测试锁定，页留 20px 尺寸档覆写）', () => {
    const visual = resultVue.match(/class="earn-visual"[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(visual).toContain('<StarGlyph')
    expect(visual).toContain('size="sm"')
    const visualRule = extractRule(resultVue, 'earn-visual svg')
    expect(visualRule).toContain('width: 20px')
    expect(visualRule).toContain('height: 20px')
  })
})

describe('Redeem 分档 + locked 卡（原 R15 T7；#202 奖品行迁 StarRewardItem，断言随迁组件源码）', () => {
  it('star-reward-name：body 16px/600（T7 档，#202 断言迁组件）', () => {
    const rule = extractRule(rewardItemVue, 'star-reward-name')
    expect(rule).toContain('font-size: var(--font-size-body)')
    expect(rule).toContain('font-weight: 600')
  })

  it('star-reward-price：num 16px/800 + star 色 + info 字距（T13 星价橙金；probe #194 第 6 节定稿，#202 断言迁组件）', () => {
    const rule = extractRule(rewardItemVue, 'star-reward-price')
    expect(rule).toContain('font-size: var(--font-size-num)')
    expect(rule).toContain('font-weight: 800')
    expect(rule).toContain('letter-spacing: var(--letter-spacing-info)')
    expect(rule).toContain('color: var(--color-star)')
  })

  it('兑换钮：#202 收编 StarRewardItem 内组装 StarButtonStandard（primary × small，14px/600 由 small 档保证），Redeem 页无 .btn-redeem 本地规则与残留', () => {
    expect(redeemVue).not.toMatch(/\n\.btn-redeem\s*\{/)
    expect(redeemVue).not.toContain('btn-redeem')
    expect(rewardItemVue).toContain('<StarButtonStandard variant="primary" size="small"')
  })

  it('ledger-link：样式已收编 StarButtonStandard（standard × small，min-height 走 --touch-sm 令牌保证），Redeem 无本地规则', () => {
    expect(redeemVue).not.toMatch(/(?:^|\n)\.ledger-link\s*\{/)
    const small = btnVue.match(/(?:^|\n)\.star-button--small\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(small).toContain('min-height: var(--touch-sm)')
  })

  it('reward-emoji 已按 #146 移除（#202 后页面与组件双层零残留）：价签星 = StarGlyph sm 归组件，价格行 inline-flex 布局', () => {
    expect(redeemVue).not.toContain('reward-emoji')
    expect(extractRule(redeemVue, 'reward-emoji')).toBe('')
    expect(extractRule(rewardItemVue, 'reward-emoji')).toBe('')
    // 价签星：#202 归 StarRewardItem 内组装 StarGlyph sm（本体/尺寸/微光契约由组件测试锁定），页面零私有规则
    expect(rewardItemVue).toContain('<StarGlyph size="sm" />')
    const price = extractRule(rewardItemVue, 'star-reward-price')
    expect(price).toContain('display: inline-flex')
    expect(extractRule(redeemVue, 'coin-star')).toBe('')
  })

  it('star-modal 正文：body-lg 18px/600（C2 组件弹窗正文，C2Re1 替换统一三处）', () => {
    const rule = extractRule(modalComponentVue, 'star-modal__text')
    expect(rule).toContain('font-size: var(--font-size-body-lg)')
    expect(rule).toContain('font-weight: 600')
  })

  it('toast：info 15px/700（T10 瞬时反馈；#139 收编 StarToastStandard，断言迁组件源码）+ 布局链锁定', () => {
    // 行首精确匹配（避免误匹配模板/注释文本）；toast 自四页 scoped 迁组件，布局链随迁锁定（fixed 底部居中 / z-toast / 限宽 / 纵向内距收紧）
    const rule = toastComponentVue.match(/\n\.toast\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('position: fixed')
    expect(rule).toContain('bottom: calc(var(--space-md) + env(safe-area-inset-bottom))')
    expect(rule).toContain('z-index: var(--z-toast)')
    expect(rule).toContain('max-width: min(440px, calc(100vw - 2 * var(--space-page)))')
    expect(rule).toContain('padding: var(--space-sm) var(--space-gutter)')
    expect(rule).toContain('font-size: var(--font-size-info)')
    expect(rule).toContain('font-weight: 700')
    // #139 样式归属拍板：容器形态由全局 star-container 样式集承担，组件不自绘底色/描边/圆角（防旧次色底回潮）
    expect(rule).not.toContain('background-color')
    expect(rule).not.toContain('border')
    expect(rule).not.toContain('border-radius')
    expect(rule).not.toContain('box-shadow')
    expect(rule).not.toContain('var(--color-secondary)')
  })

  it('locked 卡（#202 断言迁组件）：暗槽底降淡（不用整体透明度，小字保对比度）无 filter，按钮置灰由 StarButtonStandard disabled 态保证', () => {
    const card = extractRule(rewardItemVue, 'star-reward-item.is-locked')
    expect(card).toContain('background-color: var(--color-surface-dim)')
    expect(card).not.toContain('opacity')
    expect(card).not.toContain('filter')
    expect(extractRule(rewardItemVue, 'star-reward-item.is-locked .star-reward-name')).toContain('color: var(--color-text-secondary)')
    // Redeem 页私有锁态规则清零（#202 迁组件）
    expect(extractRule(redeemVue, 'reward-item.is-locked')).toBe('')
    const disabled = btnVue.match(/\.star-button:disabled\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(disabled).toContain('filter: saturate')
    expect(disabled).toContain('cursor: not-allowed')
  })

  it('顶栏余额 chip 透明无底无阴影（不可点；balance-chip 已迁居 components.css）', () => {
    const chip = extractRule(componentsCss, 'balance-chip')
    expect(chip).toContain('background-color: transparent')
    expect(chip).not.toContain('box-shadow: 0')
  })
})

describe('StarLog grid 四列 + 印章（原 R15 T8，文本断言）', () => {
  it('ledger-row：grid 四列 40px 1fr auto auto + 无 box-shadow + border-bottom outline', () => {
    const rule = extractRule(starLogVue, 'ledger-row')
    expect(rule).toContain('display: grid')
    expect(rule).toContain('grid-template-columns: 40px 1fr auto auto')
    expect(rule).not.toContain('box-shadow')
    expect(rule).toContain('border-bottom: var(--border-thin) solid var(--color-outline)')
  })

  it('stamp 印章容器：40px + secondary 底 + 符号 SVG（获得 + star / 兑换 − text-secondary）', () => {
    const stamp = extractRule(starLogVue, 'stamp')
    expect(stamp).toContain('background-color: var(--color-secondary)')
    expect(stamp).toMatch(/width:\s*40px/)
    expect(stamp).toMatch(/height:\s*40px/)
    expect(starLogVue).toContain('class="stamp"')
    expect(starLogVue).toMatch(/stroke="var\(--color-star\)"/)
    expect(starLogVue).toMatch(/stroke="var\(--color-text-secondary\)"/)
  })

  it('AC-R15-2-6 row-amount：num 16px/800（T13）', () => {
    const rule = extractRule(starLogVue, 'row-amount')
    expect(rule).toContain('font-size: var(--font-size-num)')
    expect(rule).toContain('font-weight: 800')
  })

  it('row-source：body 16px/600（T7）', () => {
    const rule = extractRule(starLogVue, 'row-source')
    expect(rule).toContain('font-size: var(--font-size-body)')
    expect(rule).toContain('font-weight: 600')
  })

  it('log-time：caption 12px + text-secondary（T15）', () => {
    const rule = extractRule(starLogVue, 'log-time')
    expect(rule).toContain('font-size: var(--font-size-caption)')
    expect(rule).toContain('color: var(--color-text-secondary)')
  })

  it('amount-earn star 色；amount-redeem text-secondary', () => {
    expect(extractRule(starLogVue, 'amount-earn')).toContain('color: var(--color-star)')
    expect(extractRule(starLogVue, 'amount-redeem')).toContain('color: var(--color-text-secondary)')
  })
})

describe('Home footer/config-link 分档 + 云朵（原 R15 T9，文本断言）', () => {
  it('app-footer：caption 12px + text-secondary（T15 版本号小字）', () => {
    const rule = extractRule(homeVue, 'app-footer')
    expect(rule).toContain('font-size: var(--font-size-caption)')
    expect(rule).toContain('color: var(--color-text-secondary)')
  })

  it('config-link：caption 12px/600（T15 配置入口；2026-09-03 收编 components.css，Home/Parent 两页共用）', () => {
    const rule = extractRule(componentsCss, 'config-link')
    expect(rule).toContain('font-size: var(--font-size-caption)')
    expect(rule).toContain('font-weight: 600')
    // 防漂移：Home.vue scoped 不再残留该规则（样式三归宿——跨页样式集归 components.css）
    expect(extractRule(homeVue, 'config-link')).toBe('')
  })

  it('云朵 ×2：surface 85% 半透明（color-mix 跟随主题）椭圆 + 伪元素圆形；#152 G2 动效对齐探针档——极慢漂移恢复（--duration-drift 26s）', () => {
    const clouds = homeVue.match(/class="cloud[^"]*"/g) ?? []
    expect(clouds.length).toBeGreaterThanOrEqual(2)
    // 行首精确匹配（避免 clouds 复数前缀干扰）
    const cloud = homeVue.match(/\n\.cloud\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(cloud).toContain('background: color-mix(in srgb, var(--color-surface) 85%, transparent)')
    expect(cloud).toContain('border-radius: 50%')
    expect(homeVue.match(/\n\.cloud::before[^{]*\{([^}]*)\}/)?.[1] ?? '').toContain('border-radius: 50%')
    expect(homeVue.match(/\n\.cloud::after[^{]*\{([^}]*)\}/)?.[1] ?? '').toContain('border-radius: 50%')
    // #152 G2 动效预算对齐探针档：云朵极慢漂移恢复（26s 档走 --duration-drift 令牌），关键帧落盘
    expect(cloud).toContain('animation: cloud-drift var(--duration-drift) ease-in-out infinite')
    expect(homeVue).toContain('@keyframes cloud-drift')
    // 两云错向错速（cloud-2 反向 + 1.25 倍时长），避免同频机械感
    const cloud2 = homeVue.match(/\n\.cloud-2\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(cloud2).toContain('animation-direction: reverse')
  })
})

describe('Parent 分档 + btn-go（原 R15 T10，文本断言）', () => {
  it('弹窗标题落 T1（24px/700 保留；#59 收编 StarModalStandard，断言迁组件源码）', () => {
    const rule = extractRule(modalComponentVue, 'star-modal__title')
    expect(rule).toContain('font-size: var(--font-size-headline)')
    expect(rule).toContain('font-weight: 700')
  })

  it('弹窗副标题（管理形态说明）：body 16px/400（T6 弹窗说明；#59 收编组件 star-modal 系类名）', () => {
    const rule = extractRule(modalComponentVue, 'star-modal__desc')
    expect(rule).toContain('font-size: var(--font-size-body)')
    expect(rule).toContain('font-weight: 400')
  })

  it('#216 弹窗三按钮纵向满宽堆叠：stacked 布局链锁定在组件层（纵排 + 占满横宽 + 解除纵轴伸展）', () => {
    // 精确匹配带 -- 后缀的类名（防 extractRule 前缀误吞）；布局链源码文本锁定（jsdom 不算真布局）
    const stacked = modalComponentVue.match(/\n\.star-modal__actions--stacked\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(stacked).toContain('flex-direction: column')
    const stackedBtn = modalComponentVue.match(/\.star-modal__actions--stacked :deep\(\.star-button\)\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(stackedBtn).toContain('flex: 0 0 auto')
    expect(stackedBtn).toContain('width: 100%')
    // 既有横排等宽规则未被削弱（双按钮形态回归锁定）
    const base = extractRule(modalComponentVue, 'star-modal__actions')
    expect(base).toContain('display: flex')
    expect(base).toContain('gap: var(--space-sm)')
  })

  it('parent-action-btn 与 btn-go 样式已随 #38 清零（操作区与返回钮组件化为 StarButtonStandard，字档与触控尺寸由组件测试保证）', () => {
    expect(extractRule(parentVue, 'parent-action-btn')).toBe('')
    expect(extractRule(parentVue, 'btn-go')).toBe('')
  })

  it('表单区正文类（import-error / import-success）：body 16px/400（T6）', () => {
    for (const cls of ['import-error', 'import-success']) {
      const rule = extractRule(parentVue, cls)
      expect(rule).toContain('font-size: var(--font-size-body)')
      expect(rule).toContain('font-weight: 400')
    }
  })

  it('parent-note：caption 12px + text-secondary（T15 家长页说明小字）', () => {
    const rule = extractRule(parentVue, 'parent-note')
    expect(rule).toContain('font-size: var(--font-size-caption)')
    expect(rule).toContain('color: var(--color-text-secondary)')
  })
})

/* ===== 原styles-r25：红旗旗钮视觉（位置/触控/两态/动画）===== */

describe('旗钮位置与触控（原 R25，DR25-1 / REQ-R25-1）', () => {
  it('flag-btn：绝对定位（页面）+ --touch-sm 圆形热区（StarIconBtn 组件）+ 24px 视觉 SVG', () => {
    // C5（#56）：热区/圆角/hover 收编 StarIconBtn，页面 scoped 只剩定位
    const rule = extractRule(quizVue, 'flag-btn')
    expect(rule).toContain('position: absolute')
    const btn = extractRule(iconBtnVue, 'star-icon-btn')
    expect(btn).toContain('width: var(--touch-sm)')
    expect(btn).toContain('height: var(--touch-sm)')
    expect(btn).toContain('border-radius: var(--radius-full)')
    expect(btn).toContain('background-color: transparent')
    const svg = extractRule(quizVue, 'flag-btn svg')
    expect(svg).toMatch(/width:\s*24px/)
    expect(svg).toMatch(/height:\s*24px/)
  })

  it('question-card：position relative + 右侧 padding 64px 让位防遮挡', () => {
    const rule = extractRule(quizVue, 'question-card')
    expect(rule).toContain('position: relative')
    expect(rule).toMatch(/padding-right:\s*64px/)
  })

  it('旗钮模板含内联圆润红旗 SVG（#146 重画：圆头旗杆 flag-pole + 弧线旗面 flag-icon，aria-hidden）', () => {
    const btn = quizVue.match(/class="flag-btn"[\s\S]*?<\/StarIconBtn>/)?.[0] ?? ''
    expect(btn).toContain('<svg')
    expect(btn).toContain('aria-hidden="true"')
    expect(btn).toContain('flag-pole')
    expect(btn).toContain('flag-icon')
    const pole = extractRule(quizVue, 'flag-pole')
    expect(pole).toContain('stroke-width: 3')
    expect(pole).toContain('stroke-linecap: round')
    const icon = extractRule(quizVue, 'flag-icon')
    expect(icon).toContain('stroke-width: 2')
    expect(icon).toContain('stroke-linejoin: round')
  })

  it('hover 反馈：background 转 surface-dim（DR25-1；C5 起由 StarIconBtn 提供）；#131 起包 @media (hover: hover)', () => {
    expect(extractRule(iconBtnVue, 'star-icon-btn:hover')).toContain('background-color: var(--color-surface-dim)')
    const rule = scanHoverRules(styleOf(iconBtnVue)).find((r) => r.header.startsWith('.star-icon-btn:hover'))
    expect(rule).toBeDefined()
    expect(rule?.guarded).toBe(true)
  })
})

describe('旗钮两态视觉（原 R25 DR25-2 / REQ-R25-2；#146 夜幕纸面版：未标 = 纸面中性淡 / 已标 = 暖红纸面旗色）', () => {
  it('未标态：纸面填充 + morning-text 半透明描边（color-mix 派生）；fill/stroke 可过渡（取消回淡）', () => {
    const icon = extractRule(quizVue, 'flag-icon')
    expect(icon).toContain('fill: var(--color-paper)')
    expect(icon).toContain('color-mix(in srgb, var(--color-morning-text) 45%, transparent)')
    expect(icon).toContain('transition')
  })

  it('已标态：暖红填充 + --color-flag-stroke 描边；旗杆同步转暖红', () => {
    const rule = extractRule(quizVue, 'flag-btn.flagged .flag-icon')
    expect(rule).toContain('fill: var(--color-warm-deep)')
    expect(rule).toContain('stroke: var(--color-flag-stroke)')
    expect(extractRule(quizVue, 'flag-btn.flagged .flag-pole')).toContain('stroke: var(--color-warm-deep)')
  })
})

describe('升旗动画（原 R25，DR25-3 / REQ-R25-2，帧效果手动验收）', () => {
  it('@keyframes hoist 存在：上移 4px + 挥动 rotate ±10°，0.28s ease 挂接点击标记态', () => {
    expect(quizVue).toContain('@keyframes hoist')
    expect(quizVue).toContain('translateY(-4px)')
    expect(quizVue).toContain('rotate(-10deg)')
    expect(quizVue).toContain('rotate(7deg)')
    expect(extractRule(quizVue, 'flag-btn.hoist svg')).toContain('animation: hoist 0.28s ease')
  })
})

/* ===== #152 差距审计落地：星子层 / 分段切换器 / 题卡质感 / 氛围光 / 兑换圆角卡 / 发光探针档 ===== */

describe('#152 G1/G13 夜空星子层（App.vue 外壳背景层，探针 sky 直译）', () => {
  it('星子层挂载：app-sky aria-hidden 装饰层 + 四芒星子 ≥ 6 颗（金星 / 米白 pale 两色）', () => {
    expect(appVue).toContain('class="app-sky" aria-hidden="true"')
    const sparks = appVue.match(/app-sky__spark/g) ?? []
    expect(sparks.length).toBeGreaterThanOrEqual(6)
    expect(appVue).toContain('app-sky__spark--pale')
    // 探针四芒星母型 path（Q 曲线四芒钻星）
    expect(appVue).toContain('M12 2 Q13.6 10.4 22 12 Q13.6 13.6 12 22')
  })

  it('星子层行为契约：pointer-events none + 层级走 --z-sky 令牌 + twinkle 微闪走 --duration-twinkle', () => {
    const sky = extractRule(appVue, 'app-sky')
    expect(sky).toContain('pointer-events: none')
    expect(sky).toContain('z-index: var(--z-sky)')
    expect(sky).toContain('position: absolute')
    expect(extractRule(appVue, 'app-sky__spark')).toContain('animation: twinkle var(--duration-twinkle) ease-in-out infinite')
    expect(extractRule(appVue, 'app-sky__spark--pale')).toContain('color: var(--color-star-pale)')
    // alt 变体：1.5 倍时长错拍（探针 anim-twinkle--alt 直译）
    expect(extractRule(appVue, 'app-sky__spark--alt')).toContain('calc(var(--duration-twinkle) * 1.5)')
    // twinkle 关键帧：透明度 + 缩放两级起伏（探针 keyframes 直译）
    const kf = appVue.match(/@keyframes twinkle\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(kf).toContain('opacity: 0.4')
    expect(kf).toContain('opacity: 0.9')
    expect(kf).toContain('scale(0.86)')
  })

  it('星子不遮内容：[data-page] 提升 z-index 建立绘制层级（内容整体绘制在星子层之上）', () => {
    const page = appVue.match(/\[data-page\]\s*\{[^}]*\}/)?.[0] ?? ''
    expect(page).toContain('position: relative')
    expect(page).toContain('z-index: 1')
  })
})

describe('#152 G3 分段切换器（StarModeEntry 三处同步：本体 + registry + 展示页）', () => {
  const modeEntryVue = readFileSync(resolve(srcDir, 'components/StarModeEntry.vue'), 'utf-8')

  it('分段形态：label + radiogroup 容器 + 三 pill 直显（探针 mode-switch 直译，暗槽底 + 全圆角 + 细描边）', () => {
    expect(modeEntryVue).toContain('star-mode-entry__label')
    expect(modeEntryVue).toContain('role="radiogroup"')
    const sw = extractRule(modeEntryVue, 'star-mode-entry__switch')
    expect(sw).toContain('background-color: var(--color-surface-dim)')
    expect(sw).toContain('border-radius: var(--radius-full)')
    expect(sw).toContain('border: var(--border-thin) solid var(--color-outline)')
    // 旧 chip 形态类零残留（__value / __caret / 弹窗选项行 __options 系）
    for (const gone of ['__value', '__caret', '__options', '__option ', '__icon', '__check']) {
      expect(modeEntryVue, `旧 chip 类残留: ${gone}`).not.toContain(gone)
    }
  })

  it('选中态星光金 + 触达 ≥ 44px：is-active 金渐变段 + glow-star-soft；pill min-height 走 --touch-sm', () => {
    const active = extractRule(modeEntryVue, 'star-mode-entry__pill.is-active')
    expect(active).toContain('linear-gradient(180deg, var(--color-star), var(--color-star-deep))')
    expect(active).toContain('color: var(--color-on-star)')
    expect(active).toContain('box-shadow: var(--glow-star-soft)')
    const pill = extractRule(modeEntryVue, 'star-mode-entry__pill')
    expect(pill).toContain('min-height: var(--touch-sm)')
  })

  it('组件零弹窗依赖：chip+草选-确认弹窗流拆除（点选即切换，v-model 单向语义归使用方）', () => {
    expect(modeEntryVue).not.toContain('StarModalStandard')
    expect(modeEntryVue).not.toContain('换个出题方式？')
  })
})

describe('#152 G5/G6 答题页质感（题卡暖光 / 屏顶氛围光）+ #200 进度条升组件', () => {
  it('G5 题卡：渐变纸色（两枚纸面令牌端点）+ 暖光 inset 令牌组合（灯下纸片）', () => {
    const card = extractRule(quizStyle, 'question-card')
    expect(card).toContain('linear-gradient(180deg, var(--color-paper) 0%, var(--color-paper-deep) 100%)')
    expect(card).toContain('box-shadow: var(--shadow-card), var(--glow-paper-top), var(--glow-edge)')
  })

  it('G6 屏顶氛围光：quiz-page 根 radial 走 --color-ambient（探针 s-quiz 直译几何）', () => {
    const page = extractRule(quizStyle, 'quiz-page')
    expect(page).toContain('radial-gradient(120% 46% at 50% 0%, var(--color-ambient), transparent 58%)')
  })

  it('#200 进度条升 registry：Quiz 页私有进度条样式清零（视觉契约移 StarProgressBar 组件，填充定稿纯 color-primary）', () => {
    for (const gone of ['progress-area', 'progress-bar', 'progress-fill', 'progress-label', '--glow-progress', 'linear-gradient(90deg, var(--color-star-deep)']) {
      expect(quizStyle, `进度条私有样式残留: ${gone}`).not.toContain(gone)
    }
  })
})

describe('#152 G9/G12 兑换页圆角奖品卡 + 发光探针档（卡片 / CTA）', () => {
  it('G9 圆角卡：reward-item 圆角升档 --radius-xl（20px 探针档，#202 断言迁组件）；价签 pill 随 #202 probe 定稿退役（页面 + 组件双清零）', () => {
    expect(extractRule(rewardItemVue, 'star-reward-item')).toContain('border-radius: var(--radius-xl)')
    // #202 价格展示定稿 = StarGlyph sm + 金色文案，非边框 pill：price-tag 类与挂口圆角 / 金描边令牌引用零残留
    expect(redeemVue).not.toContain('price-tag')
    expect(rewardItemVue).not.toContain('price-tag')
    expect(redeemVue).not.toContain('--radius-price-tag')
    expect(redeemVue).not.toContain('--color-price-tag-border')
    expect(rewardItemVue).not.toContain('--radius-price-tag')
    expect(rewardItemVue).not.toContain('--color-price-tag-border')
  })

  it('G12 卡片唇边极淡光：star-container 样式集叠加 --glow-edge（全 app 卡片受益）', () => {
    expect(extractRule(componentsCss, 'star-container')).toContain('box-shadow: var(--glow-edge)')
  })

  it('G12 CTA 光晕层次：primary 全尺寸叠 --glow-star-soft（#215 阴影统一 small 档，hover 增厚不丢光晕）', () => {
    expect(extractRule(btnVue, 'star-button--primary.star-button--large')).toContain(', var(--glow-star-soft)')
    expect(extractRule(btnVue, 'star-button--primary.star-button--small')).toContain(', var(--glow-star-soft)')
    const largeHover = extractRule(btnVue, 'star-button--primary.star-button--large:hover:not(:disabled)')
    expect(largeHover).toContain(', var(--glow-star-soft)')
  })
})

/* ===== #158：R-宽档控件封顶（≥600 视口 max-width 令牌 + 居中；<600 手机档零变化）===== */

/** 去注释（extractRule 注释陷阱防护：断言前剥离注释文本） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 花括号配对提取首个 min-width 600 媒体块的完整文本（含 @media 头） */
function media600Block(css: string): string {
  const m = css.match(/@media \(min-width: 600px\)\s*\{/)
  if (!m || m.index === undefined) return ''
  let depth = 0
  let end = -1
  for (let i = m.index + m[0].length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  return end === -1 ? '' : css.slice(m.index, end + 1)
}

describe('#158 R-宽档控件封顶：清单内控件 ≥600 不比大手机更大（480px 令牌封顶 + 居中）', () => {
  it('跨页结构类封顶规则落位 components.css 的 600 媒体块：表单输入行 / 整行内容卡（答题选项行已随 #199 迁组件）', () => {
    const css = stripComments(componentsCss)
    const block = media600Block(css)
    expect(block).toBeTruthy()
    // 封顶清单（票内拍板；#199 起答题选项行、#202 起兑换项迁组件自身样式）：表单输入行（QuestionPrompt / ProposalEdit / Pair）·
    // 整行内容卡（Prizes 进行中兑换 / Proposals 提议卡 / ProposalDetail 提议详情）
    const cappedSelectors = [
      'prompt-input',
      'prompt-textarea',
      'prompt-output',
      'form-name-input',
      'form-price-input',
      'form-desc-input',
      'pair-code-input',
      'pair-name-input',
      'pair-passphrase-input',
      'prize-card',
      'proposal-card',
      'detail-fields',
    ]
    for (const sel of cappedSelectors) {
      const rule = block.match(new RegExp(`\\.${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))
      expect(rule, `components.css 600 媒体块内应有 ${sel} 封顶规则`).toBeTruthy()
      expect(rule?.[1], `${sel} 封顶走 --control-max-width 令牌`).toContain('max-width: var(--control-max-width)')
      expect(rule?.[1], `${sel} 封顶后居中`).toContain('margin-inline: auto')
      // 居中健壮性（#158 修复 2）：封顶元素显式块级参与流，auto 居中不依赖宿主恰为 flex
      expect(rule?.[1], `${sel} 显式块级参与流`).toContain('display: block')
      // 等宽修复（2026-09-09）：input/textarea 块级化仍内容收缩、flex 宿主 auto 边距压掉 stretch——
      // 显式满宽 + border-box 使封顶前一律撑满、封顶后统一 480，杜绝同表单各输入框按内容漂移
      expect(rule?.[1], `${sel} 封顶前满宽`).toContain('width: 100%')
      expect(rule?.[1], `${sel} 满宽不外溢`).toContain('box-sizing: border-box')
    }
  })

  it('大按钮封顶写进 StarButtonStandard 组件自身样式（large 尺寸档全变体 = primary 与 standard；small 两变体不入）', () => {
    const css = stripComments(styleOf(btnVue))
    const block = media600Block(css)
    expect(block).toBeTruthy()
    const rule = block.match(/\.star-button--large[^{]*\{([^}]*)\}/)
    expect(rule).toBeTruthy()
    expect(rule?.[1]).toContain('max-width: var(--control-max-width)')
    expect(rule?.[1]).toContain('margin-inline: auto')
    // 居中健壮性（#158 修复 2）：按钮默认 inline-block，非 flex 宿主下 auto 边距不居中——显式块级化
    expect(rule?.[1]).toContain('display: block')
    // 清单外不入：small 两变体无封顶规则（断言意图不削弱）
    expect(block).not.toContain('star-button--small')
  })

  it('答题选项行封顶写进 StarOptionRow 组件自身样式（#199 组件化迁出 components.css 清单，options 全部子项同款）', () => {
    const css = stripComments(styleOf(optionRowVue))
    const block = media600Block(css)
    expect(block).toBeTruthy()
    const rule = block.match(/\.star-option[^{]*\{([^}]*)\}/)
    expect(rule, 'StarOptionRow 600 媒体块内应有 star-option 封顶规则').toBeTruthy()
    expect(rule?.[1]).toContain('max-width: var(--control-max-width)')
    expect(rule?.[1]).toContain('margin-inline: auto')
    expect(rule?.[1]).toContain('display: block')
    // 等宽修复（2026-09-09）：button 块级化仍内容收缩——显式满宽使各选项不随文案长短漂移
    expect(rule?.[1]).toContain('width: 100%')
    // components.css 清单同步退役：600 媒体块不再含 option 系选择器
    expect(media600Block(stripComments(componentsCss))).not.toContain('option')
  })

  it('奖品行封顶写进 StarRewardItem 组件自身样式（#202 组件化迁出 components.css 清单）：max-width + 居中，容器 flex 照常胜出（媒体块不声明 display）', () => {
    const css = stripComments(styleOf(rewardItemVue))
    const block = media600Block(css)
    expect(block).toBeTruthy()
    const rule = block.match(/\.star-reward-item[^{]*\{([^}]*)\}/)
    expect(rule, 'StarRewardItem 600 媒体块内应有 star-reward-item 封顶规则').toBeTruthy()
    expect(rule?.[1]).toContain('max-width: var(--control-max-width)')
    expect(rule?.[1]).toContain('margin-inline: auto')
    // 等宽修复（2026-09-09）：flex 宿主 auto 边距压掉 stretch——显式满宽 + border-box 使各行封顶前等宽
    expect(rule?.[1]).toContain('width: 100%')
    expect(rule?.[1]).toContain('box-sizing: border-box')
    // 行卡基础布局是横向 flex（probe #194 第 6 节），媒体块不声明 display 防同源覆盖压掉 flex（与旧架构页内 scoped flex 胜出行为保真）
    expect(rule?.[1]).not.toContain('display')
    // components.css 清单同步退役：600 媒体块不再含 reward-item 选择器
    expect(media600Block(stripComments(componentsCss))).not.toContain('reward-item')
  })

  it('手机档零回归：封顶令牌引用只存在于 min-width 600 媒体块内，块外零出现（components.css 与 StarButtonStandard）', () => {
    const comp = stripComments(componentsCss)
    const compBlock = media600Block(comp)
    expect(comp.replace(compBlock, '')).not.toContain('--control-max-width')
    const btn = stripComments(styleOf(btnVue))
    const btnBlock = media600Block(btn)
    expect(btn.replace(btnBlock, '')).not.toContain('--control-max-width')
  })

  it('宽度断点纪律：全仓样式的 min-width 媒体查询值仍只有 600 与 1024（不新增断点、不引入容器查询）', () => {
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter(
      (f) => !f.includes('__tests__') && (f.endsWith('.vue') || f.endsWith('.css')),
    )
    const values = new Set<string>()
    for (const f of files) {
      const raw = readFileSync(resolve(srcDir, f), 'utf-8')
      const text = f.endsWith('.vue') ? styleOf(raw) : raw
      for (const m of stripComments(text).matchAll(/@media\s*\(\s*min-width:\s*([\d.]+)px/g)) values.add(m[1])
    }
    expect([...values].sort()).toEqual(['1024', '600'])
    for (const f of files) {
      const raw = readFileSync(resolve(srcDir, f), 'utf-8')
      const text = f.endsWith('.vue') ? styleOf(raw) : raw
      expect(stripComments(text), `${f} 不引入容器查询`).not.toContain('@container')
    }
  })
})

/* ===== #231：贴纸图标准线分家（游戏自带画、宿主令牌描边）===== */

describe('#231 贴纸图标准线分家：宿主沿 alpha 轮廓施加令牌描边', () => {
  it('贴纸图标样式：drop-shadow 多向叠加形状描边 + 文本令牌引用；无矩形边框方案；触控尺寸维持', () => {
    // #276 review fixes：游戏/惊喜贴纸画作样式收口为共享 .sticker-art，契约跟着迁到共享类
    const art = extractRule(homeStyle, 'sticker-art')
    expect(art).toContain('drop-shadow')
    expect(art).toContain('var(--color-text)')
    // 多向叠加（8 向）近似等宽形状描边，非单侧投影
    expect(art.match(/drop-shadow\(/g)?.length ?? 0).toBeGreaterThanOrEqual(8)
    // 禁矩形边框方案（小车贴纸透明区不应被方框圈住）
    expect(art).not.toContain('border')
    // 尺寸规则不变（#230 触控档）
    expect(art).toContain('width: var(--touch-sm)')
    expect(art).toContain('height: var(--touch-sm)')
  })

  it('迷你车库正式SVG自包含获批PNG、不烘焙第二圈描边或依赖宿主令牌', () => {
    const icon = readFileSync(resolve(srcDir, '../public/games/mini-garage-prototype/icon.svg'), 'utf-8')
    const png = readFileSync(resolve(srcDir, '../public/games/mini-garage-prototype/icon.png'))
    for (const gone of ['#f4f1e8', '#ffd166', '#16294e', '令牌改值', '快照', 'var(--']) {
      expect(icon, `icon.svg 残留: ${gone}`).not.toContain(gone)
    }
    expect(icon).toContain('viewBox="0 0 512 512"')
    expect(icon).not.toMatch(/stroke=|<rect|<filter/)
    const embedded = icon.match(/href="data:image\/png;base64,([^"]+)"/)
    expect(embedded).not.toBeNull()
    expect(Buffer.from(embedded![1], 'base64')).toEqual(png)
  })
})

/* ===== #131：hover 规则触屏防护（收口验收）===== */

describe('#131 hover 触屏防护：hover 规则全部包在 hover-capable 媒体查询内', () => {
  it('src 下全部 .vue 样式段与 .css：无裸 hover 交互规则（触屏设备永不应用 hover 态，桌面指针行为不变）', () => {
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter(
      (f) => !f.includes('__tests__') && (f.endsWith('.vue') || f.endsWith('.css')),
    )
    expect(files.length).toBeGreaterThan(0)
    const bare = files.flatMap((f) => {
      const raw = readFileSync(resolve(srcDir, f), 'utf-8')
      return scanHoverRules(f.endsWith('.vue') ? styleOf(raw) : raw)
        .filter((r) => !r.guarded)
        .map((r) => `${f} :: ${r.header}`)
    })
    expect(bare).toEqual([])
  })
})

/* ===== #258：游戏会话全屏化（宿主 UI 让位——边缘 X / 空态退出形态 / toast 层级）===== */

describe('#258 游戏会话全屏化样式（running 边缘 X / loading 空态 / toast 层级）', () => {
  it('右上角 X：常驻半透明（opacity < 1）+ hover/聚焦提亮至全显；定位右上角；hover 包 hover-capable 媒体查询（#131）', () => {
    const x = extractRule(homeStyle, 'game-exit')
    expect(x).toContain('position: absolute')
    // 常驻半透明走 --opacity-muted 令牌（#258 评审收口：0.55 入令牌；hover/聚焦提亮的 1 不入档）
    expect(x).toContain('opacity: var(--opacity-muted)')
    expect(variablesCss).toMatch(/--opacity-muted:\s*0\.55/)
    const hover = extractRule(homeStyle, 'game-exit:hover')
    expect(hover).toContain('opacity: 1')
    expect(extractRule(homeStyle, 'game-exit:focus-visible')).toContain('opacity: 1')
    // 触屏防护：hover 提亮规则处于 hover-capable 媒体查询内（同 #131 全仓收口口径）
    const rule = scanHoverRules(homeStyle).find((r) => r.header.startsWith('.game-exit:hover'))
    expect(rule, 'game-exit hover 规则应存在').toBeDefined()
    expect(rule?.guarded).toBe(true)
  })

  it('loading/failed 空态块：app 深蓝底色令牌 + 纵横居中（failed 与 loading 同构，仅文案不同）', () => {
    const hold = extractRule(homeStyle, 'game-hold')
    expect(hold).toContain('background-color: var(--color-bg)')
    expect(hold).toContain('align-items: center')
    expect(hold).toContain('justify-content: center')
  })

  it('toast 层级高于 iframe：game-frame / game-exit 均不建层——X 靠 DOM 顺序绘制于 iframe 之上（评审收口删 z-index: 2），toast 仍走 --z-toast 浮层', () => {
    expect(extractRule(homeStyle, 'game-frame')).not.toContain('z-index')
    expect(extractRule(homeStyle, 'game-exit')).not.toContain('z-index')
    // DOM 顺序保层：模板内 .game-frame 在前、.game-exit 为 .game-session 末子元素（且与 .game-hold 互斥渲染）
    const sessionStart = homeVue.indexOf('class="game-session"')
    const session = homeVue.slice(sessionStart, homeVue.indexOf('StarToastStandard', sessionStart))
    expect(session.indexOf('class="game-frame"')).toBeGreaterThan(-1)
    expect(session.lastIndexOf('class="game-exit"')).toBeGreaterThan(session.indexOf('class="game-frame"'))
    expect(toastComponentVue).toMatch(/z-index:\s*var\(--z-toast\)/)
  })

  it('关闭 X 图标共享件：StarIconClose 承载 18px 关闭 X（--icon-size-sm 令牌），Home .game-exit 与 StarModalStandard 关闭钮同源引用，path 逐字重复清零', () => {
    const iconCloseVue = readFileSync(resolve(srcDir, 'components/StarIconClose.vue'), 'utf8')
    expect(variablesCss).toMatch(/--icon-size-sm:\s*18px/)
    expect(styleOf(iconCloseVue)).toContain('width: var(--icon-size-sm)')
    expect(homeVue).toContain('<StarIconClose />')
    expect(modalComponentVue).toContain('<StarIconClose />')
    // 防回潮：两处使用点不再驻留内联关闭 path 字面量
    expect(homeVue).not.toContain('M19 6.4')
    expect(modalComponentVue).not.toContain('M19 6.4')
  })
})
