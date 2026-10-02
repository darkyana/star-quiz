import { describe, it, expect, vi, beforeEach } from 'vitest'
import { currentQuestionBank } from '../current-questions'
import { init as initAppState } from '../../composables/useDataInfra'
import '../../composables/useLearningData'

beforeEach(() => {
  localStorage.clear()
})

describe('内置当前题库（AI 出题 20 题）', () => {
  it('AC7-1 结构：QuestionBank 类型、20 题、id 全局唯一、题型覆盖三种', () => {
    expect(currentQuestionBank.questions).toHaveLength(20)
    const ids = currentQuestionBank.questions.map((q) => q.id)
    expect(new Set(ids).size).toBe(20)
    const types = new Set(currentQuestionBank.questions.map((q) => q.type))
    expect(types.has('zh2en')).toBe(true)
    expect(types.has('en2zh')).toBe(true)
    expect(types.has('cloze')).toBe(true)
  })

  it('AC7-2 内容与 docs/questions/questions.json 一致：抽查关键题与题型', () => {
    const q1 = currentQuestionBank.questions[0]
    expect(q1.id).toBe('000001')
    expect(q1.prompt).toBe('主持人')
    expect(q1.options).toEqual(['scientist', 'winner', 'member', 'presenter'])
    expect(q1.answerIndex).toBe(3)
    const cloze = currentQuestionBank.questions.find((q) => q.type === 'cloze')
    expect(cloze).toBeDefined()
    expect(cloze?.prompt).toContain('___')
  })

  // R23 重编号基线（REQ-R23-2-2 / REQ-R23-2-3）：五字段 + 题库元数据快照，重编号只许改 id
  const baselineFields = [
    { type: 'zh2en', prompt: '主持人', options: ['scientist', 'winner', 'member', 'presenter'], answerIndex: 3, wordId: 'presenter' },
    { type: 'zh2en', prompt: '大象', options: ['monkey', 'rabbit', 'elephant', 'pig'], answerIndex: 2, wordId: 'elephant' },
    { type: 'zh2en', prompt: '危险的', options: ['dirty', 'boring', 'ugly', 'dangerous'], answerIndex: 3, wordId: 'dangerous' },
    { type: 'zh2en', prompt: '旅程', options: ['shape', 'steam', 'journey', 'danger'], answerIndex: 2, wordId: 'journey' },
    { type: 'zh2en', prompt: '科学家', options: ['presenter', 'member', 'winner', 'scientist'], answerIndex: 3, wordId: 'scientist' },
    { type: 'zh2en', prompt: '自动扶梯', options: ['ferry', 'escalator', 'train', 'taxi'], answerIndex: 1, wordId: 'escalator' },
    { type: 'zh2en', prompt: '污染', options: ['grow', 'pollute', 'shout', 'dive'], answerIndex: 1, wordId: 'pollute' },
    { type: 'en2zh', prompt: 'ferry', options: ['快艇', '潜水艇', '渡轮', '蒸汽'], answerIndex: 2, wordId: 'ferry' },
    { type: 'en2zh', prompt: 'winner', options: ['主持人', '获胜者', '科学家', '形状'], answerIndex: 1, wordId: 'winner' },
    { type: 'en2zh', prompt: 'comfortable', options: ['危险的', '聪明的', '舒适的', '有趣的'], answerIndex: 2, wordId: 'comfortable' },
    { type: 'en2zh', prompt: 'snake', options: ['鸟', '鸡', '兔', '蛇'], answerIndex: 3, wordId: 'snake' },
    { type: 'en2zh', prompt: 'circle', options: ['形状', '圆圈', '事故', '危险'], answerIndex: 1, wordId: 'circle' },
    { type: 'en2zh', prompt: 'steam', options: ['旅程', '危险', '形状', '蒸汽'], answerIndex: 3, wordId: 'steam' },
    { type: 'en2zh', prompt: 'grow', options: ['抓住', '喊叫', '成长', '污染'], answerIndex: 2, wordId: 'grow' },
    { type: 'cloze', prompt: 'The dolphins ___ with him for another hour.', options: ['went', 'swam', 'took', 'saw'], answerIndex: 1, wordId: 'swam' },
    { type: 'cloze', prompt: 'She ___ to take a course in philosophy.', options: ['forgot', 'fell', 'kept', 'decided'], answerIndex: 3, wordId: 'decided' },
    { type: 'cloze', prompt: "Take the ___ to the third floor and it's the last office on the left.", options: ['ferry', 'taxi', 'escalator', 'train'], answerIndex: 2, wordId: 'escalator' },
    { type: 'cloze', prompt: 'We stop ___ at maturity.', options: ['diving', 'shouting', 'joining', 'growing'], answerIndex: 3, wordId: 'growing' },
    { type: 'cloze', prompt: 'He was very nearly ___.', options: ['grew', 'caught', 'swam', 'wrote'], answerIndex: 1, wordId: 'caught' },
    { type: 'cloze', prompt: 'There is an express service from Paris that completes the ___ to Bordeaux in under 4 hours.', options: ['ferry', 'steam', 'accident', 'journey'], answerIndex: 3, wordId: 'journey' },
  ] as const

  it('AC-R23-1-1/1-2 重编号：20 题 id 按数组顺序为 000001~000020，全部匹配 /^\d{6}$/', () => {
    const expectedIds = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(6, '0'))
    expect(currentQuestionBank.questions.map((q) => q.id)).toEqual(expectedIds)
    for (const q of currentQuestionBank.questions) {
      expect(q.id).toMatch(/^\d{6}$/)
    }
  })

  it('AC-R23-1-2 其余字段零改动：type/prompt/options/answerIndex/wordId 逐题与基线相同', () => {
    const actualFields = currentQuestionBank.questions.map(({ type, prompt, options, answerIndex, wordId }) => ({
      type,
      prompt,
      options,
      answerIndex,
      wordId,
    }))
    expect(actualFields).toEqual(baselineFields)
  })

  it('AC-R23-2-3 题库元数据不变：version / generatedAt 保持原值', () => {
    expect(currentQuestionBank.version).toBe('1.0')
    expect(currentQuestionBank.generatedAt).toBe('2026-08-21')
  })

  it('AC7-3 首次启动将 currentQuestionBank.questions 写入 sq_questions（#173 起物理带大类/分册学科初始归类）', () => {
    initAppState()
    const stored = JSON.parse(localStorage.getItem('sq_questions') as string)
    expect(stored).toEqual(
      currentQuestionBank.questions.map((q) => ({ ...q, category: '学科', book: '默认' })),
    )
  })

  it('AC7-4 加载零网络请求', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    initAppState()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

// ===== R23-T3：旧 id 字面量清零守卫（AC-R23-5-1）=====
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// 拼接构造旧首题 id，避免守卫文件自身命中
const LEGACY_FIRST_ID = ['presenter', '001'].join('_')

function collectSourceFiles(dir: string, exts: readonly string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full, exts))
    } else if (exts.some((ext) => name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

describe('R23 旧 id 引用清零（AC-R23-5-1）', () => {
  it('旧首题 id 字面量在全库 src/ 与 tests/ 零命中', () => {
    const roots = [resolve(process.cwd(), 'src'), resolve(process.cwd(), 'tests')]
    const files = roots.flatMap((root) => collectSourceFiles(root, ['.ts', '.vue']))
    const offenders = files.filter((f) => readFileSync(f, 'utf-8').includes(LEGACY_FIRST_ID))
    expect(offenders).toEqual([])
  })
})
