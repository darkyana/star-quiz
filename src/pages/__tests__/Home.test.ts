/**
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 *
 * T6 首页功能化单测（Spec §4 REQ-4，AC4-1 ~ AC4-7）
 * 数据层直写 localStorage（F5）；路由断言用真实 router。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import Home from '../Home.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import { writeDeviceCredential } from '../../composables/useDeviceCredential'
import { balance, writeLedger } from '../../composables/useStarData'
import { writeEntryVisibilityValue } from '../../composables/useEntryVisibility'
// #322 通知角标：未读账单写入口（模拟家长在通知视图点掉全部「知道了」）
import { markParentGuideNotificationRead, parentGuideReadLedgerKey } from '../../composables/useParentGuideReadLedger'
import { parentGuideNotifications } from '../../data/parent-guide-notifications'
import { GAME_SLOT } from '../../data/playable-games'
import '../../composables/useLearningData'
import { adoptTriviaSet, triviaSetRef } from '../../data/trivia-set'
import { copy } from '../../copy'

// #275 构图/动效契约走源码文本锁定（jsdom 无布局引擎与动画引擎，不算真布局/真动效）
const homeVue = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../Home.vue'), 'utf-8')

// #287 现役题集从资产槽位读取（与生产冷启动同一份数据），测试内直接注入题集状态（网络预热不可用）
const triviaSetJson = JSON.parse(readFileSync(resolve(process.cwd(), 'public/trivia/current/set.json'), 'utf8')) as { intro: string, category: string, book: string }
const triviaSetOkResponse = (): Response => new Response(JSON.stringify(triviaSetJson), { status: 200, headers: { 'content-type': 'application/json' } })

// 首页现有同步订阅与新增游戏门禁监听均随页面卸载清理，避免跨用例残留。
enableAutoUnmount(afterEach)

/** /api/family 成功响应（2026-09-09 页脚「当前家庭」字段；已配对设备取现役码） */
function familyCodeResponse(code = '123456'): Response {
  return new Response(JSON.stringify({ code }), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function mountHome() {
  const wrapper = mount(Home, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  // #287 默认注入现役题集（模拟冷启动预热成功）；缺失/损坏用例自行 adoptTriviaSet(null) 覆盖
  adoptTriviaSet(triviaSetJson)
  window.location.hash = '#/'
  router.replace('/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AC4-1 / AC4-2 余额展示', () => {
  it('首页主星使用画师 PNG 素材而非 SVG', async () => {
    const wrapper = await mountHome()
    const star = wrapper.get('.balance-chip .home-big-star')
    expect(star.element.tagName).toBe('IMG')
    expect(star.attributes('src')).toBe(`${import.meta.env.BASE_URL}home-star.png`)
    expect(star.attributes('alt')).toBe('')
    expect(star.attributes('aria-hidden')).toBe('true')
  })

  it('AC4-1 空流水余额显示 0', async () => {
    localStorage.setItem('sq_stars', JSON.stringify([]))
    const wrapper = await mountHome()
    const chip = wrapper.get('.balance-chip')
    expect(chip.find('.star-value').text()).toBe('0')
  })

  it('AC4-2 非 0 余额实时求和展示', async () => {
    localStorage.setItem(
      'sq_stars',
      JSON.stringify([
        { id: 'a', timestamp: 1, type: 'earn', amount: 5, source: '答题得星' },
        { id: 'b', timestamp: 2, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
      ]),
    )
    const wrapper = await mountHome()
    expect(wrapper.get('.balance-chip .star-value').text()).toBe('3')
  })
})

describe('AC4-3 出题方式入口与双按钮（#152 G3 三分段直显切换器：tagline 移除）', () => {
  it('AC4-3 可见出题方式分段切换器（三段直显、默认「普通」段选中）与"开始答题""兑换星星"；tagline 不再渲染', async () => {
    const wrapper = await mountHome()
    const text = wrapper.get('[data-page="home"]').text()
    expect(text).not.toContain('今天来攒几颗星？')
    expect(text).toContain('出题方式')
    // 三分段直显（探针分段文案「普通 / 新题优先 / 错题优先」），默认普通段选中
    expect(text).toContain('普通')
    expect(text).toContain('新题优先')
    expect(text).toContain('错题优先')
    const pills = wrapper.findAll('.star-mode-entry__pill')
    expect(pills).toHaveLength(3)
    expect(pills[0].attributes('aria-checked')).toBe('true')
    expect(text).toContain('开始答题')
    expect(text).toContain('兑换星星')
    // C3Re1：品牌标题由 span.brand 迁至 StarNavBar 的 h1.page-title（视觉零差异统一化）
    expect(wrapper.get('.page-title').text()).toBe('星星答题')
    expect(wrapper.get('.balance-label').text()).toBe('星星')
  })
})

describe('AC4-4 / AC4-5 开始答题', () => {
  it('AC4-4 点击开始答题 → /quiz?start=1 且会话 in_progress', async () => {
    const wrapper = await mountHome()
    await wrapper.get('.home-main > .star-button--primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/quiz')
    expect(router.currentRoute.value.query.start).toBe('1')
    const session = JSON.parse(localStorage.getItem('sq_session') as string)
    expect(session.status).toBe('in_progress')
    expect(session.questions.length).toBeGreaterThan(0)
  })

  it('AC4-5 题池空：按钮 disabled + 提示文案', async () => {
    localStorage.setItem('sq_questions', JSON.stringify([]))
    const wrapper = await mountHome()
    const btn = wrapper.get('.home-main > .star-button--primary')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.get('[data-page="home"]').text()).toContain('还没有题目哦，等爸爸妈妈加好题目就可以开始了')
  })
})

// #271 惊喜入口贴纸化：贴纸随入口显隐渲染且与游戏贴纸同排紧挨；点贴纸弹说明弹窗（介绍文案 + 开始按钮）；
// 点开始直开惊喜会话并跳答题页；拨关即时收口且不打断进行中会话
// 豁免注明（#276 review fixes）：规格「答题页无惊喜临时切换入口」——答题页该入口在 main 上本就不存在
// （#272 起惊喜固定新题优先，临时切换整体拆除，见 CONTEXT.md「惊喜题库」词条），无对应实现可挂断言；
// 以本行注释作为存在性豁免，由 CONTEXT.md 词条 + useQuiz-scope.test.ts 的会话层口径覆盖。
describe('#271 惊喜贴纸入口：显隐 / 说明弹窗 / 一键开局', () => {
  it('默认隐藏：未设置 = 贴纸不渲染', async () => {
    const wrapper = await mountHome()
    expect(wrapper.find('.trivia-sticker').exists()).toBe(false)
  })

  it('开关开（显式 true）→ 贴纸渲染且与游戏贴纸共存于构图容器；开关关（显式 false）→ 贴纸消失且游戏贴纸不挪位', async () => {
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true, 'mini-garage-prototype': true }))
    const wrapper = await mountHome()
    expect(wrapper.find('.trivia-sticker').exists()).toBe(true)
    const classes = wrapper.findAll('.home-stickers > .game-sticker, .home-stickers > .trivia-sticker').map(s => s.classes())
    expect(classes[0]).toContain('game-sticker')
    expect(classes[1]).toContain('trivia-sticker')
    writeEntryVisibilityValue('builtin-trivia', false)
    await nextTick()
    expect(wrapper.find('.trivia-sticker').exists()).toBe(false)
    // #275 留位语义：惊喜拨关后游戏贴纸仍在构图容器内原位渲染（各贴纸独立定位，互不挪位、不破版）
    expect(wrapper.findAll('.home-stickers > .game-sticker, .home-stickers > .trivia-sticker').map(s => s.classes())).toEqual([expect.arrayContaining(['game-sticker'])])
    writeEntryVisibilityValue('builtin-trivia', true)
    await nextTick()
    expect(wrapper.find('.trivia-sticker').exists()).toBe(true)
  })

  it('点贴纸弹说明弹窗：题集介绍文案常量 + 「开始惊喜答题」按钮 + 关闭钮', async () => {
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true }))
    const wrapper = await mountHome()
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    await wrapper.get('.trivia-sticker').trigger('click')
    const modal = wrapper.get('.star-modal')
    expect(modal.text()).toContain(copy.home.trivia.label)
    expect(modal.text()).toContain(triviaSetJson.intro)
    expect(modal.text()).toContain(copy.home.trivia.start)
    // 右上关闭钮可关闭弹窗
    await modal.get('.star-icon-btn').trigger('click')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
  })

  it('点「开始惊喜答题」直开惊喜会话并跳答题页（不扣星、无门禁）', async () => {
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true }))
    const wrapper = await mountHome()
    await wrapper.get('.trivia-sticker').trigger('click')
    await wrapper.get('.star-modal .star-button--primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/quiz')
    expect(router.currentRoute.value.query.start).toBe('1')
    const session = JSON.parse(localStorage.getItem('sq_session') as string)
    expect(session.status).toBe('in_progress')
    expect(session.scope).toEqual({ kind: 'trivia', category: triviaSetJson.category, book: triviaSetJson.book })
    // 不扣星：星星流水无新增条目
    expect(JSON.parse(localStorage.getItem('sq_stars') ?? '[]')).toEqual([])
  })

  it('拨关不打断进行中的惊喜会话：会话仍在；回首页后贴纸已消失、无法再开新局', async () => {
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true }))
    const wrapper = await mountHome()
    await wrapper.get('.trivia-sticker').trigger('click')
    await wrapper.get('.star-modal .star-button--primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/quiz')
    // 进行中的一轮不受开关影响（入口级门禁不拆会话）
    writeEntryVisibilityValue('builtin-trivia', false)
    const session = JSON.parse(localStorage.getItem('sq_session') as string)
    expect(session.status).toBe('in_progress')
    // 模拟本轮答完回首页 → 贴纸已消失（弹窗无从打开、开局被门禁拦下）
    localStorage.removeItem('sq_session')
    const home = await mountHome()
    expect(home.find('.trivia-sticker').exists()).toBe(false)
  })
})

// #275 首页两贴纸构图与入场动效（#274 定稿 B3 修订版）：契约只锁源码层的构图容器、
// 动画类挂载与减弱动态降级，不测动画实现细节（节奏与落位以视觉验收为准）
describe('#287 题集缺失/损坏：题库按空处理，入口照常、兜底提示可重试', () => {
  it('题集未就绪：贴纸照常渲染（不与入口显隐耦合），点开弹「惊喜内容在路上，重试一下」+ 重试钮、无开局钮、不崩溃', async () => {
    adoptTriviaSet(null)
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true }))
    const wrapper = await mountHome()
    expect(wrapper.find('.trivia-sticker').exists()).toBe(true)
    await wrapper.get('.trivia-sticker').trigger('click')
    const modal = wrapper.get('.star-modal')
    expect(modal.text()).toContain(copy.home.trivia.loadFailed)
    expect(modal.text()).toContain(copy.home.trivia.retry)
    expect(modal.text()).not.toContain(copy.home.trivia.start)
    // 弹窗可正常关闭，无崩溃
    await modal.get('.star-icon-btn').trigger('click')
    expect(wrapper.find('.star-modal').exists()).toBe(false)
  })

  it('重试成功：点「重试」重新预热，题集就绪后弹窗响应式切回介绍文案 + 开局钮', async () => {
    adoptTriviaSet(null)
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true }))
    vi.stubGlobal('fetch', vi.fn(async () => triviaSetOkResponse()))
    const wrapper = await mountHome()
    await wrapper.get('.trivia-sticker').trigger('click')
    const modal = wrapper.get('.star-modal')
    expect(modal.text()).toContain(copy.home.trivia.loadFailed)
    await modal.get('.star-button--primary').trigger('click')
    await flushPromises()
    expect(triviaSetRef.value?.intro).toBe(triviaSetJson.intro)
    expect(wrapper.get('.star-modal').text()).toContain(triviaSetJson.intro)
    expect(wrapper.get('.star-modal').text()).toContain(copy.home.trivia.start)
  })

  it('题集未就绪时点不到开局（开局钮不渲染）；就绪后开局走题集分册，会话 scope 与题集一致', async () => {
    adoptTriviaSet(null)
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true }))
    const wrapper = await mountHome()
    await wrapper.get('.trivia-sticker').trigger('click')
    await flushPromises()
    expect(localStorage.getItem('sq_session')).toBeNull()
    // 就绪路径回归：scope 从题集对象读取（先等弹窗切回开局钮再点）
    adoptTriviaSet(triviaSetJson)
    await nextTick()
    await wrapper.get('.star-modal .star-button--primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/quiz')
    const session = JSON.parse(localStorage.getItem('sq_session') as string)
    expect(session.scope).toEqual({ kind: 'trivia', category: triviaSetRef.value?.category, book: triviaSetRef.value?.book })
  })
})

describe('#275 两贴纸构图与入场动效：构图容器 / 动画类挂载 / 减弱动态降级', () => {
  it('两贴纸共存于新构图容器：挂载后同属 .home-stickers、各自独立定位（固定错落坐标，不随显隐挪位）', async () => {
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'builtin-trivia': true, 'mini-garage-prototype': true }))
    const wrapper = await mountHome()
    const stickers = wrapper.findAll('.home-stickers > .game-sticker, .home-stickers > .trivia-sticker')
    expect(stickers.map(s => s.classes())).toEqual([
      expect.arrayContaining(['game-sticker']),
      expect.arrayContaining(['trivia-sticker']),
    ])
    // 留位语义落在源码契约：容器全幅锚定，两贴纸各写各的固定坐标，均不依赖另一张的显隐
    expect(homeVue).toMatch(/\.home-stickers\s*\{[^}]*inset: 0/)
    expect(homeVue).toMatch(/\.game-sticker\s*\{[^}]*top: var\(--space-xl\)/)
    expect(homeVue).toMatch(/\.trivia-sticker\s*\{[^}]*top: calc\(var\(--space-xl\) \+ var\(--size-star-hero\)\)/)
  })

  it('B3 入场动画类挂载：两贴纸同用 sticker-land 一次性入场，惊喜错开 --duration-fast 相位；时长/位移全走现役令牌', () => {
    // #276 review fixes 降敏：不再锁整段精确 CSS 字符串（空格与顺序），改为宽松正则/关键词包含，
    // 只保留契约意图——动画名、相位错开与令牌引用，具体写法以视觉验收为准
    expect(homeVue).toMatch(/\.game-sticker\s*\{[^}]*animation:\s*sticker-land\s+var\(--duration-slow\)[^;]*both/)
    expect(homeVue).toMatch(/\.trivia-sticker\s*\{[^}]*animation:\s*sticker-land\s+var\(--duration-slow\)\s+[^;]*var\(--duration-fast\)/)
    expect(homeVue).toMatch(/@keyframes sticker-land/)
  })

  it('减弱动态降级契约在源码层锁定：prefers-reduced-motion: reduce 时整层动画静止', () => {
    expect(homeVue).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.game-sticker[\s\S]*animation:\s*none/)
  })

  it('惊喜入口拨关不破版：拨关后构图容器仍渲染、游戏贴纸仍在（见 #271 显隐用例的留位断言）', () => {
    expect(homeVue).toMatch(/<div class="home-stickers">/)
  })
})

// #263 游戏入口改挂家长控制开关（脱离 interim 门禁）：默认隐藏，显式 true 才显示，写监听即时跟随
describe('#263 游戏贴纸随开关显隐', () => {
  it('默认隐藏：未设置 = 游戏贴纸不渲染；开关开 → 贴纸渲染；开关关 → 贴纸消失', async () => {
    const wrapper = await mountHome()
    expect(wrapper.find('.game-sticker').exists()).toBe(false)
    writeEntryVisibilityValue('mini-garage-prototype', true)
    await nextTick()
    expect(wrapper.find('.game-sticker').exists()).toBe(true)
    writeEntryVisibilityValue('mini-garage-prototype', false)
    await nextTick()
    expect(wrapper.find('.game-sticker').exists()).toBe(false)
  })
})

describe('AC4-6 兑换星星跳转', () => {
  it('AC4-6 点击兑换星星 → /redeem', async () => {
    const wrapper = await mountHome()
    await wrapper.get('.home-main > .star-button--standard').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/redeem')
  })
})

describe('AC4-7 / #308 保留页脚配置入口，新增未配对家长说明入口', () => {
  it('版本号与唯一配置链接保留；家长请看是唯一新增家长入口，无设置类图标', async () => {
    const wrapper = await mountHome()
    const footer = wrapper.get('.app-footer')
    expect(footer.text()).toContain('V0.14.0')
    const configLinks = wrapper.findAll('a[href="#/parent"]')
    expect(configLinks.length).toBe(1)
    expect(configLinks[0].text()).toBe('配置')
    // #322 通知角标（修订 #316「所有设备可见」口径）：此断言的成立前提 = 存在未读家长通知。
    // 未配对设备 + 已读账为空（三条通知全未读）→ 贴纸在且仍是首页唯一带「家长」字样的元素；
    // 未读清零 / 孩子设备的等价断言见下方 #322 describe（口径修订，勿删）。
    expect(wrapper.findAll('button, a').filter(el => el.text().includes('家长')).map(el => el.text())).toEqual([copy.parentGuide.sticker])
    expect(
      wrapper.find('[aria-label="设置"], [aria-label="齿轮"], [aria-label="菜单"], .gear, .settings, .menu').exists(),
    ).toBe(false)
    const text = wrapper.get('[data-page="home"]').text()
    expect(text).not.toContain('设置')
    expect(text).not.toContain('菜单')
    expect(text).not.toContain('⚙')
  })

  it('点击页脚「配置」链接 → /parent', async () => {
    const wrapper = await mountHome()
    // 2026-09-09 起页脚首个 .config-link 是置前的「加入家庭」，按 href 精确取「配置」
    await wrapper.get('.app-footer a[href="#/parent"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent')
  })
})

// #322 家长请看贴纸 = 通知角标（spec #319 故事 39）：本 describe 是对 #308/#316「入口对所有设备可见」口径的
// 显式修订留痕 —— 孩子设备不显示这枚贴纸是设计决定，不是回归 bug，请勿「修」回 #316。
describe('#322 家长请看 = 通知角标：未读驱动显隐 + 孩子设备不显示（修订 #316 口径）', () => {
  it('有未读（已读账为空 → 三条全未读）→ 贴纸在；未读清零 → 贴纸从首页消失', async () => {
    let wrapper = await mountHome()
    expect(wrapper.find('.parent-sticker').exists()).toBe(true)
    for (const notification of parentGuideNotifications) markParentGuideNotificationRead(notification.id)
    await nextTick()
    expect(wrapper.find('.parent-sticker').exists()).toBe(false)
    wrapper.unmount()
  })

  it('未读清零后再出现新未读（等价于后续版本新增一条通知）→ 贴纸自动重现', async () => {
    for (const notification of parentGuideNotifications) markParentGuideNotificationRead(notification.id)
    const wrapper = await mountHome()
    expect(wrapper.find('.parent-sticker').exists()).toBe(false)
    // 新通知（append-only 新 id）未读 = 账上多一条未读；此处用同键改回 false 模拟「账上出现未读」
    writeEntryVisibilityValue(parentGuideReadLedgerKey(parentGuideNotifications[0]!.id), false)
    await nextTick()
    expect(wrapper.find('.parent-sticker').exists()).toBe(true)
  })

  it('孩子设备（child 且已入队 joined）不显示贴纸 —— #316 口径显式修订；待批准 child 与未配对照常显示', async () => {
    writeDeviceCredential({ device_id: 'd-child', secret: 's', role: 'child', name: '孩子平板' }, 'active')
    const childWrapper = await mountHome()
    expect(childWrapper.find('.parent-sticker').exists()).toBe(false)
    childWrapper.unmount()
    localStorage.clear()
    initAppState()
    adoptTriviaSet(triviaSetJson)
    // 待批准（pending → familyStatus 'unjoined'）child 设备：照常显示（与今天一致）
    writeDeviceCredential({ device_id: 'd-wait', secret: 's', role: 'child', name: '孩子平板' }, 'pending')
    const pendingWrapper = await mountHome()
    expect(pendingWrapper.find('.parent-sticker').exists()).toBe(true)
  })

  it('贴纸显隐不带动游戏/惊喜贴纸（留位语义：家长贴纸消失后其余贴纸照常渲染、独立定位）', async () => {
    writeEntryVisibilityValue(GAME_SLOT.id, true)
    writeEntryVisibilityValue('builtin-trivia', true)
    for (const notification of parentGuideNotifications) markParentGuideNotificationRead(notification.id)
    const wrapper = await mountHome()
    expect(wrapper.find('.parent-sticker').exists()).toBe(false)
    expect(wrapper.find('.game-sticker').exists()).toBe(true)
    expect(wrapper.find('.trivia-sticker').exists()).toBe(true)
  })
})

describe('#125 页脚三态：未配对 / 家长设备 / 孩子设备（2026-09-09 增「当前家庭」字段 + 入家链接置前）', () => {
  it('未配对：「配置」与「加入家庭」并存且「加入家庭」在前（DOM 顺序），家庭字段显示「尚未加入家庭」；零网络请求', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const wrapper = await mountHome()
    expect(wrapper.findAll('a[href="#/parent"]').length).toBe(1)
    const pairLinks = wrapper.findAll('a[href="#/pair"]')
    expect(pairLinks.length).toBe(1)
    expect(pairLinks[0].text()).toBe('加入家庭')
    // 2026-09-09 老板拍板：入家链接在「配置」前（页脚 DOM 顺序断言）
    expect(wrapper.get('.app-footer').findAll('a').map((a) => a.attributes('href'))).toEqual(['#/pair', '#/parent'])
    expect(wrapper.get('.app-footer').text()).toContain('尚未加入家庭')
    expect(fetchSpy).not.toHaveBeenCalled() // 未配对不取码
  })

  it('点击「加入家庭」链接 → /pair', async () => {
    const wrapper = await mountHome()
    await wrapper.get('a[href="#/pair"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/pair')
  })

  it('家长设备：取现役码显示「家庭：123456」；无「加入家庭」入口（配对成功即消失）', async () => {
    writeDeviceCredential({ device_id: 'd1', secret: 's1', role: 'parent', name: '家长手机' })
    const fetchMock = vi.fn().mockResolvedValue(familyCodeResponse('123456'))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountHome()
    expect(wrapper.get('.app-footer').text()).toContain('家庭：123456')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.starquiz.link/api/family')
    expect(wrapper.findAll('a[href="#/parent"]').length).toBe(1)
    expect(wrapper.findAll('a[href="#/pair"]').length).toBe(0)
  })

  it('孩子设备：同样显示「家庭：123456」；「配置」与「加入家庭」均不渲染（家长入口构造上不存在，#84）', async () => {
    writeDeviceCredential({ device_id: 'd2', secret: 's2', role: 'child', name: '孩子平板' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(familyCodeResponse('654321')))
    const wrapper = await mountHome()
    expect(wrapper.get('.app-footer').text()).toContain('家庭：654321')
    expect(wrapper.findAll('a[href="#/parent"]').length).toBe(0)
    expect(wrapper.findAll('a[href="#/pair"]').length).toBe(0)
  })

  it('取码失败（断网）→ 已配对设备隐藏家庭字段（不误显「尚未加入家庭」），其余页脚不受影响', async () => {
    writeDeviceCredential({ device_id: 'd3', secret: 's3', role: 'parent', name: '家长手机' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const wrapper = await mountHome()
    const footerText = wrapper.get('.app-footer').text()
    expect(footerText).not.toContain('家庭：')
    expect(footerText).not.toContain('尚未加入家庭')
    expect(wrapper.findAll('a[href="#/parent"]').length).toBe(1)
  })

  it('#252 角色跟随：挂载后写入 child 凭据（不重挂载）→ 页脚「配置」「加入家庭」入口即时消失，家庭字段不再显示「尚未加入家庭」', async () => {
    const wrapper = await mountHome()
    expect(wrapper.findAll('a[href="#/parent"]').length).toBe(1)
    expect(wrapper.findAll('a[href="#/pair"]').length).toBe(1)
    // 配对落凭据（孩子角色）→ 写监听驱动页脚即时显隐，不再押在路由重挂载兜底上
    writeDeviceCredential({ device_id: 'd-live', secret: 's-live', role: 'child', name: '孩子平板' })
    await nextTick()
    expect(wrapper.findAll('a[href="#/parent"]').length).toBe(0)
    expect(wrapper.findAll('a[href="#/pair"]').length).toBe(0)
    expect(wrapper.get('.app-footer').text()).not.toContain('尚未加入家庭')
  })
})

// #258 游戏会话全屏化：真实 router + 真实 composables（useGameSession / useStarData；#266 起无超能力开关），
// 最小宿主形状同 #253 验收测试（idle / failed 不渲染 iframe，disableIframePageLoading 见文件头）。
// 时间 / iframe 是环境输入，不 mock 经济业务；只测外部行为（阶段 → DOM 形态、点击 → 退星回首页）。
describe('#258 游戏会话全屏化（宿主 UI 让位）', () => {
  const localTime = (hour: number) => new Date(2026, 8, 15, hour, 0, 0)

  beforeEach(() => {
    // 仅模拟 iframe 载入边界（同 #253 验收）：保留真实 src 与独立 Window，不发测试服务器网络请求
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLIFrameElement, url: string) {
      this.setAttribute('srcdoc', '')
      this.setAttribute('src', url)
    })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(localTime(20))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** 付费开一局进 loading（30 星本金 → 扣 15）：贴纸入口 → 说明弹窗 → 「开始游戏」
      （attachTo 同 #253 验收：iframe 需接入文档才有独立 contentWindow 供协议握手） */
  async function paidStart() {
    // #263 游戏入口改挂家长控制开关：付费开局前置开关开
    writeEntryVisibilityValue('mini-garage-prototype', true)
    writeLedger([{ id: 'earned', type: 'earn', amount: 30, source: '答题得星', timestamp: 1 }])
    const wrapper = mount(Home, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('button[aria-label="迷你车库"]').trigger('click')
    await wrapper.get('.star-modal .star-button--primary').trigger('click')
    await flushPromises()
    return wrapper
  }

  /** 以 iframe contentWindow 为来源发一条合法协议消息（同 #253 验收 game() 的消息通道） */
  function gameMessage(wrapper: VueWrapper, type: string, extra = {}) {
    const frame = wrapper.get<HTMLIFrameElement>('iframe').element
    const source = frame.contentWindow!
    vi.spyOn(source, 'postMessage').mockImplementation(() => {})
    window.dispatchEvent(new MessageEvent('message', { source, origin: location.origin, data: {
      channel: 'mini-garage', version: 1, type, instanceId: 'game-a', requestId: 'game-a:1', roundId: null, ...extra,
    } }))
    return source
  }

  it('idle 态：导航栏常驻、无游戏会话区与 iframe', async () => {
    const wrapper = await mountHome()
    expect(wrapper.find('.star-nav-bar').exists()).toBe(true)
    expect(wrapper.find('.game-session').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('loading 态：无导航栏，深蓝底居中空态块装加载中文案 + 小号「退出」钮；点击退出全额退星回 idle', async () => {
    const wrapper = await paidStart()
    expect(wrapper.find('.star-nav-bar').exists()).toBe(false)
    // loading 期 iframe 照常挂载（#253 协议握手来源），被空态块整幅覆盖
    expect(wrapper.find('iframe').exists()).toBe(true)
    const hold = wrapper.get('.game-hold')
    expect(hold.text()).toContain('游戏加载中，未能开始会自动退回星星。')
    const exit = wrapper.get('.game-session .star-button--standard')
    expect(exit.text()).toBe('退出')
    await exit.trigger('click')
    await flushPromises()
    expect(balance()).toBe(30)
    expect(wrapper.find('.star-nav-bar').exists()).toBe(true)
    expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
  })

  it('failed 态：同构空态块装「星星已退回」文案 + 小号「退出」钮；期间无导航栏与 iframe，退出回 idle', async () => {
    const wrapper = await paidStart()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrapper.find('.star-nav-bar').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    const hold = wrapper.get('.game-hold')
    expect(hold.text()).toContain('游戏未能加载，星星已退回。请返回首页。')
    expect(balance()).toBe(30)
    await wrapper.get('.game-session .star-button--standard').trigger('click')
    await flushPromises()
    expect(wrapper.find('.star-nav-bar').exists()).toBe(true)
    expect(wrapper.get('.home-scroll').isVisible()).toBe(true)
    expect(balance()).toBe(30)
  })

  it('running 态：整页只有 iframe + 右上角半透明 X；点 X 直接退星流程外回 idle（无确认弹窗、playing 退出不退星）', async () => {
    const wrapper = await paidStart()
    gameMessage(wrapper, 'ready')
    await flushPromises()
    expect(wrapper.find('.star-nav-bar').exists()).toBe(false)
    expect(wrapper.find('.game-hold').exists()).toBe(false)
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(wrapper.findAll('iframe')).toHaveLength(1)
    // 宿主按钮全让位：游戏会话区内无标准按钮，只有右上角 X（aria-label 复用「退出游戏」）
    expect(wrapper.find('.game-session .star-button--standard').exists()).toBe(false)
    const x = wrapper.get('.game-session .game-exit')
    expect(x.attributes('aria-label')).toBe('退出游戏')
    expect(x.find('svg').exists()).toBe(true)
    // toast 保留（游戏会话期间层级高于 iframe，样式断言见 styles-pages.test.ts）
    expect(wrapper.find('.toast').exists()).toBe(true)
    await x.trigger('click')
    await flushPromises()
    expect(wrapper.find('.star-nav-bar').exists()).toBe(true)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(balance()).toBe(15)
  })

  // #263 关闭语义：入口级门禁只挡新开局——家长在 running 期关开关，进行中的一局不被打断（无会话清理路径）
  it('running 期家长关游戏入口：会话区与 iframe 仍在，本局自然结束', async () => {
    const wrapper = await paidStart()
    gameMessage(wrapper, 'ready')
    await flushPromises()
    expect(wrapper.find('.game-session').exists()).toBe(true)
    writeEntryVisibilityValue('mini-garage-prototype', false)
    await nextTick()
    expect(wrapper.find('.game-session').exists()).toBe(true)
    expect(wrapper.find('iframe').exists()).toBe(true)
    // 本局正常退出流程不受影响（退星路径零改动：playing 退出不退星）
    await wrapper.get('.game-session .game-exit').trigger('click')
    await flushPromises()
    expect(wrapper.find('.game-session').exists()).toBe(false)
    expect(balance()).toBe(15)
  })
})

// #280 孩子端限时显隐与弹窗倒计时：两入口显隐走 #278 到期推导（保持开启恒显；限时未到期显、归零隐；
// 关闭/未设置隐藏）；限时生效期间两说明弹窗各显示「剩余 X 分钟」/「不到 1 分钟」，非限时开启无倒计时；
// 前台分钟粒度重算——归零入口即时消失、已开弹窗即时关闭，完全静默（拍板 B1，无提示文案/toast）；
// 归零不打断进行中的一局（入口门禁不拆会话）。推导纯函数已在 useEntryVisibility 单测覆盖，此处只测页面外部行为。
describe('#280 限时显隐与弹窗倒计时', () => {
  /** 播种限时档（家长写入形状 { visible: true, expires_at }，到期时间戳由写入方本地时钟算出；两入口同到期） */
  function seedTimed(minutes: number): void {
    const expiresAt = Date.now() + minutes * 60_000
    localStorage.setItem('sq_entry_visibility', JSON.stringify({
      'mini-garage-prototype': { visible: true, expires_at: expiresAt },
      'builtin-trivia': { visible: true, expires_at: expiresAt },
    }))
  }

  beforeEach(() => {
    // Date（推导输入）+ 定时器（分钟粒度重算）同入假时钟；保留微任务，flushPromises 照常
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 8, 15, 20, 0, 0))
    // 同 #258：仅模拟 iframe 载入边界（保留真实 src 与独立 Window，供协议握手），不发网络请求
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLIFrameElement, url: string) {
      this.setAttribute('srcdoc', '')
      this.setAttribute('src', url)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('限时未到期：两贴纸渲染；游戏弹窗与惊喜弹窗各显示「剩余 5 分钟」', async () => {
    seedTimed(5)
    const wrapper = await mountHome()
    expect(wrapper.find('.game-sticker').exists()).toBe(true)
    expect(wrapper.find('.trivia-sticker').exists()).toBe(true)
    await wrapper.get('.game-sticker').trigger('click')
    expect(wrapper.get('.star-modal').text()).toContain('剩余 5 分钟')
    await wrapper.get('.star-modal .star-button--standard').trigger('click') // 「取消」关游戏弹窗
    await wrapper.get('.trivia-sticker').trigger('click')
    expect(wrapper.get('.star-modal').text()).toContain('剩余 5 分钟')
  })

  it('剩余不足 1 分钟：弹窗显示「不到 1 分钟」', async () => {
    seedTimed(0.5)
    const wrapper = await mountHome()
    await wrapper.get('.game-sticker').trigger('click')
    expect(wrapper.get('.star-modal').text()).toContain('不到 1 分钟')
  })

  it('保持开启（显式 true，非限时）：弹窗无倒计时行', async () => {
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'mini-garage-prototype': true, 'builtin-trivia': true }))
    const wrapper = await mountHome()
    await wrapper.get('.game-sticker').trigger('click')
    const text = wrapper.get('.star-modal').text()
    expect(text).not.toContain('剩余')
    expect(text).not.toContain('不到 1 分钟')
  })

  it('已过期与显式 false：贴纸不渲染（未设置同隐藏）', async () => {
    seedTimed(0) // expires_at = 当前时刻，恰好归零按已过期（推导要求严格早于）
    let wrapper = await mountHome()
    expect(wrapper.find('.game-sticker').exists()).toBe(false)
    expect(wrapper.find('.trivia-sticker').exists()).toBe(false)
    localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'mini-garage-prototype': false, 'builtin-trivia': false }))
    wrapper = await mountHome()
    expect(wrapper.find('.game-sticker').exists()).toBe(false)
    expect(wrapper.find('.trivia-sticker').exists()).toBe(false)
  })

  it('前台分钟粒度重算：弹窗内倒计时随分钟递减；归零时贴纸消失、已开弹窗即时关闭，完全静默（B1：无 toast 无到期文案）', async () => {
    seedTimed(5)
    const wrapper = await mountHome()
    await wrapper.get('.game-sticker').trigger('click')
    expect(wrapper.get('.star-modal').text()).toContain('剩余 5 分钟')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(wrapper.get('.star-modal').text()).toContain('剩余 4 分钟')
    // 走完剩余 4 分钟 → 归零：贴纸消失、弹窗即时关闭；无任何提示文案或 toast
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(wrapper.find('.game-sticker').exists()).toBe(false)
    expect(wrapper.find('.star-modal').exists()).toBe(false)
    expect(wrapper.find('.toast').exists()).toBe(false)
    expect(wrapper.get('[data-page="home"]').text()).not.toContain('时间到了')
  })

  it('归零不打断进行中的一局：running 期到点，会话区与 iframe 仍在，本局自然结束（退星路径零改动）', async () => {
    seedTimed(30)
    writeLedger([{ id: 'earned', type: 'earn', amount: 30, source: '答题得星', timestamp: 1 }])
    const wrapper = mount(Home, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('button[aria-label="迷你车库"]').trigger('click')
    expect(wrapper.get('.star-modal').text()).toContain('剩余 30 分钟')
    await wrapper.get('.star-modal .star-button--primary').trigger('click')
    await flushPromises()
    const frame = wrapper.get<HTMLIFrameElement>('iframe').element
    const source = frame.contentWindow!
    vi.spyOn(source, 'postMessage').mockImplementation(() => {})
    window.dispatchEvent(new MessageEvent('message', { source, origin: location.origin, data: {
      channel: 'mini-garage', version: 1, type: 'ready', instanceId: 'game-a', requestId: 'game-a:1', roundId: null,
    } }))
    await flushPromises()
    expect(wrapper.find('.game-session').exists()).toBe(true)
    // 限时归零：进行中的一局不被打断（入口门禁不拆会话），本局正常退出仍不退星
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(wrapper.find('.game-session').exists()).toBe(true)
    expect(wrapper.find('iframe').exists()).toBe(true)
    await wrapper.get('.game-session .game-exit').trigger('click')
    await flushPromises()
    expect(wrapper.find('.game-session').exists()).toBe(false)
    expect(balance()).toBe(15)
  })
})
