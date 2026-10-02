// #168 T-数据键收编与门禁：登记册元数据对照测试。
// 真相源：docs/data-keys.md 台账——本测试逐键断言 STORAGE_KEYS 全集 23 键（#170 增 sq_commit_sentinel、
// #171 增 sq_sync_reconcile、#174 增 sq_upgrade_backup / sq_sync_realign；#228 移除测试模式两键、
// #262 换 sq_entry_visibility 入口显隐键控记录）、KEY_META 每键「分类＋上云策略」两字段与台账一致；改键先改表。

import { describe, it, expect } from 'vitest'
import { STORAGE_KEYS, KEY_META } from '../useDataInfra'

/** 台账目标形态（docs/data-keys.md，一处一对照；改表时同步改此处） */
const LEDGER: Record<string, { category: string; cloud: string }> = {
  sq_questions: { category: '家底', cloud: '参与' },
  sq_flagged: { category: '家底', cloud: '参与' },
  sq_question_results: { category: '家底', cloud: '参与' },
  sq_stars: { category: '家底', cloud: '参与' },
  sq_rewards: { category: '家底', cloud: '参与' },
  sq_proposals: { category: '家底', cloud: '参与' },
  sq_active_redemptions: { category: '家底', cloud: '参与' },
  sq_morale: { category: '可弃先验', cloud: '参与' },
  sq_recent_words: { category: '可弃先验', cloud: '参与' },
  sq_entry_visibility: { category: '可弃先验', cloud: '参与' },
  sq_session: { category: '临时', cloud: '永不出本机' },
  sq_quiz_mode: { category: '临时', cloud: '永不出本机' },
  sq_data_version: { category: '机器自用', cloud: '永不出本机' },
  sq_last_export: { category: '机器自用', cloud: '永不出本机' },
  sq_device_credential: { category: '凭据', cloud: '服务端有档，键不参与同步' },
  sq_sync_cursor: { category: '机器自用（引擎）', cloud: '永不出本机' },
  sq_sync_shadow: { category: '机器自用（引擎）', cloud: '永不出本机' },
  sq_sync_outbox: { category: '机器自用（引擎）', cloud: '永不出本机' },
  sq_sync_bootstrapped: { category: '机器自用（引擎）', cloud: '永不出本机' },
  sq_sync_reconcile: { category: '机器自用（引擎）', cloud: '永不出本机' },
  sq_commit_sentinel: { category: '机器自用', cloud: '永不出本机' },
  sq_upgrade_backup: { category: '机器自用', cloud: '永不出本机' },
  sq_sync_realign: { category: '机器自用（引擎）', cloud: '永不出本机' },
}

describe('#168 登记册元数据（分类＋上云策略）与台账逐键一致', () => {
  it('STORAGE_KEYS 全集 = 台账 23 键（收编后无在册外键）', () => {
    const registered = Object.values(STORAGE_KEYS).sort()
    expect(registered).toEqual(Object.keys(LEDGER).sort())
  })

  it('每键在 KEY_META 中登记分类＋上云策略，取值与台账一致', () => {
    for (const key of Object.values(STORAGE_KEYS)) {
      const meta = KEY_META[key]
      expect(meta, `${key} 未登记 KEY_META`).toBeDefined()
      const ledger = LEDGER[key]
      expect(meta.category, `${key} 分类与台账不符`).toBe(ledger.category)
      expect(meta.cloud, `${key} 上云策略与台账不符`).toBe(ledger.cloud)
    }
  })

  it('7 个收编键不注册初始值（生命周期自管理，init 不初始化、不改变既有关键集合）', () => {
    // 键名层面断言收编完成：7 键字面量在册（readValue 兜底行为由既有 useDataInfra 套件把守）
    expect(STORAGE_KEYS.session).toBe('sq_session')
    expect(STORAGE_KEYS.quizMode).toBe('sq_quiz_mode')
    expect(STORAGE_KEYS.deviceCredential).toBe('sq_device_credential')
    expect(STORAGE_KEYS.syncCursor).toBe('sq_sync_cursor')
    expect(STORAGE_KEYS.syncShadow).toBe('sq_sync_shadow')
    expect(STORAGE_KEYS.syncOutbox).toBe('sq_sync_outbox')
    expect(STORAGE_KEYS.syncBootstrapped).toBe('sq_sync_bootstrapped')
  })
})
