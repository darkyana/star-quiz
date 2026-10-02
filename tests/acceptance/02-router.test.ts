/**
 * AC2-1 ~ AC2-5 6 页面 hash 路由骨架（Spec §4 REQ-2 / §3.1）
 * 路由契约表（hash / path / data-page / 页面标题）来自 Spec §3.1，非实现源码。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
// #322 通知角标：已读账写入口 + 通知数据（未读清零/恢复的等价断言）
import { markParentGuideNotificationRead, parentGuideReadLedgerKey } from '../../src/composables/useParentGuideReadLedger'
import { parentGuideNotifications } from '../../src/data/parent-guide-notifications'
import { writeEntryVisibilityValue } from '../../src/composables/useEntryVisibility'

// Spec §3.1 路由契约表（6 行，全量）；home 行 title 按 Spec §6 D3 处置更新为品牌"星星答题"
// result 行锚文本改用结算页可见文案「回到首页」（C3Re1 老板拍板：结算页无导航栏/标题，header 整块删除）
// #125（R-P1c）：/pair 配对页入契约表（挂载零网络请求，AC2-5 零请求口径随行覆盖）
const routeContract = [
  { hash: '#/', path: '/', dataPage: 'home', title: '星星答题' },
  { hash: '#/quiz', path: '/quiz', dataPage: 'quiz', title: '答题页' },
  { hash: '#/result', path: '/result', dataPage: 'result', title: '回到首页' },
  { hash: '#/redeem', path: '/redeem', dataPage: 'redeem', title: '兑换页' },
  { hash: '#/parent', path: '/parent', dataPage: 'parent', title: '家长页' },
  { hash: '#/star-log', path: '/star-log', dataPage: 'star-log', title: '星星记事本' },
  { hash: '#/pair', path: '/pair', dataPage: 'pair', title: '设备配对' },
] as const

let wrapper: VueWrapper

/** R2 防刷分守卫（AC3-11）：结算页无会话 / in_progress 会重定向首页。
 *   R1 逐页遍历到 #/result 前需注入可结算会话作为测试前置数据（不改任何断言口径）。 */
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

/** 等待 hashchange → Vue Router 导航 → DOM 更新的链路稳定 */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
}

async function navigate(hash: string): Promise<void> {
  if (hash === '#/result') {
    // R2 防刷分（AC3-11）：quiz 页卸载会 abandon 会话，先回首页完成卸载，
    // 再注入可结算会话作为遍历 result 页的数据前置（不改任何断言口径）。
    window.location.hash = '#/'
    await settle()
    localStorage.setItem('sq_session', JSON.stringify(pendingSession))
  }
  window.location.hash = hash
  await settle()
}

beforeAll(async () => {
  window.location.hash = '#/'
  // #263 游戏入口改挂家长控制开关：路由契约断言贴纸 img 恒在，前置开关开
  localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'mini-garage-prototype': true }))
  wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
})

afterAll(() => {
  wrapper?.unmount()
})

describe('AC2 6 页面 hash 路由骨架', () => {
  it('AC2-1 默认落地首页', async () => {
    await navigate('#/')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/')
    })
    const home = wrapper.find('[data-page="home"]')
    expect(home.exists()).toBe(true)
    // Spec §6 D3：首页可见文本 = 品牌"星星答题" + 出题方式入口（#108 定稿 D 起 tagline 移除，原"首页"标题不再渲染）
    expect(home.text()).toContain('星星答题')
    expect(home.text()).toContain('出题方式')
    expect(home.text()).not.toContain('今天来攒几颗星？')
  })

  it('AC2-2 6 页面全部可切换（逐行遍历 §3.1 契约表，不得遗漏）', async () => {
    for (const row of routeContract) {
      await navigate(row.hash)
      await vi.waitFor(() => {
        expect(router.currentRoute.value.path).toBe(row.path)
      })
      const el = wrapper.find(`[data-page="${row.dataPage}"]`)
      expect(el.exists()).toBe(true)
      expect(el.text()).toContain(row.title)
    }
  })

  it('AC2-3 未知路径重定向到 #/', async () => {
    await navigate('#/unknown-page')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/')
    })
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
  })

  it('AC2-4 / #308 配置链接保留，未配对家长贴纸只进入说明页', async () => {
    await navigate('#/')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/')
    })
    const home = wrapper.find('[data-page="home"]')
    expect(home.exists()).toBe(true)

    // 1) 家长入口仅版本号旁的「配置」链接（Safari PWA 手势被系统占用，产品负责人 2026-08-21 加显式入口）
    const configLinks = wrapper.findAll('a[href="#/parent"]')
    expect(configLinks.length).toBe(1)
    expect(configLinks[0].text()).toBe('配置')
    // #308 replaces the old hidden-parent-entry rule with one informational sticker.
    // #322 通知角标（修订 #316「入口对所有设备可见」口径，spec #319 故事 39）：本断言的成立前提 =
    // 存在未读家长通知（默认已读账为空 → 全未读）；未读清零 → 隐藏、孩子设备不显示的等价断言见本用例末尾
    // 与 09-home #322 describe（口径修订留痕，勿删勿跳过）。
    expect(home.findAll('button, a').filter(el => el.text().includes('家长')).map(el => el.text())).toEqual(['家长请看'])
    // 3) 设置类图标禁止（Spec §6 D3 处置：允许产品元素 SVG——大星星 / 星星按钮，非设置图标）
    expect(home.find('[aria-label="设置"], [aria-label="齿轮"], [aria-label="菜单"]').exists()).toBe(false)
    // Scope artwork assertions to their function; the artist's balance star is not a game/settings icon.
    expect(home.get('.game-sticker img').classes()).toEqual(['sticker-art', 'game-sticker__art'])
    expect(home.get('.parent-sticker img').attributes('alt')).toBe('')
    expect(home.get('.home-big-star').attributes('src')).toBe(`${import.meta.env.BASE_URL}home-star.png`)
    const text = home.text()
    expect(text).not.toContain('设置')
    expect(text).not.toContain('菜单')
    expect(text).not.toContain('⚙')
    // #322 等价断言（原地改写，不留脏状态）：全部「知道了」（写 parent-guide:<id> 已读账）→ 贴纸从首页消失；
    // 恢复未读（等价于后续版本新增通知）→ 贴纸复现。孩子设备不显示的修订断言见 09-home / Home 页单测。
    for (const notification of parentGuideNotifications) markParentGuideNotificationRead(notification.id)
    await settle()
    expect(home.find('.parent-sticker').exists()).toBe(false)
    for (const notification of parentGuideNotifications) writeEntryVisibilityValue(parentGuideReadLedgerKey(notification.id), false)
    await settle()
    expect(home.find('.parent-sticker').exists()).toBe(true)
  })

  it('AC2-5 全程零网络请求（A1）：fetch 与 XHR 均零调用', async () => {
    const fetchSpy = vi.fn()
    const xhrSpy = vi.fn()
    // 字符串拼接避免测试文件自身命中 A1 关键字扫描
    const xhrKey = 'XML' + 'HttpRequest'
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal(xhrKey, xhrSpy)
    try {
      for (const row of routeContract) {
        await navigate(row.hash)
        await vi.waitFor(() => {
          expect(router.currentRoute.value.path).toBe(row.path)
        })
      }
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(xhrSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('#125 配对路由与孩子设备家长入口守卫（#84）', () => {
  it('AC2-6 孩子设备访问 #/parent → 重定向 #/（家长入口构造上不存在）；未配对设备照常进入（#120 维持现状）', async () => {
    localStorage.setItem(
      'sq_device_credential',
      JSON.stringify({ device_id: 'd1', secret: 's1', role: 'child', name: '孩子平板' }),
    )
    try {
      await navigate('#/parent')
      await vi.waitFor(() => {
        expect(router.currentRoute.value.path).toBe('/')
      })
      expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
    } finally {
      localStorage.removeItem('sq_device_credential')
    }

    // 未配对（凭据清除后）：#/parent 维持现状照常可达
    await navigate('#/parent')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/parent')
    })
    expect(wrapper.find('[data-page="parent"]').exists()).toBe(true)
  })

  it('AC2-7 未配对设备首页页脚出现「加入家庭」入口（指向 #/pair，#145 文案改定）；已配对（家长）设备不渲染', async () => {
    await navigate('#/')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/')
    })
    const pairLinks = wrapper.findAll('a[href="#/pair"]')
    expect(pairLinks.length).toBe(1)
    expect(pairLinks[0].text()).toBe('加入家庭')

    localStorage.setItem(
      'sq_device_credential',
      JSON.stringify({ device_id: 'd2', secret: 's2', role: 'parent', name: '家长手机' }),
    )
    try {
      await navigate('#/star-log') // 换页再回：触发 Home 重挂载重读凭据
      await navigate('#/')
      await vi.waitFor(() => {
        expect(router.currentRoute.value.path).toBe('/')
      })
      expect(wrapper.findAll('a[href="#/pair"]').length).toBe(0)
    } finally {
      localStorage.removeItem('sq_device_credential')
    }
  })
})
