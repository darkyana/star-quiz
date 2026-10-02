/**
 * R34 提议数据层双端化单测（Spec 20260828-R34 T2）：
 * 孩子新建初始态（AC-R34-3-1/2/3）、setAgreed 双端表态各控各（AC-R34-4-1/2/3/4）、
 * update 修订方向参数化（AC-R34-5-1/2/4）、发布/作废签名 grep 断言（AC-R34-8-3；publish 签名随发布门禁收口演进）。
 * 断言走公开接口（create / setAgreed / update / 落盘 JSON），不锁实现细节。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  proposals as readProposals,
  writeProposals,
  create,
  update,
  setAgreed,
  voidProposal,
  publish,
} from '../useProposals'
import type { ProposalRecord } from '../../types'

beforeEach(() => {
  localStorage.clear()
  // 发布成功路径注入窗口内固定时刻（沿 R33 用例口径，避免真实时间 flaky；vi.setSystemTime 固定系统时间，架构评审 20260829）
  vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

/** 落盘口径提议（不含派生字段 publishState） */
function makeProposalRecord(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: 'p1',
    name: '去游乐园',
    price: 20,
    status: 'discussing',
    createdAt: 1724140800000,
    updatedAt: 1724140800000,
    description: '',
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

describe('R34 孩子新建提议（AC-R34-3-1/2/3）', () => {
  it('AC-R34-3-2 create({ initiator: "child" })：追加 1 条——initiator child、孩子自动同意自己、家长未同意、整体沟通中、时间戳为写入时刻', () => {
    const existing = [makeProposalRecord()]
    writeProposals(existing)
    const before = Date.now()

    const created = create({ name: '吃冰淇淋', price: 3, description: '周末' }, { initiator: 'child' })

    const after = Date.now()
    const list = readProposals()
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual(existing[0]) // 既有提议不变，新提议追加末尾
    expect(list.map((p) => p.id)).toContain(created.id)
    expect(created).toMatchObject({
      name: '吃冰淇淋',
      price: 3,
      description: '周末',
      initiator: 'child',
      childStatus: 'agreed', // 发起人自动同意自己（对称 R32 家长行为）
      parentStatus: 'notAgreed',
      status: 'discussing',
    })
    expect(typeof created.createdAt).toBe('number')
    expect(created.createdAt).toBeGreaterThanOrEqual(before)
    expect(created.createdAt).toBeLessThanOrEqual(after)
    expect(created.updatedAt).toBe(created.createdAt) // 同一写入时刻
  })

  it('AC-R34-3-3 create 不传 opts（默认 parent）：R32 家长行为回归不变——发起人 parent 自动同意、孩子未同意', () => {
    const created = create({ name: '看电影', price: 10, description: '' })

    expect(created).toMatchObject({
      initiator: 'parent',
      parentStatus: 'agreed',
      childStatus: 'notAgreed',
      status: 'discussing',
    })
  })
})

describe('R34 双端表态 setAgreed（AC-R34-4-1/2/3/4）', () => {
  it('AC-R34-4-1/2 role="parent"：只写家长开关、孩子开关不动，整体状态随双开关重新推导', () => {
    // 孩子新建初始态（孩子已同意、家长未同意）→ 家长同意 → 已达成一致
    const created = create({ name: '吃冰淇淋', price: 3, description: '' }, { initiator: 'child' })
    writeProposals([created])

    expect(setAgreed(created.id, 'parent', true)).toBe(true)

    const after = readProposals()[0]
    expect(after.parentStatus).toBe('agreed')
    expect(after.childStatus).toBe('agreed') // 孩子开关不被触碰
    expect(after.status).toBe('agreed')
  })

  it('AC-R34-4-1/2 role="child"：只写孩子开关、家长开关不动，整体状态随之推导', () => {
    // 家长新建初始态（家长已同意、孩子未同意）→ 孩子同意 → 已达成一致
    const created = create({ name: '去动物园', price: 15, description: '' })
    writeProposals([created])

    expect(setAgreed(created.id, 'child', true)).toBe(true)

    const after = readProposals()[0]
    expect(after.childStatus).toBe('agreed')
    expect(after.parentStatus).toBe('agreed') // 家长开关不被触碰
    expect(after.status).toBe('agreed')
  })

  it('AC-R34-4-3 双向切换：已达成一致 → 任一方收回同意 → 整体回沟通中（只动该方开关）', () => {
    const agreed = makeProposalRecord({ status: 'agreed', childStatus: 'agreed' })
    writeProposals([agreed])

    expect(setAgreed('p1', 'child', false)).toBe(true)
    expect(readProposals()[0]).toMatchObject({
      childStatus: 'notAgreed',
      parentStatus: 'agreed',
      status: 'discussing',
    })

    expect(setAgreed('p1', 'child', true)).toBe(true)
    expect(readProposals()[0]).toMatchObject({ childStatus: 'agreed', status: 'agreed' })
  })

  it('AC-R34-4-4 终态或不存在 → false 零变更', () => {
    for (const status of ['published', 'voided'] as const) {
      const seeded = [makeProposalRecord({ status })]
      writeProposals(seeded)
      expect(setAgreed('p1', 'parent', true)).toBe(false)
      expect(setAgreed('p1', 'child', true)).toBe(false)
      expect(readProposals()).toEqual(seeded)
    }
    expect(setAgreed('nope', 'parent', true)).toBe(false)
  })
})

describe('R34 修订方向参数化（AC-R34-5-1/2/4）', () => {
  it('AC-R34-5-1/2 孩子视角 update(…, "child")：内容更新、对方（家长）重置未同意、自身（孩子）保持、整体回沟通中、updatedAt 刷新', () => {
    const seeded = makeProposalRecord({
      status: 'agreed',
      childStatus: 'agreed',
      updatedAt: 1000,
    })
    writeProposals([seeded])
    const before = Date.now()

    const ok = update('p1', { name: '去水上乐园', price: 25, description: '夏天去' }, 'child')

    const updated = readProposals()[0]
    expect(ok).toBe(true)
    expect(updated.name).toBe('去水上乐园')
    expect(updated.price).toBe(25)
    expect(updated.description).toBe('夏天去')
    expect(updated.parentStatus).toBe('notAgreed') // 对方自动重置
    expect(updated.childStatus).toBe('agreed') // 改动方自动同意新版本（2026-08-30 拍板；本例原本已同意）
    expect(updated.status).toBe('discussing') // agreed 修订后回沟通中
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before)
    expect(updated.createdAt).toBe(seeded.createdAt) // 创建时间不变
  })

  it('AC-R34-5-1 家长视角 update 默认方向 parent：R32 回归——孩子重置、家长保持', () => {
    const seeded = makeProposalRecord({ status: 'agreed', childStatus: 'agreed', updatedAt: 1000 })
    writeProposals([seeded])

    const ok = update('p1', { name: '改名', price: 10, description: '' })

    const updated = readProposals()[0]
    expect(ok).toBe(true)
    expect(updated.childStatus).toBe('notAgreed')
    expect(updated.parentStatus).toBe('agreed')
    expect(updated.status).toBe('discussing')
  })

  it('AC-R34-5-4 终态（已发布 / 已作废）修订拒绝零变更（双方向）', () => {
    for (const status of ['published', 'voided'] as const) {
      for (const role of ['parent', 'child'] as const) {
        const seeded = [makeProposalRecord({ status })]
        writeProposals(seeded)
        expect(update('p1', { name: '改名', price: 1, description: '' }, role)).toBe(false)
        expect(readProposals()).toEqual(seeded)
      }
    }
  })
})

describe('R34 发布 / 作废家长专属（AC-R34-8-3；publish 签名随发布门禁收口 / 窗口删除演进）', () => {
  /** grep 断言：源码导出签名逐字锁定当前契约（voidProposal 不变；publish 增可选 now 注入、publishClock 单例不复存在；
   *  #265 起窗口删除，签名收敛为仅 validate seam，锁定文本随契约同步演进） */
  it('AC-R34-8-3 useProposals.ts 源码签名断言：按当前契约逐字锁定，setChildAgreed 导出已移除、publishClock 已移除', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/composables/useProposals.ts'), 'utf-8')
    expect(source).toContain('export function voidProposal(id: string): boolean')
    expect(source).toContain(
      ['export function publish(', '  id: string,', '  opts: { validate?: PublishValidator } = {},', '): PublishResult'].join('\n'),
    )
    expect(source).not.toContain('export function setChildAgreed')
    expect(source).not.toContain('export const publishClock')
  })

  it('AC-R34-8-3 数据层不区分视角：孩子已达成一致的提议仍可被 publish / voidProposal（发布作废无角色参数，页面层专属控制）', () => {
    const childMade = makeProposalRecord({
      status: 'agreed',
      childStatus: 'agreed',
      initiator: 'child',
    })
    writeProposals([childMade])

    expect(publish('p1')).toEqual({ ok: true })
    expect(readProposals()[0].status).toBe('published')

    const childMade2 = makeProposalRecord({ id: 'p2', status: 'agreed', childStatus: 'agreed', initiator: 'child' })
    writeProposals([childMade2])
    expect(voidProposal('p2')).toBe(true)
    expect(readProposals()[0].status).toBe('voided')
  })
})
