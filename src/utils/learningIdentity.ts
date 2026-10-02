import { DEFAULT_CHILD_ID, type FlaggedEntry } from '../types'

/** 裸默认题号与复合键分命名空间；以 [ 开头的默认题号也编码，永不碰撞。 */
export function flagKey(questionId: string, childId = DEFAULT_CHILD_ID): string {
  return childId === DEFAULT_CHILD_ID && !questionId.startsWith('[') ? questionId : JSON.stringify([childId, questionId])
}

/** 编码行显式留原题号；旧文件没有此字段时，键就是题号，绝不猜解 JSON。 */
export function flagQuestionId(key: string, entry: FlaggedEntry): string {
  return entry.questionId ?? key
}

export function flagEntry(questionId: string, entry: FlaggedEntry): FlaggedEntry {
  return flagKey(questionId, entry.childId) === questionId ? entry : { ...entry, questionId }
}
