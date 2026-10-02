// #310: a closed vocabulary, never button text, URLs, user content or identity.
export const ONBOARDING_EVENTS = [
  'quiz_start', 'quiz_complete_10', 'guide_entry', 'guide_back',
  'guide_questions', 'guide_rewards', 'guide_family', 'guide_statistics',
  'guide_dismiss', 'guide_archive',
] as const
export type OnboardingEvent = typeof ONBOARDING_EVENTS[number]
export type FamilyStatus = 'joined' | 'unjoined'

export function beijingDay(time: number): string {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
export function oldestMetricsDay(time: number): string {
  return beijingDay(time - 89 * 24 * 60 * 60 * 1000)
}
