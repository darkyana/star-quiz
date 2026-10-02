/**
 * #143（R-129b）家庭管理页「等家长批准的申请」块单测（#132 前挂载家长页、随管理区迁入 FamilyAdmin，断言意图不变）：
 * 置顶块——行 = 名字 · 申请成为：角色 · 时间；批准/拒绝无二次确认、直接调端点；
 * toast 反馈（已同意/已拒绝/刚被处理过）；拉取失败错误反馈 + 刷新；行内容不含 IP。
 * 全链路断言（孩子端 ≤5 秒进家）见 PairWait.test.ts（active → onPaired 首同步 → 回首页）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import FamilyAdmin from '../FamilyAdmin.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { copy } from '../../copy'
import '../../composables/useStarData'
import '../../composables/useLearningData'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 申请行样本（worker GET /api/devices/pending 契约形状；paired_at = 5 分钟前） */
function requestsBody(): unknown {
  return {
    requests: [
      { device_id: 'dev-k', name: '孩子的平板', role: 'child', paired_at: Date.now() - 5 * 60_000 },
      { device_id: 'dev-p2', name: '第二台家长手机', role: 'parent', paired_at: Date.now() - 3 * 60_000 },
    ],
  }
}

function devicesBody(): unknown {
  return { devices: [{ device_id: 'dev-1', name: '家长手机', role: 'parent', paired_at: 1, last_seen_at: 2, revoked: false }] }
}

function snapshotsBody(): unknown {
  return { snapshots: [] }
}

type Handler = (init?: RequestInit) => Response
type CallLog = { url: string; init?: RequestInit }[]

/** 按路径前缀路由的 fetch mock（长前缀先匹配：pending / 子路径不被 /api/devices 抢答） */
function routeFetch(handlers: Record<string, Handler>, calls: CallLog): void {
  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.push({ url, init })
    const entries = Object.entries(handlers).sort((a, b) => b[0].length - a[0].length)
    for (const [path, handler] of entries) {
      if (url.includes(path)) return Promise.resolve(handler(init))
    }
    return Promise.reject(new TypeError(`no mock for ${url}`))
  }
  vi.stubGlobal('fetch', vi.fn(impl))
}

let wrapper: VueWrapper | undefined

async function mountFamilyAdmin(): Promise<VueWrapper> {
  wrapper = mount(FamilyAdmin, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function seedParentCredential(): void {
  writeDeviceCredential({ device_id: 'dev-1', secret: 'sec-1', role: 'parent', name: '家长手机' })
}

/** 批准块 section（#201 分区卡壳 StarSectionShell：家庭管理页第一个卡壳段，仍是置顶段） */
function approvalsSection(w: VueWrapper) {
  return w.findAll('.star-section-shell')[0]!
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  window.location.hash = '#/parent/family'
  router.replace('/parent/family')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})

describe('#143 批准块渲染（家庭管理页置顶）', () => {
  it('行 = 名字 · 申请成为：角色 · 时间（relativeTime）；家长角色申请带角色标注', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse(requestsBody()),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    const section = approvalsSection(w)
    expect(section.find('.star-section-title').text()).toBe(copy.parent.deviceAdmin.approvals.title)

    const rows = section.findAll('.device-admin-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('孩子的平板')
    expect(rows[0]!.text()).toContain('申请成为：孩子设备')
    expect(rows[0]!.text()).toContain('5 分钟前')
    expect(rows[1]!.text()).toContain('第二台家长手机')
    expect(rows[1]!.text()).toContain('申请成为：家长设备')
    expect(rows[1]!.text()).toContain('3 分钟前')

    // 每行两按钮：批准 / 拒绝
    const buttons = rows[0]!.findAll('button').map((b) => b.text())
    expect(buttons).toContain(copy.parent.deviceAdmin.approvals.approveBtn)
    expect(buttons).toContain(copy.parent.deviceAdmin.approvals.rejectBtn)
  })

  it('行内容不含 IP（不采集展示 IP，共识 16）', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse(requestsBody()),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()
    expect(approvalsSection(w).text()).not.toMatch(/\bip\b|\d{1,3}(\.\d{1,3}){3}/i)
  })

  it('空态文案「没有等批准的申请」；挂载自动拉取（GET /api/devices/pending，Bearer 头）', async () => {
    seedParentCredential()
    const calls: CallLog = []
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    const section = approvalsSection(w)
    expect(section.find('.star-section-empty').text()).toBe(copy.parent.deviceAdmin.approvals.empty)

    const pendingCall = calls.find((c) => c.url.includes('/api/devices/pending'))!
    expect(pendingCall.init?.headers).toMatchObject({ authorization: 'Bearer dev-1:sec-1' })
  })
})

describe('#143 批准 / 拒绝流程（无二次确认）', () => {
  it('批准：点击即 POST approve（无确认弹窗）→ toast「已同意「XX」加入家庭」→ 申请行消失 + 名册刷新', async () => {
    seedParentCredential()
    const calls: CallLog = []
    let approved = false
    let rosterDevices = devicesBody()
    routeFetch(
      {
        '/api/devices/dev-k/approve': () => {
          approved = true
          return jsonResponse({ ok: true, device_id: 'dev-k' })
        },
        '/api/devices/pending': () =>
          jsonResponse(approved ? { requests: [] } : requestsBody()),
        '/api/devices': () => {
          // 名册在批准后包含新成员（服务端行为 mock：approve 后孩子设备入名册）
          rosterDevices = approved
            ? {
                devices: [
                  { device_id: 'dev-1', name: '家长手机', role: 'parent', paired_at: 1, last_seen_at: 2, revoked: false },
                  { device_id: 'dev-k', name: '孩子的平板', role: 'child', paired_at: 3, last_seen_at: null, revoked: false },
                ],
              }
            : devicesBody()
          return jsonResponse(rosterDevices)
        },
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    const rows = approvalsSection(w).findAll('.device-admin-row')
    await rows[0]!.findAll('button').find((b) => b.text() === copy.parent.deviceAdmin.approvals.approveBtn)!.trigger('click')
    await flushPromises()

    expect(approved).toBe(true)
    // 无二次确认：全程无确认弹窗
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)
    // toast
    expect(w.get('.toast').text()).toBe(copy.parent.deviceAdmin.approvals.approvedToast('孩子的平板'))
    // 申请行消失（空态出现）
    expect(approvalsSection(w).find('.star-section-empty').exists()).toBe(true)
    // 名册刷新出现新成员
    const rosterRows = w.findAll('.star-section-shell')[1]!.findAll('.device-admin-row')
    expect(rosterRows.map((r) => r.text())).toEqual(expect.arrayContaining([expect.stringContaining('孩子的平板')]))
  })

  it('拒绝：点击即 POST reject（无确认弹窗）→ toast「已拒绝这次申请」→ 申请行消失', async () => {
    seedParentCredential()
    let rejected = false
    routeFetch(
      {
        '/api/devices/dev-k/reject': () => {
          rejected = true
          return jsonResponse({ ok: true, device_id: 'dev-k' })
        },
        '/api/devices/pending': () => jsonResponse(rejected ? { requests: [] } : requestsBody()),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    const rows = approvalsSection(w).findAll('.device-admin-row')
    await rows[0]!.findAll('button').find((b) => b.text() === copy.parent.deviceAdmin.approvals.rejectBtn)!.trigger('click')
    await flushPromises()

    expect(rejected).toBe(true)
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)
    expect(w.get('.toast').text()).toBe(copy.parent.deviceAdmin.approvals.rejectedToast)
    expect(approvalsSection(w).find('.star-section-empty').exists()).toBe(true)
  })

  it('并发后到（409 / 404）：toast「这条申请刚被处理过」+ 列表刷新，无错误态', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/dev-k/approve': () => jsonResponse({ error: 'request already handled' }, 409),
        '/api/devices/pending': () => jsonResponse(requestsBody()),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    const rows = approvalsSection(w).findAll('.device-admin-row')
    await rows[0]!.findAll('button').find((b) => b.text() === copy.parent.deviceAdmin.approvals.approveBtn)!.trigger('click')
    await flushPromises()

    expect(w.get('.toast').text()).toBe(copy.parent.deviceAdmin.approvals.conflictToast)
    expect(w.find('.star-section-error').exists()).toBe(false)
  })

  it('操作失败（network）：错误反馈文案，行保留可重试', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/dev-k/approve': () => Promise.reject(new TypeError('offline')) as unknown as Response,
        '/api/devices/pending': () => jsonResponse(requestsBody()),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    const rows = approvalsSection(w).findAll('.device-admin-row')
    await rows[0]!.findAll('button').find((b) => b.text() === copy.parent.deviceAdmin.approvals.approveBtn)!.trigger('click')
    await flushPromises()

    expect(approvalsSection(w).find('.star-section-error').text()).toBe(copy.parent.deviceAdmin.error.network)
    // 错误态出刷新按钮（贴设备名册块模式）
    expect(approvalsSection(w).find('.star-section-refresh').exists()).toBe(true)
  })

  it('列表拉取失败：错误反馈 + 刷新按钮；恢复后刷新出申请行', async () => {
    seedParentCredential()
    let failPending = true
    routeFetch(
      {
        '/api/devices/pending': () =>
          failPending
            ? (Promise.reject(new TypeError('offline')) as unknown as Response)
            : jsonResponse(requestsBody()),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    expect(approvalsSection(w).find('.star-section-error').text()).toBe(copy.parent.deviceAdmin.error.network)

    failPending = false
    await approvalsSection(w).get('.star-section-refresh').trigger('click')
    await flushPromises()
    expect(approvalsSection(w).findAll('.device-admin-row')).toHaveLength(2)
  })
})
