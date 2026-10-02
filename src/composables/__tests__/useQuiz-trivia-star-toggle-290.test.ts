/**
 * #290 惊喜得星开关（开局读取位）：关掉后新开的轮不写规则快照 = 零产星（即使题集带规则）；
 * 默认开 / 显式开 = 规则快照照写；进行中的轮按开局快照结算，中途改开关不打断；
 * 开关读取只发生在 startQuiz 一处——结算与结果页只读会话快照（孩子端对开关零感知）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { QuizSession } from '../../types'
import { adoptTriviaSet, triviaSetRef } from '../../data/trivia-set'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz, readSession, sessionEarnsStars } from '../useQuiz'
import { readTriviaStarEarns, writeTriviaStarEarns } from '../useTriviaStarToggle'
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

/** 答完一轮：前 correctCount 题答对，其余答错 */
function answerRound(session: QuizSession, correctCount: number): void {
  session.questions.forEach((q, i) => {
    answerQuiz(i < correctCount ? q.answerIndex : (q.answerIndex + 1) % 4)
  })
}

beforeEach(() => {
  localStorage.clear()
  adoptRuledSet()
})

describe('#290 得星开关开局读取', () => {
  it('默认开（未设置）：规则快照照写（#289 行为回归）', () => {
    expect(readTriviaStarEarns()).toBe(true)
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    expect(session.starRule).toEqual([{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }])
    expect(sessionEarnsStars(session)).toBe(true)
  })

  it('关掉后新开的轮零产星：会话不带 starRule，满分轮零流水零入账（即使题集带规则）', () => {
    writeTriviaStarEarns(false)
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    expect(session.starRule).toBeUndefined()
    expect(sessionEarnsStars(session)).toBe(false)
    answerRound(session, session.questions.length)
    finishQuiz()
    expect(readSession()!.earnedStars).toBe(0)
    expect(settleQuiz()).toBe('settled')
    expect(ledger()).toEqual([])
    expect(balance()).toBe(0)
  })

  it('关后再开（显式 true）：恢复规则快照', () => {
    writeTriviaStarEarns(false)
    writeTriviaStarEarns(true)
    expect(readTriviaStarEarns()).toBe(true)
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    expect(session.starRule).toEqual([{ minAccuracy: 0.7, stars: 5 }, { minAccuracy: 1, stars: 25 }])
  })

  it('进行中的轮不受中途改开关影响：开局时开、答完前关掉 → 仍按开局快照满额结算', () => {
    const session = startQuiz(mulberry32(1), RULED_SCOPE)!
    expect(session.starRule).toBeDefined()
    writeTriviaStarEarns(false) // 中途关掉：不打断进行中的轮
    answerRound(session, session.questions.length)
    finishQuiz()
    expect(readSession()!.earnedStars).toBe(25)
    expect(settleQuiz()).toBe('settled')
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ type: 'earn', amount: 25 })
  })
})
