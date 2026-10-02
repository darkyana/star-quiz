// 出题指令生成纯函数（#136）：模板资产 = docs/question-tool/prompt.md（构建时 ?raw 打包，
// 单一真相源——改模板重新构建即生效）；本模块只做截取 / 校验 / 占位符替换，页面只做交互编排。
import promptRaw from '../../docs/question-tool/prompt.md?raw'

/** 截取标记：用法说明头部与指令正文的分界（构建从标记后截到文末，丢弃给家长看的头部说明） */
export const PROMPT_BODY_START = '<!-- PROMPT_BODY_START -->'

/** 输入上限与题数边界（票内拍板：文本 ≤100 字；题数 20–600 整数——AI 出题太多质量会差） */
export const LEVEL_MAX = 100
export const CONTENT_MAX = 100
export const COUNT_MIN = 20
export const COUNT_MAX = 600
/** 表单默认题数（2026-09-09 老板拍板 60：与「建议生成 100 题以下」提示口径一致，原 200 与建议线矛盾） */
export const COUNT_DEFAULT = 60

/**
 * #138 内容留空兜底句（#219 拍板措辞）：家长把 PDF/图片等原始材料直接发给外部 AI 的场景，
 * 「主题/词表」槽位注入此句引导 AI 先从材料提炼词表——与模板「忠于词表」条款闭环。
 */
export const CONTENT_FALLBACK =
  '出题范围以我随本条指令附上的原始材料为准：请先从材料中提炼目标词表，再按词表出题'

/** 校验失败原因（页面按 reason 映射 copy.parent.questionPrompt 文案；#138 起内容可留空，无 content-required） */
export type QuestionPromptInvalidReason =
  | 'level-required'
  | 'level-too-long'
  | 'content-too-long'
  | 'count-required'
  | 'count-invalid'

export type QuestionPromptValidation =
  | { ok: true; level: string; content: string; count: number }
  | { ok: false; reason: QuestionPromptInvalidReason }

/** 生成失败原因 = 校验原因 ∪ 模板资产损坏（缺截取标记 / 含未知占位符） */
export type QuestionPromptBuildReason = QuestionPromptInvalidReason | 'template-broken'

/** 截取指令正文：取标记之后到文末并 trim；无标记 → null */
export function extractPromptBody(raw: string): string | null {
  const idx = raw.indexOf(PROMPT_BODY_START)
  if (idx === -1) return null
  return raw.slice(idx + PROMPT_BODY_START.length).trim()
}

/** 校验三参数（trim 后判水平/题数必填；#138 内容可留空、填写时限 ≤100 字；题数须 20–600 整数），通过则回传归一化值 */
export function validateQuestionPrompt(level: string, content: string, countText: string): QuestionPromptValidation {
  const levelTrimmed = level.trim()
  const contentTrimmed = content.trim()
  const countTrimmed = countText.trim()
  if (levelTrimmed === '') return { ok: false, reason: 'level-required' }
  if (levelTrimmed.length > LEVEL_MAX) return { ok: false, reason: 'level-too-long' }
  if (contentTrimmed.length > CONTENT_MAX) return { ok: false, reason: 'content-too-long' }
  if (countTrimmed === '') return { ok: false, reason: 'count-required' }
  if (!/^\d+$/.test(countTrimmed)) return { ok: false, reason: 'count-invalid' }
  const count = Number(countTrimmed)
  if (count < COUNT_MIN || count > COUNT_MAX) return { ok: false, reason: 'count-invalid' }
  return { ok: true, level: levelTrimmed, content: contentTrimmed, count }
}

/**
 * 占位符全替换：先剥离三个已知占位符验证模板再无【】（防模板漂移产生未知占位符），
 * 再注入用户值（用户输入自带的【按内容原样保留，不误判为占位符残留）。
 * 返回 null = 模板含未知占位符。
 */
function replacePromptPlaceholders(body: string, level: string, content: string, count: number): string | null {
  const LEVEL_PLACEHOLDER = /【年级\/水平[^】]*】/g
  const CONTENT_PLACEHOLDER = /【如：[^】]*】/g
  const COUNT_PLACEHOLDER = /【题目总数】/g
  const stripped = body.replace(LEVEL_PLACEHOLDER, '').replace(CONTENT_PLACEHOLDER, '').replace(COUNT_PLACEHOLDER, '')
  if (stripped.includes('【') || stripped.includes('】')) return null
  // #138：内容留空 → 「主题/词表」槽位注入材料兜底句（单值替换，模板零分支）
  const contentValue = content === '' ? CONTENT_FALLBACK : content
  return body.replace(LEVEL_PLACEHOLDER, level).replace(CONTENT_PLACEHOLDER, contentValue).replace(COUNT_PLACEHOLDER, String(count))
}

/** 生成完整出题指令：校验 → 截取正文 → 占位符全替换（保证无模板占位符残留） */
export function buildQuestionPrompt(
  level: string,
  content: string,
  countText: string,
  raw: string = promptRaw,
): { ok: true; prompt: string } | { ok: false; reason: QuestionPromptBuildReason } {
  const validated = validateQuestionPrompt(level, content, countText)
  if (!validated.ok) return validated
  const body = extractPromptBody(raw)
  if (body === null) return { ok: false, reason: 'template-broken' }
  const prompt = replacePromptPlaceholders(body, validated.level, validated.content, validated.count)
  if (prompt === null) return { ok: false, reason: 'template-broken' }
  return { ok: true, prompt }
}
