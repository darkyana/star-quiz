/**
 * AC7 内置题库加载（当前题库 = AI 出题 20 题，数据源 docs/questions/questions.json）
 * 期望数据 = docs/questions/questions.json（六字段全量深比较），来自数据契约文档，非实现源码。
 */
import { describe, it, expect, vi } from 'vitest'
import { currentQuestionBank } from '../../src/data/current-questions'
import { init as initAppState } from '../../src/composables/useDataInfra'
import '../../src/composables/useLearningData'

// 期望数据 = docs/questions/questions.json（2026-08-21，AI 出题第 1 波 20 题），六字段契约
const expectedQuestions = [
  { id: '000001', type: 'zh2en', prompt: '主持人', options: ['scientist', 'winner', 'member', 'presenter'], answerIndex: 3, wordId: 'presenter' },
  { id: '000002', type: 'zh2en', prompt: '大象', options: ['monkey', 'rabbit', 'elephant', 'pig'], answerIndex: 2, wordId: 'elephant' },
  { id: '000003', type: 'zh2en', prompt: '危险的', options: ['dirty', 'boring', 'ugly', 'dangerous'], answerIndex: 3, wordId: 'dangerous' },
  { id: '000004', type: 'zh2en', prompt: '旅程', options: ['shape', 'steam', 'journey', 'danger'], answerIndex: 2, wordId: 'journey' },
  { id: '000005', type: 'zh2en', prompt: '科学家', options: ['presenter', 'member', 'winner', 'scientist'], answerIndex: 3, wordId: 'scientist' },
  { id: '000006', type: 'zh2en', prompt: '自动扶梯', options: ['ferry', 'escalator', 'train', 'taxi'], answerIndex: 1, wordId: 'escalator' },
  { id: '000007', type: 'zh2en', prompt: '污染', options: ['grow', 'pollute', 'shout', 'dive'], answerIndex: 1, wordId: 'pollute' },
  { id: '000008', type: 'en2zh', prompt: 'ferry', options: ['快艇', '潜水艇', '渡轮', '蒸汽'], answerIndex: 2, wordId: 'ferry' },
  { id: '000009', type: 'en2zh', prompt: 'winner', options: ['主持人', '获胜者', '科学家', '形状'], answerIndex: 1, wordId: 'winner' },
  { id: '000010', type: 'en2zh', prompt: 'comfortable', options: ['危险的', '聪明的', '舒适的', '有趣的'], answerIndex: 2, wordId: 'comfortable' },
  { id: '000011', type: 'en2zh', prompt: 'snake', options: ['鸟', '鸡', '兔', '蛇'], answerIndex: 3, wordId: 'snake' },
  { id: '000012', type: 'en2zh', prompt: 'circle', options: ['形状', '圆圈', '事故', '危险'], answerIndex: 1, wordId: 'circle' },
  { id: '000013', type: 'en2zh', prompt: 'steam', options: ['旅程', '危险', '形状', '蒸汽'], answerIndex: 3, wordId: 'steam' },
  { id: '000014', type: 'en2zh', prompt: 'grow', options: ['抓住', '喊叫', '成长', '污染'], answerIndex: 2, wordId: 'grow' },
  { id: '000015', type: 'cloze', prompt: 'The dolphins ___ with him for another hour.', options: ['went', 'swam', 'took', 'saw'], answerIndex: 1, wordId: 'swam' },
  { id: '000016', type: 'cloze', prompt: 'She ___ to take a course in philosophy.', options: ['forgot', 'fell', 'kept', 'decided'], answerIndex: 3, wordId: 'decided' },
  { id: '000017', type: 'cloze', prompt: "Take the ___ to the third floor and it's the last office on the left.", options: ['ferry', 'taxi', 'escalator', 'train'], answerIndex: 2, wordId: 'escalator' },
  { id: '000018', type: 'cloze', prompt: 'We stop ___ at maturity.', options: ['diving', 'shouting', 'joining', 'growing'], answerIndex: 3, wordId: 'growing' },
  { id: '000019', type: 'cloze', prompt: 'He was very nearly ___.', options: ['grew', 'caught', 'swam', 'wrote'], answerIndex: 1, wordId: 'caught' },
  { id: '000020', type: 'cloze', prompt: 'There is an express service from Paris that completes the ___ to Bordeaux in under 4 hours.', options: ['ferry', 'steam', 'accident', 'journey'], answerIndex: 3, wordId: 'journey' },
] as const

describe('AC7 内置题库加载', () => {
  it('AC7-1 数据模块结构：QuestionBank、20 题、id 全局唯一、题型覆盖三值', () => {
    expect(currentQuestionBank.questions).toHaveLength(20)
    const ids = new Set(currentQuestionBank.questions.map((q) => q.id))
    expect(ids.size).toBe(20)
    const types = new Set(currentQuestionBank.questions.map((q) => q.type))
    expect(types.has('zh2en')).toBe(true)
    expect(types.has('en2zh')).toBe(true)
    expect(types.has('cloze')).toBe(true)
  })

  it('AC7-2 内容与 docs/questions/questions.json 逐题一致：六字段全量深比较', () => {
    const actual = currentQuestionBank.questions.map(({ id, type, prompt, options, answerIndex, wordId }) => ({
      id,
      type,
      prompt,
      options,
      answerIndex,
      wordId,
    }))
    expect(actual).toEqual(expectedQuestions)
  })

  it('AC7-4 加载零网络请求（A1）：应用启动（含题库加载）fetch 零调用', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      localStorage.clear()
      initAppState()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
