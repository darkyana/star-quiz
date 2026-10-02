import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        d1Databases: { LEGACY_DB: 'legacy-migration-test' },
        // 迁移语句数组注入为测试绑定，由 setup 文件 applyD1Migrations 应用（官方 D1 配方）
        bindings: { D1_MIGRATIONS: await readD1Migrations('migrations') },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    include: ['test/**/*.test.ts'],
  },
})
