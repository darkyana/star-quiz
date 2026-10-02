/**
 * R15 亮色主题「晴空剧场」验收补充（Spec AC-R15，2026-08-23）
 *
 * 覆盖（补充 ai-developer 已建 src/__tests__/styles-r15.test.ts 未覆盖的 AC 文本断言）：
 * - AC-R15-2-2  src 全部源码无 font-size 17/20/22px（简报门 5 口径，防表外档位回归）
 * - AC-R15-2-3  src 全部源码无 font-weight: 900（字重收敛）
 * - AC-R15-2-4  src 全部源码零引用 --font-size-title（改名完成）
 * - AC-R15-3-1  非交互元素去阴影（余额 / 题干卡 / 流水行 / chip 无 box-shadow）
 * - AC-R15-3-7  触控工艺：主按钮 min-height ≥ 56px，其余可点元素 ≥ 44px
 *
 * ===== 老板手动验收清单（AC-R15-1-5 / 2-7 / 3-8，Spec 标注不生成自动化测试）=====
 * 以下三项为纯视觉验收项，由老板在真实浏览器（建议 iPhone Safari / Chrome 移动模拟）
 * 逐条核对，预期结果以 Spec「成功长什么样」为准：
 *
 * AC-R15-1-5（夜幕换装观感，#146 星夜童话后预期更新）：
 *   步骤：依次打开 首页 / 答题页 / 结算页 / 兑换页 / 星星记事本 / 家长页（连点星星图标 5 次）。
 *   预期：全站星星统一星光金 #ffd166（含首页星径星群、结算页发光大星与 +N 星、兑换/记事本余额星标），
 *         无任何星星呈暗色；背景深蓝夜幕纵深 + 月光米白文字，整体氛围统一、无对比度刺眼。
 *
 * AC-R15-2-7（文字档位观感）：
 *   步骤：遍历上述 6 页面，观察标题 / 正文 / 标签 / 说明文案的字号层级。
 *   预期：标题（T2 18px 顶栏）、题干（T8 18px）、正文（T6 16px）、信息（T9 15px）、
 *         标签（T14 13px）、说明小字（T15 12px）各档一致、层级清晰，无突兀字号、无 900 字重。
 *
 * AC-R15-3-8（首页氛围与主 CTA）：
 *   步骤：打开首页停留 ≥ 10 秒，观察顶部天空渐晕与云朵；核对开始答题 / 兑换星星按钮位置。
 *   预期：顶部浅蓝渐晕自然；云朵缓慢漂移（不抢注意力、无闪烁）；两个主 CTA 位于页面底部区域、
 *         触控区域充足（高度 ≥ 56px）；整体明快耐看，孩子愿意多练几次。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const SRC_DIR = resolve(process.cwd(), 'src')

/** 递归收集 src 生产源码（排除 __tests__ 测试目录），返回文件绝对路径 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === '__tests__') continue
      out.push(...collectSourceFiles(full))
    } else if (/\.(vue|ts|css)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

const SOURCE_FILES = collectSourceFiles(SRC_DIR)
const SOURCE_TEXT = SOURCE_FILES.map((f) => readFileSync(f, 'utf-8')).join('\n')

/** 提取某选择器（类名，不含点）在全部组件样式中的首个规则块声明文本 */
function styleSections(filePath: string): string {
  const text = readFileSync(filePath, 'utf-8')
  const parts: string[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) parts.push(m[1])
  return parts.join('\n')
}

const STYLE_FILES = [
  resolve(SRC_DIR, 'App.vue'),
  resolve(SRC_DIR, 'pages/Home.vue'),
  resolve(SRC_DIR, 'pages/Quiz.vue'),
  resolve(SRC_DIR, 'pages/Result.vue'),
  resolve(SRC_DIR, 'pages/Redeem.vue'),
  resolve(SRC_DIR, 'pages/StarLog.vue'),
  resolve(SRC_DIR, 'pages/Parent.vue'),
]
/* 三归宿迁移（2026-08-30）：跨页样式集迁入 components.css，与其余 <style> 段一并纳入扫描 */
const ALL_STYLE = [...STYLE_FILES.map(styleSections), readFileSync(resolve(SRC_DIR, 'styles/components.css'), 'utf-8')].join('\n')

function extractRule(className: string): string {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\.${esc}[^{]*\\{([^}]*)\\}`, 's')
  const m = ALL_STYLE.match(re)
  return m ? m[1] : ''
}

describe('AC-R15-2 文字样式防回归门（src 全仓 grep）', () => {
  it('AC-R15-2-2 无 font-size 17/20/22px（简报门 5 口径，防表外档位）', () => {
    const hits = SOURCE_TEXT.match(/font-size:\s*(17|20|22)px/g) ?? []
    expect(hits).toEqual([])
  })

  it('AC-R15-2-3 无 font-weight: 900（字重收敛，仅允许 400/600/700/800）', () => {
    const hits = SOURCE_TEXT.match(/font-weight:\s*900/g) ?? []
    expect(hits).toEqual([])
  })

  it('AC-R15-2-4 --font-size-title 零引用（改名 --font-size-topbar 完成）', () => {
    const hits = SOURCE_TEXT.match(/--font-size-title/g) ?? []
    expect(hits).toEqual([])
  })
})

describe('AC-R15-3-1 非交互元素去阴影（设计规则 6；#152 G5/G12 题卡例外走拍板令牌）', () => {
  it('余额 / 流水行规则块不含 box-shadow；题卡（非交互展示容器）阴影只允许 #152 拍板的探针档令牌组合', () => {
    const targets: Array<[string, string]> = [
      ['balance-chip', '余额 chip（不可点）'],
      ['ledger-row', '记事本流水行'],
    ]
    for (const [cls, label] of targets) {
      const rule = extractRule(cls)
      expect(rule, `${label}（.${cls}）应有样式规则`).not.toBe('')
      expect(rule, `${label}（.${cls}）不得含 box-shadow`).not.toContain('box-shadow')
    }
    // #152 G5/G12：题卡「灯下纸片」暖光 inset + 卡投影 + 唇边极淡光 = 票内拍板的探针档令牌组合；
    // 整串锁定防任意硬编码阴影借预算放宽回潮
    const card = extractRule('question-card')
    expect(card, '题干卡（.question-card）应有样式规则').not.toBe('')
    expect(card).toContain('box-shadow: var(--shadow-card), var(--glow-paper-top), var(--glow-edge)')
  })
})

describe('AC-R15-3-7 触控工艺（主按钮 ≥ 56px，其余可点元素 ≥ 44px；#57 起尺寸走 --touch 令牌，数值经 variables.css 回溯）', () => {
  const variablesCss = readFileSync(resolve(SRC_DIR, 'styles/variables.css'), 'utf-8')

  /** 令牌感知版：规则内 min-height 引用的令牌经 variables.css 回溯数值后与 min 比较 */
  function minHeightGe(rule: string, min: number): boolean {
    const token = rule.match(/min-height:\s*var\((--[\w-]+)\)/)?.[1]
    if (!token) return false
    const value = Number(variablesCss.match(new RegExp(`${token}:\\s*(\\d+(?:\\.\\d+)?)px`))?.[1] ?? 0)
    return value >= min
  }

  it('主按钮 min-height ≥ 56px（App 全局 .btn 系已组件化进 StarButtonStandard，--touch-md 保证）', () => {
    const btnVue = readFileSync(resolve(process.cwd(), 'src/components/StarButtonStandard.vue'), 'utf-8')
    const rule = btnVue.match(/(?:^|\n)\.star-button--large\s*\{([^}]*)\}/s)
    expect(rule, 'StarButtonStandard large 尺寸规则应存在').not.toBeNull()
    expect(rule![1], '组件 large min-height 走 --touch-md 令牌').toContain('min-height: var(--touch-md)')
    expect(minHeightGe(rule![1], 56), '组件 large min-height ≥ 56px').toBe(true)
  })

  it('记事本入口（.ledger-link）已组件化进 StarButtonStandard（small 走 --touch-sm，回溯 44px ≥ 44px）', () => {
    // 注：Spec AC-R15-3-7 以 .notebook_entry 指代记事本入口，实现以 .ledger-link 类名钩子 + StarButtonStandard 落地
    const redeemVue = readFileSync(resolve(process.cwd(), 'src/pages/Redeem.vue'), 'utf-8')
    expect(redeemVue, 'Redeem 使用 StarButtonStandard 渲染入口').toContain('class="ledger-link"')
    const btnVue = readFileSync(resolve(process.cwd(), 'src/components/StarButtonStandard.vue'), 'utf-8')
    const rule = btnVue.match(/(?:^|\n)\.star-button--small\s*\{([^}]*)\}/s)
    expect(rule, 'StarButtonStandard small 尺寸规则应存在').not.toBeNull()
    expect(rule![1], '组件 small min-height 走 --touch-sm 令牌').toContain('min-height: var(--touch-sm)')
    expect(minHeightGe(rule![1], 44), '组件 small min-height ≥ 44px').toBe(true)
  })
})
