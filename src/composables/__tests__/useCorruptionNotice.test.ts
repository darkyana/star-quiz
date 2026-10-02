/**
 * #172 家底键损坏恢复提示（useCorruptionNotice）单测：
 * - 时机 = 被发现那一刻（#169 registerCorruptionResetHandler 钩子链：上云参与键损坏重置即触发）；
 * - 答题会话进行中不得弹（已拍板口径）：置延后标记，flushCorruptionNotice 在下次非答题时机补弹；
 * - 显示走 App.vue 全局挂载的 StarToastStandard（#139 共享组件，不新建样式）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from '../../App.vue'
import { router } from '../../router'
import { copy } from '../../copy'
import {
  installCorruptionNotice,
  corruptionNotice,
  clearCorruptionNotice,
  flushCorruptionNotice,
} from '../useCorruptionNotice'
import { init, readValue, STORAGE_KEYS } from '../useDataInfra'
import '../useLearningData'
import { startQuiz, clearSession } from '../useQuiz'

beforeEach(() => {
  localStorage.clear()
  init()
  clearCorruptionNotice()
  installCorruptionNotice()
})

/** 触发一次「被发现那一刻」：家底键写坏 JSON 后经通用读原语读取（E1 损坏重置路径） */
function triggerCorruptionReset(): void {
  localStorage.setItem(STORAGE_KEYS.questions, '{corrupt')
  readValue<unknown>(STORAGE_KEYS.questions)
}

describe('#172 损坏恢复提示时机（被发现那一刻，经 #169 钩子链）', () => {
  it('非答题时机：家底键损坏被读取发现 → 提示文案立即置位（票内原文）', () => {
    triggerCorruptionReset()
    expect(corruptionNotice().value).toBe(copy.corruptionRecoveryToast)
    expect(corruptionNotice().value).toBe('检测到数据异常，已自动恢复，建议导出一份备份')
  })

  it('提示经 App.vue 全局 StarToastStandard 弹出（共享组件，不新建样式）', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('.toast').exists()).toBe(false)

    triggerCorruptionReset()
    await flushPromises()

    expect(wrapper.find('.toast').exists()).toBe(true)
    expect(wrapper.find('.toast').text()).toBe(copy.corruptionRecoveryToast)
    wrapper.unmount()
  })
})

describe('#172 答题会话进行中不得弹（延后到非答题时机）', () => {
  it('答题中损坏被发现 → 不弹；会话结束后 flushCorruptionNotice 补弹', () => {
    expect(startQuiz()).not.toBeNull()

    triggerCorruptionReset()
    expect(corruptionNotice().value).toBe('')

    // 会话仍在进行 → flush 继续延后
    flushCorruptionNotice()
    expect(corruptionNotice().value).toBe('')

    // 会话结束（非答题时机）→ 补弹
    clearSession()
    flushCorruptionNotice()
    expect(corruptionNotice().value).toBe(copy.corruptionRecoveryToast)
  })

  it('非答题状态下 flush 无延后标记 → 无动作（不重复弹）', () => {
    flushCorruptionNotice()
    expect(corruptionNotice().value).toBe('')
  })
})
