import { describe, it, expect } from 'vitest'
import pkg from '../../package.json'

const ALLOWED_DEV_DEPS = [
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

const FORBIDDEN_PACKAGES = [
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

describe('工程初始化依赖白名单（AC1-1）', () => {
  it('dependencies 恰好为 vue 与 vue-router 两项', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['vue', 'vue-router'])
  })

  it('devDependencies 恰好为基础工具链与 Pages 回归运行时', () => {
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([...ALLOWED_DEV_DEPS].sort())
  })

  it('整个 package.json 不含任何禁止项包名', () => {
    const text = JSON.stringify(pkg)
    for (const name of FORBIDDEN_PACKAGES) {
      expect(text).not.toContain(name)
    }
  })
})
