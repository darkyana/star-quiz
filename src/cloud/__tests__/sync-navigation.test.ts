/**
 * 导航驱动拉取单测（#208）：路由全局守卫触发一轮同步（唯一收口）+ 进行中去重（AC3）+
 * 短节流 trailing 补跑（AC2）+ 拉取完成广播 → 订阅页静默重读（AC5）+
 * 未配对 gating 空转（红线：零网络 / 零推零拉）+ 失败静默与最近同步结果（AC4）。
 * fetch mock = 内存云端（忠实 worker/src/sync.ts 语义，沿 sync.test.ts 惯例；增量：pull 门闩控制在途）。
 */
import { nextTick } from 'vue'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { init as initAppState } from '../../composables/useDataInfra'
import { ledger as readStars, writeLedger } from '../../composables/useStarData'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { router } from '../../router'
import Home from '../../pages/Home.vue'
import {
  startSync,
  onNavigationSync,
  registerSyncCompleteListener,
  getLastSyncOutcome,
  NAVIGATION_PULL_THROTTLE_MS,
  __resetSyncForTests,
  __runCycleForTests,
  SYNC_OUTBOX_KEY,
  SYNC_BOOTSTRAPPED_KEY,
} from '../sync'
import type { StarEntry } from '../../types'

// ===== 内存云端 double（star_entries 单域即可；增量拉取按 since 游标过滤）=====

type CloudRow = Record<string, unknown> & { server_at: number }

function createCloud() {
  const stars = new Map<string, CloudRow>()
  let clock = 10_000
  let online = true
  let pendingPullGate: Promise<void> | null = null
  let releasePullGate: (() => void) | null = null

  const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (!online) throw new TypeError('fetch failed')
    if (u.endsWith('/api/sync/capabilities')) {
      return json({ ok: true, sync_protocol: 6 }) // #174 能力探测：协议版本 6（#303 起 proposals 含 emoji 列）
    }
    if (u.endsWith('/api/sync/push')) {
      const body = JSON.parse(String(init?.body)) as Record<string, Array<Record<string, unknown>>>
      for (const row of body['star_entries'] ?? []) {
        if (!stars.has(String(row['id']))) stars.set(String(row['id']), { ...row, server_at: ++clock })
      }
      return json({ ok: true, server_at: ++clock })
    }
    if (u.includes('/api/sync/pull')) {
      if (pendingPullGate !== null) {
        const gate = pendingPullGate
        pendingPullGate = null
        await gate // 门闩：测试控制拉取在途（AC3 去重断言）
      }
      const since = Number(/since=(-?\d+)/.exec(u)?.[1] ?? '0')
      const rows = [...stars.values()].filter((r) => r.server_at > since)
      return json(rows.length > 0 ? { star_entries: rows, server_at: ++clock } : { server_at: ++clock })
    }
    return json({ error: 'not found' }, 404)
  })

  return {
    fetchSpy,
    setOnline(v: boolean): void {
      online = v
    },
    seed(rows: Array<Record<string, unknown>>): void {
      for (const row of rows) {
        if (!stars.has(String(row['id']))) stars.set(String(row['id']), { ...row, server_at: ++clock })
      }
    },
    /** 挂起下一次 pull 请求（仅一次），返回放行函数 */
    gateNextPull(): () => void {
      pendingPullGate = new Promise<void>((resolve) => {
        releasePullGate = resolve
      })
      return () => {
        releasePullGate?.()
        releasePullGate = null
      }
    },
    pullCount(): number {
      return fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/sync/pull')).length
    },
  }
}

// ===== 数据工厂与辅助 =====

function entry(id: string, timestamp = 1000): StarEntry {
  return { id, timestamp, type: 'earn', amount: 2, source: '答题得星', quizId: `quiz-${id}` }
}

/** 云端线协议行（snake_case，同 sync.test.ts 断言的推送体形状） */
function starRow(id: string, amount: number, timestamp: number): Record<string, unknown> {
  return { id, child_id: 'default', kind: 'main', timestamp, type: 'earn', amount, source: '答题得星', quiz_id: `quiz-${id}` }
}

function seedCredential(role: 'parent' | 'child' = 'parent'): void {
  writeDeviceCredential({ device_id: `dev-${role}`, secret: 's1', role, name: `${role}手机` })
}

/** 留档下载 stub（沿 sync.test.ts 惯例）：bootstrap 灌入前的 useExport 双文件导出不真下载。
 *  URL 用子类而非平面对象替换：happy-dom 的 location.hash setter 依赖 new URL()，覆写构造器会炸。 */
function stubDownload(): void {
  const StubURL = class extends URL {}
  ;(StubURL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = vi.fn(() => 'blob:mock-url')
  ;(StubURL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', StubURL)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    void this.download
  })
}

function outbox(): Record<string, unknown[]> {
  const raw = localStorage.getItem(SYNC_OUTBOX_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown[]>)
}

/** 等待引擎静默：outbox 清空且无在途请求（真实定时器用） */
async function waitForDrain(): Promise<void> {
  await vi.waitFor(() => {
    expect(Object.keys(outbox())).toHaveLength(0)
  })
  await new Promise((r) => setTimeout(r, 0))
}

/** 等待冷启动周期完成（bootstrap 完成标记在周期末尾落盘，真实定时器用） */
async function waitForBootstrapped(): Promise<void> {
  await vi.waitFor(() => {
    expect(localStorage.getItem(SYNC_BOOTSTRAPPED_KEY)).toBe('true')
  })
  await new Promise((r) => setTimeout(r, 0))
}

/** fake timers 下的引擎链排水：advanceTimersByTimeAsync 会完整冲刷引擎的异步链
 *  （happy-dom Response 内部链在纯微任务 await 下每次只推进一步，实测不能用作排水原语） */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
}

/** 真实定时器下的引擎链排水（宏任务边界冲刷全部微任务链，沿 sync.test.ts 惯例） */
async function settleReal(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10))
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
})

afterEach(() => {
  vi.useRealTimers()
  __resetSyncForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

// ===== 红线：未配对 gating（导航触发空转）=====

describe('红线：导航触发的 gating（#125 口径延续）', () => {
  it('未配对设备导航触发空转：零网络请求', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    startSync() // 无凭据：冷启动空转
    await settleReal()
    onNavigationSync()
    onNavigationSync()
    await settleReal()
    expect(cloud.fetchSpy).not.toHaveBeenCalled()
    expect(getLastSyncOutcome()).toBe('idle') // 空转不改写最近同步结果
  })
})

// ===== AC2：短节流 + trailing 补跑 =====

describe('AC2 短节流：窗口内快速切页只打一轮，窗口结束后 trailing 补跑一轮', () => {
  it('连续 10 次导航：实际拉取 = 即时轮 1 + 补跑 1；最终数据为最新', async () => {
    vi.useFakeTimers()
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync() // 引擎启动 + 冷启动 bootstrap（云端空 → 首台上推，无落库）
    await settle()
    cloud.seed([starRow('s1', 2, 2000)])
    const pullsAfterBootstrap = cloud.pullCount()

    onNavigationSync() // 首次导航：即时轮
    await settle()
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 1)

    for (let i = 0; i < 9; i++) {
      onNavigationSync() // 节流窗口内连续切页：不打接口
      await settle()
    }
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 1)

    await vi.advanceTimersByTimeAsync(NAVIGATION_PULL_THROTTLE_MS) // trailing 补跑
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 2) // 恰好一轮补拉
    expect(readStars().map((e) => e.id)).toContain('s1') // 最后一次导航的数据不丢
  })
})

// ===== AC3：进行中去重 =====

describe('AC3 进行中去重：拉取在途再导航不并发两轮', () => {
  it('在途期间多次导航只此一轮；完成后窗口结束补跑一轮收口', async () => {
    vi.useFakeTimers()
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync()
    await settle()
    cloud.seed([starRow('s1', 2, 2000), starRow('s2', 3, 3000)])
    const pullsAfterBootstrap = cloud.pullCount()

    const release = cloud.gateNextPull()
    onNavigationSync() // 即时轮：拉取被门闩挂起（在途）
    await settle()
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 1)

    onNavigationSync() // 在途期间再导航：去重，不并发第二轮
    onNavigationSync()
    await settle()
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 1) // 仍只一轮在途

    release()
    await settle()
    expect(readStars().map((e) => e.id)).toEqual(['s1', 's2']) // 在途轮落库

    await vi.advanceTimersByTimeAsync(NAVIGATION_PULL_THROTTLE_MS) // 补跑收口
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 2) // 恰好一轮补跑，非逐导航补跑
  })
})

// ===== AC4：失败静默 + 最近同步结果 =====

describe('AC4 失败静默：断网导航保留本地数据，恢复后补拉拿到云端数据', () => {
  it('断网轮 outcome=failed 且不广播；恢复后补拉 outcome=ok 且广播一次', async () => {
    vi.useFakeTimers()
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    writeLedger([entry('s1')])
    startSync() // 冷启动 bootstrap：本机 s1 推上云（bootstrap 全量拉计入 pullCount 基线）
    await settle()
    const pullsAfterBootstrap = cloud.pullCount()
    const listener = vi.fn()
    const unregister = registerSyncCompleteListener(listener)

    cloud.setOnline(false)
    onNavigationSync() // 断网导航：即时轮拉取失败
    await settle()
    expect(getLastSyncOutcome()).toBe('failed')
    expect(listener).not.toHaveBeenCalled() // 失败不广播
    expect(readStars()).toEqual([entry('s1')]) // 本地数据照常，无弹错无白屏

    cloud.setOnline(true)
    cloud.seed([starRow('s2', 3, 5000)])
    onNavigationSync() // 窗口内导航：节流，仅排定补跑
    await settle()
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 1) // 失败轮后窗口内不再打接口

    await vi.advanceTimersByTimeAsync(NAVIGATION_PULL_THROTTLE_MS) // 补跑：恢复网络后的拉取
    expect(cloud.pullCount()).toBe(pullsAfterBootstrap + 2)
    expect(getLastSyncOutcome()).toBe('ok')
    expect(readStars().map((e) => e.id)).toEqual(['s1', 's2']) // 拉到云端最新
    expect(listener).toHaveBeenCalledTimes(1) // 成功落库才广播
    unregister()
  })
})

// ===== 广播时机与注册风格 =====

describe('拉取完成广播：仅远端行实际落库时回调（对齐 registerWriteListener 注册风格）', () => {
  it('落库轮回调一次；拉取成功但无新行不回调；注销后不再回调', async () => {
    vi.useFakeTimers()
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync() // 引擎启动 + 冷启动 bootstrap（云端空，无落库）
    await settle()
    cloud.seed([starRow('s1', 2, 2000)])
    const listener = vi.fn()
    const unregister = registerSyncCompleteListener(listener)

    onNavigationSync() // 即时轮：s1 落库
    await settle()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(readStars().map((e) => e.id)).toEqual(['s1'])

    await __runCycleForTests() // 游标已推进：拉取成功但无新行 → 不广播
    expect(listener).toHaveBeenCalledTimes(1)

    unregister()
    cloud.seed([starRow('s3', 1, 6000)])
    await __runCycleForTests() // 落库但已注销 → 不回调
    expect(listener).toHaveBeenCalledTimes(1)
    expect(readStars().map((e) => e.id)).toEqual(['s1', 's3'])
  })
})

// ===== 路由全局守卫触发（唯一收口点）=====

describe('路由全局守卫：导航触发一轮同步（守卫一处收口，不散落页面）', () => {
  it('真实 router 导航 → 守卫触发拉取，云端新行落库（AC1 链路）', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    startSync() // 冷启动 bootstrap
    await waitForDrain()
    cloud.seed([starRow('s9', 4, 9000)])

    window.location.hash = '#/'
    await router.push('/star-log') // 导航 → 全局守卫触发（守卫同步返回，不等待拉取——AC6）
    await new Promise((r) => setTimeout(r, 20))
    expect(readStars().map((e) => e.id)).toContain('s9') // 导航触发的拉取已落库
    expect(getLastSyncOutcome()).toBe('ok')
  })
})

// ===== AC5：页面订阅广播 → 静默重读（首页星星数量核心场景）=====

describe('AC5 页面静默刷新：停留在首页，拉取落库广播后星星数自动更新', () => {
  it('无需重挂载：广播 → Home 重读本地 → 余额无感替换', async () => {
    const cloud = createCloud()
    vi.stubGlobal('fetch', cloud.fetchSpy)
    seedCredential()
    cloud.seed([starRow('s1', 2, 2000)])
    stubDownload() // 灌入前留档导出 stub
    startSync() // 冷启动 bootstrap：云端 s1 灌入（此刻无页面订阅）
    await waitForBootstrapped()
    expect(readStars().map((e) => e.id)).toEqual(['s1'])

    window.location.hash = '#/'
    const wrapper = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('.balance-chip .star-value').text()).toBe('2')

    cloud.seed([starRow('s2', 3, 5000)])
    await __runCycleForTests() // 增量拉取落库 s2 → 广播 → Home.refresh() 重读本地
    await flushPromises()
    await nextTick()
    expect(wrapper.get('.balance-chip .star-value').text()).toBe('5') // 静默刷新到最新落库值
    wrapper.unmount()
  })
})
