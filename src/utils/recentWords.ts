import { DEFAULT_CHILD_ID, RECENT_WORDS_LIMIT, type WordAppearance } from '../types'

/** 版本9旧清单没有真实时刻：用非正时间保序，不伪造一次新出现。 */
export function wordEventsOf(value: WordAppearance[] | string[]): WordAppearance[] {
  return value.map((row, index) => typeof row === 'string'
    ? { wordId: row, appearedAt: -index, childId: DEFAULT_CHILD_ID } : row)
}

/** 每孩同词只保留最新一次，排序确定且每孩最多30词。云端仍保留所有事件。 */
export function latestWordEvents(events: WordAppearance[]): WordAppearance[] {
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  return [...events].sort((a, b) => b.appearedAt - a.appearedAt || (a.wordId < b.wordId ? -1 : a.wordId > b.wordId ? 1 : 0))
    .filter((e) => {
      const key = JSON.stringify([e.childId, e.wordId])
      if (seen.has(key)) return false
      seen.add(key)
      const count = (counts.get(e.childId) ?? 0) + 1
      counts.set(e.childId, count)
      return count <= RECENT_WORDS_LIMIT
    })
}
