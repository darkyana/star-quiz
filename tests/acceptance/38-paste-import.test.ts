/**
 * #212 粘贴导入验收（拆自 #137 tracer bullet）：数据管理弹窗「粘贴导入」端到端。
 * 入口按钮与「导入」并列（仅数据管理弹窗，经济流水不捎带）→ 弹窗内切换粘贴视图（标题 + 文本域 + 解析 + 返回）→
 * 剥壳校验走契约层 validateLearningPasteImport（三形态成功 / no-json 必拒 / 代码块非 JSON 不回退 / 双 JSON 无壳必拒）
 * → 成功进现有覆盖/追加二次确认 → 落库复用现有编排（覆盖三键捆 / 追加重编号）→ 反馈复用 importError / importSuccess。
 * 返回 / 取消全程不落任何数据。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import App from '../../src/App.vue'
import router from '../../src/router/index'
import { init as initAppState } from '../../src/composables/useDataInfra'
import { copy } from '../../src/copy'
import { questions as readQuestions, writeQuestions } from '../../src/composables/useLearningData'
import '../../src/composables/useStarData'
import '../../src/composables/useLearningData'
import type { Question } from '../../src/types/index'

function makeQuestion(id: string): Question {
  return { id, type: 'zh2en', prompt: `题目${id}`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, wordId: id, category: '学科', book: '默认' }
}

/** 合法 2.0 学习文件 JSON 文本（默认 2 题 + 空红旗 + 空答题记录） */
function dataFileJson(opts: { questionPool?: unknown[] } = {}): string {
  return JSON.stringify({
    version: '2.0',
    exportedAt: '2026-09-08T10:30:00.000Z',
    questionPool: opts.questionPool ?? [makeQuestion('q1'), makeQuestion('q2')],
    flagged: {},
    questionResults: {},
  })
}

let wrapper: VueWrapper | undefined

beforeEach(async () => {
  localStorage.clear()
  initAppState()
  await router.replace('/parent')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

async function mountParentApp(): Promise<VueWrapper> {
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return wrapper
}

async function openModal(wrapper: VueWrapper, label: string): Promise<void> {
  const btn = wrapper.findAll('button').find((b) => b.text() === label)
  expect(btn).toBeDefined()
  await btn!.trigger('click')
}

/** 进入数据管理弹窗并切换到粘贴视图 */
async function openPasteView(target: VueWrapper): Promise<void> {
  await openModal(target, copy.parent.dataManage)
  const entry = target.get('.btn-paste-import')
  expect(entry.text()).toBe(copy.parent.pasteImportBtn)
  await entry.trigger('click')
}

async function clickButton(target: VueWrapper, selector: string): Promise<void> {
  await target.get(selector).trigger('click')
}

describe('#212 粘贴导入：入口与视图切换', () => {
  it('入口按钮与「导入」并列在数据管理弹窗内；流水管理弹窗无此按钮（经济流水粘贴导入不捎带）', async () => {
    wrapper = await mountParentApp()
    await openModal(wrapper, copy.parent.dataManage)
    // 与「导入」并列：导出 / 导入 / 粘贴导入 三按钮同时在场
    expect(wrapper.get('.btn-import').text()).toBe(copy.parent.importBtn)
    expect(wrapper.get('.btn-paste-import').text()).toBe(copy.parent.pasteImportBtn)
    await wrapper.get('.star-modal__close').trigger('click')
    await openModal(wrapper, copy.parent.ledgerManage)
    expect(wrapper.find('.btn-paste-import').exists()).toBe(false)
  })

  it('点击后弹窗内切换粘贴视图：标题「粘贴导入」+ 文本域 + 解析 + 返回，导出/导入按钮退场', async () => {
    wrapper = await mountParentApp()
    await openPasteView(wrapper)
    const modal = wrapper.get('.star-modal')
    expect(modal.find('.star-modal__title').text()).toBe(copy.parent.pasteImportTitle)
    const textarea = modal.get('.paste-input')
    expect(textarea.attributes('placeholder')).toBe(copy.parent.pasteImportPlaceholder)
    expect(textarea.attributes('aria-label')).toBe(copy.parent.pasteImportTitle)
    expect(modal.get('.btn-paste-parse').text()).toBe(copy.parent.pasteImportParseBtn)
    expect(modal.get('.btn-paste-back').text()).toBe(copy.parent.pasteImportBackBtn)
    expect(modal.find('.btn-export').exists()).toBe(false)
    expect(modal.find('.btn-import').exists()).toBe(false)
    expect(modal.find('.btn-paste-import').exists()).toBe(false)
  })

  it('返回：回主视图（标题「数据管理」+ 导出/导入复位），草稿与反馈全清，不落任何数据', async () => {
    writeQuestions([makeQuestion('000001')])
    const beforeQ = readQuestions()
    wrapper = await mountParentApp()
    await openPasteView(wrapper)
    await wrapper.get('.paste-input').setValue(dataFileJson())
    await clickButton(wrapper, '.btn-paste-back')
    const modal = wrapper.get('.star-modal')
    expect(modal.find('.star-modal__title').text()).toBe(copy.parent.dataManage)
    expect(modal.find('.btn-export').exists()).toBe(true)
    expect(modal.find('.btn-import').exists()).toBe(true)
    expect(modal.find('.paste-input').exists()).toBe(false)
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
  })
})

describe('#212 粘贴导入：三种形态成功 + 二次确认 + 落库', () => {
  it('纯 JSON：解析 → 现有覆盖/追加二次确认「2 题」→ 导入并重置 → 题库覆盖 + 「导入成功」+ 退出粘贴视图', async () => {
    writeQuestions([makeQuestion('old')])
    wrapper = await mountParentApp()
    await openPasteView(wrapper)
    await wrapper.get('.paste-input').setValue(dataFileJson())
    await clickButton(wrapper, '.btn-paste-parse')
    const confirm = wrapper.get('.confirm-modal')
    expect(confirm.text()).toContain(copy.parent.confirmLearningImport(2))
    // 无默认无预选：取消 + 双模式按钮并存（复用现有确认弹窗）
    expect(confirm.get('.confirm-cancel').text()).toBe(copy.parent.cancel)
    expect(confirm.text()).toContain(copy.parent.importOverwrite)
    expect(confirm.text()).toContain(copy.parent.importAppend)
    const overwriteBtn = confirm.findAll('button').find((b) => b.text() === copy.parent.importOverwrite)
    await overwriteBtn!.trigger('click')
    // R24：导入时无 difficulty 的题物理补 3（期望值随行为同步）
    expect(readQuestions()).toEqual([
      { ...makeQuestion('q1'), difficulty: 3 },
      { ...makeQuestion('q2'), difficulty: 3 },
    ])
    expect(wrapper.get('.import-success').text()).toBe(copy.parent.importSuccess)
    // 成功即完成：退回主视图
    expect(wrapper.get('.star-modal').find('.star-modal__title').text()).toBe(copy.parent.dataManage)
    expect(wrapper.find('.paste-input').exists()).toBe(false)
  })

  it('``` 代码块包裹：剥壳成功 → 导入并追加 → 只增量题库并按现有库重编号', async () => {
    writeQuestions([makeQuestion('000001')])
    wrapper = await mountParentApp()
    await openPasteView(wrapper)
    await wrapper.get('.paste-input').setValue('```json\n' + dataFileJson() + '\n```')
    await clickButton(wrapper, '.btn-paste-parse')
    const confirm = wrapper.get('.confirm-modal')
    const appendBtn = confirm.findAll('button').find((b) => b.text() === copy.parent.importAppend)
    await appendBtn!.trigger('click')
    // 追加重编号（importMerge：起始 = 现有可解析 id 最大值 + 1，只改 id 其余字段原样），追加只增量题库
    expect(readQuestions()).toEqual([
      makeQuestion('000001'),
      { ...makeQuestion('q1'), id: '000002', difficulty: 3 },
      { ...makeQuestion('q2'), id: '000003', difficulty: 3 },
    ])
    expect(wrapper.get('.import-success').text()).toBe(copy.parent.importSuccess)
  })

  it('前后带解释文字（无代码块）：剥壳成功 → 确认弹窗出现 → 取消则零写入且草稿保留在粘贴视图', async () => {
    writeQuestions([makeQuestion('000001')])
    const beforeQ = readQuestions()
    wrapper = await mountParentApp()
    await openPasteView(wrapper)
    const pasted = `这是给你出的 2 道题：\n${dataFileJson()}\n\n直接导入就能用。`
    await wrapper.get('.paste-input').setValue(pasted)
    await clickButton(wrapper, '.btn-paste-parse')
    expect(wrapper.get('.confirm-modal').text()).toContain(copy.parent.confirmLearningImport(2))
    await wrapper.get('.confirm-cancel').trigger('click')
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
    expect(wrapper.find('.import-success').exists()).toBe(false)
    // 取消不落数据也不退视图：粘贴视图与草稿保留，可修改后重新解析
    expect(wrapper.get('.star-modal').find('.star-modal__title').text()).toBe(copy.parent.pasteImportTitle)
    expect(wrapper.find('.paste-input').exists()).toBe(true)
  })
})

describe('#212 粘贴导入：剥壳失败必拒（全程原子拒绝零写入）', () => {
  it('空白 / 纯解释文字 → 「未在粘贴内容中找到有效 JSON」（no-json 档），无确认弹窗、数据不变', async () => {
    writeQuestions([makeQuestion('000001')])
    const beforeQ = readQuestions()
    wrapper = await mountParentApp()
    for (const pasted of ['', '   \n\t ', '抱歉，我没有生成题目，请再问一次。']) {
      await openPasteView(wrapper)
      await wrapper.get('.paste-input').setValue(pasted)
      await clickButton(wrapper, '.btn-paste-parse')
      expect(wrapper.get('.import-error').text()).toBe(copy.parent.importPasteNoJson)
      expect(wrapper.get('.import-error').text()).toBe('未在粘贴内容中找到有效 JSON')
      expect(wrapper.find('.confirm-modal').exists()).toBe(false)
      expect(readQuestions()).toEqual(beforeQ)
      // 失败不退视图：草稿保留供修改重试
      expect(wrapper.get('.star-modal').find('.star-modal__title').text()).toBe(copy.parent.pasteImportTitle)
      // 复位到关闭态，供下一次循环重新进入
      await wrapper.get('.star-modal__close').trigger('click')
    }
  })

  it('代码块非 JSON 不回落 {…} 兜底：围栏外有合法 JSON 也必拒（file-corrupt 档同口径文案），数据不变', async () => {
    writeQuestions([makeQuestion('000001')])
    const beforeQ = readQuestions()
    wrapper = await mountParentApp()
    await openPasteView(wrapper)
    const pasted = ['```json', '这里放的是说明文字不是 JSON', '```', '参考下面的合法数据：', dataFileJson()].join('\n')
    await wrapper.get('.paste-input').setValue(pasted)
    await clickButton(wrapper, '.btn-paste-parse')
    expect(wrapper.get('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
  })

  it('双段独立 JSON 且无代码块（已知边界，老板接受）→ 贪心子串含解释文字 → 必拒，数据不变', async () => {
    writeQuestions([makeQuestion('000001')])
    const beforeQ = readQuestions()
    wrapper = await mountParentApp()
    await openPasteView(wrapper)
    const first = dataFileJson()
    const second = dataFileJson({ questionPool: [makeQuestion('q9')] })
    await wrapper.get('.paste-input').setValue(`${first}\n\n以上是第一批，下面还有一批：\n\n${second}`)
    await clickButton(wrapper, '.btn-paste-parse')
    expect(wrapper.get('.import-error').text()).toBe(copy.parent.importFailChecked)
    expect(wrapper.find('.confirm-modal').exists()).toBe(false)
    expect(readQuestions()).toEqual(beforeQ)
  })
})
