import { copy } from '../copy'
import type { OnboardingEvent } from '../../shared/onboarding-metrics'

/**
 * #320 家长通知数据模型（spec #319 T1）：「家长请看」页的三张功能卡收敛为数据驱动的通知列表。
 * 通知 = 稳定身份（id，只增不改）+ 标题 + 正文 + 功能入口按钮（含去向）+ 埋点名。
 * 内容与身份随版本内置；「加一条通知 = 加一条数据」，不需要改页面结构或渲染逻辑。
 * 本阶段为纯重构：渲染结果与改造前逐字一致，无任何用户可观察的行为变化。
 */

/** 通知正文两种既有形态：段落（可带一条附注）或条目列表。 */
export type ParentGuideNotificationBody =
  | { kind: 'paragraphs'; paragraphs: string[]; note?: string }
  | { kind: 'items'; items: string[] }

/** 功能入口去向：页内路由跳转，或打开内测说明弹窗。 */
export type ParentGuideNotificationAction =
  | { kind: 'route'; path: string; query?: Record<string, string> }
  | { kind: 'beta-notice' }

export interface ParentGuideNotification {
  /** 稳定身份。文案随版本改不算新通知；同一件事再提醒必须换新 id（如 family-v2）。 */
  id: 'questions' | 'rewards' | 'family'
  /** aria-labelledby 指向的标题节点 id（历史值保留，保证渲染逐字一致）。 */
  headingId: string
  title: string
  body: ParentGuideNotificationBody
  actionLabel: string
  actionMetric: OnboardingEvent
  action: ParentGuideNotificationAction
}

export const parentGuideNotifications: ParentGuideNotification[] = [
  {
    id: 'questions',
    headingId: 'guide-questions-title',
    title: copy.parentGuide.questionsTitle,
    body: { kind: 'paragraphs', paragraphs: [copy.parentGuide.questionsBody], note: copy.parentGuide.tryNote },
    actionLabel: copy.parentGuide.questionsAction,
    actionMetric: 'guide_questions',
    action: { kind: 'route', path: '/parent/question-prompt', query: { from: 'parent-guide' } },
  },
  {
    id: 'rewards',
    headingId: 'guide-rewards-title',
    title: copy.parentGuide.rewardsTitle,
    body: { kind: 'paragraphs', paragraphs: [copy.parentGuide.rewardsBody] },
    actionLabel: copy.parentGuide.rewardsAction,
    actionMetric: 'guide_rewards',
    action: { kind: 'route', path: '/redeem', query: { from: 'parent-guide' } },
  },
  {
    id: 'family',
    headingId: 'guide-parent-title',
    title: copy.parentGuide.parentTitle,
    body: { kind: 'items', items: copy.parentGuide.parentItems },
    actionLabel: copy.parentGuide.familyAction,
    actionMetric: 'guide_family',
    action: { kind: 'beta-notice' },
  },
]
