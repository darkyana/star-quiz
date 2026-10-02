import { beforeEach, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { Question } from '../../types'
import Quiz from '../Quiz.vue'
import { router } from '../../router'
import { startQuiz, readSession } from '../../composables/useQuiz'
import { writeQuestions, questionResults } from '../../composables/useLearningData'
import { balance } from '../../composables/useStarData'

// #234 起归属由来源判定：范围题占 9 号段（type trivia 只是未被清除的旧形式标签，身份来自序号段）
const scoped: Question = { id: '900003', type: 'trivia', category: 'Think', book: 'level2', prompt: '范围内题', options: ['A', 'B', 'C', 'D'], answerIndex: 0 }
const other: Question = { ...scoped, id: 'other', type: 'zh2en', category: '学科', book: '默认', prompt: '不该出现' }
const scope = { kind: 'trivia', category: 'Think', book: 'level2' } as const
beforeEach(async () => { localStorage.clear(); await router.replace('/') })

it('无 start 参数直访重抽时维持残留会话范围；该分册已被导入移除则回首页', async () => {
  writeQuestions([scoped, other])
  startQuiz(Math.random, scope)
  await router.replace('/quiz')
  const wrapper = mount(Quiz, { global: { plugins: [router] } })
  await flushPromises()
  expect(readSession()?.scope).toEqual(scope)
  expect(wrapper.text()).toContain('范围内题')
  wrapper.unmount()
  startQuiz(Math.random, scope)
  writeQuestions([other])
  const empty = mount(Quiz, { global: { plugins: [router] } })
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/')
  expect(readSession()).toBeNull()
  empty.unmount()
})

it('重来前分册被导入移除时回首页，不留不可作答的旧画面', async () => {
  writeQuestions([scoped, other])
  startQuiz(Math.random, scope)
  await router.replace('/quiz?start=1')
  const wrapper = mount(Quiz, { global: { plugins: [router] } })
  await flushPromises()
  writeQuestions([other])
  await wrapper.get('.restart-btn').trigger('click')
  await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/')
  expect(readSession()).toBeNull()
  wrapper.unmount()
})

it('答题页重新开始保留原范围，不回到默认学科；已作答只写放弃记录', async () => {
  writeQuestions([scoped, other])
  const old = startQuiz(Math.random, scope)!
  await router.replace('/quiz?start=1')
  const wrapper = mount(Quiz, { global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('.options > :last-child').trigger('click')
  await wrapper.get('.restart-btn').trigger('click')
  await wrapper.get('[role="dialog"] .star-button--primary').trigger('click')
  expect(readSession()?.scope).toEqual(scope)
  expect(readSession()?.quizId).not.toBe(old.quizId)
  expect(wrapper.text()).toContain('范围内题')
  expect(wrapper.text()).not.toContain('不该出现')
  expect(questionResults()['900003'].map(r => r.outcome)).toEqual(['skipped'])
  expect(balance()).toBe(0)
  wrapper.unmount()
})
