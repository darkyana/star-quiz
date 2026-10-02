/**
 * #132 家庭管理页单测（原 #127 家长页「设备与家庭」管理区测试随页面迁移至 /parent/family，断言意图不变）：
 * 三块全流程（fetch 按真实 worker 契约 mock 路由）——设备列表/移除（含移除本机回未配对态）、
 * 家庭码出示/重置、快照列表/回滚；
 * 渲染前提（未配对/孩子设备不渲染，#84 构造性不可达组件级回归）+ 确认弹窗文案 + 断网可重试零退化；
 * #132 追加页面骨架：顶栏标题「家庭管理」+ 返回家长页 + 四段各独立容器、批准块置顶。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import FamilyAdmin from '../FamilyAdmin.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import {
  writeDeviceCredential,
  readDeviceCredential,
  DEVICE_CREDENTIAL_KEY,
} from '../../composables/useDeviceCredential'
import { copy } from '../../copy'
import '../../composables/useStarData'
import '../../composables/useLearningData'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 设备名册（dev-1 = 本机家长设备；dev-old 已移除；kidRevoked 供移除全流程刷新断言） */
function devicesBody(kidRevoked = false): unknown {
  return {
    devices: [
      { device_id: 'dev-1', name: '家长手机', role: 'parent', paired_at: 1, last_seen_at: Date.now() - 5_000, revoked: false },
      { device_id: 'dev-k', name: '孩子平板', role: 'child', paired_at: 2, last_seen_at: null, revoked: kidRevoked },
      { device_id: 'dev-old', name: '旧平板', role: 'child', paired_at: 3, last_seen_at: 4, revoked: true },
    ],
  }
}

function snapshotsBody(): unknown {
  return { snapshots: [{ snapshot_id: 'snap-1', taken_at: Date.now() - 86_400_000 }] }
}

type Handler = (init?: RequestInit) => Response
type CallLog = { url: string; init?: RequestInit }[]

/** 按路径前缀路由的 fetch mock（记录调用供断言；长前缀先匹配，revoke/reset 不被列表端点抢答） */
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

/** 默认路由：申请列表 + 设备列表 + 快照列表 200；其余端点按需覆盖 */
function seedDefaultRoutes(calls: CallLog): void {
  routeFetch(
    {
      '/api/devices/pending': () => jsonResponse({ requests: [] }),
      '/api/devices': () => jsonResponse(devicesBody()),
      '/api/family-code/reset': () => jsonResponse({ code: '654321', passphrase: 'wxyz' }),
      '/api/family-code': () => jsonResponse({ code: '123456', passphrase: 'abcd' }),
      '/api/snapshots/': (init) =>
        (init?.method ?? 'GET') === 'POST' ? jsonResponse({ ok: true, snapshot_id: 'snap-1' }) : jsonResponse({ error: 'not found' }, 404),
      '/api/snapshots': () => jsonResponse(snapshotsBody()),
    },
    calls,
  )
}

/** 行内指定设备的移除按钮 */
function revokeBtnOf(w: VueWrapper, rowText: string) {
  const row = w.findAll('.device-admin-row').find((r) => r.text().includes(rowText))
  expect(row, `应存在设备行「${rowText}」`).toBeDefined()
  return row!.findAll('button').find((b) => b.text() === copy.parent.deviceAdmin.revokeBtn)
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

describe('#132 家庭管理页骨架（四段各独立容器 + 批准块置顶 + 返回家长页）', () => {
  it('顶栏标题 = copy.parent.familyAdminTitle「家庭管理」；四段各为独立 star-container 容器；批准块置顶', async () => {
    seedParentCredential()
    const calls: CallLog = []
    seedDefaultRoutes(calls)
    const w = await mountFamilyAdmin()

    expect(w.get('.page-title').text()).toBe(copy.parent.familyAdminTitle)

    // 四段各独立容器（#132 分段容器化）：申请 [0] / 名册 [1] / 家庭码 [2] / 快照 [3]
    const sections = w.findAll('.star-section-shell')
    expect(sections).toHaveLength(4)
    for (const s of sections) {
      expect(s.classes()).toContain('star-container')
    }
    // 批准块置顶
    expect(sections[0]!.text()).toContain(copy.parent.deviceAdmin.approvals.title)
    expect(sections[1]!.text()).toContain(copy.parent.deviceAdmin.devicesTitle)
    expect(sections[2]!.text()).toContain(copy.parent.deviceAdmin.codeTitle)
    expect(sections[3]!.text()).toContain(copy.parent.deviceAdmin.snapshotsTitle)
  })

  it('返回按钮（.back-btn，StarButtonStandard）→ 路由 /parent', async () => {
    seedParentCredential()
    const calls: CallLog = []
    seedDefaultRoutes(calls)
    const w = await mountFamilyAdmin()

    expect(w.get('.back-btn').text()).toBe(copy.back)
    await w.get('.back-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent')
  })
})

describe('#127 管理区渲染前提（#84 构造性不可达 + 未配对不渲染；#132 起挂载 FamilyAdmin 页）', () => {
  it('未配对设备：四段整体不渲染（无凭据无家庭可管理），页面顶栏照常', async () => {
    const calls: CallLog = []
    seedDefaultRoutes(calls)
    const w = await mountFamilyAdmin()
    expect(w.find('.star-section-shell').exists()).toBe(false)
    // 未配对不发任何管理请求
    expect(calls).toHaveLength(0)
    expect(w.get('.page-title').text()).toBe(copy.parent.familyAdminTitle)
  })

  it('孩子设备：四段不渲染（路由 child 守卫之外，组件级回归防线）', async () => {
    writeDeviceCredential({ device_id: 'dev-k', secret: 'sec', role: 'child', name: '孩子平板' })
    const calls: CallLog = []
    seedDefaultRoutes(calls)
    const w = await mountFamilyAdmin()
    expect(w.find('.star-section-shell').exists()).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('#127 设备列表', () => {
  it('渲染名册：名字 / 角色标签 / 本机标识 / 已移除标识 / 最后活跃时间（relativeTime 五档）', async () => {
    seedParentCredential()
    const calls: CallLog = []
    seedDefaultRoutes(calls)
    const w = await mountFamilyAdmin()

    // 名册区取自设备区（#143 批准块置顶后名册区为第二段；快照行复用同结构类，不入名册计数）
    const rows = w.findAll('.star-section-shell')[1]!.findAll('.device-admin-row')
    expect(rows).toHaveLength(3)

    const selfRow = rows[0]!
    expect(selfRow.text()).toContain('家长手机')
    expect(selfRow.text()).toContain(copy.parent.deviceAdmin.roleParent)
    expect(selfRow.text()).toContain(copy.parent.deviceAdmin.selfDevice)
    expect(selfRow.text()).toContain('最后活跃 刚刚')
    expect(selfRow.find('.star-chip--ghost').text()).toBe(copy.parent.deviceAdmin.selfDevice)

    const kidRow = rows[1]!
    expect(kidRow.text()).toContain('孩子平板')
    expect(kidRow.text()).toContain(copy.parent.deviceAdmin.roleChild)
    expect(kidRow.text()).toContain(copy.parent.deviceAdmin.lastSeenUnknown)
    expect(kidRow.text()).not.toContain(copy.parent.deviceAdmin.selfDevice)

    // 已移除设备：打已移除标签、不出移除按钮
    const oldRow = rows[2]!
    expect(oldRow.text()).toContain('旧平板')
    expect(oldRow.text()).toContain(copy.parent.deviceAdmin.revokedChip)
    expect(oldRow.text()).toContain('1970-01-01')
    expect(oldRow.findAll('button')).toHaveLength(0)
  })

  it('挂载自动拉取：GET /api/devices + GET /api/snapshots（Bearer 头 = device_id:secret）', async () => {
    seedParentCredential()
    const calls: CallLog = []
    seedDefaultRoutes(calls)
    await mountFamilyAdmin()
    expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining([expect.stringContaining('/api/devices'), expect.stringContaining('/api/snapshots')]))
    const devicesCall = calls.find((c) => c.url.includes('/api/devices'))!
    expect(devicesCall.init?.headers).toMatchObject({ authorization: 'Bearer dev-1:sec-1' })
  })

  it('移除设备全流程：二次确认（断云 + 本机数据保留不擦除文案）→ 确认调 revoke → 列表刷新出已移除标签', async () => {
    seedParentCredential()
    const calls: CallLog = []
    let revoked = false
    routeFetch(
      {
        // #143：显式接管申请列表端点（否则被下方 /api/devices/ 前缀误拦，挂载即触发 revoked 副作用）
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices/': () => {
          revoked = true
          return jsonResponse({ ok: true, device_id: 'dev-k' })
        },
        '/api/devices': () => jsonResponse(devicesBody(revoked)),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    await revokeBtnOf(w, '孩子平板')!.trigger('click')
    const modal = w.get('.admin-confirm-modal')
    expect(modal.find('.star-modal__title').text()).toBe(copy.parent.deviceAdmin.revokeConfirmTitle)
    expect(modal.text()).toContain('孩子平板')
    // CONTEXT.md 移除设备语义：与云端断开、本机数据保留不擦除
    expect(modal.text()).toContain('与云端断开')
    expect(modal.text()).toContain('本机数据保留不擦除')
    // 未确认前不发移除请求
    expect(revoked).toBe(false)

    await modal.findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    await flushPromises()
    expect(revoked).toBe(true)
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)
    const kidRow = w.findAll('.device-admin-row').find((r) => r.text().includes('孩子平板'))!
    expect(kidRow.text()).toContain(copy.parent.deviceAdmin.revokedChip)
  })

  it('移除本机设备：本机特化确认文案 → 确认后清空 sq_device_credential、四段消失（回未配对态）', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices/': () => jsonResponse({ ok: true, device_id: 'dev-1' }),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    await revokeBtnOf(w, '家长手机')!.trigger('click')
    const modal = w.get('.admin-confirm-modal')
    expect(modal.text()).toContain('本机')
    expect(modal.text()).toContain('回到未配对状态')

    await modal.findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    await flushPromises()
    expect(readDeviceCredential()).toBeNull()
    expect(localStorage.getItem(DEVICE_CREDENTIAL_KEY)).toBeNull()
    expect(w.find('.star-section-shell').exists()).toBe(false)
  })

  it('取消 / Escape：确认弹窗关闭且不发移除请求', async () => {
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

    await revokeBtnOf(w, '孩子平板')!.trigger('click')
    await w.get('.admin-confirm-modal .star-modal__scrim').trigger('click')
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)

    await revokeBtnOf(w, '孩子平板')!.trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)
    expect(calls.filter((c) => c.url.includes('/revoke'))).toHaveLength(0)
  })
})

describe('清除已移除设备（ADR 0012 墓碑可硬删 / CONTEXT.md 清除已移除设备）', () => {
  it('名册含已移除设备 → 末尾单独一行「删除已移除设备」标准按钮（StarButtonStandard standard·small）', async () => {
    seedParentCredential()
    seedDefaultRoutes([])
    const w = await mountFamilyAdmin()

    const btn = w.get('.btn-clear-revoked')
    expect(btn.text()).toBe(copy.parent.deviceAdmin.clearRevokedBtn)
    expect(btn.element.tagName).toBe('BUTTON')
    expect(btn.attributes('aria-disabled')).toBeUndefined() // 初始可点（非 busy 态）
  })

  it('名册无已移除设备 → 按钮不渲染', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () =>
          jsonResponse({
            devices: [
              { device_id: 'dev-1', name: '家长手机', role: 'parent', paired_at: 1, last_seen_at: Date.now(), revoked: false },
              { device_id: 'dev-k', name: '孩子平板', role: 'child', paired_at: 2, last_seen_at: null, revoked: false },
            ],
          }),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()
    expect(w.find('.btn-clear-revoked').exists()).toBe(false)
  })

  it('全流程：确认弹窗（数量 + 不可恢复）→ 取消零请求；确认 → POST /api/devices/revoked/delete → toast + 名册刷新（墓碑行与按钮消失）', async () => {
    seedParentCredential()
    const calls: CallLog = []
    let swept = false
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices/revoked/delete': () => {
          swept = true
          return jsonResponse({ ok: true, deleted: 1 })
        },
        '/api/devices': () =>
          jsonResponse(
            swept
              ? {
                  devices: [
                    { device_id: 'dev-1', name: '家长手机', role: 'parent', paired_at: 1, last_seen_at: Date.now(), revoked: false },
                    { device_id: 'dev-k', name: '孩子平板', role: 'child', paired_at: 2, last_seen_at: null, revoked: false },
                  ],
                }
              : devicesBody(),
          ),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    await w.get('.btn-clear-revoked').trigger('click')
    const modal = w.get('.admin-confirm-modal')
    expect(modal.find('.star-modal__title').text()).toBe(copy.parent.deviceAdmin.clearRevokedBtn)
    // 名册快照 1 台已移除：正文写数量不列名，注明不可恢复
    expect(modal.text()).toContain('全部 1 台已移除设备')
    expect(modal.text()).toContain('不可恢复')
    expect(swept).toBe(false)

    // 取消：关闭弹窗、零请求
    await modal.findAll('button').find((b) => b.text() === '取消')!.trigger('click')
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)

    await w.get('.btn-clear-revoked').trigger('click')
    await w.get('.admin-confirm-modal').findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    await flushPromises()
    expect(swept).toBe(true)
    expect(calls.filter((c) => c.url.includes('/api/devices/revoked/delete'))).toHaveLength(1)
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)
    // toast 以服务端删除数为准
    expect(w.get('.toast').text()).toBe(copy.parent.deviceAdmin.clearedToast(1))
    // 名册刷新：墓碑行消失、按钮随之隐藏
    expect(w.findAll('.star-section-shell')[1]!.findAll('.device-admin-row')).toHaveLength(2)
    expect(w.find('.btn-clear-revoked').exists()).toBe(false)
  })

  it('删除失败 404 → 名册区 not-found 错误反馈（错误行 + 刷新可重试）', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices/revoked/delete': () => jsonResponse({ error: 'not found' }, 404),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    await w.get('.btn-clear-revoked').trigger('click')
    await w.get('.admin-confirm-modal').findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    await flushPromises()
    const section = w.findAll('.star-section-shell')[1]!
    expect(section.find('.star-section-error').text()).toBe(copy.parent.deviceAdmin.error.notFound)
    expect(section.find('.star-section-refresh').exists()).toBe(true)
  })
})

describe('#127 家庭码', () => {
  it('平时隐藏（掩码不出码）：出示后同屏可见 6 位码与家庭口令，可再隐藏（#192 成对出示/隐藏）', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/family-code': () => jsonResponse({ code: '123456', passphrase: 'abcd' }),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    const codeValue = w.get('.family-code-value')
    expect(codeValue.text()).toBe(copy.parent.deviceAdmin.codeHidden)
    expect(codeValue.text()).not.toContain('123456')
    // 口令随码同隐藏：掩码不出对（#192）
    expect(w.get('.family-passphrase-value').text()).toBe(copy.parent.deviceAdmin.passphraseHidden)
    expect(w.get('.family-passphrase-value').text()).not.toContain('abcd')

    await w.get('.btn-code-show').trigger('click')
    await flushPromises()
    expect(w.get('.family-code-value').text()).toBe('123456')
    expect(w.get('.family-passphrase-value').text()).toBe(copy.parent.deviceAdmin.passphraseValue('abcd'))

    await w.get('.btn-code-hide').trigger('click')
    expect(w.get('.family-code-value').text()).toBe(copy.parent.deviceAdmin.codeHidden)
    expect(w.get('.family-passphrase-value').text()).toBe(copy.parent.deviceAdmin.passphraseHidden)
  })

  it('家庭口令未设置（worker 返回 passphrase null）→ 明确「未设置」态文案，不显示空白（#192）', async () => {
    seedParentCredential()
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/family-code': () => jsonResponse({ code: '123456', passphrase: null }),
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      [],
    )
    const w = await mountFamilyAdmin()

    await w.get('.btn-code-show').trigger('click')
    await flushPromises()
    expect(w.get('.family-code-value').text()).toBe('123456')
    expect(w.get('.family-passphrase-value').text()).toBe(copy.parent.deviceAdmin.passphraseUnset)
    expect(w.get('.family-passphrase-value').text()).toContain('未设置')
  })

  it('重置：确认弹窗明示「只拦住后续加入，已配对设备不受影响」→ 确认后同屏出示新码+新口令（#192 成对轮换）', async () => {
    seedParentCredential()
    const calls: CallLog = []
    let resetCount = 0
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/family-code/reset': () => {
          resetCount += 1
          return jsonResponse({ code: '654321', passphrase: 'wxyz' })
        },
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    await w.get('.btn-code-reset').trigger('click')
    const modal = w.get('.admin-confirm-modal')
    expect(modal.find('.star-modal__title').text()).toBe(copy.parent.deviceAdmin.codeResetConfirmTitle)
    expect(modal.text()).toContain('只拦住后续加入')
    expect(modal.text()).toContain('已配对设备不受影响')
    expect(resetCount).toBe(0)

    await modal.findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    await flushPromises()
    expect(resetCount).toBe(1)
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)
    // #192：新码+新口令同屏更新为新对
    expect(w.get('.family-code-value').text()).toBe('654321')
    expect(w.get('.family-passphrase-value').text()).toBe(copy.parent.deviceAdmin.passphraseValue('wxyz'))
  })
})

describe('#127 快照回滚', () => {
  it('列表渲染时间点（relativeTime）+ 回滚强确认（覆盖云端状态 / 下次同步生效）→ 确认成功反馈', async () => {
    seedParentCredential()
    const calls: CallLog = []
    let restored = ''
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots/': (init) => {
          if ((init?.method ?? 'GET') === 'POST') {
            restored = calls.at(-1)!.url
            return jsonResponse({ ok: true, snapshot_id: 'snap-1' })
          }
          return jsonResponse({ error: 'not found' }, 404)
        },
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    const snapRow = w.findAll('.device-admin-row').at(-1)!
    expect(snapRow.text()).toContain('1 天前')

    await w.get('.btn-restore-snapshot').trigger('click')
    const modal = w.get('.admin-confirm-modal')
    expect(modal.find('.star-modal__title').text()).toBe(copy.parent.deviceAdmin.restoreConfirmTitle)
    expect(modal.text()).toContain('覆盖当前云端状态')
    expect(modal.text()).toContain('下次同步生效')
    expect(modal.text()).toContain('1 天前')
    expect(restored).toBe('')

    await modal.findAll('button').find((b) => b.text() === '确认')!.trigger('click')
    await flushPromises()
    expect(restored).toContain('/api/snapshots/snap-1/restore')
    expect(w.get('.device-admin-notice').text()).toBe(copy.parent.deviceAdmin.restoreDone)
    expect(w.find('.admin-confirm-modal').exists()).toBe(false)
  })
})

describe('#127 断网零退化（请求失败明确反馈可重试，不影响其他功能）', () => {
  it('设备/快照拉取失败：各块错误反馈 + 刷新按钮；家庭码块照常；页面与家长页入口已分离（#132）', async () => {
    seedParentCredential()
    const calls: CallLog = []
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () => Promise.reject(new TypeError('offline')) as unknown as Response,
        '/api/snapshots': () => jsonResponse(snapshotsBody()),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    // devices 抛错 → network 反馈 + 刷新按钮（名册区为第二段：#143 批准块置顶）
    expect(w.findAll('.star-section-shell')[1]!.find('.star-section-error').text()).toBe(copy.parent.deviceAdmin.error.network)
    expect(w.findAll('.star-section-shell')[1]!.find('.star-section-refresh').exists()).toBe(true)

    // 快照 200 照常渲染（互不拖累）
    expect(w.find('.btn-restore-snapshot').exists()).toBe(true)

    // 家庭码块照常（点出示 → network 错误提示，重试通道仍在）
    await w.get('.btn-code-show').trigger('click')
    await flushPromises()
    expect(w.findAll('.star-section-shell')[2]!.find('.family-code-error').text()).toBe(copy.parent.deviceAdmin.error.network)

    // #132 起管理区独立成页：家长页操作区不在此页（入口按钮在家长页，断网不波及）
    expect(w.find('.parent-actions').exists()).toBe(false)
  })

  it('快照列表 404（如旧版本 worker 尚未部署 GET /api/snapshots 的窗口期）：not-found 反馈 + 刷新可重试', async () => {
    seedParentCredential()
    const calls: CallLog = []
    routeFetch(
      {
        '/api/devices/pending': () => jsonResponse({ requests: [] }),
        '/api/devices': () => jsonResponse(devicesBody()),
        '/api/snapshots': () => jsonResponse({ error: 'not found' }, 404),
      },
      calls,
    )
    const w = await mountFamilyAdmin()

    const sections = w.findAll('.star-section-shell')
    // #143 批准块置顶后：申请 [0] / 名册 [1] / 家庭码 [2] / 快照 [3]
    const snapSection = sections[3]!
    expect(snapSection.find('.star-section-error').text()).toBe(copy.parent.deviceAdmin.error.notFound)
    expect(snapSection.find('.star-section-refresh').exists()).toBe(true)
    // 设备块 200 照常
    expect(w.findAll('.device-admin-row')).toHaveLength(3)
  })
})
