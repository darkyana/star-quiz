/**
 * AC6 CSS Variables 设计令牌与全局布局 —— 引用性断言（#95 归并）
 * 令牌存在性/取值的逐条断言已收拢至 src/__tests__/styles-tokens.test.ts（含 #57 令牌收口防回潮门禁），
 * 验收侧只保留「令牌契约测试存在且就位」级别的引用性断言，不再重复同一批颜色与字号令牌断言。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('AC6 设计令牌契约（引用性断言）', () => {
  it('令牌契约测试存在且就位：src/__tests__/styles-tokens.test.ts 含 AC6 契约与 #57 防回潮门禁', () => {
    const contract = readFileSync(resolve(process.cwd(), 'src/__tests__/styles-tokens.test.ts'), 'utf-8')
    expect(contract).toContain('CSS Variables 设计令牌与全局布局')
    expect(contract).toContain('令牌收口防回潮门禁')
    expect(contract).toContain('--color-primary')
    expect(contract).toContain('--font-size-')
  })
})
