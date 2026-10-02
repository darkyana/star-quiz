// 同步域建表存在性护栏（票 #249）：应用全部迁移后，DOMAINS 每个域的物理表都必须可查询。
// 与 golden 契约测试互补：golden 防名单漂移，本测试防「域定义有域而数据库缺表」（漏写建表迁移）。
// 物理表名 = DOMAINS 键（生产 upsert/pull 即以此直查，migrations 同名建表），故不引入第二份映射。
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { DOMAINS } from '../src/sync'

describe('同步域建表存在性（#249 护栏）', () => {
  it('DOMAINS 每个域都有对应物理表可查询（缺表即红并点名缺失域清单）', async () => {
    const missing: string[] = []
    for (const domain of Object.keys(DOMAINS)) {
      try {
        // 表名为 DOMAINS 编译期键（非用户输入），与生产 upsertSql 同口径直接插值；空表亦可查询
        await env.DB.prepare(`SELECT 1 FROM ${domain} LIMIT 1`).run()
      } catch {
        missing.push(domain)
      }
    }
    expect(missing, `缺建表迁移的域: ${missing.join(', ')}`).toEqual([])
  })
})
