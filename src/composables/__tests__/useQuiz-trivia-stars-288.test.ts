/**
 * #288 惊喜答题默认不产星（结算链路侧）：无规则轮零 earn 流水、会话零得星；
 * 幂等重结算与中途放弃零写入；逐题答题记录照写、临场状态与近期已测词不写（既有跳过回归）；
 * 学科轮得星行为回归（byte-identical 口径：earnedStars 公式 / 流水条数不变）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Question } from '../../types'
// #287 内置题集经资产槽位加载：默认注入现役 set.json（与冷启动预热同构）
import { adoptTriviaSet, triviaSetRef } from '../../data/trivia-set'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz, abandonQuiz, readSession } from '../useQuiz'
import { writeQuestions, questionResults, morale, recentWords } from '../useLearningData'
import { balance, ledger } from '../useStarData'
import { mulberry32 } from '../../utils/quizEngine'

function question(id: string, type: Question['type'] = 'zh2en'): Question {
  return { id, category: 'Think', book: 'level1', type, prompt: id, options: ['yes', 'no', 'maybe', 'never'], answerIndex: 0, wordId: id, difficulty: 1 }
}

const triviaSetJson = JSON.parse(readFileSync(resolve(process.cwd(), 'public/trivia/current/set.json'), 'utf8'))

beforeEach(() => {
  localStorage.clear()
  triviaSetRef.value = null
  adoptTriviaSet(triviaSetJson)
})

describe('#288 无规则惊喜轮：零流水、零得星', () => {
  it('全对轮：earnedStars 恒 0，结算零 earn 流水，幂等重结算不补写；逐题答题记录照写', () => {
    writeQuestions([question('900001', 'trivia'), question('900002', 'trivia'), question('900003', 'trivia')])
    const session = startQuiz(mulberry32(1), { kind: 'trivia', category: 'Think', book: 'level1' })!
    for (const q of session.questions) answerQuiz(q.answerIndex)
    finishQuiz()
    const finished = readSession()!
    expect(finished.correctCount).toBe(finished.questions.length) // 全对前提成立
    expect(finished.earnedStars).toBe(0)
    expect(settleQuiz()).toBe('settled')
    expect(ledger()).toEqual([])
    expect(balance()).toBe(0)
    expect(settleQuiz()).toBe('idempotent')
    expect(ledger()).toEqual([])
    for (const q of session.questions) {
      expect(questionResults()[q.id]).toHaveLength(1)
      expect(questionResults()[q.id][0].outcome).toBe('correct')
    }
  })

  it('中途放弃：零流水零得星，已答逐题记录照写，会话删除', () => {
    writeQuestions([question('900004', 'trivia'), question('900005', 'trivia')])
    const session = startQuiz(mulberry32(1), { kind: 'trivia', category: 'Think', book: 'level1' })!
    answerQuiz(session.questions[0].answerIndex)
    abandonQuiz()
    expect(balance()).toBe(0)
    expect(ledger()).toEqual([])
    expect(questionResults()[session.questions[0].id]).toHaveLength(1)
    expect(readSession()).toBeNull()
  })

  it('惊喜轮不写学科临场状态与近期已测词（#181 既有跳过回归）', () => {
    const moraleBefore = morale()
    const recentBefore = recentWords()
    writeQuestions([question('900006', 'trivia')])
    const session = startQuiz(mulberry32(1), { kind: 'trivia', category: 'Think', book: 'level1' })!
    answerQuiz(session.questions[0].answerIndex)
    finishQuiz()
    settleQuiz()
    expect(morale()).toEqual(moraleBefore)
    expect(recentWords()).toEqual(recentBefore)
  })
})

describe('#288 学科轮回归：得星行为不变', () => {
  it('全对轮：earnedStars = 答对数 + 3，流水两条（答题得星 + 满分奖励），临场状态写回', () => {
    writeQuestions(Array.from({ length: 10 }, (_, i) => question(`sub_${i}`)))
    const session = startQuiz(mulberry32(1), { kind: 'subject', category: 'Think', book: 'level1' })!
    for (const q of session.questions) answerQuiz(q.answerIndex)
    finishQuiz()
    const finished = readSession()!
    expect(finished.earnedStars).toBe(finished.questions.length + 3)
    expect(settleQuiz()).toBe('settled')
    const entries = ledger()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: 'earn', amount: finished.questions.length, source: '答题得星' })
    expect(entries[1]).toMatchObject({ type: 'earn', amount: 3, source: '满分奖励' })
    expect(balance()).toBe(finished.questions.length + 3)
    expect(morale().lastRoundCorrect).toBe(finished.questions.length)
  })
})
