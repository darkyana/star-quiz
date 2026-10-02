/**
 * 出题指令生成页单测（#136 / #141）：路由 /parent/question-prompt / 表单三输入 + 失焦逐字段校验（错误就近显示、
 * 有错禁用生成）/ 点生成对未失焦字段全量补校验 / 生成成功占位符全替换 / 复制成功 toast / 复制失败聚焦全选 / 返回家长页。
 * 生成逻辑收口纯函数模块（questionPrompt.ts），此处测页面交互编排。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import QuestionPrompt from '../QuestionPrompt.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import { CONTENT_FALLBACK, COUNT_DEFAULT } from '../../utils/questionPrompt'

const LEVEL = '小学三年级，剑桥少儿英语 Starters 水平'
const CONTENT = '人教版 PEP 四年级上册 Unit 1–3'

/** 三字段标识：水平（input 第 1 个）/ 内容（textarea）/ 题数（input 第 2 个） */
type FieldKey = 'level' | 'content' | 'count'

async function mountPage(): Promise<VueWrapper> {
  // attachTo 真实文档：复制失败用例需断言 textarea 聚焦（游离 DOM 上 focus 不改变 activeElement）
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wrapper = mount(QuestionPrompt, { attachTo: host, global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

/** 按元素顺序填三输入：水平（.prompt-input 第 1 个）/ 内容（.prompt-textarea）/ 题数（.prompt-input 第 2 个） */
async function fillForm(wrapper: VueWrapper, level: string, content: string, count: string): Promise<void> {
  const inputs = wrapper.findAll('input.prompt-input')
  await inputs[0]!.setValue(level)
  await wrapper.get('textarea.prompt-textarea').setValue(content)
  await inputs[1]!.setValue(count)
}

/** 对指定字段触发失焦校验（#141：逐字段校验入口） */
async function blurField(wrapper: VueWrapper, field: FieldKey): Promise<void> {
  if (field === 'content') {
    await wrapper.get('textarea.prompt-textarea').trigger('blur')
    return
  }
  const inputs = wrapper.findAll('input.prompt-input')
  await inputs[field === 'level' ? 0 : 1]!.trigger('blur')
}

/** 字段就近错误断言定位：该字段的 .prompt-field 容器内（data-field 挂钩） */
function fieldError(wrapper: VueWrapper, field: FieldKey) {
  return wrapper.get(`[data-field="${field}"]`).find('.prompt-error')
}

/** 生成按钮禁用态（#141：任一字段报错 → 禁用） */
function generateDisabled(wrapper: VueWrapper): boolean {
  return (wrapper.get('.btn-generate').element as HTMLButtonElement).disabled
}

/** 复制失败断言前把焦点归位到 body，避免上一用例焦点泄漏；await 导航完成再进用例体 */
beforeEach(async () => {
  localStorage.clear()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await router.replace('/parent/question-prompt')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('页面骨架与路由', () => {
  it('/parent/question-prompt 可达：data-page=question-prompt + 标题「出题指令」', async () => {
    const wrapper = await mountPage()
    expect(router.currentRoute.value.path).toBe('/parent/question-prompt')
    expect(wrapper.find('[data-page="question-prompt"]').exists()).toBe(true)
    expect(wrapper.get('.page-title').text()).toBe('出题指令')
  })

  it('顶部说明句 + 三输入（口语标签）+ 生成按钮；生成前不渲染结果区', async () => {
    const wrapper = await mountPage()
    expect(wrapper.get('.question-prompt-intro').text()).toBe(copy.parent.questionPrompt.intro)
    // #141 文案拍板：第一字段标题「为谁出题」+ 灰字占位提示「孩子年龄/年级/水平」（输入后被替代，标准行为）
    expect(copy.parent.questionPrompt.levelLabel).toBe('为谁出题')
    expect(wrapper.get('label[for="prompt-level"]').text()).toBe(copy.parent.questionPrompt.levelLabel)
    expect(wrapper.get('label[for="prompt-content"]').text()).toBe(copy.parent.questionPrompt.contentLabel)
    expect(wrapper.get('label[for="prompt-count"]').text()).toBe(copy.parent.questionPrompt.countLabel)
    const inputs = wrapper.findAll('input.prompt-input')
    expect((inputs[0]!.element as HTMLInputElement).placeholder).toBe(copy.parent.questionPrompt.levelPlaceholder)
    expect((inputs[0]!.element as HTMLInputElement).placeholder).toBe('孩子年龄/年级/水平')
    // #138：内容字段占位符首词「可留空」（告知材料直发外部 AI 的路径）
    const contentBox = wrapper.get('textarea.prompt-textarea').element as HTMLTextAreaElement
    expect(contentBox.placeholder).toBe(copy.parent.questionPrompt.contentPlaceholder)
    expect(wrapper.get('.btn-generate').text()).toBe(copy.parent.questionPrompt.generateBtn)
    expect(wrapper.find('.prompt-result').exists()).toBe(false)
  })

  it('题数默认 60（2026-09-09：与建议 100 以下提示口径一致）', async () => {
    const wrapper = await mountPage()
    const inputs = wrapper.findAll('input.prompt-input')
    expect((inputs[1]!.element as HTMLInputElement).value).toBe(String(COUNT_DEFAULT))
  })

  it('题数字段就近常显建议量提示（2026-09-09：建议生成 100 题以下，仅题数字段有）', async () => {
    const wrapper = await mountPage()
    const hint = wrapper.get('[data-field="count"]').get('.prompt-hint')
    expect(hint.text()).toBe(copy.parent.questionPrompt.countHint)
    expect(copy.parent.questionPrompt.countHint).toContain('100')
    // 建议量提示只挂题数字段（水平/内容字段不出）
    expect(wrapper.find('[data-field="level"] .prompt-hint').exists()).toBe(false)
    expect(wrapper.find('[data-field="content"] .prompt-hint').exists()).toBe(false)
  })

  it('「返回」→ /parent（入口所在页，沿 Prizes 返回惯例）', async () => {
    const wrapper = await mountPage()
    await wrapper.get('.back-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent')
  })
})

describe('校验交互（#141）：失焦逐字段校验、就近报错、有错禁用生成', () => {
  it.each([
    ['水平为空', 'level', '', CONTENT, '200', copy.parent.questionPrompt.error.levelRequired],
    ['水平纯空白', 'level', '   ', CONTENT, '200', copy.parent.questionPrompt.error.levelRequired],
    ['水平超 100 字', 'level', 'a'.repeat(101), CONTENT, '200', copy.parent.questionPrompt.error.levelTooLong],
    ['内容超 100 字（#138：留空合法，但填写仍限长）', 'content', LEVEL, 'b'.repeat(101), '200', copy.parent.questionPrompt.error.contentTooLong],
    ['题数为空', 'count', LEVEL, CONTENT, '', copy.parent.questionPrompt.error.countRequired],
    ['题数 19 越下界', 'count', LEVEL, CONTENT, '19', copy.parent.questionPrompt.error.countInvalid],
    ['题数 601 越上界', 'count', LEVEL, CONTENT, '601', copy.parent.questionPrompt.error.countInvalid],
    ['题数非整数 12.5', 'count', LEVEL, CONTENT, '12.5', copy.parent.questionPrompt.error.countInvalid],
  ])(
    '%s → 失焦即在该字段旁报错、其余字段不误报、生成按钮禁用、无结果区',
    async (_name, field, level, content, count, message) => {
      const wrapper = await mountPage()
      await fillForm(wrapper, level as string, content as string, count as string)
      await blurField(wrapper, field as FieldKey)
      // 就近：错误显示在出错字段的容器内，实文本节点 + role=alert 读屏可感知
      const err = fieldError(wrapper, field as FieldKey)
      expect(err.exists()).toBe(true)
      expect(err.text()).toBe(message as string)
      expect(err.attributes('role')).toBe('alert')
      for (const other of ['level', 'content', 'count'] as const) {
        if (other !== field) expect(fieldError(wrapper, other).exists()).toBe(false)
      }
      expect(generateDisabled(wrapper)).toBe(true)
      expect(wrapper.find('.prompt-result').exists()).toBe(false)
      expect(wrapper.find('.prompt-output').exists()).toBe(false)
    },
  )

  it('打开页面直接点「生成指令」→ 未失焦字段视同失焦全量补校验：水平/题数就近报错（#138 内容留空合法不再报错），按钮随后禁用，无生成结果', async () => {
    const wrapper = await mountPage()
    expect(generateDisabled(wrapper)).toBe(false)
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    expect(fieldError(wrapper, 'level').text()).toBe(copy.parent.questionPrompt.error.levelRequired)
    expect(fieldError(wrapper, 'count').exists()).toBe(false)
    expect(generateDisabled(wrapper)).toBe(true)
    expect(wrapper.find('.prompt-result').exists()).toBe(false)
  })

  it('三字段全空点「生成指令」→ 水平/题数两条必填错误并存（#138 内容留空合法）', async () => {
    const wrapper = await mountPage()
    await fillForm(wrapper, '', '', '')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    expect(fieldError(wrapper, 'level').text()).toBe(copy.parent.questionPrompt.error.levelRequired)
    expect(fieldError(wrapper, 'count').text()).toBe(copy.parent.questionPrompt.error.countRequired)
    expect(wrapper.findAll('.prompt-error')).toHaveLength(2)
    expect(generateDisabled(wrapper)).toBe(true)
  })

  it('#138 内容留空 → 可直接生成：指令含材料兜底句、无占位符残留；复制后「去导入题目」直达入口照常出现（用户故事 8）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, '', '100')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    expect(fieldError(wrapper, 'content').exists()).toBe(false)
    const output = wrapper.get('textarea.prompt-output').element as HTMLTextAreaElement
    expect(output.value).toContain(CONTENT_FALLBACK)
    expect(output.value).not.toContain('【')
    // 留空场景走完闭环：复制后 #311 接住块与直达入口同样工作
    await wrapper.get('.btn-copy').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-next-steps]').get('.btn-go-import').text()).toBe(copy.parent.questionPrompt.goImportBtn)
  })

  it('仅题数填 10：失焦即报越界错误且按钮禁用（无需点生成）；改回 200 失焦 → 错误清除、按钮恢复可点、生成成功', async () => {
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '10')
    await blurField(wrapper, 'count')
    expect(fieldError(wrapper, 'count').text()).toBe(copy.parent.questionPrompt.error.countInvalid)
    expect(generateDisabled(wrapper)).toBe(true)
    const inputs = wrapper.findAll('input.prompt-input')
    await inputs[1]!.setValue('200')
    await blurField(wrapper, 'count')
    expect(fieldError(wrapper, 'count').exists()).toBe(false)
    expect(generateDisabled(wrapper)).toBe(false)
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    expect(wrapper.find('.prompt-result').exists()).toBe(true)
  })

  it('报错后重新填好再生成 → 字段错误清除，结果区渲染', async () => {
    const wrapper = await mountPage()
    await wrapper.get('.btn-generate').trigger('click')
    expect(fieldError(wrapper, 'level').text()).toBe(copy.parent.questionPrompt.error.levelRequired)
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    // 真实浏览器点按钮会先让输入框失焦（jsdom 需显式补）：失焦清错 → 按钮恢复可点
    await blurField(wrapper, 'level')
    await blurField(wrapper, 'content')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(generateDisabled(wrapper)).toBe(false)
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    expect(wrapper.find('.prompt-result').exists()).toBe(true)
  })
})

describe('生成指令：占位符全替换', () => {
  it('生成成功 → 只读文本框含三参数值、无残留【】、不含模板用法头部', async () => {
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '150')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    const output = wrapper.get('textarea.prompt-output')
    expect((output.element as HTMLTextAreaElement).readOnly).toBe(true)
    const text = (output.element as HTMLTextAreaElement).value
    expect(text).toContain(LEVEL)
    expect(text).toContain(CONTENT)
    expect(text).toContain('共约150题')
    expect(text).not.toContain('【')
    expect(text).not.toContain('】')
    expect(text).not.toContain('把下方分隔线之后的全文复制给任意 AI')
    // 复制按钮随结果区出现
    expect(wrapper.get('.btn-copy').text()).toBe(copy.parent.questionPrompt.copyBtn)
  })
})

describe('复制指令', () => {
  function stubClipboard(writeText: ReturnType<typeof vi.fn>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  }

  it('成功 → writeText 收到指令全文 + toast（role=status）出现', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    await wrapper.get('.btn-copy').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    const generated = (wrapper.get('textarea.prompt-output').element as HTMLTextAreaElement).value
    expect(writeText).toHaveBeenCalledWith(generated)
    expect(wrapper.get('.toast').attributes('role')).toBe('status')
    expect(wrapper.get('.toast').text()).toBe(copy.parent.questionPrompt.copyToast)
  })

  it('失败 → 错误提示 + 文本框聚焦并全选（方便手动复制），无 toast', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    stubClipboard(writeText)
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    await wrapper.get('.btn-copy').trigger('click')
    await flushPromises()
    expect(wrapper.find('.toast').exists()).toBe(false)
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe(copy.parent.questionPrompt.copyFail)
    const textarea = wrapper.get('textarea.prompt-output').element as HTMLTextAreaElement
    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe(textarea.value.length)
  })
})

describe('#311 复制后就地接住：后续步骤指引 + 直达导入入口', () => {
  function stubClipboard(writeText: ReturnType<typeof vi.fn>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  }

  it('生成后未点复制 → 指引块不出现', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-next-steps]').exists()).toBe(false)
  })

  it('点「复制指令」成功 → 就地出现后续步骤指引与「去导入题目」入口', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    await wrapper.get('.btn-copy').trigger('click')
    await flushPromises()
    const steps = wrapper.get('[data-next-steps]')
    expect(steps.find('.next-steps-text').text()).toBe(copy.parent.questionPrompt.nextStepHint)
    expect(steps.get('.btn-go-import').text()).toBe(copy.parent.questionPrompt.goImportBtn)
  })

  it('复制失败（手动复制路径）→ 指引块同样出现（接住与复制成败无关）', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    stubClipboard(writeText)
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    await wrapper.get('.btn-copy').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-next-steps]').exists()).toBe(true)
  })

  it('「去导入题目」→ 跳 /parent?import=paste（家长页识别后自动开粘贴导入弹窗）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    await wrapper.get('.btn-copy').trigger('click')
    await flushPromises()
    await wrapper.get('.btn-go-import').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/parent')
    expect(router.currentRoute.value.query.import).toBe('paste')
  })

  it('重新生成指令 → 上一轮指引收起（新一轮流程重新接住）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const wrapper = await mountPage()
    await fillForm(wrapper, LEVEL, CONTENT, '200')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    await wrapper.get('.btn-copy').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-next-steps]').exists()).toBe(true)
    await fillForm(wrapper, LEVEL, CONTENT, '300')
    await wrapper.get('.btn-generate').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-next-steps]').exists()).toBe(false)
  })
})
