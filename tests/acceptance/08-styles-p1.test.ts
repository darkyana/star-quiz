/**
 * AC9-1 ~ AC9-5 设计令牌补全与工艺债（Spec §4 REQ-9）
 * 全部为样式文件文本断言 + 首页 DOM class 映射断言（Spec §8 风险表：不依赖 jsdom 布局计算）。
 * 期望文本来自 Spec §4 验收标准与 §0.1 文案白名单，非实现源码。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'

function readText(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf-8')
}

/** 提取 <style>...</style> 段（App.vue + 全部页面） */
const STYLE_FILES = [
  'src/App.vue',
  'src/pages/Home.vue',
  'src/pages/Quiz.vue',
  'src/pages/Result.vue',
  'src/pages/Redeem.vue',
  'src/pages/StarLog.vue',
  'src/pages/Parent.vue',
]

function styleSections(file: string): string {
  const text = readText(file)
  const parts: string[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) parts.push(m[1])
  return parts.join('\n')
}

/* 三归宿迁移（2026-08-30）：跨页样式集迁入 components.css，与其余 <style> 段一并纳入扫描 */
const ALL_STYLE = [...STYLE_FILES.map(styleSections), readText('src/styles/components.css')].join('\n')

/** 提取某选择器（不含点）的首个规则块声明文本 */
function extractRule(className: string): string {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\.${esc}[^{]*\\{([^}]*)\\}`, 's')
  const m = ALL_STYLE.match(re)
  return m ? m[1] : ''
}

async function mountHome(): Promise<VueWrapper> {
  window.location.hash = '#/'
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return wrapper
}

describe('AC9-1 设计令牌补全（variables.css）', () => {
  it('R2 补全令牌仍在服役者已定义（outline / error-shadow；#153 清理退役废弃三组）', () => {
    const css = readText('src/styles/variables.css')
    for (const token of ['--color-outline', '--color-outline-soft', '--color-error-shadow']) {
      expect(css).toMatch(new RegExp(`${token}\\s*:`))
    }
  })

  it('R1 既有令牌不回归（primary / bg 仍在）', () => {
    const css = readText('src/styles/variables.css')
    expect(css).toMatch(/--color-primary\s*:/)
    expect(css).toMatch(/--color-bg\s*:/)
  })
})

describe('AC9-2 按钮零描边 + 唇边语言', () => {
  it('全局 .btn 系已收编 StarButtonStandard 组件（App/页面样式不再含 btn-primary/btn-secondary/btn-sm 规则）', () => {
    expect(extractRule('btn-primary')).toBe('')
    expect(extractRule('btn-secondary')).toBe('')
    expect(extractRule('btn-sm')).toBe('')
    expect(extractRule('icon-btn')).toBe('')
    expect(extractRule('star-btn')).toBe('')
  })

  it('选项行（#199 组件化 StarOptionRow）规则唇边深度走 --shadow-sm 令牌；跳过钮无专属样式复用同款', () => {
    const optionRowVue = readText('src/components/StarOptionRow.vue')
    expect(optionRowVue).toMatch(/\.star-option\s*\{[^}]*box-shadow: 0 var\(--shadow-sm\) 0/)
    expect(optionRowVue).not.toContain('option-skip')
  })

  it('组件唇边语言落位（StarButtonStandard.vue：主蓝 / 标准唇边深度走 --shadow 令牌）', () => {
    const btnVue = readText('src/components/StarButtonStandard.vue')
    expect(btnVue).toMatch(/\.star-button--primary\.star-button--large\s*\{[^}]*box-shadow: 0 var\(--shadow-sm\) 0 var\(--color-primary-shadow\)/)
    expect(btnVue).toMatch(/\.star-button--standard\.star-button--small\s*\{[^}]*box-shadow: 0 var\(--shadow-sm\) 0/)
  })
})

describe('AC9-3 hover 态（工艺债②）', () => {
  it('选项存在 :hover 规则，且含 translateY(-2px) 与唇边加厚（#199 组件化后选项与按钮 hover 均读组件源码）', () => {
    const optionRowVue = readText('src/components/StarOptionRow.vue')
    const optionHover = optionRowVue.match(/\.star-option:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(optionHover).toContain('translateY(-2px)')
    expect(optionHover).toContain('box-shadow: 0 var(--shadow-md) 0')
    const btnHover = readText('src/components/StarButtonStandard.vue')
    expect(btnHover).toMatch(/\.star-button--standard\.star-button--large:hover[^{]*\{[^}]*translateY\(-2px\)/)
  })
})

describe('AC9-4 chip / 角标间距归入既有 scale（工艺债④）', () => {
  it('含 chip / badge / is-locked 规则的 padding / margin / gap 数值均为 {4,8,12,16,20,24}px 之一', () => {
    const blocks = ALL_STYLE.match(/[^{}]+\{[^{}]*\}/g) ?? []
    const badValues: string[] = []
    for (const block of blocks) {
      if (!/(chip|badge|is-locked)/.test(block)) continue
      const declarations = block.match(/(?:padding|margin|gap)(?:-[a-z]+)?\s*:\s*[^;]+/g) ?? []
      for (const decl of declarations) {
        const values = decl.match(/\d+(?:\.\d+)?(?:px)?/g) ?? []
        for (const v of values) {
          const n = parseFloat(v)
          if (n === 0) continue // 0 非失败判据（AC 明文列出的失败值：2 / 6 / 10 / 14 / 22）
          if (![4, 8, 12, 16, 20, 24].includes(n)) badValues.push(`${block.trim()} :: ${decl.trim()} :: ${v}`)
        }
      }
    }
    expect(badValues).toEqual([])
  })
})

describe('AC9-5 首页字号档位收敛（工艺债③ + R15 T1-T15 分档，防回归）', () => {
  it('首页可见文本元素经 class → 字号令牌映射后全部落在 T1-T15 档位令牌内（无表外档位）', async () => {
    const wrapper = await mountHome()
    const home = wrapper.find('[data-page="home"]')
    expect(home.exists()).toBe(true)

    // R15 Typography T1-T15 全量令牌（Spec 实现提示 §2 档位表），首页任何文本元素不得引用表外字号
    const ALLOWED = new Set([
      '--font-size-display',
      '--font-size-headline',
      '--font-size-topbar',
      '--font-size-btn',
      '--font-size-btn-sm',
      '--font-size-body-lg',
      '--font-size-body',
      '--font-size-info',
      '--font-size-star-lg',
      '--font-size-star',
      '--font-size-num',
      '--font-size-label',
      '--font-size-caption',
    ])
    const used = new Set<string>()
    const leafElements: Element[] = []
    for (const el of home.element.querySelectorAll('*')) {
      // 页脚（.app-footer：版本号 + 「配置」链接）为产品负责人 2026-08-21 裁决新增的 caption 位，
      // 属元信息而非内容层级，豁免于首页内容档位校验（见 src/pages/Home.vue 页脚注释）
      if (el.closest('.app-footer')) continue
      const directText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
      )
      if (directText) leafElements.push(el)
    }
    for (const el of leafElements) {
      const cls = typeof el.className === 'string' ? el.className : ''
      for (const c of cls.split(/\s+/).filter(Boolean)) {
        const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\.${esc}(?![-a-zA-Z0-9_])[^{]*\\{([^}]*)\\}`, 's')
        const m = ALL_STYLE.match(re)
        if (!m) continue
        const fs = m[1].match(/font-size\s*:\s*var\((--font-size-[a-zA-Z0-9-]+)\)/)
        if (fs) used.add(fs[1])
      }
    }
    expect(used.size).toBeGreaterThan(0) // 首页文本元素必须实际落在映射档位内（防空过）
    for (const t of used) expect(ALLOWED.has(t)).toBe(true) // R15：无表外档位
    wrapper.unmount()
  })
})
