/**
 * R3 AC1-4 ~ AC1-8 家长页骨架与触控规范（Spec §4 REQ-1 / §3.6 / 公理 B1/B2/L3）
 * 星星手势进入家长页（B4）已废弃：C3Re1 老板拍板删除首页星星按钮，家长入口 = 页脚「配置」链接（AC1-7 / 09-home）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
// #322 通知角标：孩子设备显隐口径修订所需
import { writeDeviceCredential } from '../../src/composables/useDeviceCredential'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
import type { Question, StarEntry, RewardItem } from '../../src/types/index'

const DEFAULT_REWARDS: RewardItem[] = [
  { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
  { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
  { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' },
]

function makeQuestions(n: number): Question[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    type: 'zh2en' as const,
    prompt: `题目${i + 1}`,
    options: ['a', 'b', 'c', 'd'] as [string, string, string, string],
    answerIndex: 2,
    wordId: `w${i + 1}`,
  }))
}

function seed(overrides: { questions?: Question[]; stars?: StarEntry[] } = {}): void {
  localStorage.clear()
  localStorage.setItem('sq_questions', JSON.stringify(overrides.questions ?? makeQuestions(10)))
  localStorage.setItem('sq_stars', JSON.stringify(overrides.stars ?? []))
  localStorage.setItem('sq_rewards', JSON.stringify(DEFAULT_REWARDS))
  localStorage.setItem('sq_last_export', JSON.stringify(''))
  // #263 游戏入口改挂家长控制开关：本文件覆盖开局/兑换行为，前置开关开（显隐行为见 src 页面单测）
  localStorage.setItem('sq_entry_visibility', JSON.stringify({ 'mini-garage-prototype': true }))
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
}

async function mountApp(path = '/'): Promise<VueWrapper> {
  await router.replace(path)
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return wrapper
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  initAppState()
  // #266 游戏贴纸改时窗显隐：钉住时窗外时刻，保证「首页零 img」断言不随运行时间抖动
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 15, 12))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

/** R2 防刷分守卫：访问 #/result 前注入可结算会话（同 02-router.test.ts 前置口径） */
const pendingSession = {
  quizId: 'r3_gesture_sweep',
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

describe('AC1-4 ~ AC1-6 家长页骨架', () => {
  it('AC1-4 家长页标识与标题：可见「返回」（#38 文案统一 copy.back）与「家长页」（routeContract 契约行保留）', async () => {
    wrapper = await mountApp('/parent')
    const page = wrapper.get('[data-page="parent"]')
    expect(page.text()).toContain('家长页')
    expect(page.text()).toContain('返回')
  })

  it('AC1-5 返回孩子端无确认：点击后无 .confirm-modal 且路由 /', async () => {
    wrapper = await mountApp('/parent')
    await wrapper.get('.btn-back-child').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(wrapper.find('[data-page="home"]').exists()).toBe(true)
  })

  it('AC1-6 操作区 6 按钮同权重（#38：StarButtonStandard standard×large 统一；2026-09-03 组件库入口降级为 config-link 链接；#136 增出题指令、#132 增家庭管理、#323 增「给家长的话」归档入口）', async () => {
    wrapper = await mountApp('/parent')
    const buttons = wrapper.findAll('.parent-actions button')
    // #323：5→6（末位新增「给家长的话」同权重主按钮，既有位次不变）
    expect(buttons).toHaveLength(6)
    for (const b of buttons) {
      expect(b.classes()).toContain('star-button--standard')
      expect(b.classes()).toContain('star-button--large')
    }
    expect(buttons.find((b) => b.text() === '数据管理')?.classes()).toContain('btn-data-manage')
    expect(buttons.find((b) => b.text() === '流水管理')?.classes()).toContain('btn-ledger-manage')
  })
})

describe('AC1-7 家长入口约束 + B2 孩子端无功能可见入口', () => {
  it('B1 / #308 配置链接与家长说明贴纸并存，首页无管理操作；hint 为纯文本', async () => {
    seed({ questions: [] }) // 空题池以展示 hint 文案「还没有题目哦，等爸爸妈妈加好题目就可以开始了」
    wrapper = await mountApp('/')
    const home = wrapper.get('[data-page="home"]')

    const footer = home.get('.app-footer')
    expect(footer.text()).toContain('V0.14.0')
    const configLinks = wrapper.findAll('a[href="#/parent"]')
    expect(configLinks.length).toBe(1)
    expect(configLinks[0].text()).toBe('配置')
    // #322 通知角标（修订 #316「入口对所有设备可见」口径，spec #319 故事 39）：本断言成立前提 =
    // 存在未读家长通知（默认已读账为空 → 全未读）。孩子设备不显示这枚贴纸的口径修订断言见下一用例（勿删勿跳过）。
    expect(home.findAll('button, a').filter(el => el.text().includes('家长')).map(el => el.text())).toEqual(['家长请看'])
    expect(home.find('[aria-label="设置"], [aria-label="齿轮"], [aria-label="菜单"]').exists()).toBe(false)
    expect(home.get('.game-sticker img').classes()).toEqual(['sticker-art', 'game-sticker__art'])
    expect(home.get('.parent-sticker img').attributes('alt')).toBe('')
    expect(home.get('.home-big-star').attributes('src')).toBe(`${import.meta.env.BASE_URL}home-star.png`)

    // hint 为纯文本 <p>，非功能入口，属 B2 白名单豁免（Home.vue:79 / 09-home.test.ts AC4-5）
    const hint = home.find('.home-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.element.tagName).toBe('P')
    expect(home.find('input[type="file"]').exists()).toBe(false)
    for (const el of home.findAll('button, a')) {
      expect(el.text()).not.toMatch(/导入|导出|数据管理|流水管理/)
    }
  })

  // #322 对 #316 口径的显式修订（spec #319 故事 39）：孩子设备（child + 已入队）首页不显示家长请看贴纸，
  // 这是设计决定而非回归 bug，勿修回「所有设备可见」；待批准设备照常显示。
  it('B2 / #322 已入队孩子设备首页无家长请看贴纸（修订 #316 口径）；待批准设备照常显示', async () => {
    seed()
    writeDeviceCredential({ device_id: 'd-child', secret: 's', role: 'child', name: '孩子平板' }, 'active')
    wrapper = await mountApp('/')
    expect(wrapper.find('.parent-sticker').exists()).toBe(false)
    wrapper?.unmount()
    wrapper = undefined
    seed()
    writeDeviceCredential({ device_id: 'd-wait', secret: 's', role: 'child', name: '孩子平板' }, 'pending')
    wrapper = await mountApp('/')
    expect(wrapper.find('.parent-sticker').exists()).toBe(true)
  })

  it('B2 孩子端 5 页面 DOM 均无「导入/导出/数据管理/流水管理」功能可见入口（button/a/input[type=file]）', async () => {
    seed()
    wrapper = await mountApp('/')
    const pages = [
      { hash: '#/', dataPage: 'home' },
      { hash: '#/quiz', dataPage: 'quiz' },
      { hash: '#/result', dataPage: 'result' },
      { hash: '#/redeem', dataPage: 'redeem' },
      { hash: '#/star-log', dataPage: 'star-log' },
    ]
    for (const row of pages) {
      if (row.hash === '#/result') {
        window.location.hash = '#/'
        await settle()
        localStorage.setItem('sq_session', JSON.stringify(pendingSession))
      }
      window.location.hash = row.hash
      await settle()
      const page = wrapper.find(`[data-page="${row.dataPage}"]`)
      expect(page.exists()).toBe(true)
      expect(page.find('input[type="file"]').exists()).toBe(false)
      for (const el of page.findAll('button, a')) {
        expect(el.text()).not.toMatch(/导入|导出|数据管理|流水管理/)
      }
    }
  })
})

describe('AC1-8 L3 触控目标 ≥ 44px（源码文本断言；#57 起尺寸走 --touch 令牌）', () => {
  // config-link 2026-09-03 收编 components.css 跨页样式集（Home/Parent 共用），样式源并入扫描
  const STYLE_FILES = ['src/App.vue', 'src/pages/Home.vue', 'src/pages/Parent.vue', 'src/styles/components.css']

  function styleText(): string {
    return STYLE_FILES.map((f) => {
      const text = readFileSync(resolve(process.cwd(), f), 'utf-8')
      if (f.endsWith('.css')) return text
      const parts: string[] = []
      const re = /<style[^>]*>([\s\S]*?)<\/style>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) parts.push(m[1])
      return parts.join('\n')
    }).join('\n')
  }

  function ruleFor(className: string, styles: string): string {
    const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\.${esc}[^{]*\\{([^}]*)\\}`, 's')
    const m = styles.match(re)
    return m ? m[1] : ''
  }

  it('家长入口触控规范（#38：按钮类已组件化，触控尺寸由 StarButtonStandard 组件测试保证；此处保留 .config-link 文本断言）', () => {
    const styles = styleText()
    const variablesCss = readFileSync(resolve(process.cwd(), 'src/styles/variables.css'), 'utf-8')
    for (const cls of ['config-link']) {
      const rule = ruleFor(cls, styles)
      expect(rule, `${cls} 应有样式规则`).not.toBe('')
      expect(rule, `${cls} 高度走 --touch-sm 令牌`).toContain('min-height: var(--touch-sm)')
      expect(rule, `${cls} 宽度走 --touch-sm 令牌`).toContain('min-width: var(--touch-sm)')
    }
    expect(variablesCss, '--touch-sm 档位值 44px（触控下限不回归）').toMatch(/--touch-sm:\s*44px/)
  })

  it('弹窗内四操作按钮（.btn-export/.btn-import/.confirm-ok/.confirm-cancel）已组件化，触控高度由 StarButtonStandard large（--touch-md 56px ≥ 44px）保证', () => {
    // 按钮组件化（#38 延伸）：Parent.vue 仅保留类名钩子，尺寸由组件样式保证
    const btnVue = readFileSync(resolve(process.cwd(), 'src/components/StarButtonStandard.vue'), 'utf-8')
    const rule = btnVue.match(/(?:^|\n)\.star-button--large\s*\{([^}]*)\}/s)
    expect(rule, 'StarButtonStandard large 尺寸规则应存在').not.toBeNull()
    expect(rule![1], '组件 large min-height 走 --touch-md 令牌').toContain('min-height: var(--touch-md)')
    const parentVue = readFileSync(resolve(process.cwd(), 'src/pages/Parent.vue'), 'utf-8')
    for (const cls of ['btn-export', 'btn-import', 'confirm-ok', 'confirm-cancel']) {
      expect(parentVue, `${cls} 应由 StarButtonStandard 渲染`).toContain(`class="${cls}"`)
    }
  })
})
