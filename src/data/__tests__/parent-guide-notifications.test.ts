import { describe, it, expect } from 'vitest'
import { parentGuideNotifications } from '../parent-guide-notifications'
import { copy } from '../../copy'

// #320 通知数据模型（spec #319 T1）：三条首发通知有稳定 id，「加一条通知 = 加一条数据」。
describe('#320 parent guide notifications data model', () => {
  it('ships the three launch notifications with stable ids in render order', () => {
    expect(parentGuideNotifications.map(notification => notification.id)).toEqual(['questions', 'rewards', 'family'])
  })

  it('each notification carries title, body copy, action label, metric and target from data', () => {
    const [questions, rewards, family] = parentGuideNotifications
    expect(questions.title).toBe(copy.parentGuide.questionsTitle)
    expect(questions.body).toEqual({ kind: 'paragraphs', paragraphs: [copy.parentGuide.questionsBody], note: copy.parentGuide.tryNote })
    expect(questions.actionLabel).toBe(copy.parentGuide.questionsAction)
    expect(questions.actionMetric).toBe('guide_questions')
    expect(questions.action).toEqual({ kind: 'route', path: '/parent/question-prompt', query: { from: 'parent-guide' } })
    expect(rewards.action).toEqual({ kind: 'route', path: '/redeem', query: { from: 'parent-guide' } })
    expect(family.action).toEqual({ kind: 'beta-notice' })
  })

  it('notification ids and heading anchors are unique', () => {
    expect(new Set(parentGuideNotifications.map(notification => notification.id)).size).toBe(parentGuideNotifications.length)
    expect(new Set(parentGuideNotifications.map(notification => notification.headingId)).size).toBe(parentGuideNotifications.length)
  })
})
