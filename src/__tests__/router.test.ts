import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { router } from '../router'
import App from '../App.vue'

const ROUTE_TABLE = [
  // result 行锚文本改用结算页可见文案「回到首页」（C3Re1 老板拍板：结算页无导航栏/标题，header 整块删除）
  { path: '/', dataPage: 'home', title: '星星答题' },
  { path: '/quiz', dataPage: 'quiz', title: '答题页' },
  { path: '/result', dataPage: 'result', title: '回到首页' },
  { path: '/redeem', dataPage: 'redeem', title: '兑换页' },
  { path: '/parent', dataPage: 'parent', title: '家长页' },
  { path: '/star-log', dataPage: 'star-log', title: '星星记事本' },
  // #125（R-P1c）：配对页入契约表（挂载零网络请求，AC2-5 零请求口径随行覆盖）
  { path: '/pair', dataPage: 'pair', title: '设备配对' },
]

/** R2 防刷分守卫（AC3-11）：结算页无会话 / in_progress 会重定向首页。
 *   逐页遍历到 /result 前注入可结算会话作为测试前置数据（不改任何断言口径）。 */
const pendingSession = {
  quizId: 'r1_router_visit',
  status: 'pending',
  // #181：路由前置必须是有效非空会话，原页面与零网络断言不变。
  questions: [{ id: '000001', type: 'zh2en', prompt: '题目', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'router-word' }],
  currentIndex: 1,
  answers: [{ questionId: '000001', selectedIndex: null, correct: false }],
  correctCount: 0,
  score: 0,
  earnedStars: 0,
  createdAt: 1,
}

async function navigateTo(path: string, expectedPath = path): Promise<void> {
  if (path === '/result') {
    // R2 防刷分（AC3-11）：quiz 页卸载会 abandon 会话，先回首页完成卸载，
    // 再注入可结算会话作为遍历 result 页的数据前置（不改任何断言口径）。
    window.location.hash = '#/'
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/')
    })
    await flushPromises()
    localStorage.setItem('sq_session', JSON.stringify(pendingSession))
  }
  window.location.hash = path
  await vi.waitFor(() => {
    expect(router.currentRoute.value.path).toBe(expectedPath)
  })
  await flushPromises()
}

beforeEach(() => {
  window.location.hash = '#/'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('6 页面 hash 路由骨架（REQ-2）', () => {
  it('AC2-1 默认落地首页：data-page="home" 且可见文本含品牌与出题方式入口（Spec §6 D3；#108 定稿 D 起 tagline 移除）', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await vi.waitFor(() => {
      expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
    })
    const home = wrapper.get('[data-page="home"]').text()
    expect(home).toContain('星星答题')
    expect(home).toContain('出题方式')
    expect(home).not.toContain('今天来攒几颗星？')
    wrapper.unmount()
  })

  it('AC2-2 按契约表逐行切换 6 个路由，路径 / data-page / 标题全部命中', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    for (const { path, dataPage, title } of ROUTE_TABLE) {
      await navigateTo(path)
      const el = wrapper.get(`[data-page="${dataPage}"]`)
      expect(el.text()).toContain(title)
    }
    wrapper.unmount()
  })

  it('AC2-3 未知路径重定向到 #/', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await navigateTo('/unknown-page', '/')
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('AC2-4 / #308 首页保留配置链接并提供家长说明入口，无设置类图标', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    const configLinks = wrapper.findAll('a[href="#/parent"]')
    expect(configLinks.length).toBe(1)
    expect(configLinks[0].text()).toBe('配置')
    // #308 deliberately introduces an informational parent sticker, not a settings menu.
    expect(wrapper.findAll('button, a').filter(el => el.text().includes('家长')).map(el => el.text())).toEqual(['家长请看'])
    expect(wrapper.find('[aria-label="设置"], [aria-label="齿轮"], [aria-label="菜单"]').exists()).toBe(false)
    const text = wrapper.get('[data-page="home"]').text()
    expect(text).not.toContain('设置')
    expect(text).not.toContain('菜单')
    expect(text).not.toContain('⚙')
    wrapper.unmount()
  })

  it('AC2-5 遍历全部 6 行导航，网络请求对象均未被调用（A1）', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const xhrName = 'XML' + 'HttpRequest'
    const xhrSpy = vi.fn()
    vi.stubGlobal(xhrName, xhrSpy)

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    for (const { path } of ROUTE_TABLE) {
      await navigateTo(path)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('#125 /pair 路由与孩子设备家长入口守卫', () => {
  it('AC2-6 孩子设备访问 /parent 重定向回 /（家长入口构造上不存在，#84）', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    localStorage.setItem(
      'sq_device_credential',
      JSON.stringify({ device_id: 'd1', secret: 's1', role: 'child', name: '孩子平板' }),
    )
    try {
      await navigateTo('/parent', '/')
      expect(router.currentRoute.value.path).toBe('/')
      expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
    } finally {
      localStorage.removeItem('sq_device_credential')
    }
    wrapper.unmount()
  })

  it('AC2-7 家长设备与未配对设备访问 /parent 照常进入（#120 未配对维持现状）', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    localStorage.setItem(
      'sq_device_credential',
      JSON.stringify({ device_id: 'd2', secret: 's2', role: 'parent', name: '家长手机' }),
    )
    try {
      await navigateTo('/parent')
      expect(router.currentRoute.value.path).toBe('/parent')
      expect(wrapper.find('[data-page="parent"]').exists()).toBe(true)
    } finally {
      localStorage.removeItem('sq_device_credential')
    }

    // 未配对（凭据清除后）：/parent 维持现状照常可达
    await navigateTo('/parent')
    expect(router.currentRoute.value.path).toBe('/parent')
    wrapper.unmount()
  })
})

describe('#142 /pair-wait 申请等待页路由', () => {
  function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  it('有设备凭据（pending 申请已落盘）→ 等待页渲染：data-page="pair-wait" + 主文案 + 回显', async () => {
    // 等待页挂载即轮询：stub fetch 回 pending，避免真实网络（AC2-5 零网络口径只覆盖契约表内路由）
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'pending', server_at: 1 }, 200))
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(
      'sq_device_credential',
      JSON.stringify({ device_id: 'd-w', secret: 's-w', role: 'child', name: '孩子平板' }),
    )
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    try {
      await navigateTo('/pair-wait')
      expect(router.currentRoute.value.path).toBe('/pair-wait')
      const page = wrapper.get('[data-page="pair-wait"]')
      expect(page.text()).toContain('申请已发给家长，等家长点一下批准。')
      expect(page.text()).toContain('孩子平板 · 孩子设备')
    } finally {
      localStorage.removeItem('sq_device_credential')
      wrapper.unmount()
    }
  })

  it('无凭据直达 /pair-wait → 重定向回 /pair（等待页只对已申请设备有意义）', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    await navigateTo('/pair-wait', '/pair')
    expect(router.currentRoute.value.path).toBe('/pair')
    expect(fetchSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
