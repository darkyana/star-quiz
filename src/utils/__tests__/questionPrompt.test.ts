/**
 * 出题指令生成纯函数（#136）：模板资产截取 / 占位符替换 / 三参数校验。
 * 模板单一真相源 = docs/question-tool/prompt.md（构建时 ?raw 打包，改模板重构建即生效）。
 */
import { describe, it, expect } from 'vitest'
import promptRaw from '../../../docs/question-tool/prompt.md?raw'
import {
  PROMPT_BODY_START,
  CONTENT_FALLBACK,
  COUNT_MIN,
  COUNT_MAX,
  extractPromptBody,
  validateQuestionPrompt,
  buildQuestionPrompt,
} from '../questionPrompt'

describe('模板资产契约（docs/question-tool/prompt.md）', () => {
  it('含截取标记 PROMPT_BODY_START；规模行为单占位符：有【题目总数】、无【N】与「个目标词」', () => {
    expect(promptRaw).toContain(PROMPT_BODY_START)
    const body = extractPromptBody(promptRaw)
    expect(body).not.toBeNull()
    expect(body!).toContain('共约【题目总数】题')
    expect(body!).not.toContain('【N】')
    expect(body!).not.toContain('个目标词')
    // 三个占位符齐备（学习者 / 主题 / 题数）
    expect(body!).toMatch(/【年级\/水平[^】]*】/)
    expect(body!).toMatch(/【如：[^】]*】/)
  })
})

describe('extractPromptBody：从标记后截到文末', () => {
  it('标记之后的正文 trim 返回，头部用法说明被丢弃', () => {
    const raw = '# 头部说明\n\n用法：把下方分隔线之后的全文复制给任意 AI。\n\n---\n\n<!-- PROMPT_BODY_START -->\n\n你是一名老师。\n\n## 任务\n'
    expect(extractPromptBody(raw)).toBe('你是一名老师。\n\n## 任务')
  })

  it('无标记 → null（模板资产损坏，页面按 template-broken 提示）', () => {
    expect(extractPromptBody('# 没有标记的文档')).toBeNull()
  })
})

describe('validateQuestionPrompt：三参数校验（必填 / ≤100 字 / 20–600 整数）', () => {
  it('合法输入 → ok 且回传 trim 归一化值与题数', () => {
    const result = validateQuestionPrompt('  小学三年级  ', '人教版 PEP 四年级上册 Unit 1–3', '200')
    expect(result).toEqual({ ok: true, level: '小学三年级', content: '人教版 PEP 四年级上册 Unit 1–3', count: 200 })
  })

  it('边界：题数 20 与 600 合法', () => {
    expect(validateQuestionPrompt('三年级', '四年级上册词表', String(COUNT_MIN)).ok).toBe(true)
    expect(validateQuestionPrompt('三年级', '四年级上册词表', String(COUNT_MAX)).ok).toBe(true)
  })

  it('文本边界：恰好 100 字合法', () => {
    const hundred = 'a'.repeat(100)
    expect(validateQuestionPrompt(hundred, hundred, '200').ok).toBe(true)
  })

  it('必填为空（含纯空白）→ level-required / count-required；内容可留空（#138）', () => {
    expect(validateQuestionPrompt('   ', '词表', '200')).toEqual({ ok: false, reason: 'level-required' })
    expect(validateQuestionPrompt('三年级', '词表', '')).toEqual({ ok: false, reason: 'count-required' })
    expect(validateQuestionPrompt('三年级', '词表', '   ')).toEqual({ ok: false, reason: 'count-required' })
  })

  it('#138 内容留空（含纯空白）→ 合法，content 归一化为空串（材料直发外部 AI 场景）', () => {
    expect(validateQuestionPrompt('三年级', '', '200')).toEqual({ ok: true, level: '三年级', content: '', count: 200 })
    expect(validateQuestionPrompt('三年级', '   ', '200').ok).toBe(true)
  })

  it('超 100 字 → level-too-long / content-too-long', () => {
    const hundredAndOne = 'a'.repeat(101)
    expect(validateQuestionPrompt(hundredAndOne, '词表', '200')).toEqual({ ok: false, reason: 'level-too-long' })
    expect(validateQuestionPrompt('三年级', hundredAndOne, '200')).toEqual({ ok: false, reason: 'content-too-long' })
  })

  it('题数非整数 / 非数字 / 越界 19 与 601 → count-invalid', () => {
    for (const bad of ['12.5', 'abc', '-20', '0x10', '19', '601', '1e3']) {
      const result = validateQuestionPrompt('三年级', '词表', bad)
      expect(result, `题数 ${bad} 应拒绝`).toEqual({ ok: false, reason: 'count-invalid' })
    }
  })
})

describe('buildQuestionPrompt：校验 + 截取 + 占位符全替换', () => {
  it('真实模板生成：含用户三值、无残留【】、不含头部用法说明', () => {
    const result = buildQuestionPrompt('小学三年级，剑桥少儿英语 Starters 水平', '人教版 PEP 四年级上册 Unit 1–3', '150')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prompt).toContain('小学三年级，剑桥少儿英语 Starters 水平')
    expect(result.prompt).toContain('人教版 PEP 四年级上册 Unit 1–3')
    expect(result.prompt).toContain('共约150题')
    // 占位符零残留（模板占位符全部替换）
    expect(result.prompt).not.toContain('【')
    expect(result.prompt).not.toContain('】')
    // 截取生效：给家长看的用法头部不入指令
    expect(result.prompt).not.toContain('把下方分隔线之后的全文复制给任意 AI')
    expect(result.prompt).toContain('你是一名资深小学英语老师')
  })

  it('用户输入中自带的【按内容原样保留（不是模板占位符残留）', () => {
    const result = buildQuestionPrompt('三年级【尖子班】', '四年级词表', '200')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prompt).toContain('三年级【尖子班】')
  })

  it('#138 内容留空 → 「主题/词表」槽位注入材料兜底句，指令无【】残留', () => {
    const result = buildQuestionPrompt('小学三年级', '', '100')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prompt).toContain(CONTENT_FALLBACK)
    expect(result.prompt).not.toContain('【')
    expect(result.prompt).not.toContain('】')
  })

  it('#138 内容留空生成走纯空白输入同口径（trim 归一化后判空注入兜底句）', () => {
    const result = buildQuestionPrompt('小学三年级', '   ', '100')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prompt).toContain(CONTENT_FALLBACK)
  })

  it('校验不过 → 原样返回校验错误原因，不进入生成', () => {
    expect(buildQuestionPrompt('', '词表', '200')).toEqual({ ok: false, reason: 'level-required' })
    expect(buildQuestionPrompt('三年级', '词表', '19')).toEqual({ ok: false, reason: 'count-invalid' })
  })

  it('模板缺截取标记 → template-broken（资产损坏防御，不产出指令）', () => {
    const result = buildQuestionPrompt('三年级', '词表', '200', '# 无标记文档')
    expect(result).toEqual({ ok: false, reason: 'template-broken' })
  })

  it('模板含未知占位符（剥离三已知占位符后仍有【】）→ template-broken', () => {
    const raw = [
      '<!-- PROMPT_BODY_START -->',
      '你是一名老师。',
      '- 学习者：【年级/水平，如：三年级】',
      '- 主题：【如：四年级词表】',
      '- 规模：共约【题目总数】题',
      '- 附加：【神秘占位符】',
    ].join('\n')
    const result = buildQuestionPrompt('三年级', '词表', '200', raw)
    expect(result).toEqual({ ok: false, reason: 'template-broken' })
  })
})
