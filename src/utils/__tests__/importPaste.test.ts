/**
 * #212 粘贴导入剥壳纯函数单测（拆自 #137，二次 grill 决议 2026-09-08 拍死四规则）：
 * ① 先找 ``` 代码块取内容，多个取第一个；② 无代码块取第一个 { 到最后一个 } 的子串；
 * ③ JSON.parse 失败零修复原子拒绝（走文件导入同口径错误链路 file-corrupt）；
 * ④ 代码块非 JSON 不回落 {…} 兜底，直接拒。
 * 已知边界（老板接受，测试钉住）：双段独立 JSON 且无代码块 → 贪心子串含解释文字 → 必拒。
 * 无可剥内容（空白 / 纯解释文字）→ 新码 no-json；剥壳成功后校验转接 validateLearningImport（既有码透传）。
 */
import { describe, it, expect } from 'vitest'
import type { Question } from '../../types'
import { validateLearningImport, validateLearningPasteImport } from '../importExport'
import { copy } from '../../copy'

const NOW = '2026-08-27T10:30:00.000Z'

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'zh2en',
    prompt: '火车',
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 0,
    wordId: 'train',
    ...overrides,
  }
}

function validLearningJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: NOW,
    questionPool: [makeQuestion(), makeQuestion({ id: 'q2', wordId: 'bus' })],
    flagged: {},
    questionResults: {},
    ...overrides,
  })
}

describe('#212 剥壳四规则：成功三形态', () => {
  it('纯 JSON（无壳）通过，输出与 validateLearningImport 同形 Validation', () => {
    const raw = validLearningJson()
    expect(validateLearningPasteImport(raw)).toEqual(validateLearningImport(raw))
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(true)
  })

  it('``` 代码块包裹通过（规则①）', () => {
    const raw = '```\n' + validLearningJson() + '\n```'
    expect(validateLearningPasteImport(raw)).toEqual(validateLearningImport(validLearningJson()))
  })

  it('带语言标注的围栏（```json）通过', () => {
    const raw = '```json\n' + validLearningJson() + '\n```'
    expect(validateLearningPasteImport(raw)).toEqual(validateLearningImport(validLearningJson()))
  })

  it('前后带解释文字（无代码块，规则②贪心子串）通过', () => {
    const json = validLearningJson()
    const raw = `好的，这是给你出的题目，直接导入即可：\n${json}\n\n希望对你有帮助，有需要可以让我调整难度。`
    expect(validateLearningPasteImport(raw)).toEqual(validateLearningImport(json))
  })

  it('合法数据完整通过（可选字段 difficulty / category / book / flagged / questionResults 全量转接）', () => {
    const json = JSON.stringify({
      version: '3.0',
      exportedAt: NOW,
      questionPool: [
        { ...makeQuestion(), difficulty: 2, category: '学科', book: '默认' },
        makeQuestion({ id: 'q2', wordId: undefined }),
      ],
      flagged: { q1: { flaggedAt: 1000 } },
      questionResults: { q1: [{ outcome: 'correct', timestamp: '2026-08-25T10:00:00.000Z' }] },
    })
    expect(validateLearningPasteImport(json)).toEqual(validateLearningImport(json))
  })
})

describe('#212 剥壳四规则：代码块选取', () => {
  it('多个代码块取第一个（规则①）', () => {
    const first = validLearningJson()
    const second = validLearningJson({ questionPool: [makeQuestion({ id: 'other', prompt: '干扰项' })] })
    const raw = `第一段：\n\`\`\`json\n${first}\n\`\`\`\n第二段别用：\n\`\`\`json\n${second}\n\`\`\``
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(true)
    expect(result).toEqual(validateLearningImport(first))
  })

  it('代码块非 JSON 不回落 {…} 兜底（规则④）：围栏外有合法 JSON 也必拒', () => {
    const raw = [
      '```json',
      '这不是 JSON，我只是把说明文字放进了代码块',
      '```',
      '参考下面的合法数据：',
      validLearningJson(),
    ].join('\n')
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // 规则③：parse 失败走文件导入同口径错误链路（file-corrupt），不做任何修复
      expect(result.code).toBe('file-corrupt')
    }
  })

  it('未闭合围栏不算代码块：落规则②贪心子串（保守解释，钉住行为）', () => {
    const json = validLearningJson()
    const raw = '```json\n' + json + '\n后面忘了闭合围栏'
    expect(validateLearningPasteImport(raw)).toEqual(validateLearningImport(json))
  })
})

describe('#212 剥壳四规则：零修复必拒', () => {
  it('双段独立 JSON 且无代码块 → 贪心子串含解释文字 → 必拒（已知边界，老板接受）', () => {
    const first = validLearningJson()
    const second = validLearningJson({ questionPool: [makeQuestion({ id: 'q9' })] })
    const raw = `${first}\n\n以上是第一批，下面还有一批：\n\n${second}`
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('file-corrupt')
  })

  it('剥壳后 JSON 解析失败（截断的 JSON）必拒，零修复', () => {
    const raw = `以下是题目：\n${validLearningJson().slice(0, -20)}...（后面被截断了）`
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('file-corrupt')
  })
})

describe('#212 剥壳失败：新码 no-json', () => {
  it('空白输入必拒并出 no-json（文案「未在粘贴内容中找到有效 JSON」）', () => {
    for (const raw of ['', '   ', '\n\t\n  \n']) {
      const result = validateLearningPasteImport(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('no-json')
        expect(result.reason).toBe(copy.parent.importPasteNoJson)
        expect(result.reason).toBe('未在粘贴内容中找到有效 JSON')
      }
    }
  })

  it('纯解释文字（无花括号）必拒并出 no-json', () => {
    const raw = '抱歉，我刚才没有生成题目，你可以再问一次。'
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('no-json')
      expect(result.reason).toBe(copy.parent.importPasteNoJson)
    }
  })

  it('解释文字含普通括号但无花括号 → no-json（不误判）', () => {
    const result = validateLearningPasteImport('说明文字（含中文括号）与 [方括号数组] 都不是对象')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no-json')
  })
})

describe('#212 剥壳成功后校验转接：既有码透传', () => {
  it('JSON 合法但字段非法 → invalid 透传', () => {
    // answerIndex 故意给字符串（非法值）——独立字面量构造绕开 Partial<Question> 类型约束（照 19 号验收先例）
    const badPool = [makeQuestion(), { ...makeQuestion({ id: 'q2' }), answerIndex: '1' }]
    const raw = JSON.stringify({
      version: '2.0',
      exportedAt: NOW,
      questionPool: badPool,
      flagged: {},
      questionResults: {},
    })
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid')
  })

  it('版本断代（1.x）→ version-unsupported 透传（文案走 copy 槽位）', () => {
    const raw = `\`\`\`json\n${validLearningJson({ version: '1.2' })}\n\`\`\``
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('version-unsupported')
      expect(result.reason).toBe(copy.parent.importVersionTooOld)
    }
  })

  it('根不是对象（代码块里放 JSON 数组）→ file-corrupt 透传（同口径，零修复）', () => {
    const raw = '```json\n[1, 2, 3]\n```'
    const result = validateLearningPasteImport(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('file-corrupt')
  })
})
