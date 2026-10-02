import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const variablesCss = readFileSync(resolve(srcDir, 'styles/variables.css'), 'utf-8')
const appVue = readFileSync(resolve(srcDir, 'App.vue'), 'utf-8')
const indexHtml = readFileSync(resolve(srcDir, '..', 'index.html'), 'utf-8')

describe('CSS Variables 设计令牌与全局布局（REQ-6）', () => {
  it('AC6-1 令牌类别齐全：颜色三必选 + 字号 / 间距 / 圆角前缀', () => {
    expect(variablesCss).toContain('--color-primary')
    expect(variablesCss).toContain('--color-bg')
    expect(variablesCss).toContain('--color-text')
    expect(variablesCss).toMatch(/--font-size-[\w-]+:/)
    expect(variablesCss).toMatch(/--space-[\w-]+:/)
    expect(variablesCss).toMatch(/--radius-[\w-]+:/)
  })

  it('AC6-1 颜色值取 #146 星夜童话夜幕系（bg/primary/text 锁定，探针 P1-r2 面板直译）', () => {
    expect(variablesCss).toMatch(/--color-bg:\s*#0d1b3e/)
    expect(variablesCss).toMatch(/--color-primary:\s*#ffd166/)
    expect(variablesCss).toMatch(/--color-text:\s*#f4f1e8/)
  })

  it('AC6-2 全局样式引用令牌：var(--color- 出现，且骨架根元素背景渐变用 var(--color-bg)', () => {
    expect(appVue).toMatch(/var\(--color-/)
    expect(appVue).toMatch(/background:\s*(radial-gradient|linear-gradient)[\s\S]*?var\(--color-bg\)/)
  })

  it('AC6-3 外壳内容列三阶段（#156）：基础 480px 居中，≥600px 上限 640，≥1024px 上限 760，居中方式不变', () => {
    const rule = appVue.match(/[^{}]*\{[^{}]*\}/g) ?? []
    const baseRule = rule.find((r) => r.includes('.app-shell') && r.includes('max-width: 480px'))
    expect(baseRule).toBeTruthy()
    expect(baseRule).toContain('margin-inline: auto')
    // 阶段二/三：宽度断点（orientation 无关），媒体查询内仅放宽上限，其余外壳声明不动
    const stage600 = appVue.match(/@media \(min-width: 600px\)\s*\{[\s\S]*?\.app-shell\s*\{([^}]*)\}/)
    expect(stage600?.[1]).toContain('max-width: 640px')
    expect(stage600?.[1]).not.toContain('margin-inline')
    const stage1024 = appVue.match(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.app-shell\s*\{([^}]*)\}/)
    expect(stage1024?.[1]).toContain('max-width: 760px')
    expect(stage1024?.[1]).not.toContain('margin-inline')
  })

  it('AC6-5 控件宽度封顶令牌（#158）：--control-max-width 480px 在 variables.css 恰一处定义，与外壳第一阶段列宽同值', () => {
    // 令牌定义唯一（全仓恰一处的令牌侧面；样式侧引用钉点见 styles-pages #158 分区）
    const defs = variablesCss.match(/--control-max-width:/g) ?? []
    expect(defs).toHaveLength(1)
    expect(variablesCss).toMatch(/--control-max-width:\s*480px/)
    // 同值同源：外壳第一阶段基础列宽即 480px（App.vue .app-shell 基础规则）
    expect(appVue.match(/\.app-shell[^{]*\{[^}]*max-width: 480px/) ?? []).toBeTruthy()
  })

  it('AC6-4 移动基准：index.html 含 viewport meta（#50 增补 viewport-fit=cover）', () => {
    expect(indexHtml).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    )
  })
})

/* ===== 令牌契约分区（#95 归并：原 styles-r6 / styles-r15 纯令牌断言 / styles-r25 旗红令牌）===== */

describe('字号档位令牌表 T1-T15（原 R6 基线 + R15 T2 去重归一；#146 星夜童话字阶更新）', () => {
  it('T1-T15 档位 clamp 流式契约逐档锁定（#146 星夜字阶值 × #155：下限=现值、上限=现值×1.12 四舍五入、插值视口 390/1366）', () => {
    // 表值 = clamp(下限, 截距px + 斜率vw, 上限) 的正则字面量（钉流式契约表达式，非单值）
    const baseline: Record<string, string> = {
      '--font-size-display': 'clamp\\(64px,\\s*60\\.8px \\+ 0\\.82vw,\\s*72px\\)',
      '--font-size-headline': 'clamp\\(26px,\\s*24\\.8px \\+ 0\\.31vw,\\s*29px\\)',
      '--font-size-question': 'clamp\\(34px,\\s*32\\.4px \\+ 0\\.41vw,\\s*38px\\)',
      '--font-size-topbar': 'clamp\\(18px,\\s*17\\.2px \\+ 0\\.2vw,\\s*20px\\)',
      '--font-size-btn': 'clamp\\(18px,\\s*17\\.2px \\+ 0\\.2vw,\\s*20px\\)',
      '--font-size-btn-sm': 'clamp\\(15px,\\s*14\\.2px \\+ 0\\.2vw,\\s*17px\\)',
      '--font-size-body-lg': 'clamp\\(18px,\\s*17\\.2px \\+ 0\\.2vw,\\s*20px\\)',
      '--font-size-body': 'clamp\\(16px,\\s*15\\.2px \\+ 0\\.2vw,\\s*18px\\)',
      '--font-size-info': 'clamp\\(15px,\\s*14\\.2px \\+ 0\\.2vw,\\s*17px\\)',
      '--font-size-star-lg': 'clamp\\(56px,\\s*53\\.2px \\+ 0\\.72vw,\\s*63px\\)',
      '--font-size-star': 'clamp\\(44px,\\s*42px \\+ 0\\.51vw,\\s*49px\\)',
      '--font-size-num': 'clamp\\(16px,\\s*15\\.2px \\+ 0\\.2vw,\\s*18px\\)',
      '--font-size-label': 'clamp\\(13px,\\s*12\\.2px \\+ 0\\.2vw,\\s*15px\\)',
      '--font-size-caption': 'clamp\\(12px,\\s*11\\.6px \\+ 0\\.1vw,\\s*13px\\)',
    }
    for (const [token, pattern] of Object.entries(baseline)) {
      expect(variablesCss, `${token} 应钉 clamp 流式契约`).toMatch(new RegExp(`${token}:\\s*${pattern}`))
    }
  })

  it('AC-R15-2-1 --font-size-title 已删除（R15 旧档位令牌退役）', () => {
    expect(variablesCss).not.toMatch(/--font-size-title\s*:/)
  })
})

describe('旗红描边令牌（原 R25，DR25-5 / REQ-R25-2；#146 夜幕 = 暖红纸面旗色）', () => {
  it('--color-flag-stroke: #c95844 存在于 variables.css', () => {
    expect(variablesCss).toMatch(/--color-flag-stroke:\s*#c95844/)
  })
})

describe('补全与退役令牌（原 R2 AC9-1 + R15 T1-3；#153 清理收口）', () => {
  it('仍在服役的 R2 补全令牌均已定义（outline / outline-soft / error-shadow）', () => {
    for (const token of ['--color-outline', '--color-outline-soft', '--color-error-shadow']) {
      expect(variablesCss).toMatch(new RegExp(`${token}\\s*:`))
    }
  })

  it('#153 退役令牌零残留（星径色 + 废弃三组，防回潮；令牌名拼接构造、不驻留字面量）', () => {
    for (const name of ['primary-light', 'tertiary', 'on-tertiary', 'tertiary-shadow', 'outline-strong', 'starpath']) {
      expect(variablesCss).not.toMatch(new RegExp(`--color-${name}\\s*:`))
    }
    // 废弃标注随退役令牌一并清零（R15「保留定义兼容断言」口径已废除）
    expect(variablesCss).not.toContain('DEPRECATED')
  })

  it('R2 组件新增令牌落位（scrim / z / duration / modal-max）', () => {
    expect(variablesCss).toMatch(/--color-scrim\s*:/)
    expect(variablesCss).toMatch(/--z-modal\s*:/)
    expect(variablesCss).toMatch(/--z-toast\s*:/)
    expect(variablesCss).toMatch(/--duration-fast\s*:/)
    expect(variablesCss).toMatch(/--duration-base\s*:/)
    expect(variablesCss).toMatch(/--modal-max\s*:/)
  })
})

describe('夜幕主题色令牌值（原 R15 T1「晴空剧场」；#146 星夜童话「夜幕 × 星光金 × 月光米白」）', () => {
  it('AC-R15-1-1 夜幕令牌值全部存在（star / go 金系 / bg-accent 底深档）', () => {
    expect(variablesCss).toMatch(/--color-star:\s*#ffd166/)
    expect(variablesCss).toMatch(/--color-go:\s*#f7b733/)
    expect(variablesCss).toMatch(/--color-bg-accent:\s*#0a1531/)
  })

  it('#146 补一轮 弃描边：深金星描边令牌已从令牌表删除（圆润发光星不描边，防回潮）', () => {
    expect(variablesCss).not.toMatch(/--color-star-shadow/)
  })

  it('#146 补一轮 星光微光令牌存在（小星单级 drop-shadow，探针 P1-r2 直译）', () => {
    expect(variablesCss).toMatch(/--glow-star-svg-soft:\s*drop-shadow\(0 0 4px rgba\(255, 209, 102, 0\.7\)\)/)
  })

  it('AC-R15-1-2 旧值零残留（R15 暗色旧值 + #146 换装前亮色值，防回潮）', () => {
    for (const old of [
      '#171310', '#ffd600', '#f7f2e8', '#95f849', '#ffb4ab',
      '#fbfeff', '#3d7ee0', '#2b3a55', '#ef9820', '#c47f1c', '#7cb342', '#dce7f4', '#d9544f', '#b0403c',
    ]) {
      expect(variablesCss).not.toContain(old)
    }
  })
})

/* ===== #57 令牌收口防回潮门禁（2026-08-30）=====
   口径：src 生产代码（令牌定义本体 variables.css 除外）不得出现本次收口各族的规格值字面量；
   装饰几何按「文件 + 选择器」白名单豁免（EXEMPTS，行内容须同时匹配才放行）。
   扫描写法沿用 tests/acceptance/22 的 src 全仓收集模式。 */

/** 递归收集 src 生产源码（排除 __tests__ 测试目录与 variables.css 令牌定义本体） */
function collectProductionFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === '__tests__') continue
      out.push(...collectProductionFiles(full))
    } else if (/\.(vue|ts|css)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

const PRODUCTION_FILES = collectProductionFiles(srcDir).filter(
  (f) => relative(srcDir, f) !== join('styles', 'variables.css'),
)

/** 装饰几何豁免白名单：文件 + 选择器（allow 同时匹配该行内容才放行，防整文件误放） */
const EXEMPTS: Array<{ file: string; selector: string; allow: RegExp }> = []

/** 行级族扫描：返回违规行（文件:行号 内容） */
function scanLiteral(re: RegExp): string[] {
  const hits: string[] = []
  for (const file of PRODUCTION_FILES) {
    const rel = relative(srcDir, file)
    const lines = readFileSync(file, 'utf-8').split('\n')
    lines.forEach((line, idx) => {
      if (!re.test(line)) return
      if (EXEMPTS.some((e) => e.file === rel && e.allow.test(line))) return
      hits.push(`${rel}:${idx + 1} ${line.trim()}`)
    })
  }
  return hits
}

describe('#57 令牌收口防回潮门禁（src 生产代码规格值零硬编码）', () => {
  it('新增令牌族定义齐全：字距两档 / 触控三档 / 阴影四档 / 细描边 / 大星尺寸档', () => {
    for (const [token, value] of [
      ['--letter-spacing-title', '1px'],
      ['--letter-spacing-info', '0.5px'],
      ['--touch-sm', '44px'],
      ['--touch-md', '56px'],
      ['--touch-lg', '64px'],
      ['--shadow-xs', '2px'],
      ['--shadow-sm', '4px'],
      ['--shadow-md', '6px'],
      ['--shadow-lg', '8px'],
      ['--border-thin', '1.5px'],
      ['--size-star-hero', '112px'],
    ] as const) {
      expect(variablesCss, `${token} 应定义为 ${value}`).toMatch(
        new RegExp(`${token}:\\s*${value.replace(/\./g, '\\.')}\\b`),
      )
    }
  })

  it('z-index 层级 90 零残留（原水印层令牌已随测试模式移除，层级空缺不补字面量）', () => {
    expect(scanLiteral(/z-index:\s*90\b/)).toEqual([])
  })

  it('字距 1px / 0.5px 零残留（走 --letter-spacing-title / --letter-spacing-info）', () => {
    expect(scanLiteral(/letter-spacing:\s*(?:1px|0\.5px)\b/)).toEqual([])
  })

  it('触控/规格尺寸 44 / 56 / 64px 声明零残留（走 --touch-*；装饰几何白名单豁免）', () => {
    expect(scanLiteral(/(?:min-)?(?:width|height):\s*(?:44|56|64)px/)).toEqual([])
  })

  it('唇边阴影深度 2 / 4 / 6 / 8px 零残留（含 inset 形态，走 --shadow-*）', () => {
    expect(scanLiteral(/box-shadow:\s*(?:inset\s+)?0\s*[2468]px/)).toEqual([])
  })

  it('细描边 1.5px solid 零残留（走 --border-thin）', () => {
    expect(scanLiteral(/1\.5px\s+solid/)).toEqual([])
  })

  it('云朵白 rgba 0.85 零残留（走 color-mix 回溯 --color-surface）', () => {
    expect(scanLiteral(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.85\s*\)/)).toEqual([])
  })

  it('表外字号 12px / 14px 零残留（StarChip 走 --font-size-caption / --font-size-btn-sm）', () => {
    expect(scanLiteral(/font-size:\s*(?:12|14)px/)).toEqual([])
  })
})
