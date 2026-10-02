/**
 * #289 惊喜得星规则（结算链路侧）：开局把现役题集 starRule 快照进会话（scope 类别名同源时）；
 * 结算只读快照——多档命中取最高一档、写一条「惊喜答题：{类别名}」流水、quizId 幂等、0 星零写入；
 * 换题集（快照后改规则/撤规则）不打断进行中的轮；旧会话无规则字段 = 不产星（#288 基线回归）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Question, QuizSession } from '../../types'
import { adoptTriviaSet, triviaSetRef } from '../../data/trivia-set'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz, readSession, sessionEarnsStars, starsForRule } from '../useQuiz'
import { writeQuestions } from '../useLearningData'
import { balance, ledger } from '../useStarData'
import { mulberry32 } from '../../utils/quizEngine'

const triviaSetJson = JSON.parse(readFileSync(resolve(process.cwd(), 'public/trivia/current/set.json'), 'utf8'))
/** 带规则现役题集：0.7→5 星、1.0→25 星（类别名沿现役 set.json，scope 同源命中） */
const RULED_SET = { ...triviaSetJson, starRule: [{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }] }
const RULED_SCOPE = { kind: 'trivia', category: triviaSetJson.category, book: triviaSetJson.book } as const

function adoptRuledSet(): void {
  triviaSetRef.value = null
  adoptTriviaSet(RULED_SET)
}

/** 答完一轮：前 correctCorrectCount 题答对，其余答错 */
function answerRound(session: QuizSession, correctCount: number): void {
  session.questions.forEach((q, i) => {
    answerQuiz(i < correctCount ? q.answerIndex : (q.answerIndex + 1) % 4)
  })
}

beforeEach(() => {
  localStorage.clear()
  adoptRuledSet()
})

describe('#289 规则折算（starsForRule 纯函数）', () => {
  const rule = [{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }]
  it('满分命中两档只取最高一档：1.0 → 25（不是 30）', () => {
    expect(starsForRule(rule, 10, 10)).toBe(25)
  })
  it('仅命中低档：0.9 → 5；未命中任何档：0', () => {
    expect(starsForRule(rule, 9, 10)).toBe(5)
    expect(starsForRule(rule, 6, 10)).toBe(0)
  })
})

describe('#289 开局快照', () => {
  it('惊喜轮开局把现役规则深拷贝快照进会话（改现役题集不影响已开局轮）', () => {
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    expect(session.starRule).toEqual([{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }])
    // 深拷贝验证：改快照不回写题集
    session.starRule![0].stars = 99
    expect(triviaSetRef.value!.starRule![0].stars).toBe(5)
    expect(sessionEarnsStars(session)).toBe(true)
  })

  it('无规则题集开局：会话不带 starRule（不产星，#288 回归）', () => {
    adoptTriviaSet(triviaSetJson)
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    expect(session.starRule).toBeUndefined()
    expect(sessionEarnsStars(session)).toBe(false)
  })

  it('学科轮开局：不写规则快照', () => {
    const subject: Question = { id: 'sub_0', category: RULED_SCOPE.category, book: RULED_SCOPE.book, type: 'zh2en', prompt: 'p', options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: 'w' }
    writeQuestions([subject])
    const session = startQuiz(mulberry32(1), { kind: 'subject', category: RULED_SCOPE.category, book: RULED_SCOPE.book })!
    expect(session.scope?.kind).toBe('subject')
    expect(session.starRule).toBeUndefined()
  })
})

describe('#289 按规则入账', () => {
  it('满分轮：earnedStars = 25（只取最高一档），单条流水「惊喜答题：{类别名}」，quizId 幂等', () => {
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    answerRound(session, session.questions.length)
    finishQuiz()
    const finished = readSession()!
    expect(finished.earnedStars).toBe(25)
    expect(settleQuiz()).toBe('settled')
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ type: 'earn', amount: 25, source: '惊喜答题：' + RULED_SCOPE.category, quizId: finished.quizId })
    expect(balance()).toBe(25)
    expect(settleQuiz()).toBe('idempotent')
    expect(ledger()).toHaveLength(1)
  })

  it('中档轮（命中 0.7 未达 1.0）：earnedStars = 5，单条流水 5 星', () => {
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    answerRound(session, Math.ceil(session.questions.length * 0.7))
    finishQuiz()
    expect(readSession()!.earnedStars).toBe(5)
    expect(settleQuiz()).toBe('settled')
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ amount: 5, source: '惊喜答题：' + RULED_SCOPE.category })
  })

  it('未命中任何档：earnedStars = 0，零流水零写入，幂等重结算不补写', () => {
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    answerRound(session, 0)
    finishQuiz()
    expect(readSession()!.earnedStars).toBe(0)
    expect(settleQuiz()).toBe('settled')
    expect(ledger()).toEqual([])
    expect(settleQuiz()).toBe('idempotent')
    expect(ledger()).toEqual([])
  })

  it('结算只读快照：开局后换规则（现役题集改档/撤规则）不影响本轮折算', () => {
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    // 换题集：规则改为一档 1.0→3（App 升级换主题的等价扰动）
    adoptTriviaSet({ ...triviaSetJson, starRule: [{ minAccuracy: 1, stars: 3 }] })
    answerRound(session, session.questions.length)
    finishQuiz()
    expect(readSession()!.earnedStars).toBe(25) // 仍按开局快照折算
    expect(settleQuiz()).toBe('settled')
    expect(ledger()[0]).toMatchObject({ amount: 25 })
  })
})

describe('#289 旧会话兼容', () => {
  it('旧惊喜会话无 starRule 字段：不产星（sessionEarnsStars false，#288 基线）', () => {
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    answerRound(session, session.questions.length)
    finishQuiz()
    // 模拟 #288 时代旧会话：删除字段后按旧会话结算
    const finished = readSession()!
    delete finished.starRule
    localStorage.setItem('sq_session', JSON.stringify(finished))
    expect(sessionEarnsStars(readSession()!)).toBe(false)
    expect(settleQuiz()).toBe('settled')
    expect(ledger()).toEqual([])
  })
})
