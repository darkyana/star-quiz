/**
 * 等待页单测（#142，R-129a）：申请发出（pending，真申请与假等待同构）后的等待屏——
 * 主文案 + 回显名字/角色；挂载即轮询一次、其后每 ~5 秒轮询 GET /api/pair/status；
 * pending 保持等待；active（#143 批准落定后）→ 回首页并停止轮询；
 * 网络失败只提示小字、不清凭据、无限重试；2 分钟长等提示；无凭据直达 → 回配对页。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import PairWait from '../PairWait.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { DEVICE_CREDENTIAL_KEY, readDeviceCredential } from '../../composables/useDeviceCredential'
import { copy } from '../../copy'
import '../../composables/useStarData'
import '../../composables/useLearningData'

// #143 全链路断言：批准落定 → 轮询发现 active → onPaired 首同步挂钩被调（不真跑同步引擎，其余导出原样）
const onPairedMock = vi.hoisted(() => vi.fn())
vi.mock('../../cloud/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cloud/sync')>()
  return { ...actual, onPaired: onPairedMock }
})

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function statusPending(): Response {
  return jsonResponse({ status: 'pending', server_at: 1 }, 200)
}

function statusActive(): Response {
  return jsonResponse({ status: 'active', server_at: 1 }, 200)
}

/** 每次调用生成全新 Response（Response body 只能读一次，mockResolvedValue 单实例会假性报错） */
function alwaysPending(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async () => statusPending())
}

const PENDING_CRED = { device_id: 'dev-w1', secret: 'wait-secret', role: 'child', name: '孩子平板' }

let wrapper: VueWrapper | undefined

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  initAppState()
  window.location.hash = '#/'
  router.replace('/')
  onPairedMock.mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** 挂载等待页（可先写凭据）；advanceTimersByTimeAsync(0) 冲刷挂载 → 首轮轮询 */
async function mountWait(): Promise<VueWrapper> {
  window.location.hash = '#/pair-wait'
  await router.replace('/pair-wait')
  wrapper = mount(PairWait, { global: { plugins: [router] } })
  await vi.advanceTimersByTimeAsync(0)
  return wrapper
}

describe('#142 等待页渲染与回显', () => {
  it('主文案 + 回显名字/角色（读凭据单一来源）；挂载即轮询一次（Bearer 凭据头）', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    const fetchMock = vi.fn().mockResolvedValue(statusPending())
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountWait()

    expect(w.get('[data-page="pair-wait"]').text()).toContain(copy.pair.wait.main)
    expect(w.get('.pair-wait-echo').text()).toBe('孩子平板 · 孩子设备')
    expect(w.find('.pair-wait-hint').exists()).toBe(false) // 无网络错 / 未到长等阈值

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.starquiz.link/api/pair/status')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer dev-w1:wait-secret')
  })

  it('无凭据直达 /pair-wait → 重定向回 /pair（等待页只对已申请设备有意义），零网络请求', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await mountWait()
    await vi.advanceTimersByTimeAsync(0)

    expect(router.currentRoute.value.path).toBe('/pair')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('#142 轮询行为（~5 秒，pending 停留 / active 进家）', () => {
  it('pending 响应 → 停留等待页；每 5 秒再轮询', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    const fetchMock = alwaysPending()
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountWait()

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(router.currentRoute.value.path).toBe('/pair-wait')
    expect(w.find('.pair-wait-hint').exists()).toBe(false)
  })

  it('active 响应（#143 批准落定）→ 回首页 + onPaired 首同步挂钩被调 + 停止状态轮询（后续 fetch 只属同步引擎首启）', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    const fetchMock = vi.fn().mockImplementation(async () => statusActive())
    vi.stubGlobal('fetch', fetchMock)
    await mountWait()

    expect(router.currentRoute.value.path).toBe('/')
    // 全链路：轮询发现 active → 进家首同步挂钩（真实引擎里它延迟首启 pull/push）
    expect(onPairedMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    const statusCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/pair/status'))
    expect(statusCalls).toHaveLength(1) // 进家后不再轮询申请状态
  })

  it('pending 期间不触发 onPaired（只有批准落定才进家首同步）', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    vi.stubGlobal('fetch', alwaysPending())
    await mountWait()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(onPairedMock).not.toHaveBeenCalled()
  })

  it('卸载后停止轮询（离开等待页不再发请求）', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    const fetchMock = alwaysPending()
    vi.stubGlobal('fetch', fetchMock)
    await mountWait()

    wrapper?.unmount()
    wrapper = undefined
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('#142 网络失败与长等提示（不清凭据、无限重试）', () => {
  it('fetch 抛错 → 「网络不稳，正在重试……」小字；凭据不落空；每 5 秒无限重试；恢复后小字消隐', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(statusPending())
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountWait()

    expect(w.get('.pair-wait-hint').text()).toBe(copy.pair.wait.networkRetry)
    expect(readDeviceCredential()).toEqual(PENDING_CRED) // 不清凭据

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 无限重试
    expect(w.find('.pair-wait-hint').exists()).toBe(false) // 恢复 pending → 小字消隐
  })

  it('HTTP 500（error 类失败）→ 同网络口径：提示 + 无限重试不清凭据', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    const fetchMock = vi.fn().mockImplementation(async () => new Response('gateway html', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountWait()

    expect(w.get('.pair-wait-hint').text()).toBe(copy.pair.wait.networkRetry)
    expect(readDeviceCredential()).toEqual(PENDING_CRED)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('2 分钟长等提示小字出现（伞票 UI 文案初稿）', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    vi.stubGlobal('fetch', alwaysPending())
    const w = await mountWait()

    expect(w.text()).not.toContain(copy.pair.wait.longWaitHint)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(w.text()).toContain(copy.pair.wait.longWaitHint)
  })
})

describe('#144 等待页重新申请按钮（替换语义入口）', () => {
  it('「重新申请」按钮渲染在卡内（2 分钟提示不再是无按钮空话）', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    vi.stubGlobal('fetch', alwaysPending())
    const w = await mountWait()

    expect(w.get('.pair-wait-reapply-btn').text()).toBe(copy.pair.wait.reapplyBtn)
    expect(w.get('.pair-wait-reapply-btn').text()).toBe('重新申请')
  })

  it('点击 → 回配对页重填（/pair?reapply=1）；本地凭据保留（提交时带旧凭据替换旧申请）；跳转后停止状态轮询', async () => {
    localStorage.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(PENDING_CRED))
    const fetchMock = alwaysPending()
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountWait()

    await w.get('.pair-wait-reapply-btn').trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(router.currentRoute.value.path).toBe('/pair')
    expect(router.currentRoute.value.query.reapply).toBe('1')
    expect(readDeviceCredential()).toEqual({ ...PENDING_CRED, familyStatus: 'unjoined' }) // 不清凭据；#310 仅补本机确认分类
    // 卸载停轮询由「卸载后停止轮询」既有用例覆盖（真实 App 中 router-view 换页即卸载）
  })
})
