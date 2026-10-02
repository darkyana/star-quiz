/**
 * AC-2.5 组件无硬编码界面文案（Spec 20260823 REQ-2 / AC-2.5）
 * 结构性验收：Home / Quiz / Result / Redeem / StarLog / Parent 六个页面 .vue 的
 * <template> 与 <script setup> 不含直接书写的界面文案字符串字面量，文案均经 copy 对象引用。
 * AC-2.1 正向：六页均 import { copy }；AC-2.5 负向：高辨识度界面文案不出现在 .vue 源码。
 * 文案白名单取自 Spec §7 实现提示（不取自实现源码），避开注释/类名误伤。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readPage(name: string): string {
  return readFileSync(resolve(process.cwd(), `src/pages/${name}`), 'utf-8')
}

const PAGES = ['Home.vue', 'Quiz.vue', 'Result.vue', 'Redeem.vue', 'StarLog.vue', 'Parent.vue'] as const

describe('AC-2.1 / AC-2.5 文案抽离结构性验收（Spec 20260823 REQ-2）', () => {
  it('AC-2.1 正向：六个页面 .vue 均 import { copy } from "../copy"', () => {
    for (const name of PAGES) {
      const src = readPage(name)
      expect(src, `${name} 应引入 copy`).toContain("import { copy } from '../copy'")
    }
  })

  it('AC-2.5 正向：六个页面 .vue 均通过 copy.* 引用文案（非空引用）', () => {
    for (const name of PAGES) {
      const src = readPage(name)
      // import 行 '../copy' 不含 "copy."，此处仅匹配实际使用（如 copy.home.brand）
      expect(src, `${name} 应通过 copy.* 引用文案`).toContain('copy.')
    }
  })

  // Spec §7 实现提示披露的界面文案白名单（高辨识度，已确认不误伤 .vue 注释/类名）
  const UI_COPY_LITERALS = [
    '满分通关！太棒了',
    '差一点点就满分了，再来一次',
    '没关系，下次再来',
    '今天来攒几颗星？',
    '还没有题目哦，等爸爸妈妈加好题目就可以开始了',
    '答题得星',
    '满分奖励',
    '兑换：',
  ]

  it('AC-2.5 负向：六个 .vue 不含界面文案字符串字面量（文案均经 copy 引用）', () => {
    for (const name of PAGES) {
      const src = readPage(name)
      for (const literal of UI_COPY_LITERALS) {
        expect(src, `${name} 不应硬编码界面文案 "${literal}"`).not.toContain(literal)
      }
    }
  })
})
