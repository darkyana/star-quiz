/**
 * #251 拉取样板收敛组合模块单测：useAdminSection（远端列表四件套）与
 * runAdminAction（动作包装原语）自身的接口规格——初始态、刷新成功/失败写入、
 * 忙期间重复刷新合并、忙期间动作忽略、执行序与错误去向两种形状。
 * 页面级行为（加载/报错/防重复/刷新时机与收敛前一致）由 FamilyAdmin 两套页面测试把守，此处不窥探实现。
 */
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useAdminSection, runAdminAction } from '../useAdminSection'
import type { AdminFailure } from '../../cloud/admin'

/** 测试用行形状（模块对载荷字段无感知，pick 在调用点取行） */
interface Row {
  id: string
}

/** 可控时点的延迟 resolve（忙期间合并 / 忽略的时序控制） */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('#251 useAdminSection 远端列表四件套', () => {
  it('初始态：数据空数组、错误 null、忙 false', () => {
    const section = useAdminSection(() => Promise.resolve({ ok: true, rows: [] }), (s) => s.rows)
    expect(section.rows.value).toEqual([])
    expect(section.error.value).toBeNull()
    expect(section.busy.value).toBe(false)
  })

  it('刷新成功：写数据、清错误（先失败后成功验证两向翻转）', async () => {
    let fail = true
    const fetch = vi.fn((): Promise<{ ok: true; rows: Row[] } | AdminFailure> =>
      fail
        ? Promise.resolve({ ok: false, kind: 'network' })
        : Promise.resolve({ ok: true, rows: [{ id: 'r1' }] }),
    )
    const section = useAdminSection(fetch, (s) => s.rows)

    await section.refresh()
    expect(section.rows.value).toEqual([])
    expect(section.error.value).toBe('network')

    fail = false
    await section.refresh()
    expect(section.rows.value).toEqual([{ id: 'r1' }])
    expect(section.error.value).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('刷新失败：清数据、写错误类别（成功后再失败验证两向翻转）', async () => {
    let fail = false
    const fetch = vi.fn((): Promise<{ ok: true; rows: Row[] } | AdminFailure> =>
      fail
        ? Promise.resolve({ ok: false, kind: 'forbidden' })
        : Promise.resolve({ ok: true, rows: [{ id: 'r1' }] }),
    )
    const section = useAdminSection(fetch, (s) => s.rows)

    await section.refresh()
    expect(section.rows.value).toEqual([{ id: 'r1' }])
    expect(section.error.value).toBeNull()

    fail = true
    await section.refresh()
    expect(section.rows.value).toEqual([])
    expect(section.error.value).toBe('forbidden')
  })

  it('忙期间重复刷新合并为同一次拉取：fetch 只调一次、两次调用拿到同一 promise、忙随完成归位', async () => {
    let gate = deferred<{ ok: true; rows: Row[] } | AdminFailure>()
    const fetch = vi.fn(() => gate.promise)
    const section = useAdminSection(fetch, (s) => s.rows)

    const first = section.refresh()
    const second = section.refresh()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(section.busy.value).toBe(true)

    gate.resolve({ ok: true, rows: [{ id: 'r1' }] })
    await second
    expect(section.busy.value).toBe(false)
    expect(section.rows.value).toEqual([{ id: 'r1' }])
    expect(section.error.value).toBeNull()

    // 完成后再刷新是新的拉取（合并不跨完成边界；换新 gate 模拟第二次响应）
    gate = deferred<{ ok: true; rows: Row[] } | AdminFailure>()
    gate.resolve({ ok: true, rows: [{ id: 'r2' }] })
    await section.refresh()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(section.rows.value).toEqual([{ id: 'r2' }])
  })
})

describe('#251 runAdminAction 动作包装原语', () => {
  it('忙期间调用直接忽略：动作不执行、任何钩子不跑', async () => {
    const busy = ref(false)
    const error = ref<AdminFailure['kind'] | null>(null)
    const action = vi.fn(async () => ({ ok: true } as const))
    const onSuccess = vi.fn()
    const onSettled = vi.fn()

    busy.value = true
    await runAdminAction(busy, action, { onSettled, onError: error, onSuccess })

    expect(action).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(error.value).toBeNull()
    expect(busy.value).toBe(true)
  })

  it('执行序与收敛前页面手写逐字节对齐：置忙 → 动作 → 释放忙 → onSettled → 成功分支收载荷', async () => {
    const busy = ref(false)
    const events: string[] = []
    const busyAt: Record<string, boolean | undefined> = {}

    await runAdminAction(busy, async () => {
      busyAt.action = busy.value
      events.push('action')
      return { ok: true, code: '123456' }
    }, {
      onSettled: () => {
        busyAt.settled = busy.value
        events.push('settled')
      },
      onError: () => {
        events.push('error')
      },
      onSuccess: (success) => {
        busyAt.success = busy.value
        events.push(`success:${success.code}`)
      },
    })

    // 动作在忙中执行；释放忙先于弹窗收尾，收尾先于结果分支
    expect(events).toEqual(['action', 'settled', 'success:123456'])
    expect(busyAt.action).toBe(true)
    expect(busyAt.settled).toBe(false)
    expect(busyAt.success).toBe(false)
    expect(busy.value).toBe(false)
  })

  it('失败 + 错误 ref 去向：包装直接写入错误类别，onSuccess 不跑', async () => {
    const busy = ref(false)
    const error = ref<AdminFailure['kind'] | null>(null)
    const onSuccess = vi.fn()

    await runAdminAction(busy, () => Promise.resolve({ ok: false, kind: 'network' }), {
      onError: error,
      onSuccess,
    })

    expect(error.value).toBe('network')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(busy.value).toBe(false)
  })

  it('失败 + 函数去向：特例编排自行分支（conflict 形状不写错误，其余照写）', async () => {
    const busy = ref(false)
    const error = ref<AdminFailure['kind'] | null>(null)
    const handled: string[] = []

    const sink = async (kind: AdminFailure['kind']): Promise<void> => {
      if (kind === 'conflict') {
        handled.push('conflict-toast')
        return
      }
      error.value = kind
    }

    await runAdminAction(busy, () => Promise.resolve({ ok: false, kind: 'conflict' }), {
      onError: sink,
    })
    expect(handled).toEqual(['conflict-toast'])
    expect(error.value).toBeNull()

    await runAdminAction(busy, () => Promise.resolve({ ok: false, kind: 'unknown' }), {
      onError: sink,
    })
    expect(error.value).toBe('unknown')
  })
})
