/**
 * R32 提议键与迁移 5→6 专项（Spec 20260827-R32，AC-R32-9-1 ~ 4 / REQ-R32-6）+
 * useProposals 键读写骨架（load / save）往返。
 * 沿 useDataInfra-migrations.test.ts 断言口径：备份只看下载 spy 次数，版本一次到位。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, registerMigrationBackup } from '../useDataInfra'
// 提议域 useProposals 注册 sq_proposals 初始值与源版本 5 迁移；星星 / 学习域提供既有键与备份动作
import '../useProposals'
import '../useStarData'
import '../useLearningData'
import {
  proposals as readProposals,
  writeProposals,
  create,
  update,
  setAgreed,
  voidProposal,
  publish,
  publishGate,
  proposalEmoji,
} from '../useProposals'
import type { Question, StarEntry, RewardItem, ProposalRecord } from '../../types'

// mock useExport 下载函数：备份断言只关心调用次数（经济 + 学习各 1 次）。
// 剪环后备份注册上移组合根：测试扮演 main.ts 注册一次（与生产同构，架构评审 20260829）
vi.mock('../useExport', () => {
  const downloadDataExport = vi.fn()
  const downloadLedgerExport = vi.fn()
  return {
    downloadDataExport,
    downloadLedgerExport,
    runMigrationBackup: () => {
      try {
        downloadDataExport()
      } catch {
        // 备份失败不阻断迁移（与生产语义一致）
      }
      try {
        downloadLedgerExport()
      } catch {
        // 同上
      }
    },
  }
})
import { downloadDataExport, downloadLedgerExport, runMigrationBackup } from '../useExport'
const mockedDownloadData = vi.mocked(downloadDataExport)
const mockedDownloadLedger = vi.mocked(downloadLedgerExport)
registerMigrationBackup(runMigrationBackup)

beforeEach(() => {
  localStorage.clear()
  mockedDownloadData.mockClear()
  mockedDownloadLedger.mockClear()
})

/** 版本 5 口径的题池（6 位补零 id + difficulty 就位，迁移 1→4 链不应触碰） */
function makeV5Questions(count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1).padStart(6, '0'),
    type: 'zh2en',
    prompt: `第 ${i + 1} 题题干`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: i % 4,
    wordId: `word${i + 1}`,
    difficulty: 3,
  }))
}

function makeStars(count: number): StarEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    timestamp: 1724140800000 + i,
    type: 'earn',
    amount: 1,
    source: '答题得星',
  }))
}

function makeRewards(count: number): RewardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i + 1}`,
    name: `奖励${i + 1}`,
    price: 5 + i,
  }))
}

/** 落盘口径提议（不含派生字段 publishState） */
function makeProposalRecord(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: 'p1',
    name: '去游乐园',
    price: 20,
    status: 'discussing',
    createdAt: 1724140800000,
    updatedAt: 1724140800000,
    description: '',
    parentStatus: 'agreed',
    childStatus: 'notAgreed',
    initiator: 'parent',
    lastActionBy: 'parent',
    lastActionKind: 'proposed',
    ...overrides,
  }
}

/** 预置一套版本 5 的真实用户数据（既有三键就位、无 sq_proposals） */
function seedVersion5Data(): { questions: Question[]; stars: StarEntry[]; rewards: RewardItem[] } {
  const questions = makeV5Questions(3)
  const stars = makeStars(2)
  const rewards = makeRewards(3)
  localStorage.setItem('sq_data_version', '5')
  localStorage.setItem('sq_questions', JSON.stringify(questions))
  localStorage.setItem('sq_stars', JSON.stringify(stars))
  localStorage.setItem('sq_rewards', JSON.stringify(rewards))
  return { questions, stars, rewards }
}

describe('R32 数据层迁移 5→6（REQ-R32-6 / AC-R32-9）', () => {
  it('AC-R32-9-1 版本 "5" + 既有三键真实数据 + 无 sq_proposals → 备份恰好 2 次、sq_proposals "[]"、版本到位、既有三键条数与内容不变', () => {
    const seeded = seedVersion5Data()

    init()

    // 版本 6 首次升级触发自动备份（经济 + 学习两个文件各 1 次）
    expect(mockedDownloadData).toHaveBeenCalledTimes(1)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('sq_proposals')).toBe('[]')
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    // 既有三键内容保留；8→9 断代仅按 #173 形状物理补齐（题补大类/分册、流水补 kind/childId）
    expect(JSON.parse(localStorage.getItem('sq_questions') as string)).toEqual(
      seeded.questions.map((q) => ({ ...q, category: '学科', book: '默认' })),
    )
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(
      seeded.stars.map((s) => ({ ...s, kind: 'main', childId: 'default' })),
    )
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(seeded.rewards)
  })

  it('AC-R32-9-2 全新环境（无任何键）→ 版本到位、sq_proposals []、备份 0 次', () => {
    init()

    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)).toEqual([])
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
  })

  it('AC-R32-9-3 已是当前版本 9 且有提议（含归因字段）→ 再次 init 幂等：提议不变、备份 0 次（#173 起终值）', () => {
    const existing = [
      { ...makeProposalRecord(), lastActionBy: 'parent' as const, lastActionKind: 'proposed' as const },
      { ...makeProposalRecord({ id: 'p2', status: 'published' }), lastActionBy: 'parent' as const, lastActionKind: 'proposed' as const },
    ]
    localStorage.setItem('sq_data_version', '9')
    localStorage.setItem('sq_proposals', JSON.stringify(existing))

    init()

    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)).toEqual(existing)
    expect(localStorage.getItem('sq_data_version')).toBe('9')
    expect(mockedDownloadData).toHaveBeenCalledTimes(0)
    expect(mockedDownloadLedger).toHaveBeenCalledTimes(0)
  })

  it('AC-R32-9-4 sq_proposals 为损坏 JSON → init 不崩溃，读取兜底重置 []', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      localStorage.setItem('sq_data_version', '6')
      localStorage.setItem('sq_proposals', '{corrupted json')

      expect(() => init()).not.toThrow()

      expect(JSON.parse(localStorage.getItem('sq_proposals') as string)).toEqual([])
      expect(warnSpy).toHaveBeenCalled()
      expect(String(warnSpy.mock.calls[0][0])).toContain('sq_proposals')
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('R32 useProposals 键读写骨架（REQ-R32-6-4）', () => {
  it('writeProposals / proposals：整组写入读回一致且落盘 sq_proposals', () => {
    const list = [makeProposalRecord(), makeProposalRecord({ id: 'p2', name: '看电影', price: 10 })]

    writeProposals(list)

    expect(readProposals()).toEqual(list)
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)).toEqual(list)
  })

  it('proposals 键缺失 → 兜底初始值 [] 并落盘', () => {
    expect(readProposals()).toEqual([])
    expect(localStorage.getItem('sq_proposals')).toBe('[]')
  })
})

describe('R32 提议 CRUD + 发布（T3，REQ-R32-3-2/3-3、REQ-R32-5-4/5-5、REQ-R32-7-2~7-5）', () => {
  // 注入固定系统时刻使时间戳断言可预期（#265 后发布门禁与时间无关）
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('create：追加 1 条新提议——id 新生成、发起人 parent 自动同意、孩子未同意、整体沟通中、时间戳为写入时刻 number', () => {
    const existing = [makeProposalRecord()]
    writeProposals(existing)
    const before = Date.now()

    const created = create({ name: '看电影', price: 10, description: '周末去' })

    const after = Date.now()
    const list = readProposals()
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual(existing[0]) // 既有提议不变，新提议追加末尾
    expect(list.map((p) => p.id)).toContain(created.id)
    expect(created).toMatchObject({
      name: '看电影',
      price: 10,
      description: '周末去',
      initiator: 'parent',
      parentStatus: 'agreed', // 发起人自动同意（REQ-R32-3-2）
      childStatus: 'notAgreed',
      status: 'discussing',
    })
    expect(typeof created.createdAt).toBe('number')
    expect(created.createdAt).toBeGreaterThanOrEqual(before) // 写入时刻
    expect(created.createdAt).toBeLessThanOrEqual(after)
    expect(created.updatedAt).toBe(created.createdAt) // 同一写入时刻
  })

  it('update：非终态内容变更——内容更新、对方（孩子）重置未同意、改动方（家长）自动同意新版本（本例原本已同意，结果相同）、updatedAt 刷新、agreed 整体回 discussing', () => {
    const seeded = makeProposalRecord({ status: 'agreed', childStatus: 'agreed', updatedAt: 1000 })
    writeProposals([seeded])
    const before = Date.now()

    const ok = update('p1', { name: '去动物园', price: 15, description: '看熊猫' })

    const updated = readProposals()[0]
    expect(ok).toBe(true)
    expect(updated.name).toBe('去动物园')
    expect(updated.price).toBe(15)
    expect(updated.description).toBe('看熊猫')
    expect(updated.childStatus).toBe('notAgreed') // 另一方自动重置（REQ-R32-5-4 规则 2）
    expect(updated.parentStatus).toBe('agreed') // 改动方自动同意新版本（2026-08-30 拍板；本例原本已同意）
    expect(updated.status).toBe('discussing') // 重推导：agreed 编辑后回沟通中
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before) // 刷新
    expect(updated.updatedAt).toBeGreaterThan(1000)
    expect(updated.createdAt).toBe(seeded.createdAt) // 创建时间不变
  })

  it('update：改动方原本未同意（家长修订孩子的新提议）→ 修改后自动同意新版本，无需再点同意（2026-08-30 拍板）', () => {
    // 孩子新建：childStatus=agreed / parentStatus=notAgreed
    const seeded = makeProposalRecord({ parentStatus: 'notAgreed', childStatus: 'agreed', initiator: 'child', updatedAt: 1000 })
    writeProposals([seeded])

    const ok = update('p1', { name: '去动物园改', price: 15, description: '' }, 'parent')

    const updated = readProposals()[0]
    expect(ok).toBe(true)
    expect(updated.parentStatus).toBe('agreed') // 修改即认同自己改后的内容
    expect(updated.childStatus).toBe('notAgreed') // 孩子对新版本重新表态
    expect(updated.status).toBe('discussing')
  })

  it('最后动作归因（#63 2026-08-30）：create/update/setAgreed 各写入点维护 lastActionBy / lastActionKind', () => {
    // create：新建 → by=initiator / proposed
    const created = create({ name: '新提议', price: 3, description: '' }, { initiator: 'child' })
    expect(created.lastActionBy).toBe('child')
    expect(created.lastActionKind).toBe('proposed')

    // setAgreed：点头 / 收回 → agreed / rethought
    setAgreed(created.id, 'parent', true)
    expect(readProposals()[0]).toMatchObject({ lastActionBy: 'parent', lastActionKind: 'agreed' })
    setAgreed(created.id, 'parent', false)
    expect(readProposals()[0]).toMatchObject({ lastActionBy: 'parent', lastActionKind: 'rethought' })

    // update：修改 → by=changedBy / changed
    update(created.id, { name: '改名', price: 3, description: '' }, 'child')
    expect(readProposals()[0]).toMatchObject({ lastActionBy: 'child', lastActionKind: 'changed' })
  })

  it('update：终态提议（已发布 / 已作废）拒绝，零变更', () => {
    for (const status of ['published', 'voided'] as const) {
      const seeded = [makeProposalRecord({ status })]
      writeProposals(seeded)

      const ok = update('p1', { name: '改名', price: 1, description: '' })

      expect(ok).toBe(false)
      expect(readProposals()).toEqual(seeded)
    }
  })

  it('setAgreed（R34 改造自 setChildAgreed，语义等价）：双向切换孩子开关、整体状态随之推导；终态拒绝零变更', () => {
    // 沟通中（家长已同意、孩子未同意）→ 开 → 已达成一致
    writeProposals([makeProposalRecord()])
    expect(setAgreed('p1', 'child', true)).toBe(true)
    expect(readProposals()[0]).toMatchObject({ childStatus: 'agreed', status: 'agreed' })
    // 已达成一致 → 关 → 沟通中（双向切换，REQ-R32-5-5）
    expect(setAgreed('p1', 'child', false)).toBe(true)
    expect(readProposals()[0]).toMatchObject({ childStatus: 'notAgreed', status: 'discussing' })

    const seeded = [makeProposalRecord({ status: 'voided' })]
    writeProposals(seeded)
    expect(setAgreed('p1', 'child', true)).toBe(false)
    expect(readProposals()).toEqual(seeded)
  })

  it('voidProposal：非终态任意状态（discussing / agreed）→ 已作废终态；已终态拒绝零变更', () => {
    for (const from of ['discussing', 'agreed'] as const) {
      writeProposals([
        makeProposalRecord({ status: from, childStatus: from === 'agreed' ? 'agreed' : 'notAgreed' }),
      ])
      expect(voidProposal('p1')).toBe(true)
      expect(readProposals()[0].status).toBe('voided')
    }
    // 作废不可恢复：已终态（已发布 / 已作废）拒绝
    for (const status of ['published', 'voided'] as const) {
      const seeded = [makeProposalRecord({ status })]
      writeProposals(seeded)
      expect(voidProposal('p1')).toBe(false)
      expect(readProposals()).toEqual(seeded)
    }
  })

  it('publish：仅已达成一致可发布——sq_rewards 末尾追加新兑换项（新 id；#299 无 emoji 提议不落 emoji 键、读取侧兜底）、既有项逐字段不变、sq_stars 零写入、提议置已发布', () => {
    const seededRewards = makeRewards(2)
    localStorage.setItem('sq_rewards', JSON.stringify(seededRewards))
    const seededStars = makeStars(2)
    localStorage.setItem('sq_stars', JSON.stringify(seededStars))
    writeProposals([makeProposalRecord({ status: 'agreed', childStatus: 'agreed' })])

    const result = publish('p1')

    expect(result).toEqual({ ok: true })
    expect(readProposals()[0]).toMatchObject({
      status: 'published',
      parentStatus: 'agreed',
      childStatus: 'agreed', // 其余字段不变
    })
    const list = JSON.parse(localStorage.getItem('sq_rewards') as string) as RewardItem[]
    expect(list).toHaveLength(3)
    expect(list.slice(0, 2)).toEqual(seededRewards) // 既有项逐字段不变
    expect(list[2]).toEqual({ id: expect.any(String), name: '去游乐园', price: 20 }) // 精确匹配 = 无 emoji 提议发布不落 emoji 键（#299 读取侧兜底）
    expect(list[2].id).not.toBe('p1') // 新 id ≠ 提议 id
    expect(seededRewards.map((r) => r.id)).not.toContain(list[2].id) // ≠ 既有任一 id
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(seededStars) // 星星流水零写入
  })

  it('publish：任一方未同意或终态 → 拒绝零变更（proposals / rewards 全不动）', () => {
    const seededRewards = makeRewards(1)
    localStorage.setItem('sq_rewards', JSON.stringify(seededRewards))

    const blocked = [makeProposalRecord()] // 孩子未同意（沟通中）
    writeProposals(blocked)
    expect(publish('p1')).toEqual({ ok: false, reason: 'not_publishable' })
    expect(readProposals()).toEqual(blocked)

    const terminal = [makeProposalRecord({ status: 'published', childStatus: 'agreed' })]
    writeProposals(terminal)
    expect(publish('p1')).toEqual({ ok: false, reason: 'not_publishable' })
    expect(readProposals()).toEqual(terminal)

    expect(publish('nope')).toEqual({ ok: false, reason: 'not_found' })
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(seededRewards)
  })

  it('publish：同名兑换项允许并存——已含同名项时发布成功，两条 id 不同', () => {
    localStorage.setItem('sq_rewards', JSON.stringify([{ id: 'r-exist', name: '去游乐园', price: 20 }]))
    writeProposals([makeProposalRecord({ status: 'agreed', childStatus: 'agreed' })])

    expect(publish('p1')).toEqual({ ok: true })

    const list = JSON.parse(localStorage.getItem('sq_rewards') as string) as RewardItem[]
    expect(list).toHaveLength(2)
    expect(list.map((r) => r.name)).toEqual(['去游乐园', '去游乐园'])
    expect(list[0].id).not.toBe(list[1].id)
  })

  it('publish 校验 seam（REQ-R32-7-4）：注入拒绝 → 发布被拒、rewards 与提议状态零变更；校验函数收提议与现有兑换项；放行后发布成功', () => {
    const seededRewards = makeRewards(1)
    localStorage.setItem('sq_rewards', JSON.stringify(seededRewards))
    const seeded = [makeProposalRecord({ status: 'agreed', childStatus: 'agreed' })]
    writeProposals(seeded)

    const reject = vi.fn((_proposal: ProposalRecord, _rewards: RewardItem[]) => false)
    expect(publish('p1', { validate: reject })).toEqual({ ok: false, reason: 'rejected' })
    expect(reject).toHaveBeenCalledTimes(1)
    expect(reject.mock.calls[0][0]).toMatchObject({ id: 'p1', name: '去游乐园' })
    expect(reject.mock.calls[0][1]).toEqual(seededRewards)
    // 零变更
    expect(JSON.parse(localStorage.getItem('sq_rewards') as string)).toEqual(seededRewards)
    expect(readProposals()).toEqual(seeded)

    // seam 放行（与默认恒通过同语义）后发布成功
    const allow = vi.fn(() => true)
    expect(publish('p1', { validate: allow })).toEqual({ ok: true })
    expect(readProposals()[0].status).toBe('published')
  })
})

describe('#265 删发布窗口:发布门禁 = 发布门槛,任意时刻可发布', () => {
  it('门槛就绪(双方同意)本地 22:00 publish → ok: true 走既有发布语义:rewards 末尾追加新项、提议置已发布、星星流水零写入', () => {
    const seededRewards = makeRewards(1)
    localStorage.setItem('sq_rewards', JSON.stringify(seededRewards))
    const seededStars = makeStars(1)
    localStorage.setItem('sq_stars', JSON.stringify(seededStars))
    writeProposals([makeProposalRecord({ status: 'agreed', childStatus: 'agreed' })])

    vi.setSystemTime(new Date(2026, 0, 15, 22, 0, 0))
    const result = publish('p1')
    vi.useRealTimers()

    expect(result).toEqual({ ok: true })
    const rewardsAfter = JSON.parse(localStorage.getItem('sq_rewards') as string) as RewardItem[]
    expect(rewardsAfter).toHaveLength(2)
    expect(rewardsAfter[0]).toEqual(seededRewards[0]) // 既有项不变
    expect(rewardsAfter[1]).toEqual({ id: expect.any(String), name: '去游乐园', price: 20 }) // 末尾追加
    expect(readProposals()[0]).toMatchObject({ status: 'published' })
    expect(JSON.parse(localStorage.getItem('sq_stars') as string)).toEqual(seededStars) // 流水零写入
  })

  it('连续 publish 两条门槛就绪的提议 → 均成功(不限时刻、不限次数)', () => {
    writeProposals([
      makeProposalRecord({ id: 'p1', status: 'agreed', childStatus: 'agreed' }),
      makeProposalRecord({ id: 'p2', name: '看电影', price: 10, status: 'agreed', childStatus: 'agreed' }),
    ])

    const first = publish('p1')
    const second = publish('p2')

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(readProposals().map((p) => p.status)).toEqual(['published', 'published'])
  })
})

describe('#299 提议 emoji：落盘可选、修订即认同、发布携带、读取兜底', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 0, 15, 20, 30, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('create 带 emoji → 落盘记录携带该 emoji；不传 → 不落 emoji 键（零迁移）', () => {
    const created = create({ name: '吃冰淇淋', price: 5, description: '', emoji: '🍦' })
    expect(created.emoji).toBe('🍦')
    expect(readProposals()[0]).toMatchObject({ emoji: '🍦' })

    const plain = create({ name: '看电影', price: 10, description: '' })
    expect(plain.emoji).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)[1]).not.toHaveProperty('emoji')
  })

  it('update 只改 emoji → 与改名称同走修订即认同：改动方自动同意、对方重置未同意（单一语义无字段豁免）', () => {
    const seeded = makeProposalRecord({ status: 'agreed', childStatus: 'agreed', emoji: '🎁' })
    writeProposals([seeded])

    const ok = update('p1', { name: seeded.name, price: seeded.price, description: seeded.description, emoji: '🍕' }, 'child')

    const updated = readProposals()[0]
    expect(ok).toBe(true)
    expect(updated.emoji).toBe('🍕')
    expect(updated.childStatus).toBe('agreed') // 修改方自动同意
    expect(updated.parentStatus).toBe('notAgreed') // 对方重置
    expect(updated.status).toBe('discussing')
    expect(updated.lastActionKind).toBe('changed')
  })

  it('publish 携带提议 emoji → 新兑换项 emoji 同值（#299 废除「发布不设 emoji」旧行为）', () => {
    const seededRewards = makeRewards(1)
    localStorage.setItem('sq_rewards', JSON.stringify(seededRewards))
    writeProposals([makeProposalRecord({ status: 'agreed', childStatus: 'agreed', emoji: '🦄' })])

    expect(publish('p1')).toEqual({ ok: true })

    const list = JSON.parse(localStorage.getItem('sq_rewards') as string) as RewardItem[]
    expect(list[1]).toEqual({ id: expect.any(String), name: '去游乐园', price: 20, emoji: '🦄' })
  })

  it('proposalEmoji：存量提议无 emoji → 读取兜底 🎁（proposalEmoji 单一出口，无迁移代码）', () => {
    writeProposals([makeProposalRecord()])
    expect(proposalEmoji(readProposals()[0])).toBe('🎁')
    expect(proposalEmoji(makeProposalRecord({ emoji: '🏆' }))).toBe('🏆')
    // 存量行读取不物理补键
    expect(JSON.parse(localStorage.getItem('sq_proposals') as string)[0]).not.toHaveProperty('emoji')
  })
})

describe('发布门禁 publishGate(CONTEXT.md:发布门禁 = 发布门槛,与时间无关;#265)', () => {
  const agreed = makeProposalRecord({ status: 'agreed', childStatus: 'agreed' })

  it('门槛已过(双方同意、非终态)→ { allowed: true },与本地时刻无关', () => {
    expect(publishGate(agreed)).toEqual({ allowed: true })
    vi.setSystemTime(new Date(2026, 0, 15, 22, 0, 0))
    try {
      expect(publishGate(agreed)).toEqual({ allowed: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('门槛未过(孩子未同意)→ { allowed: false, reason: "not_publishable" }', () => {
    const notAgreed = makeProposalRecord()
    expect(publishGate(notAgreed)).toEqual({
      allowed: false,
      reason: 'not_publishable',
    })
  })

  it('门槛未过(终态:已发布 / 已作废)→ { allowed: false, reason: "not_publishable" }', () => {
    for (const status of ['published', 'voided'] as const) {
      expect(publishGate(makeProposalRecord({ status, childStatus: 'agreed' }))).toEqual({
        allowed: false,
        reason: 'not_publishable',
      })
    }
  })
})
