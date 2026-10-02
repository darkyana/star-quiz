/**
 * #228 R-移除测试模式：移除完成的可验证定义（源码级守卫，沿 32 号验收源码文本断言先例）。
 * 口径：src/ 下（含 __tests__）零测试模式状态模块引用与两存储键名；测试系组件/文案槽位/设计令牌零残留；
 * 六个孩子端页面与家长页零水印/开关卡挂载。违禁标识符拼接构造、不驻留字面量（沿 #153 先例），
 * 保证本守卫文件自身不命中同样口径的全仓 grep。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'

const cwd = process.cwd()

/** 递归收集 src/ 下 .ts / .vue 源文件（含 __tests__，与 33 号验收同收集口径） */
function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full))
    else if (/\.(ts|vue|css)$/.test(name)) out.push(full)
  }
  return out
}

const srcFiles = walkFiles(resolve(cwd, 'src'))

/** 违禁标识符清单（拼接构造：模块/单例/生命周期函数/组件/存储键名/键属性名/挂载类名） */
const BANNED: string[] = [
  'use' + 'TestModeState',
  'sq_test_' + 'mode',
  'sq_test_' + 'snapshot',
  'is' + 'TestMode',
  'on' + 'TestModeResumed',
  'load' + 'TestModeState',
  'enable' + 'TestMode',
  'disable' + 'TestMode',
  'pending' + 'TestEntries',
  'snapshot' + 'Broken',
  'Watermark' + 'Test',
  'Card' + 'Toggle',
  'test' + 'Mode',
  'test' + 'Snapshot',
  'test-mode' + '-card',
  'test' + '-watermark',
]

describe('#228 测试模式状态模块与存储键零引用', () => {
  it('src/ 下 .ts/.vue/.css 文件名与文件内容零违禁标识符（防空集：文件数 ≥ 100）', () => {
    expect(srcFiles.length).toBeGreaterThanOrEqual(100)
    for (const file of srcFiles) {
      for (const banned of BANNED) {
        expect(basename(file), `${relative(cwd, file)} 文件名含 ${'违禁标识符'}`).not.toContain(banned)
        expect(readFileSync(file, 'utf-8'), `${relative(cwd, file)} 内容含 ${'违禁标识符'}`).not.toContain(banned)
      }
    }
  })

  it('测试系文件整体删除：状态模块 / 开关卡组件 / 水印组件不存在', () => {
    for (const path of ['src/composables/use' + 'TestModeState.ts', 'src/components/Card' + 'Toggle.vue', 'src/components/Watermark' + 'Test.vue']) {
      expect(existsSync(resolve(cwd, path)), `${path} 应不存在`).toBe(false)
    }
  })
})

describe('#228 配套文案与设计令牌零残留', () => {
  it('copy.ts 无测试模式文案槽位（「测试中」水印文案不驻留源码）', () => {
    const copySource = readFileSync(resolve(cwd, 'src', 'copy.ts'), 'utf-8')
    expect(copySource).not.toContain('测试中')
    expect(copySource).not.toContain('测试模式')
  })

  it('variables.css 测试系令牌零残留（绯红语义色 / 水印 z 层 / 水印字号）', () => {
    const vars = readFileSync(resolve(cwd, 'src', 'styles', 'variables.css'), 'utf-8')
    for (const token of ['--color-test-', '--z-' + 'watermark', '--font-size-test-']) {
      expect(vars).not.toContain(token)
    }
  })
})

describe('#228 挂载点零回潮（孩子端六页 + 家长页）', () => {
  it('六个孩子端页面与家长页源码零水印/开关卡挂载痕迹', () => {
    for (const page of ['Home.vue', 'Quiz.vue', 'Result.vue', 'StarLog.vue', 'Prizes.vue', 'Redeem.vue', 'Parent.vue']) {
      const source = readFileSync(resolve(cwd, 'src', 'pages', page), 'utf-8')
      expect(source, page).not.toContain('Watermark' + 'Test')
      expect(source, page).not.toContain('Card' + 'Toggle')
      expect(source, page).not.toContain('confirm-hint')
    }
  })
})
