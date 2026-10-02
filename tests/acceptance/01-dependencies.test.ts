/**
 * AC1-1 依赖白名单（Spec §4 REQ-1 / §3.4）
 * 测试依据：Spec §3.4 依赖白名单（allowed / forbidden 完整清单），非实现源码。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkgRaw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')
const pkg = JSON.parse(pkgRaw) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }

// Spec §3.4 devDependencies 允许清单（完整）
const ALLOWED_DEV = [
  'vite',
  'typescript',
  'vue-tsc',
  'vitest',
  '@vitejs/plugin-vue',
  '@vue/test-utils',
  'happy-dom',
  '@types/node',
  'wrangler', // #213 retro: isolated Pages HTTP regression runtime
]

// Spec §3.4 禁止项（完整）
const FORBIDDEN = [
  'element-plus',
  'naive-ui',
  'vant',
  'ant-design-vue',
  'gsap',
  'anime.js',
  'motion',
  'pinia',
  'vuex',
  'tailwindcss',
  'bootstrap',
]

describe('AC1-1 依赖白名单', () => {
  it('dependencies 恰好为 vue、vue-router 两项', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['vue', 'vue-router'])
  })

  it('devDependencies 为 §3.4 允许清单的子集', () => {
    for (const dep of Object.keys(pkg.devDependencies)) {
      expect(ALLOWED_DEV).toContain(dep)
    }
  })

  it('整个文件不含 §3.4 禁止项中的任何一个包名', () => {
    const raw = JSON.stringify(pkg)
    for (const name of FORBIDDEN) {
      expect(raw).not.toContain(name)
    }
  })
})
