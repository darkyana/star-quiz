/**
 * T4 模块改名重构独立验收（Spec 20260826-073，阶段二外门 test-writer）。
 * 补齐 32 号验收未覆盖的 AC 子条：
 * - AC-T4-1-1 接口形状（§实现提示·类型形状）｜AC-T4-1-5/6 兑换闭环（AC 原数字场景）
 * - AC-T4-1-7 记账幂等｜AC-T4-1-8 满分 +3
 * - AC-T4-3-1 五旧标识符全词零命中 + 新名存在被引用｜AC-T4-3-2 .ts 模块文件名 camelCase
 * （2026-08-29 废弃旧工作流时移除：AC-T4-4-1 / AC-T4-5-1——依赖已删除的 .trae/rules/
 *   与 docs 活文档 backlog.md / terms.md / README.md，规则与活文档概念已随旧工作流废弃）
 * - AC-T4-6-1 无 skip / todo 残留
 * 【#55 裁决 2026-08-29（修正）】AC-T4-5-2（历史快照旧名保留）随 docs/releases、docs/iterations
 *   整体移入 _Archived_docs/ 归档封存而退役——归档 = 冻结不再维护，防清洗断言失去对象，删除。
 * 【2026-08-30 追记】_Archived_docs/ 已整体移出仓库（内容仅存 git 历史）——勿寻。
 * 已由既有测试覆盖、不在本文件重复：AC-T4-1-2/3/4/9、AC-T4-2-2、AC-T4-3-3、AC-T4-6-2 契约面。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'
import type { StarEntry } from '../../src/types'
import { init } from '../../src/composables/useDataInfra'
import { earn, redeem, balance, ledger, hasEarned, writeRewards, writeLedger } from '../../src/composables/useStarData'

const cwd = process.cwd()
const rel = (p: string): string => relative(cwd, p)

/** 递归收集指定扩展名文件（不依赖 readdirSync recursive 选项） */
function walkFiles(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, exts))
    else if (exts.some((ext) => name.endsWith(ext))) out.push(full)
  }
  return out
}

beforeEach(() => {
  localStorage.clear()
  init()
})

// ===== AC-T4-1-1 接口形状（§实现提示·类型形状） =====
describe('AC-T4-1-1 useStarData 接口形状（全新环境 + init() 后）', () => {
  it('earn 返回 void；balance 返回 number；hasEarned 返回 boolean', () => {
    expect(earn({ quizId: 'q1', correctCount: 3, totalCount: 10 })).toBeUndefined()
    expect(balance()).toBeTypeOf('number')
    expect(hasEarned('q1')).toBeTypeOf('boolean')
    expect(hasEarned('q1')).toBe(true)
  })

  it('redeem 返回 { ok: true } | { ok: false, reason } 两种形态', () => {
    // init() 后默认兑换目录含 reward_pineapple（价格 5），余额 0 → 拒绝形态
    const denied = redeem('reward_pineapple')
    expect(denied).toMatchObject({ ok: false })
    expect('reason' in denied && typeof denied.reason === 'string').toBe(true)

    earn({ quizId: 'q1', correctCount: 7, totalCount: 10 })
    expect(redeem('reward_pineapple')).toEqual({ ok: true })
  })

  it('ledger 返回 StarEntry[] 形状；ledger / writeLedger 可调用且不抛错', () => {
    earn({ quizId: 'q1', correctCount: 2, totalCount: 10 })
    const entries = ledger()
    expect(Array.isArray(entries)).toBe(true)
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries as StarEntry[]) {
      expect(typeof e.id).toBe('string')
      expect(typeof e.timestamp).toBe('number')
      expect(['earn', 'redeem']).toContain(e.type)
      expect(typeof e.amount).toBe('number')
      expect(typeof e.source).toBe('string')
    }
    const snap = ledger()
    expect(() => writeLedger(snap)).not.toThrow()
  })
})

// ===== AC-T4-1-5 / AC-T4-1-6 兑换闭环（AC 原数字场景） =====
describe('AC-T4-1-5 兑换成功闭环（传标识符，来源含「兑换：{名称}」）', () => {
  it('余额 5 + 价格 5 的 r1 → ok:true、balance 0、新增 1 条 redeem 流水', () => {
    writeRewards([{ id: 'r1', name: '菠萝油', price: 5 }])
    earn({ quizId: 'setup', correctCount: 5, totalCount: 10 })
    expect(balance()).toBe(5)

    const result = redeem('r1')
    expect(result).toEqual({ ok: true })
    expect(balance()).toBe(0)

    const after = ledger()
    expect(after).toHaveLength(2) // setup earn 1 条 + redeem 1 条
    const added = after[after.length - 1]
    expect(added.type).toBe('redeem')
    expect(added.amount).toBe(5)
    expect(added.source).toBe('兑换：菠萝油') // 「兑换：{名称}」现行格式保留
  })
})

describe('AC-T4-1-6 余额不足零写入', () => {
  it('余额 4 + 价格 5 的 r1 → ok:false + reason、balance 仍 4、ledger 条数不变', () => {
    writeRewards([{ id: 'r1', name: '菠萝油', price: 5 }])
    earn({ quizId: 'setup', correctCount: 4, totalCount: 10 })
    const countBefore = ledger().length

    const result = redeem('r1')
    expect(result).toMatchObject({ ok: false })
    expect('reason' in result && typeof result.reason === 'string').toBe(true)
    expect(balance()).toBe(4)
    expect(ledger()).toHaveLength(countBefore)
  })
})

// ===== AC-T4-1-7 / AC-T4-1-8 记账幂等与满分 +3 =====
describe('AC-T4-1-7 earn 已入账幂等', () => {
  it('8/10 首次 balance 8 + 1 条 earn + hasEarned true；同 quizId 再次 earn 零写入', () => {
    earn({ quizId: 'q1', correctCount: 8, totalCount: 10 })
    expect(balance()).toBe(8)
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0].type).toBe('earn')
    expect(hasEarned('q1')).toBe(true)

    earn({ quizId: 'q1', correctCount: 8, totalCount: 10 })
    expect(balance()).toBe(8)
    expect(ledger()).toHaveLength(1)
  })
})

describe('AC-T4-1-8 满分额外 +3', () => {
  it('10/10 → balance === 13（10 题全对 10 星 + 满分奖励 3 星）', () => {
    earn({ quizId: 'q2', correctCount: 10, totalCount: 10 })
    expect(balance()).toBe(13)
  })
})

// ===== AC-T4-3-1 五旧标识符全词零命中 + 新名存在被引用 =====
const srcSourceFiles = walkFiles(resolve(cwd, 'src'), ['.ts', '.vue'])

/** 全词匹配（词边界）：含子串关系的标识符（如 useTestMode）非全词必误报（Spec §验收标准头部约定） */
const FIVE_OLD_IDENTIFIERS: Array<[string, RegExp]> = [
  ['useTestMode', /\buseTestMode\b/],
  ['import-export', /\bimport-export\b/],
  ['relative-time', /\brelative-time\b/],
  ['TestWatermark', /\bTestWatermark\b/],
  ['TestModeCard', /\bTestModeCard\b/],
]

describe('AC-T4-3-1 五旧标识符 src/ 全词零命中', () => {
  it('src/ 下 .ts/.vue 文件名与文件内容五旧标识符全词零命中（防空集：文件数 ≥ 20）', () => {
    expect(srcSourceFiles.length).toBeGreaterThanOrEqual(20)
    for (const file of srcSourceFiles) {
      for (const [name, re] of FIVE_OLD_IDENTIFIERS) {
        expect(re.test(basename(file)), `${rel(file)} 文件名含旧标识符 ${name}`).toBe(false)
        expect(re.test(readFileSync(file, 'utf-8')), `${rel(file)} 内容含旧标识符 ${name}`).toBe(false)
      }
    }
  })
})

describe('AC-T4-3-1 新标识符存在文件且被引用', () => {
  const NEW_MODULES: Array<[string, string]> = [
    ['importExport', 'src/utils/importExport.ts'],
    ['relativeTime', 'src/utils/relativeTime.ts'],
  ]

  it('新标识符对应模块文件存在', () => {
    for (const [, path] of NEW_MODULES) {
      expect(existsSync(resolve(cwd, path)), `${path} 应存在`).toBe(true)
    }
  })

  it('新标识符在 src/ 内被引用（定义文件之外 ≥ 1 个文件）', () => {
    for (const [id, def] of NEW_MODULES) {
      const referrers = srcSourceFiles.filter(
        (f) => rel(f) !== def && readFileSync(f, 'utf-8').includes(id),
      )
      expect(referrers.length, `${id} 应被定义文件之外的模块引用`).toBeGreaterThan(0)
    }
  })
})

// ===== AC-T4-3-2 .ts 模块文件名全 camelCase（范围按头部修订 1 澄清） =====
describe('AC-T4-3-2 无连字符命名的 .ts 模块文件', () => {
  it('排除 src/data/ 静态内容、__tests__/ 测试文件、vite-env.d.ts 后无连字符 .ts 文件', () => {
    const moduleTsFiles = srcSourceFiles.filter((f) => {
      const r = rel(f)
      if (!r.endsWith('.ts')) return false
      if (r.startsWith('src/data/')) return false // §非目标豁免的静态内容文件
      if (r.includes('__tests__/')) return false
      if (r.endsWith('vite-env.d.ts')) return false
      return true
    })
    expect(moduleTsFiles.length).toBeGreaterThanOrEqual(8) // 防空集假绿
    const offenders = moduleTsFiles.filter((f) => basename(f).includes('-'))
    expect(offenders.map(rel), '应全部为 camelCase（无连字符）').toEqual([])
  })
})

// ===== AC-T4-5-1 活文档六旧名 / AC-T4-5-2 历史快照均已退役（见文件头说明），常量一并移除 =====

// ===== AC-T4-6-1 无 skip / todo 残留 =====
describe('AC-T4-6-1 全部测试文件无 skip / todo / only 残留', () => {
  it('src/**/__tests__/ 与 tests/acceptance/ 的 .test.ts 零残留（防空集：≥ 50 个）', () => {
    const testFiles = [
      ...srcSourceFiles.filter((f) => rel(f).includes('__tests__/') && f.endsWith('.test.ts')),
      ...walkFiles(resolve(cwd, 'tests/acceptance'), ['.test.ts']),
    ]
    expect(testFiles.length).toBeGreaterThanOrEqual(50)
    for (const file of testFiles) {
      const content = readFileSync(file, 'utf-8')
      expect(
        /\b(it|test|describe)\.(skip|todo|only)\b/.test(content),
        `${rel(file)} 存在 it/describe/test 的 skip/todo/only 残留`,
      ).toBe(false)
    }
  })
})
