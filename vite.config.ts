/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { APP_VERSION } from './src/data/app-version'

// 检查更新（版本号可点击）：构建身份 = git 短哈希，构建时注入前端并与 dist/version.json 同源落盘。
// 业务版本号 APP_VERSION 只服务人（页脚展示），不参与「有无新版本」判定——不 bump 版本号的常规合并
// 部署也能被其他设备检测到（2026-02 老板拍板：比对构建哈希，不依赖人工版本纪律）。
function resolveBuildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}
const BUILD_ID = resolveBuildId()

/** 构建收尾写 dist/version.json：{ version, build }，各设备 fetch(no-store) 比对 build 字段 */
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    closeBundle() {
      const outDir = fileURLToPath(new URL('./dist', import.meta.url))
      mkdirSync(outDir, { recursive: true })
      writeFileSync(`${outDir}/version.json`, JSON.stringify({ version: APP_VERSION, build: BUILD_ID }))
    },
  }
}

export default defineConfig({
  plugins: [vue(), emitVersionJson()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    allowedHosts: ['happybot.sgponte'],
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.ts', 'tests/acceptance/**/*.test.ts'],
    setupFiles: ['tests/setup.localStorage.ts', 'tests/setup.hashNav.ts', 'tests/setup.onboardingTransport.ts'],
  },
})
