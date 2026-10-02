import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import Home from '../Home.vue'
import Result from '../Result.vue'
import ParentGuide from '../ParentGuide.vue'
import Parent from '../Parent.vue'
import Quiz from '../Quiz.vue'
import { router } from '../../router'
import { init } from '../../composables/useDataInfra'
import { startQuiz, answerQuiz, finishQuiz } from '../../composables/useQuiz'
import { writeQuestions } from '../../composables/useLearningData'
import { writeQuizMode } from '../../composables/useQuizMode'
import { copy } from '../../copy'
import { adoptTriviaSet } from '../../data/trivia-set'
import { writeEntryVisibilityValue } from '../../composables/useEntryVisibility'
import triviaSet from '../../../public/trivia/current/set.json'

const transport = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
const events = () => transport.mock.calls.flatMap(args => {
  const [url, options] = args as unknown as [string, RequestInit]
  return String(url).endsWith('/api/metrics/onboarding') ? [JSON.parse(String(options.body))] : []
})
enableAutoUnmount(afterEach)
beforeEach(async () => {
  localStorage.clear(); init(); transport.mockClear(); vi.stubGlobal('fetch', transport)
  await router.replace('/')
})
afterEach(() => vi.unstubAllGlobals())

async function guide() {
  await router.push('/parent-guide')
  const page = mount(ParentGuide, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return page
}

describe('#310 actual onboarding page interactions', () => {
  it('never counts actual surprise start or completed surprise result', async () => {
    adoptTriviaSet(triviaSet)
    writeEntryVisibilityValue('builtin-trivia', true)
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    await home.get('.trivia-sticker').trigger('click')
    await home.get('[role="dialog"] button.star-button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/quiz')
    for (let i = 0; i < 10; i++) answerQuiz(null)
    finishQuiz()
    mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(events()).toEqual([])
  })
  it.each(['normal', 'fresh', 'wrong'] as const)('counts successful ordinary %s start but not quiz reload', async mode => {
    writeQuizMode(mode)
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    await home.findAll('button').find(button => button.text() === copy.home.startQuiz)!.trigger('click')
    await flushPromises()
    expect(events()).toEqual([{ event: 'quiz_start', family_status: 'unjoined' }])
    await router.replace('/quiz')
    mount(Quiz, { global: { plugins: [router] } })
    await flushPromises()
    expect(events()).toHaveLength(1)
  })
  it('does not count empty-pool starts', async () => {
    writeQuestions([])
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    await home.findAll('button').find(button => button.text() === copy.home.startQuiz)!.trigger('click')
    expect(events()).toEqual([])
  })
  it('counts completion only on the first successful settlement, even with zero correct', async () => {
    const session = startQuiz()!
    for (let i = 0; i < 10; i++) answerQuiz(null)
    finishQuiz()
    expect(session.questions).toHaveLength(10)
    expect(events()).toEqual([])
    const first = mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(events()).toEqual([{ event: 'quiz_complete_10', family_status: 'unjoined' }])
    first.unmount()
    mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(events()).toHaveLength(1)
  })
  it('does not count an incomplete result visit', async () => {
    startQuiz(); answerQuiz(null); finishQuiz()
    mount(Result, { global: { plugins: [router] } })
    await flushPromises()
    expect(events()).toEqual([])
  })
  it.each([
    [copy.back, 'guide_back', '/'],
    ['出一套我家的题', 'guide_questions', '/parent/question-prompt'],
    ['看看星星兑换', 'guide_rewards', '/redeem'],
    ['创建我们的家', 'guide_family', '/parent-guide'],
    [copy.parentGuide.dismiss, 'guide_dismiss', '/parent-guide'],
    [copy.parent.parentGuideEntry, 'guide_archive', '/parent-guide'],
  ])('counts %s clicks independently without changing the action', async (label, event, route) => {
    // #324 两个新计数：guide_dismiss = 通知视图点「知道了」（消费）；guide_archive = 家长页
    // 「给家长的话」进入归档形态（入口价值，在家长页点击处上报，非 from=parent 进入不计）。
    let page = await guide()
    if (event === 'guide_archive') {
      page.unmount()
      await router.push('/parent')
      page = mount(Parent, { global: { plugins: [router] } })
      await flushPromises()
    }
    await page.findAll('button').find(button => button.text() === label)!.trigger('click')
    await flushPromises()
    expect(events()).toEqual([{ event, family_status: 'unjoined' }])
    expect(router.currentRoute.value.path).toBe(route)
    if (event === 'guide_family') {
      await page.get('[role="dialog"] button').trigger('click')
      expect(events()).toHaveLength(1)
    }
  })
  it('discloses statistics only after clicking the link; repeat clicks count, dismissals do not', async () => {
    const page = await guide()
    expect(page.find('[role="dialog"]').exists()).toBe(false)
    const link = page.get('a[aria-haspopup="dialog"]')
    expect(link.text()).toBe('数据统计说明')
    await link.trigger('click'); await flushPromises()
    const dialog = page.get('[role="dialog"]')
    for (const phrase of ['次数', '加入家庭', '90 天', 'IP', '不上传题目', '默认']) expect(dialog.text()).toContain(phrase)
    expect(events()).toEqual([{ event: 'guide_statistics', family_status: 'unjoined' }])
    await dialog.get('button').trigger('click'); await flushPromises()
    expect(document.activeElement).toBe(link.element)
    expect(events()).toHaveLength(1)
    await link.trigger('click'); await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(page.find('[role="dialog"]').exists()).toBe(false)
    expect(events()).toHaveLength(2)
  })
  it('counts guide entry only on click, not on home render or direct guide navigation', async () => {
    const home = mount(Home, { global: { plugins: [router] } })
    await flushPromises()
    expect(events()).toEqual([])
    await home.get('.parent-sticker').trigger('click')
    await flushPromises()
    expect(events()).toEqual([{ event: 'guide_entry', family_status: 'unjoined' }])
    await guide()
    expect(events()).toHaveLength(1)
  })
})
