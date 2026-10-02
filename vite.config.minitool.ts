// 小红书小工具专用构建配置（npm run build:minitool → tools/build-minitool.mjs 编排）：
// - define 注入 VITE_MINITOOL='1'：src/minitool.ts 的 IS_MINITOOL 恒 true，云端/配对/游戏/文件下载
//   等容器不可用能力经 DCE tree-shake 移出产物
// - target es2017/chrome61：容器最低内核基线（js-compatibility 规范）
// - IIFE 单文件经典脚本：容器 CSP 禁 type="module"（zip-artifact-spec §3），无代码分割
// - base './'：zip 内资源必须相对路径引用；publicDir 关闭（manifest 与 games 不进小工具包）
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'

// __BUILD_ID__ 与主构建同口径（vite.config.ts）：小工具构建也编译 Home.vue，缺失该 define 会编译失败；
// 小工具包无 version.json（publicDir 关闭），检查更新入口在 minitool 恒不渲染（Home 按 IS_MINITOOL 门禁）
const BUILD_ID = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
})()

export default defineConfig({
  plugins: [vue()],
  base: './',
  publicDir: false,
  define: {
    'import.meta.env.VITE_MINITOOL': JSON.stringify('1'),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    outDir: 'dist-minitool',
    target: ['es2017', 'chrome61'],
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { index: 'minitool.html' },
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
