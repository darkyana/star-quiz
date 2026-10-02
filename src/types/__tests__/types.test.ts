// R23-T1 / R24-T1：类型层契约测试（注释契约 REQ-R23-1-2；difficulty 与新状态类型 REQ-R24-1-1 / REQ-R24-2-1~2-2）
// R25-T2：DataExport flagged 字段 + version '1.1'（Spec 20260825-v0.7.1-R25 REQ-R25-6）
// R27-T1：QuestionResult / QuestionResultsState（Spec 20260825-v0.7.2-R27 REQ-R27-1-1）
// R36-T1：DataExport/LedgerExport 退役，LearningExport/EconomyExport 两组 2.0 契约（Spec 20260827-v0.10.0-R36 REQ-R36-1/2/7）
import { describe, it, expect, expectTypeOf } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type {
  Question,
  QuizSession,
  MoraleState,
  RecentWords,
  LearningExport,
  EconomyExport,
  FlaggedEntry,
  FlaggedState,
  QuestionResult,
  QuestionResultsState,
  ProposalRecord,
  ActiveRedemption,
} from '../index'

// vitest 从项目根运行（npm test / npx vitest run），以 cwd 锚定源文件
const typesSource = readFileSync(resolve(process.cwd(), 'src/types/index.ts'), 'utf-8')

/** 递归收集 src/ 源文件（.ts/.vue，跳过 __tests__），供退役类型零残留扫描 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|vue)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

// 退役类型名用拼接构造，避免本测试文件自身污染扫描目标（扫描已跳过 __tests__，双保险）
const RETIRED_TYPES = [['Data', 'Export'].join(''), ['Ledger', 'Export'].join('')]

describe('R23 类型注释契约（REQ-R23-1-2）', () => {
  it('Question.id 注释：6 位数字序号 + 值域 + 全局唯一 + 追加生成规则一句话', () => {
    expect(typesSource).toContain('6 位数字序号')
    expect(typesSource).toContain('\\d{6}')
    expect(typesSource).toContain('全局唯一')
    expect(typesSource).toContain('最大序号 + 1')
  })

  it('Question.wordId 可空，存在时兼作词级去重主键（#173）', () => {
    expectTypeOf<Question['wordId']>().toEqualTypeOf<string | undefined>()
    expect(typesSource).toContain('词级去重主键')
  })
})

describe('R24 类型契约（REQ-R24-1-1 / REQ-R24-2-1~2-2）', () => {
  it('Question.difficulty 可选，值域 1|2|3，缺省仍合法', () => {
    expectTypeOf<Question['difficulty']>().toEqualTypeOf<1 | 2 | 3 | undefined>()
    const withoutDifficulty: Question = {
      id: '000021',
      type: 'zh2en',
      prompt: 'p',
      options: ['a', 'b', 'c', 'd'],
      answerIndex: 0,
      wordId: 'w',
    }
    expect(withoutDifficulty.difficulty).toBeUndefined()
    const withDifficulty: Question = { ...withoutDifficulty, difficulty: 2 }
    expect(withDifficulty.difficulty).toBe(2)
  })

  it('MoraleState：level 为 1|2|3，lastRoundCorrect 为 number|null', () => {
    expectTypeOf<MoraleState['level']>().toEqualTypeOf<1 | 2 | 3>()
    expectTypeOf<MoraleState['lastRoundCorrect']>().toEqualTypeOf<number | null>()
    const initial: MoraleState = { level: 1, lastRoundCorrect: null }
    expect(initial).toEqual({ level: 1, lastRoundCorrect: null })
  })

  it('RecentWords：字符串数组，初始为空（#173）', () => {
    expectTypeOf<RecentWords>().toEqualTypeOf<string[]>()
    const initial: RecentWords = []
    expect(initial).toEqual([])
  })

  it('QuizSession 结构：既有 key + #103 mode + #181 scope + #289 starRule（均可选快照，存量兼容）', () => {
    expectTypeOf<keyof QuizSession>().toEqualTypeOf<
      | 'quizId'
      | 'status'
      | 'questions'
      | 'mode'
      | 'scope'
      | 'starRule'
      | 'currentIndex'
      | 'answers'
      | 'correctCount'
      | 'score'
      | 'earnedStars'
      | 'createdAt'
      | 'settledAt'
    >()
    // mode 可选：不传仍合法（存量 sq_session 反序列化兼容）
    const legacy: QuizSession = {
      quizId: 'q',
      status: 'in_progress',
      questions: [],
      currentIndex: 0,
      answers: [],
      correctCount: 0,
      createdAt: 1,
    }
    expect(legacy.mode).toBeUndefined()
    // #289 starRule 可选：不传仍合法（存量 sq_session 反序列化兼容）；带规则快照为门槛数组
    expect(legacy.starRule).toBeUndefined()
    const ruled: QuizSession = { ...legacy, starRule: [{ minAccuracy: 1, stars: 25 }] }
    expect(ruled.starRule).toEqual([{ minAccuracy: 1, stars: 25 }])
  })
})

describe('R25 类型契约（REQ-R25-4 / REQ-R25-6；#69 老板拍板删 correct）', () => {
  it('FlaggedEntry：仅 flaggedAt 为 number（是否标记 = 键存在与否）', () => {
    expectTypeOf<keyof FlaggedEntry>().toEqualTypeOf<'flaggedAt' | 'childId' | 'questionId'>()
    expectTypeOf<FlaggedEntry['flaggedAt']>().toEqualTypeOf<number>()
    const entry: FlaggedEntry = { flaggedAt: 1000 }
    expect(entry).toEqual({ flaggedAt: 1000 })
  })

  it('FlaggedState = Record<string, FlaggedEntry>', () => {
    expectTypeOf<FlaggedState>().toEqualTypeOf<Record<string, FlaggedEntry>>()
    const state: FlaggedState = { '000001': { flaggedAt: 1000 } }
    expect(state['000001'].flaggedAt).toBe(1000)
  })

  it('R36 退役：DataExport/LedgerExport 定义移除（源码零 interface 定义，R25 形状用例随断代删除）', () => {
    expect(typesSource).not.toMatch(/interface (Data|Ledger)Export/)
  })
})

describe('R27 类型契约（REQ-R27-1-1）', () => {
  it('QuestionResult：outcome 为三态字面量联合，timestamp 为 string（完整 ISO 8601）', () => {
    expectTypeOf<QuestionResult['outcome']>().toEqualTypeOf<'correct' | 'wrong' | 'skipped'>()
    expectTypeOf<QuestionResult['timestamp']>().toEqualTypeOf<string>()
    const entry: QuestionResult = { outcome: 'skipped', timestamp: '2026-08-25T00:00:00.000Z' }
    expect(entry.outcome).toBe('skipped')
  })

  it('QuestionResultsState = Record<string, QuestionResult[]>（key = questionId）', () => {
    expectTypeOf<QuestionResultsState>().toEqualTypeOf<Record<string, QuestionResult[]>>()
    const state: QuestionResultsState = {
      '000001': [{ outcome: 'correct', timestamp: '2026-08-25T00:00:00.000Z' }],
      '000002': [
        { outcome: 'wrong', timestamp: '2026-08-25T00:00:01.000Z' },
        { outcome: 'correct', timestamp: '2026-08-25T00:00:02.000Z' },
      ],
    }
    expect(state['000001']).toHaveLength(1)
    expect(state['000002']).toHaveLength(2)
  })
})

describe('R36 类型契约（REQ-R36-1 / REQ-R36-2 / REQ-R36-7，AC-R36-7-1）', () => {
  it('LearningExport：key 集合恰为五字段（version/exportedAt/questionPool/flagged/questionResults），version 恰为字面量 "2.0"', () => {
    expectTypeOf<keyof LearningExport>().toEqualTypeOf<
      'version' | 'exportedAt' | 'questionPool' | 'flagged' | 'questionResults'
    >()
    expectTypeOf<LearningExport['version']>().toEqualTypeOf<'2.0' | '3.0'>()
    expectTypeOf<LearningExport['questionPool']>().toEqualTypeOf<Question[]>()
    expectTypeOf<LearningExport['flagged']>().toEqualTypeOf<FlaggedState>()
    expectTypeOf<LearningExport['questionResults']>().toEqualTypeOf<QuestionResultsState>()
    const sample: LearningExport = {
      version: '2.0',
      exportedAt: '2026-08-27T00:00:00.000Z',
      questionPool: [],
      flagged: { '000001': { flaggedAt: 1000 } },
      questionResults: { '000001': [{ outcome: 'correct', timestamp: '2026-08-27T00:00:00.000Z' }] },
    }
    expect(sample.flagged['000001'].flaggedAt).toBe(1000)
    expect(sample.questionResults['000001'][0].outcome).toBe('correct')
    expect(sample.version).toBe('2.0')
  })

  it('EconomyExport：key 集合恰为六字段（version/exportedAt/rewards/proposals/starLedger/activeRedemptions），R32 起 version 联合 "2.0"|"2.1"、#75 起扩 "2.2"、proposals 为 ProposalRecord[]、activeRedemptions 为 ActiveRedemption[]', () => {
    expectTypeOf<keyof EconomyExport>().toEqualTypeOf<
      'version' | 'exportedAt' | 'rewards' | 'proposals' | 'starLedger' | 'activeRedemptions'
    >()
    expectTypeOf<EconomyExport['version']>().toEqualTypeOf<'2.0' | '2.1' | '2.2' | '2.3' | '2.4'>()
    expectTypeOf<EconomyExport['proposals']>().toEqualTypeOf<ProposalRecord[]>()
    expectTypeOf<EconomyExport['activeRedemptions']>().toEqualTypeOf<ActiveRedemption[]>()
    const sample: EconomyExport = {
      version: '2.2',
      exportedAt: '2026-08-27T00:00:00.000Z',
      rewards: [],
      proposals: [],
      starLedger: [],
      activeRedemptions: [],
    }
    expect(sample.proposals).toEqual([])
    expect(sample.activeRedemptions).toEqual([])
    expect(sample.version).toBe('2.2')
  })

  it('AC-R36-7-1 退役零残留：src/ 源码（跳过 __tests__）不出现 DataExport / LedgerExport 独立标识符，新类型已定义', () => {
    expect(typesSource).toContain('interface LearningExport')
    expect(typesSource).toContain('interface EconomyExport')
    const files = collectSourceFiles(resolve(process.cwd(), 'src'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      // \b 词边界：排除 downloadDataExport 等含同尾子串的合法标识符
      for (const retired of RETIRED_TYPES) {
        expect(new RegExp(`\\b${retired}\\b`).test(source), `${file} 含退役类型名 ${retired}`).toBe(false)
      }
    }
  })
})
