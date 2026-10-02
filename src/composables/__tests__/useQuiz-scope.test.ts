import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Question, QuizSession } from '../../types'
// #287 内置题集改经资产槽位加载：默认注入现役 set.json（模拟冷启动预热成功）
import { adoptTriviaSet, triviaSetRef } from '../../data/trivia-set'
import { startQuiz, answerQuiz, finishQuiz, settleQuiz, readSession, abandonQuiz, clearSession } from '../useQuiz'
import { writeQuestions, questions as readQuestions, questionResults, recentWords, morale, writeMorale, writeRecentWords, wordAppearances, writeFlagged } from '../useLearningData'
import { balance } from '../useStarData'
import { applyLearningImport } from '../useImport'
import { readQuizMode, writeQuizMode } from '../useQuizMode'
import { mulberry32 } from '../../utils/quizEngine'

function question(id: string, category = 'Think', book = 'level1', type: Question['type'] = 'zh2en'): Question {
  return { id, category, book, type, prompt: id, options: ['yes', 'no', 'maybe', 'never'], answerIndex: 0, wordId: id, difficulty: 1 }
}

const triviaSetJson = JSON.parse(readFileSync(resolve(process.cwd(), 'public/trivia/current/set.json'), 'utf8'))

beforeEach(() => {
  localStorage.clear()
  triviaSetRef.value = null
  adoptTriviaSet(triviaSetJson)
})

describe('#181 分册公开会话链路', () => {
  it.each(['fresh', 'wrong'] as const)('%s 优先及补位只在范围内，放弃后的三态记录不跨孩子也不赚星', (mode) => {
    const scope = { kind: 'subject', category: 'Think', book: 'level1' } as const
    writeQuestions([question('wrong'), question('correct'), question('new')])
    const preparation = startQuiz(mulberry32(1), scope)!
    for (const q of preparation.questions) answerQuiz(q.id === 'new' ? null : q.id === 'correct' ? q.answerIndex : (q.answerIndex + 1) % 4)
    abandonQuiz()
    expect(balance()).toBe(0)
    expect(questionResults('other')).toEqual({})
    writeQuestions([question('wrong'), question('correct'), question('new'), question('foreign-new', 'Think', 'level2'), question('900002', 'Think', 'level1', 'trivia')])
    writeQuizMode(mode)
    const round = startQuiz(mulberry32(2), scope)!
    expect(round.questions.map(q => q.id).sort()).toEqual(['correct', 'new', 'wrong'])
    expect(round.questions[0].id).toBe(mode === 'fresh' ? 'new' : 'wrong')
    for (const q of round.questions) answerQuiz(q.answerIndex)
    finishQuiz()
    expect(settleQuiz()).toBe('settled')
    expect(balance()).toBe(6)
    expect(morale().lastRoundCorrect).toBeNull()
    expect(recentWords().sort()).toEqual(['correct', 'new', 'wrong'])
    expect(questionResults().new.map(r => r.outcome)).toEqual(['correct', 'skipped'])
  })

  it('惊喜会话固定新题优先（#272：偏好记忆拆除，无可写模式），组卷记入会话；#288 无规则轮零产星、逐题记录照写', () => {
    writeQuestions([question('900001', 'Think', 'level1', 'trivia')])
    const session = startQuiz(mulberry32(1), { kind: 'trivia', category: 'Think', book: 'level1' })!
    expect(session.mode).toBe('fresh')
    expect(readSession()?.mode).toBe('fresh')
    answerQuiz(session.questions[0].answerIndex)
    finishQuiz()
    settleQuiz()
    expect(balance()).toBe(0)
    expect(questionResults()['900001']).toHaveLength(1)
  })

  it('学科重考同一分册仍刷新 appearance 事件时刻，其他孩子事实不变', () => {
    writeQuestions([question('a')])
    writeRecentWords(['other-word'], 'other')
    const otherBefore = wordAppearances().filter(r => r.childId === 'other')
    const play = () => {
      const session = startQuiz(mulberry32(1))!
      answerQuiz(session.questions[0].answerIndex)
      finishQuiz()
      settleQuiz()
      clearSession()
    }
    play()
    const before = wordAppearances().find(r => r.wordId === 'a')!.appearedAt
    play()
    expect(wordAppearances().find(r => r.wordId === 'a')!.appearedAt).toBeGreaterThan(before)
    expect(wordAppearances().filter(r => r.childId === 'other')).toEqual(otherBefore)
    expect(recentWords()).toEqual(['a'])
  })
  it('无显式范围的新题优先入口跳过全红旗默认分册，选一个实际可答学科分册', () => {
    writeQuizMode('fresh')
    writeQuestions([question('default', '学科', '默认'), question('a'), question('b', 'Think', 'level2')])
    writeFlagged({ default: { flaggedAt: 1 } })
    expect(startQuiz(mulberry32(1))?.questions.map(q => q.id)).toEqual(['a'])
    expect(startQuiz(mulberry32(1), { kind: 'subject', category: '学科', book: '默认' })).toBeNull()
  })
  it('旧惊喜会话 normal 保守归一 fresh，不套用学科偏好；恢复结算不写先验', () => {
    writeQuizMode('wrong')
    const legacy: QuizSession = { quizId: 'old-trivia', status: 'in_progress', mode: 'normal', questions: [question('900005', '任意名字', '任意分册', 'trivia')], currentIndex: 0, answers: [], correctCount: 0, createdAt: 1 }
    localStorage.setItem('sq_session', JSON.stringify(legacy))
    expect(readSession()?.mode).toBe('fresh')
    answerQuiz(0)
    finishQuiz()
    expect(settleQuiz()).toBe('settled')
    expect(recentWords()).toEqual([])
    expect(morale().lastRoundCorrect).toBeNull()
    expect(questionResults()['900005'][0].outcome).toBe('correct')
    expect(readQuizMode()).toBe('wrong')
  })
  it.each([
    [question('a'), question('b', 'Think', 'level2')],
    [question('a'), question('b', '小学')],
    [question('a'), question('900006', 'Think', 'level1', 'trivia')],
    [],
  ])('旧会话混分册/大类/类型或空题快照按非法会话清理，不继续答题或入账 %#', (...questions) => {
    const legacy: QuizSession = { quizId: 'invalid', status: 'pending', questions, currentIndex: questions.length, answers: [], correctCount: 0, createdAt: 1 }
    localStorage.setItem('sq_session', JSON.stringify(legacy))
    expect(readSession()).toBeNull()
    expect(settleQuiz()).toBe('redirect')
    expect(balance()).toBe(0)
    expect(questionResults()).toEqual({})
  })
  it('旧无 scope 会话从题目快照推断固定范围，不依赖刷新后的题池', () => {
    const legacy: QuizSession = { quizId: 'old', status: 'in_progress', questions: [question('a')], currentIndex: 0, answers: [], correctCount: 0, createdAt: 1 }
    localStorage.setItem('sq_session', JSON.stringify(legacy))
    writeQuestions([question('replacement', '学科', '默认')])
    expect(readSession()?.scope).toEqual({ kind: 'subject', category: 'Think', book: 'level1' })
    answerQuiz(0)
    finishQuiz()
    expect(settleQuiz()).toBe('settled')
    expect(questionResults().a[0].outcome).toBe('correct')
    expect(balance()).toBe(4)
  })
  it.each(['fresh', 'wrong'] as const)('%s 显式范围全红旗视为空候选：不借其他分册、不创建零题满分会话', (mode) => {
    writeQuizMode(mode)
    writeQuestions([question('a'), question('other', 'Think', 'level2')])
    writeFlagged({ a: { flaggedAt: 1 } })
    expect(startQuiz(mulberry32(1), { kind: 'subject', category: 'Think', book: 'level1' })).toBeNull()
    expect(readSession()).toBeNull()
    finishQuiz()
    expect(settleQuiz()).toBe('redirect')
    expect(balance()).toBe(0)
  })
  it.each(['fresh', 'wrong'] as const)('惊喜 %s 结算：有无错误 wordId 均不污染任何孩子的先验，#288 无规则轮零产星且保留最近5次', (mode) => {
    writeMorale({ level: 2, lastRoundCorrect: 8 })
    writeMorale({ level: 3, lastRoundCorrect: 10, childId: 'other' })
    writeRecentWords(['old'])
    writeRecentWords(['other-word'], 'other')
    const beforeWords = wordAppearances()
    const beforeMorale = morale()
    const noWord = question('900008', '我的世界', '初阶', 'trivia')
    delete noWord.wordId
    writeQuestions([question('900007', '我的世界', '初阶', 'trivia'), noWord, question('subject', '我的世界', '初阶')])
    const triviaScope = { kind: 'trivia', category: '我的世界', book: '初阶' } as const
    // #272：新开局固定 fresh；wrong 轮只可能来自旧惊喜会话（保守归一只纠 normal，wrong 快照保留）
    const startRound = mode === 'fresh'
      ? (round: number) => startQuiz(mulberry32(round), triviaScope)!
      : () => {
          const legacy: QuizSession = { quizId: `legacy-wrong-${Math.random()}`, status: 'in_progress', mode: 'wrong', questions: [question('900007', '我的世界', '初阶', 'trivia'), noWord], currentIndex: 0, answers: [], correctCount: 0, createdAt: 1 }
          localStorage.setItem('sq_session', JSON.stringify(legacy))
          return readSession()!
        }
    for (let round = 0; round < 6; round++) {
      const session = startRound(round)!
      expect(session.questions.map(q => q.id).sort()).toEqual(['900007', '900008'])
      for (const q of session.questions) answerQuiz(q.answerIndex)
      finishQuiz()
      expect(settleQuiz()).toBe('settled')
      expect(settleQuiz()).toBe('idempotent')
    }
    expect(wordAppearances()).toEqual(beforeWords)
    expect(morale()).toEqual(beforeMorale)
    expect(morale('other')).toEqual({ level: 3, lastRoundCorrect: 10, childId: 'other' })
    expect(questionResults()['900007']).toHaveLength(5)
    expect(questionResults()['900008']).toHaveLength(5)
    expect(balance()).toBe(0)
  })
  it('惊喜会话固定 fresh：不读学科偏好；旧按 kind 落盘的对象形状按非法值删键回 normal（#272 拆除）', () => {
    writeQuestions([question('a'), question('900001', 'Think', 'level1', 'trivia')])
    const scope = { kind: 'trivia', category: 'Think', book: 'level1' } as const
    // 学科偏好（含旧真实落盘标量）对惊喜开局零影响
    localStorage.setItem('sq_quiz_mode', JSON.stringify('wrong'))
    expect(startQuiz(mulberry32(1), scope)?.mode).toBe('fresh')
    expect(readQuizMode()).toBe('wrong')
    // 旧按 kind 分流的对象形状（{subject,trivia}）：拆除后读作非法值 → 删键回 normal，学科偏好保守归一
    localStorage.setItem('sq_quiz_mode', JSON.stringify({ subject: 'fresh', trivia: 'wrong' }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readQuizMode()).toBe('normal')
    expect(localStorage.getItem('sq_quiz_mode')).toBeNull()
    warnSpy.mockRestore()
    expect(startQuiz(mulberry32(1))?.mode).toBe('normal')
    // 惊喜开局照常固定 fresh，且不写任何模式偏好
    expect(startQuiz(mulberry32(1), scope)?.mode).toBe('fresh')
    expect(localStorage.getItem('sq_quiz_mode')).toBeNull()
  })
  it('旧开始入口优先默认分册，否则仅选一个可用学科分册；显式空范围绝不回退', () => {
    // #234 起 9 号段经导入整次拒收：惊喜归属题只经 writeQuestions 直写构造，导入文件不含 9 号段
    const surprise = question('900004', 'Think', 'level1', 'trivia')
    const imported = [question('a'), question('b'), question('other', 'Think', 'level2')]
    writeQuestions([surprise, ...imported, question('default', '学科', '默认')])
    expect(startQuiz(mulberry32(1))?.questions.map(q => q.id)).toEqual(['default'])
    expect(applyLearningImport({ version: '3.0', exportedAt: '2026-09-07T00:00:00.000Z', questionPool: imported, flagged: {}, questionResults: {} }, 'overwrite').ok).toBe(true)
    expect(startQuiz(mulberry32(1))?.questions.map(q => q.id).sort()).toEqual(['a', 'b'])
    expect(startQuiz(mulberry32(1), { kind: 'subject', category: '学科', book: '默认' })).toBeNull()
    expect(startQuiz(mulberry32(1), { kind: 'subject', category: '', book: '' })).toBeNull()
    writeQuestions([surprise])
    expect(startQuiz(mulberry32(1))).toBeNull()
  })
  it('来源即身份（#234）：9 号段进惊喜会话，trivia 形式但学科段照归学科会话', () => {
    writeQuestions([
      question('900011', 'Think', 'level1'),
      question('trivia-form', 'Think', 'level1', 'trivia'),
      question('900012', 'Think', 'level1', 'trivia'),
    ])
    const triviaRound = startQuiz(mulberry32(1), { kind: 'trivia', category: 'Think', book: 'level1' })!
    expect(triviaRound.scope).toEqual({ kind: 'trivia', category: 'Think', book: 'level1' })
    expect(triviaRound.questions.map(q => q.id).sort()).toEqual(['900011', '900012'])
    // 默认学科入口不因内置段改道：可选学科分册只含学科段题（trivia 形式照常在列）
    const subjectRound = startQuiz(mulberry32(1))!
    expect(subjectRound.scope).toEqual({ kind: 'subject', category: 'Think', book: 'level1' })
    expect(subjectRound.questions.map(q => q.id)).toEqual(['trivia-form'])
  })
  it('内置集并入惊喜调度（#234）：显式内置分册零题池也能开考，结算同规、不写任何用户题池键', () => {
    writeQuestions([]) // 用户题池清空：惊喜会话只靠内置集
    const scope = { kind: 'trivia', category: triviaSetJson.category, book: triviaSetJson.book } as const
    const session = startQuiz(mulberry32(1), scope)!
    expect(session.scope).toEqual(scope)
    expect(session.mode).toBe('fresh') // 惊喜缺省新题优先
    const ids = session.questions.map(q => q.id)
    expect(ids.every(id => /^9\d{5}$/.test(id))).toBe(true)
    expect(ids.length).toBeGreaterThan(0)
    for (const q of session.questions) answerQuiz(q.answerIndex)
    finishQuiz()
    expect(settleQuiz()).toBe('settled')
    // 内置题不落用户题池；逐题记录照写（惊喜题与普通题同规）
    expect(readQuestions()).toEqual([])
    for (const id of ids) expect(questionResults()[id]).toHaveLength(1)
  })
  it('指定大类与分册：短轮不跨范围补位，恢复后作答结算只记录范围内题', () => {
    writeQuestions([question('a'), question('b'), question('other-book', 'Think', 'level2'), question('other-category', '小学'), question('900004', 'Think', 'level1', 'trivia')])
    const session = startQuiz(mulberry32(1), { kind: 'subject', category: 'Think', book: 'level1' })!
    expect(session.questions.map(q => q.id).sort()).toEqual(['a', 'b'])
    expect(session.scope).toEqual({ kind: 'subject', category: 'Think', book: 'level1' })
    answerQuiz(session.questions[0].answerIndex)
    // 导入替换题池不改变已开局快照；恢复只通过公开读取。
    writeQuestions([question('replacement', '小学', '三年级')])
    const restored = readSession()!
    expect(restored.scope).toEqual(session.scope)
    expect(restored.currentIndex).toBe(1)
    answerQuiz(restored.questions[1].answerIndex)
    finishQuiz()
    expect(settleQuiz()).toBe('settled')
    expect(readSession()?.status).toBe('settled')
    expect(Object.keys(questionResults()).sort()).toEqual(['a', 'b'])
    expect(recentWords().sort()).toEqual(['a', 'b'])
    expect(morale().lastRoundCorrect).toBe(2)
    expect(balance()).toBe(5)
    expect(settleQuiz()).toBe('idempotent')
    expect(balance()).toBe(5)
  })
})
