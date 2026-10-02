// cloudflare:test 的 env 类型增强（官方 types 里声明 env: Cloudflare.Env）
import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import type { Env as WorkerEnv } from '../src/env'

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      /** 迁移语句数组（vitest.config 读盘注入，仅测试环境存在） */
      D1_MIGRATIONS: D1Migration[]
      LEGACY_DB: D1Database
    }
  }
}
