// 运营方发码脚本纯函数单测（票 #191，ADR 0007）
// 被测对象：tools/operator.mjs 导出的纯函数（家庭码拒绝采样为 operator 独立实现，口令口径与 worker/src/admin.ts 一致）
// wrangler 调用边不在本套件覆盖（简报 AC：调用边不测，对 dev 库走通一次即验）
import { describe, expect, it } from 'vitest'
import {
  generateCode,
  generatePassphrase,
  buildIssueStatements,
  buildRetireSql,
  buildRetireVerifySql,
  buildCodeLookupSql,
  buildListSql,
  buildSetPassphraseSql,
  isValidCode,
  decideAddPassphrase,
  decideRetire,
  isCodeCollision,
  issueWithRetry,
  parseDatabaseName,
  parseCliArgs,
} from '../../tools/operator.mjs'

describe('generateCode：6 位数字（pairing_codes CHECK 口径）', () => {
  it('格式为 6 位数字，200 次全过', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/)
    }
  })
  it('随机值 ≥ LIMIT 时重采样而非直接取模：超界样本被丢弃，产出首个合法样本的余数', () => {
    const original = globalThis.crypto.getRandomValues
    let call = 0
    // 4_294_967_295 = 2^32 - 1、4_294_000_000 = 拒绝上限本身：两者均 ≥ LIMIT，必须重采样；
    // 若拒绝分支失效（有偏直取模），首个样本 4_294_967_295 将产出 '967295' 而非 '456789'
    const seq = [4_294_967_295, 4_294_000_000, 123_456_789]
    globalThis.crypto.getRandomValues = ((array: Uint32Array) => {
      array[0] = seq[Math.min(call++, seq.length - 1)]
      return array
    }) as unknown as typeof crypto.getRandomValues
    try {
      expect(generateCode()).toBe('456789')
      expect(call).toBe(3)
    } finally {
      globalThis.crypto.getRandomValues = original
    }
  })
})

describe('generatePassphrase：4 位小写 a-z（#190 双因子口径）', () => {
  it('格式为 4 位小写字母，200 次全过', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePassphrase()).toMatch(/^[a-z]{4}$/)
    }
  })
})

describe('buildIssueStatements：families 行 + pairing_codes 行原子 batch', () => {
  it('两条 INSERT 的快照断言（families 在前作 FK 父行，pairing_codes 含 passphrase 列）', () => {
    const sql = buildIssueStatements({ familyId: 'fam-uuid-1', code: '123456', passphrase: 'abcd', now: 1757200000000 })
    expect(sql).toBe(
      "INSERT INTO families (family_id, created_at) VALUES ('fam-uuid-1', 1757200000000);\n" +
      "INSERT INTO pairing_codes (code, family_id, issued_at, passphrase) VALUES ('123456', 'fam-uuid-1', 1757200000000, 'abcd');",
    )
    const statements = sql.split(';').filter((s) => s.trim() !== '')
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('INSERT INTO families')
    expect(statements[1]).toContain('INSERT INTO pairing_codes')
    expect(statements[1]).toContain('passphrase')
  })
})

describe('buildRetireSql：指定码 retired_at 打戳（只动该码）', () => {
  it('UPDATE 带 WHERE 且限定现役行', () => {
    expect(buildRetireSql('654321', 1757200000000)).toBe(
      "UPDATE pairing_codes SET retired_at = 1757200000000 WHERE code = '654321' AND retired_at IS NULL;",
    )
  })
})

describe('buildListSql：全服家庭一览（子查询防 join 扇出）', () => {
  it('SELECT 含现役码/口令有无、设备总数、active 设备数、last_seen 聚合与创建时间倒序', () => {
    const sql = buildListSql()
    expect(sql).toContain('FROM families f')
    expect(sql).toContain('active_code')
    expect(sql).toContain('active_passphrase')
    expect(sql).toContain('device_total')
    expect(sql).toContain('device_active')
    expect(sql).toContain('MAX(d.last_seen_at)')
    expect(sql).toContain("d.status = 'active'")
    expect(sql).toContain('d.revoked_at IS NULL')
    expect(sql).toContain('ORDER BY f.created_at DESC')
  })
})

describe('retire 资格判定与回查：免 meta.changes 的先查后改再确认', () => {
  it('回查语句按码取 retired_at', () => {
    expect(buildRetireVerifySql('654321')).toBe("SELECT retired_at FROM pairing_codes WHERE code = '654321';")
  })
  it('decideRetire：码不存在 → not_found', () => {
    expect(decideRetire(null)).toEqual({ ok: false, reason: 'not_found' })
  })
  it('decideRetire：已退役 → already_retired', () => {
    expect(decideRetire({ code: '123456', retired_at: 123, passphrase: null })).toEqual({
      ok: false,
      reason: 'already_retired',
    })
  })
  it('decideRetire：现役码允许退役', () => {
    expect(decideRetire({ code: '123456', retired_at: null, passphrase: 'abcd' })).toEqual({ ok: true })
  })
})

describe('add-passphrase SQL 组装：先查后补 + 幂等保护', () => {
  it('查询语句按码取整行', () => {
    expect(buildCodeLookupSql('654321')).toBe(
      "SELECT code, family_id, retired_at, passphrase FROM pairing_codes WHERE code = '654321';",
    )
  })
  it('补发语句 WHERE 限定现役且无口令行（并发下不覆盖已有口令）', () => {
    expect(buildSetPassphraseSql('654321', 'wxyz', 1757200000000)).toBe(
      "UPDATE pairing_codes SET passphrase = 'wxyz' WHERE code = '654321' AND retired_at IS NULL AND passphrase IS NULL;",
    )
  })
})

describe('isValidCode：CLI 入参防线（6 位数字，兼防注入）', () => {
  it('合法 6 位数字通过', () => {
    expect(isValidCode('000000')).toBe(true)
    expect(isValidCode('999999')).toBe(true)
  })
  it('位数不对/含非数字/空值一律拒绝', () => {
    expect(isValidCode('12345')).toBe(false)
    expect(isValidCode('1234567')).toBe(false)
    expect(isValidCode('12a456')).toBe(false)
    expect(isValidCode('12345 6')).toBe(false)
    expect(isValidCode('')).toBe(false)
    expect(isValidCode(undefined as unknown as string)).toBe(false)
  })
})

describe('decideAddPassphrase：补发资格判定（幂等保护）', () => {
  it('码不存在 → not_found', () => {
    expect(decideAddPassphrase(null)).toEqual({ ok: false, reason: 'not_found' })
  })
  it('已退役 → retired', () => {
    expect(decideAddPassphrase({ code: '123456', family_id: 'f', retired_at: 123, passphrase: null })).toEqual({
      ok: false,
      reason: 'retired',
    })
  })
  it('已有口令 → has_passphrase（拒绝重发）', () => {
    expect(decideAddPassphrase({ code: '123456', family_id: 'f', retired_at: null, passphrase: 'abcd' })).toEqual({
      ok: false,
      reason: 'has_passphrase',
    })
  })
  it('现役且无口令 → 允许补发', () => {
    expect(decideAddPassphrase({ code: '123456', family_id: 'f', retired_at: null, passphrase: null })).toEqual({
      ok: true,
    })
  })
})

describe('isCodeCollision：撞全服主键识别', () => {
  it('UNIQUE 约束错误识别为撞码', () => {
    expect(isCodeCollision(new Error('UNIQUE constraint failed: pairing_codes.code'))).toBe(true)
  })
  it('其他错误不是撞码', () => {
    expect(isCodeCollision(new Error('boom'))).toBe(false)
  })
})

describe('issueWithRetry：撞码整批换号重试（注入假执行器）', () => {
  const mkGenerate = (codes: string[]) => {
    let i = 0
    return () => ({ familyId: `fam-${i}`, code: codes[Math.min(i++, codes.length - 1)], passphrase: `pp${i}`.slice(0, 4) })
  }

  it('首次成功：单次执行，返回签发的钥匙对', async () => {
    const calls: string[] = []
    const result = await issueWithRetry({
      executor: async (sql: string) => {
        calls.push(sql)
      },
      generate: mkGenerate(['111111']),
      now: 1757200000000,
    })
    expect(calls).toHaveLength(1)
    expect(result.code).toBe('111111')
    expect(result.attempts).toBe(1)
    expect(calls[0]).toContain("'111111'")
  })

  it('撞码后换号重提：前两次 UNIQUE 拒绝，第三次新码成功', async () => {
    const calls: string[] = []
    const result = await issueWithRetry({
      executor: async (sql: string) => {
        calls.push(sql)
        if (calls.length < 3) throw new Error('UNIQUE constraint failed: pairing_codes.code')
      },
      generate: mkGenerate(['111111', '111111', '222222']),
      now: 1757200000000,
    })
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain("'111111'")
    expect(calls[2]).toContain("'222222'")
    expect(result.code).toBe('222222')
    expect(result.attempts).toBe(3)
  })

  it('非 UNIQUE 错误立即抛出，不重试', async () => {
    const calls: string[] = []
    await expect(
      issueWithRetry({
        executor: async (sql: string) => {
          calls.push(sql)
          throw new Error('boom')
        },
        generate: mkGenerate(['111111']),
        now: 1757200000000,
      }),
    ).rejects.toThrow('boom')
    expect(calls).toHaveLength(1)
  })

  it('连续撞码达到上限：抛「换号重试耗尽」且执行次数 = maxAttempts', async () => {
    const calls: string[] = []
    await expect(
      issueWithRetry({
        executor: async (sql: string) => {
          calls.push(sql)
          throw new Error('UNIQUE constraint failed: pairing_codes.code')
        },
        generate: mkGenerate(['999999']),
        now: 1757200000000,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('换号重试耗尽')
    expect(calls).toHaveLength(3)
  })
})

describe('parseDatabaseName：从 wrangler.jsonc 读库名（脚本内零硬编码）', () => {
  it('剥离 // 与 /* */ 注释后取 d1_databases[0].database_name', () => {
    const sample = `{
      // 主配置注释
      "name": "star-quiz-worker",
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "star-quiz-sync", // 行尾注释
          "database_id": "00000000-0000-0000-0000-000000000000"
        }
      ]
    }`
    expect(parseDatabaseName(sample)).toBe('star-quiz-sync')
  })
  it('缺 d1_databases 配置时抛错', () => {
    expect(() => parseDatabaseName('{ "name": "x" }')).toThrow('database_name')
  })
})

describe('parseCliArgs：--remote 显式开关与参数防线（票 #204）', () => {
  it('空参数：subcommand/arg 为 undefined、remote=false、无 error（main 打印用法）', () => {
    expect(parseCliArgs([])).toEqual({ subcommand: undefined, arg: undefined, remote: false })
  })
  it('无子命令仅带 --remote：subcommand 为 undefined、remote=true（不报错，main 打印用法）', () => {
    expect(parseCliArgs(['--remote'])).toEqual({ subcommand: undefined, arg: undefined, remote: true })
  })
  it('issue 不带开关：remote=false（默认保守连本地，现状不变）', () => {
    expect(parseCliArgs(['issue'])).toEqual({ subcommand: 'issue', arg: undefined, remote: false })
  })
  it('list 不带开关：remote=false', () => {
    expect(parseCliArgs(['list'])).toEqual({ subcommand: 'list', arg: undefined, remote: false })
  })
  it('issue --remote：开关在子命令后 → remote=true', () => {
    expect(parseCliArgs(['issue', '--remote'])).toEqual({ subcommand: 'issue', arg: undefined, remote: true })
  })
  it('list --remote：只读子命令同样识别开关 → remote=true', () => {
    expect(parseCliArgs(['list', '--remote'])).toEqual({ subcommand: 'list', arg: undefined, remote: true })
  })
  it('retire 123456 --remote：开关在位置参数后 → remote=true，arg 正确解析', () => {
    expect(parseCliArgs(['retire', '123456', '--remote'])).toEqual({
      subcommand: 'retire',
      arg: '123456',
      remote: true,
    })
  })
  it('add-passphrase 654321 --remote：多词子命令 + 尾部开关 → remote=true', () => {
    expect(parseCliArgs(['add-passphrase', '654321', '--remote'])).toEqual({
      subcommand: 'add-passphrase',
      arg: '654321',
      remote: true,
    })
  })
  it('--remote 出现在子命令前也识别（位置宽松，不误判为位置参数）', () => {
    expect(parseCliArgs(['--remote', 'retire', '123456'])).toEqual({
      subcommand: 'retire',
      arg: '123456',
      remote: true,
    })
  })
  it('显式 --local：remote=false（与默认一致，显式声明本地）', () => {
    expect(parseCliArgs(['list', '--local'])).toEqual({ subcommand: 'list', arg: undefined, remote: false })
    expect(parseCliArgs(['--local', 'issue'])).toEqual({ subcommand: 'issue', arg: undefined, remote: false })
  })
  it('retire 不带码：arg 为 undefined 且无 error（6 位码校验留给子命令入参防线）', () => {
    expect(parseCliArgs(['retire'])).toEqual({ subcommand: 'retire', arg: undefined, remote: false })
    expect(parseCliArgs(['retire', '--remote'])).toEqual({ subcommand: 'retire', arg: undefined, remote: true })
  })
  it('未知 flag（--foo）→ error，且不静默落到任何库', () => {
    const result = parseCliArgs(['list', '--foo'])
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('--foo')
  })
  it('未知 flag 与 --remote 同时出现 → 仍然 error（容错不放行）', () => {
    const result = parseCliArgs(['issue', '--remote', '--bar'])
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('--bar')
  })
  it('多余位置参数 → error（不静默吞参）', () => {
    const result = parseCliArgs(['retire', '123456', '789012'])
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('789012')
  })
  it('list 带多余位置参数 → error', () => {
    const result = parseCliArgs(['list', '123456'])
    expect(result.error).toBeTruthy()
  })
  it('issue 带位置参数 → error（issue 零参数，不静默吞参）', () => {
    const result = parseCliArgs(['issue', '123456', '--remote'])
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('issue')
  })
  it('retire 带两个位置参数 → error 且消息含多余参数', () => {
    const result = parseCliArgs(['retire', '123456', '789012', '--remote'])
    expect(result.error).toBeTruthy()
    expect(result.remote).toBe(true)
  })
  it('未知子命令 → error（main 打印用法并退出非零）', () => {
    const result = parseCliArgs(['frobnicate'])
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('frobnicate')
  })
  it('纯函数不碰进程状态：返回对象结构稳定，error 为字符串', () => {
    const ok = parseCliArgs(['add-passphrase', '000001'])
    expect(Object.keys(ok).sort()).toEqual(['arg', 'remote', 'subcommand'])
    const bad = parseCliArgs(['nope', '--x'])
    expect(typeof bad.error).toBe('string')
  })
})
