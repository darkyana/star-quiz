// #321 家长通知已读账单一出口单测（spec #319 T2，先例照 useEntryVisibility.test.ts）：
// 读-写-未读-已读往返；键缺席 = 未读；只显式写才落账；写入广播写监听 → 响应式 ref 跟随；
// 携带新键（parent-guide:<id>）的记录经既有 entry_visibility 域行级 LWW 同步合并后往返仍成立
// （即云同步链路对这一形状零改动，证伪「必须新建同步域」）。
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isParentGuideNotificationRead,
  markParentGuideNotificationRead,
  readParentGuideReadIds,
  useParentGuideReadIds,
} from '../useParentGuideReadLedger'
import { readEntryVisibilityMap, writeEntryVisibilityValue, writeEntryVisibilityMap } from '../useEntryVisibility'
import { diffEntryVisibility, mergeEntryVisibility, type EntryVisibilityRow } from '../../cloud/merge'
import { STORAGE_KEYS, init } from '../useDataInfra'

beforeEach(() => {
  localStorage.clear()
  init()
})

describe('#321 家长通知已读账（键缺席 = 未读，只有显式写才落账）', () => {
  it('未写 / 键缺失 = 未读；写后 = 已读；各通知独立互不串扰', () => {
    expect(isParentGuideNotificationRead('questions')).toBe(false)
    markParentGuideNotificationRead('questions')
    expect(isParentGuideNotificationRead('questions')).toBe(true)
    expect(isParentGuideNotificationRead('rewards')).toBe(false)
    expect(isParentGuideNotificationRead('family')).toBe(false)
    expect(readParentGuideReadIds()).toEqual(new Set(['questions']))
  })

  it('已读集合快照与响应式 ref：本地「知道了」写入即时跟随', () => {
    const readIds = useParentGuideReadIds()
    expect(readIds.value).toEqual(new Set())
    markParentGuideNotificationRead('rewards')
    markParentGuideNotificationRead('family')
    expect(readIds.value).toEqual(new Set(['rewards', 'family']))
  })

  it('记录损坏兜底：读取回退未读，不抛（最坏情况 = 通知重新显示为未读）', () => {
    markParentGuideNotificationRead('questions')
    localStorage.setItem(STORAGE_KEYS.entryVisibility, '{oops')
    expect(isParentGuideNotificationRead('questions')).toBe(false)
    expect(readParentGuideReadIds()).toEqual(new Set())
  })

  it('不串扰既有显隐键：已读账键与 builtin-trivia:star 同域共存，显隐读数不受影响', () => {
    writeEntryVisibilityValue('builtin-trivia', true)
    markParentGuideNotificationRead('questions')
    const map = readEntryVisibilityMap()
    expect(map['builtin-trivia']).toBe(true)
    expect(map['parent-guide:questions']).toBe(true)
    // 键缺席 = 未读；显隐语义与本账语义各走各的读路径
    expect(isParentGuideNotificationRead('family')).toBe(false)
  })
})

describe('#321 已读账搭既有 entry_visibility 域（行级 LWW，云侧零改动）', () => {
  it('推侧 diff：新键照常出行（任意业务键 + 布尔值），与既有显隐键同行不互相干扰', () => {
    markParentGuideNotificationRead('questions')
    writeEntryVisibilityValue('builtin-trivia', true)
    const rows = diffEntryVisibility(readEntryVisibilityMap(), [], 1_800_000_000_000, 'device-a')
    const ids = rows.map(row => row.entry_id)
    expect(ids).toContain('parent-guide:questions')
    expect(ids).toContain('builtin-trivia')
    expect(rows.find(row => row.entry_id === 'parent-guide:questions')).toMatchObject({ visible: 1 })
  })

  it('拉侧合并：另一台设备写的新键行落地后，本机读取照常已读（家庭级往返成立）', () => {
    markParentGuideNotificationRead('questions')
    // 模拟家庭同步拉合：远端行（含另一设备写的 parent-guide:rewards）经既有行级 LWW 合并落库
    const remoteRows: EntryVisibilityRow[] = [
      { entry_id: 'parent-guide:rewards', visible: 1, updated_at: 1_800_000_000_100, updated_by: 'device-b' },
      { entry_id: 'parent-guide:family', visible: 1, updated_at: 1_800_000_000_050, updated_by: 'device-b' },
    ]
    const outcome = mergeEntryVisibility(readEntryVisibilityMap(), remoteRows, [])
    writeEntryVisibilityMap(outcome.next)
    expect(isParentGuideNotificationRead('questions')).toBe(true)
    expect(isParentGuideNotificationRead('rewards')).toBe(true)
    expect(isParentGuideNotificationRead('family')).toBe(true)
    expect(readParentGuideReadIds()).toEqual(new Set(['questions', 'rewards', 'family']))
  })
})
