/**
 * 设备配对页单测（#125 起家，#142 R-129a 申请化，#145 单屏化）：单屏表单全流程（fetch mock 按真实契约驱动）——
 * 码/名字/角色三字段同屏 + 主按钮「申请配对」（三项齐备才可点）；
 * 申请提交 200 同构响应：status=active（建家直入）→ 凭据落盘回首页并挂钩首同步；
 * status=pending（真申请与假等待同构，页面不区分）→ 凭据落盘进等待页 /pair-wait；
 * 反馈只剩限流（服务端秒数换算分钟）与网络/未知兜底；提交前零网络请求（配对是可选能力）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Pair from '../Pair.vue'
import Home from '../Home.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { readDeviceCredential } from '../../composables/useDeviceCredential'
import { copy } from '../../copy'
import '../../composables/useStarData'
import '../../composables/useLearningData'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function okPair(deviceId = 'dev-1', secret = 's'.repeat(64), status: 'pending' | 'active' = 'pending'): Response {
  return jsonResponse({ device_id: deviceId, secret, status, server_at: 1 }, 200)
}

let wrapper: VueWrapper | undefined

async function mountPair(): Promise<VueWrapper> {
  wrapper = mount(Pair, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

/** 单屏表单填齐三项（code/name 可覆盖；name=null 保持默认建议名） */
async function fillForm(w: VueWrapper, code = '123456', name: string | null = null, role: 'parent' | 'child' = 'parent'): Promise<void> {
  await w.get('.pair-code-input').setValue(code)
  if (name !== null) await w.get('.pair-name-input').setValue(name)
  const options = w.findAll('.star-segment-tabs__item')
  await options[role === 'parent' ? 0 : 1].trigger('click')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  window.location.hash = '#/'
  router.replace('/')
  window.location.hash = '#/pair'
  router.replace('/pair')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})

describe('#145 配对页单屏表单（申请配对口径）', () => {
  it('初始即单屏：标题「设备配对」+ 码/名字/角色三字段同屏 + 申请说明 + 返回钮；无分步按钮；挂载零网络请求', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const w = await mountPair()

    expect(w.get('[data-page="pair"]').text()).toContain('设备配对')
    expect(w.get('.page-title').text()).toBe('设备配对')
    expect(w.find('.pair-code-input').exists()).toBe(true)
    expect(w.find('.pair-name-input').exists()).toBe(true)
    expect(w.findAll('.star-segment-tabs__item').length).toBe(2)
    expect(w.get('.pair-hint').text()).toBe(copy.pair.intro)
    expect(w.get('.back-btn').text()).toBe('返回')
    // #145 单屏化：上一步/下一步分步按钮不复存在
    expect(w.find('.pair-next-btn').exists()).toBe(false)
    expect(w.find('.pair-prev-btn').exists()).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('主按钮文案为「申请配对」', async () => {
    const w = await mountPair()
    expect(w.get('.pair-submit-btn').text()).toBe('申请配对')
  })

  it('主按钮门禁：码非 6 位 / 名称为空 / 角色未选 → 禁用；三项齐备才启用（禁用而非隐藏）', async () => {
    const w = await mountPair()
    const submit = w.get('.pair-submit-btn')
    const code = w.get('.pair-code-input')
    const name = w.get('.pair-name-input')

    // 初始：码空 + 角色未选（名字有默认建议名）
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)
    await code.setValue('12345')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true) // 码非 6 位
    await code.setValue('123456')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true) // 角色未选
    await w.findAll('.star-segment-tabs__item')[0].trigger('click')
    expect((submit.element as HTMLButtonElement).disabled).toBe(false) // 三项齐备（名字取默认建议名）
    await name.setValue('   ')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true) // 名称为空白
    await name.setValue('家长手机')
    expect((submit.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('名字字段默认给可编辑建议名（copy.pair.defaultDeviceName）', async () => {
    const w = await mountPair()
    expect((w.get('.pair-name-input').element as HTMLInputElement).value).toBe(copy.pair.defaultDeviceName)
  })
})

describe('#142 申请结果：status=active 建家直入回首页（现状路径回归）', () => {
  it('填码/名字/选角色→提交：凭据四字段逐字落盘、回首页、首页配对入口消失', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okPair('dev-abc', 'secret-64', 'active'))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountPair()

    await fillForm(w, '654321', '家长手机', 'parent')
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()

    expect(readDeviceCredential()).toEqual({
      device_id: 'dev-abc',
      secret: 'secret-64',
      role: 'parent',
      name: '家长手机',
      familyStatus: 'joined',
    })
    expect(router.currentRoute.value.path).toBe('/')

    // 首页重挂载：配对入口消失（已配对设备不渲染），配置链接照常
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(home.findAll('a[href="#/pair"]').length).toBe(0)
    expect(home.findAll('a[href="#/parent"]').length).toBe(1)
    home.unmount()
  })

  it('已配对设备直达 /pair：挂载即回首页（入口消失兜底）', async () => {
    localStorage.setItem(
      'sq_device_credential',
      JSON.stringify({ device_id: 'd', secret: 's', role: 'child', name: '孩子平板' }),
    )
    await mountPair()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })
})

describe('#142 申请结果：status=pending → 落凭据进等待页（真申请与假等待同构）', () => {
  it('提交 pending → 凭据落盘、跳 /pair-wait（不回首页）——错码/超上限响应同形，页面无从区分', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okPair('dev-p1', 'pending-secret', 'pending'))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountPair()

    await fillForm(w, '111111', '孩子平板', 'child')
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()

    expect(readDeviceCredential()).toEqual({
      device_id: 'dev-p1',
      secret: 'pending-secret',
      role: 'child',
      name: '孩子平板',
      familyStatus: 'unjoined',
    })
    expect(router.currentRoute.value.path).toBe('/pair-wait')
  })
})

describe('#144 重新申请（reapply 模式：/pair?reapply=1 放行已配对门禁，预填旧名/旧角色，提交带旧凭据）', () => {
  const OLD_CRED = { device_id: 'dev-old', secret: 'old-secret', role: 'child', name: '孩子平板' }

  /** 挂载 reapply 形态配对页（路由 /pair?reapply=1 + 已有本地凭据） */
  async function mountReapply(): Promise<VueWrapper> {
    localStorage.setItem('sq_device_credential', JSON.stringify(OLD_CRED))
    window.location.hash = '#/pair?reapply=1'
    await router.replace('/pair?reapply=1')
    wrapper = mount(Pair, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('reapply 直达不被弹回首页；单屏同屏预填旧名/旧角色（码不预填：本地无码，必重输）', async () => {
    const w = await mountReapply()

    expect(router.currentRoute.value.path).toBe('/pair')
    expect((w.get('.pair-code-input').element as HTMLInputElement).value).toBe('') // 码不预填
    expect((w.get('.pair-name-input').element as HTMLInputElement).value).toBe('孩子平板') // 预填旧名
    expect(w.findAll('.star-segment-tabs__item')[1].classes()).toContain('is-selected') // 预填旧角色 child
  })

  it('重提提交：Authorization 头带旧凭据（服务端替换语义入口）；pending 新凭据覆盖本地、回等待页', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okPair('dev-new', 'new-secret', 'pending'))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountReapply()

    await fillForm(w, '654321', '孩子的新平板', 'child') // 角色点击与预填一致（child）
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.starquiz.link/api/pair')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer dev-old:old-secret')
    expect(JSON.parse(init.body as string)).toEqual({ code: '654321', device_name: '孩子的新平板', role: 'child' })

    expect(readDeviceCredential()).toEqual({
      device_id: 'dev-new',
      secret: 'new-secret',
      role: 'child',
      name: '孩子的新平板',
      familyStatus: 'unjoined',
    }) // 本地凭据被新申请覆盖
    expect(router.currentRoute.value.path).toBe('/pair-wait')
  })

  it('无 reapply 标记的直达仍弹回首页（既有门禁回归，#142 口径不变）', async () => {
    localStorage.setItem('sq_device_credential', JSON.stringify(OLD_CRED))
    await mountPair()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })
})

describe('#142 反馈路径：只剩限流与网络/未知兜底', () => {
  it('429 带 retry 秒数（900s）→ 「试得太多次了，15 分钟后再试」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'too many pairing attempts, retry in 900s' }, 429)),
    )
    const w = await mountPair()
    await fillForm(w)
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()
    expect(w.get('.pair-error').text()).toBe('试得太多次了，15 分钟后再试')
  })

  it('429 秒数缺省 → 按限流窗口上限 15 分钟兜底；短秒数（60s）向上取整为 1 分钟', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'slow down' }, 429)))
    const w = await mountPair()
    await fillForm(w)
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()
    expect(w.get('.pair-error').text()).toBe('试得太多次了，15 分钟后再试')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'too many pairing attempts, retry in 60s' }, 429)),
    )
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()
    expect(w.get('.pair-error').text()).toBe('试得太多次了，1 分钟后再试')
  })

  it('服务端 400 兜底 → 通用「申请失败，请重试」（无码错类文案）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid pairing code' }, 400)))
    const w = await mountPair()
    await fillForm(w)
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()
    expect(w.get('.pair-error').text()).toBe('申请失败，请重试')
  })

  it('断网（fetch 抛错）→ 网络失败提示；App 其余功能不等待不阻塞：可返回首页正常使用、可重试', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okPair('dev-4', 's'.repeat(64), 'active'))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountPair()

    await fillForm(w)
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()
    expect(w.get('.pair-error').text()).toBe(copy.pair.error.network)
    expect(readDeviceCredential()).toBeNull()

    // 不阻塞：返回首页照常可用（答题入口在）
    await w.get('.back-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(home.get('.star-button--primary').text()).toBe('开始答题')
    home.unmount()

    // 可重试：再次进入配对页提交成功
    window.location.hash = '#/pair'
    router.replace('/pair')
    await flushPromises()
    wrapper?.unmount()
    const w2 = await mountPair()
    await fillForm(w2, '123456', '家长手机', 'parent')
    await w2.get('.pair-submit-btn').trigger('click')
    await flushPromises()
    expect(readDeviceCredential()?.device_id).toBe('dev-4')
  })
})

describe('#192 双因子：家长角色选填家庭口令（孩子角色构造上无此输入）', () => {
  it('口令输入框只在家长角色出现：初始未选/孩子角色均无，选家长才出现', async () => {
    const w = await mountPair()
    expect(w.find('.pair-passphrase-input').exists()).toBe(false) // 初始角色未选
    await w.findAll('.star-segment-tabs__item')[1].trigger('click') // 孩子设备
    expect(w.find('.pair-passphrase-input').exists()).toBe(false)
    await w.findAll('.star-segment-tabs__item')[0].trigger('click') // 家长设备
    expect(w.find('.pair-passphrase-input').exists()).toBe(true)
  })

  it('家长角色：口令留空提交 → 请求体与旧契约逐字段一致（无 passphrase 字段）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okPair('dev-p', 'pending-secret', 'pending'))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountPair()

    await fillForm(w, '123456', '家长手机', 'parent')
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ code: '123456', device_name: '家长手机', role: 'parent' })
  })

  it('家长角色：填口令提交 → 请求体携带 passphrase（trim 后进体）；标签/占位文案遵循术语（含「家庭口令」与首台设备填写语义）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okPair('dev-a', 'active-secret', 'active'))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountPair()

    await fillForm(w, '123456', '家长手机', 'parent')
    const passphraseInput = w.get('.pair-passphrase-input')
    expect(passphraseInput.attributes('placeholder')).toBe(copy.pair.passphrasePlaceholder)
    expect(copy.pair.passphraseLabel).toContain('家庭口令')
    await passphraseInput.setValue(' ab12 ')
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      code: '123456',
      device_name: '家长手机',
      role: 'parent',
      passphrase: 'ab12',
    })
  })

  it('孩子角色提交：构造上无口令输入，请求体无 passphrase（家长态输入的残留值不外泄）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okPair('dev-c', 'child-secret', 'pending'))
    vi.stubGlobal('fetch', fetchMock)
    const w = await mountPair()

    await w.findAll('.star-segment-tabs__item')[0].trigger('click') // 先选家长
    await w.get('.pair-passphrase-input').setValue('abcd')
    await w.findAll('.star-segment-tabs__item')[1].trigger('click') // 切孩子（口令框隐藏）
    await w.get('.pair-code-input').setValue('123456')
    await w.get('.pair-submit-btn').trigger('click')
    await flushPromises()

    expect(w.find('.pair-passphrase-input').exists()).toBe(false)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ code: '123456', device_name: '星星设备', role: 'child' })
  })
})
