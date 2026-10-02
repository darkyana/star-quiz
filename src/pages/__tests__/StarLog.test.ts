/**
 * T10 星星记事本单测（Spec §4 REQ-8，AC8-1、AC8-2、AC8-7）
 * 相对时间五档单测已由 T2 覆盖（AC8-3~8-6、8-8）；AC3-9 完整闭环端到端留给验收测试。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { StarEntry } from '../../types'
import StarLog from '../StarLog.vue'
import { router } from '../../router'
import { init as initAppState } from '../../composables/useDataInfra'
import '../../composables/useStarData'
import '../../composables/useLearningData'

function seedStars(entries: StarEntry[]): void {
  localStorage.setItem('sq_stars', JSON.stringify(entries))
}

async function mountLog() {
  const wrapper = mount(StarLog, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  initAppState()
  router.replace('/star-log')
})

describe('AC8-1 倒序展示', () => {
  it('按 timestamp 降序：首行 t3、中行 t2、末行 t1', async () => {
    const now = Date.now()
    seedStars([
      { id: 't1', timestamp: now - 300_000, type: 'earn', amount: 1, source: '答题得星' },
      { id: 't2', timestamp: now - 200_000, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
      { id: 't3', timestamp: now - 100_000, type: 'earn', amount: 3, source: '满分奖励' },
    ])
    const wrapper = await mountLog()
    const rows = wrapper.findAll('.ledger-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('满分奖励')
    expect(rows[1].text()).toContain('兑换：菠萝油')
    expect(rows[2].text()).toContain('答题得星')
  })
})

describe('AC8-2 获得 / 兑换标识', () => {
  it('earn 行 +5、redeem 行 −2（负号 −），均可见来源文本', async () => {
    const now = Date.now()
    seedStars([
      { id: 't1', timestamp: now - 300_000, type: 'earn', amount: 5, source: '答题得星' },
      { id: 't2', timestamp: now - 200_000, type: 'redeem', amount: 2, source: '兑换：菠萝油' },
    ])
    const wrapper = await mountLog()
    const rows = wrapper.findAll('.ledger-row')
    const earnRow = rows.find((r) => r.classes().includes('earn'))!
    const redeemRow = rows.find((r) => r.classes().includes('redeem'))!
    expect(earnRow.text()).toContain('+5')
    expect(earnRow.text()).toContain('答题得星')
    expect(redeemRow.text()).toContain('−2')
    expect(redeemRow.text()).toContain('兑换：菠萝油')
  })

  it('相对时间落位：近期流水显示"刚刚"', async () => {
    const now = Date.now()
    seedStars([{ id: 't1', timestamp: now - 5_000, type: 'earn', amount: 5, source: '答题得星' }])
    const wrapper = await mountLog()
    expect(wrapper.get('.ledger-row').text()).toContain('刚刚')
  })
})

describe('AC8-7 空状态与顶栏 chip', () => {
  it('空流水：空态文案 + chip 0', async () => {
    seedStars([])
    const wrapper = await mountLog()
    expect(wrapper.get('[data-page="star-log"]').text()).toContain('还没有记录，快去答题攒星星吧')
    expect(wrapper.get('.balance-chip').text()).toContain('0')
  })

  it('有流水：chip 实时求和为 5', async () => {
    seedStars([{ id: 't1', timestamp: 1, type: 'earn', amount: 5, source: '答题得星' }])
    const wrapper = await mountLog()
    expect(wrapper.get('.balance-chip').text()).toContain('5')
  })
})

describe('顶栏返回', () => {
  it('"返回"按钮 → #/redeem', async () => {
    seedStars([])
    const wrapper = await mountLog()
    expect(wrapper.get('.back-btn').text()).toBe('返回')
    await wrapper.get('.back-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/redeem')
  })
})
