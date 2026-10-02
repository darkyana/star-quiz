import { applyD1Migrations, env } from 'cloudflare:test'

// D1 迁移在 setup 阶段应用（vitest.config 里 readD1Migrations 读盘注入 D1_MIGRATIONS 绑定）
await applyD1Migrations(env.DB, env.D1_MIGRATIONS)
