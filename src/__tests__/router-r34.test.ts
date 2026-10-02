/**
 * R34 孩子端路由组单测（Spec 20260828-R34 T3；AC-R34-1-2 / 1-4 路由层部分）：
 * /child/proposals 路由组复用家长端同三页面组件、meta.view='child' 视角标记传递、
 * 静态段（new）优先于参数段（:id）；家长端既有路由路径与语义零改动回归。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { vi } from 'vitest'
import { router } from '../router'
import App from '../App.vue'
import Proposals from '../pages/Proposals.vue'
import ProposalEdit from '../pages/ProposalEdit.vue'
import ProposalDetail from '../pages/ProposalDetail.vue'

beforeEach(() => {
  window.location.hash = '#/'
})

describe('R34 孩子端路由组注册（AC-R34-1-2 / 1-4 路由层）', () => {
  it('AC-R34-1-2 四条孩子端路由 resolve 可达：meta.view="child"、复用家长端同三页面组件', () => {
    const cases = [
      { path: '/child/proposals', component: Proposals },
      { path: '/child/proposals/new', component: ProposalEdit },
      { path: '/child/proposals/p1/edit', component: ProposalEdit },
      { path: '/child/proposals/p1', component: ProposalDetail },
    ]
    for (const { path, component } of cases) {
      const resolved = router.resolve(path)
      expect(resolved.matched, path).toHaveLength(1)
      expect(resolved.meta.view, path).toBe('child')
      expect(resolved.matched[0].components?.default, path).toBe(component)
    }
  })

  it('AC-R34-1-2 静态段优先：/child/proposals/new 命中 ProposalEdit 而非 ProposalDetail（:id 不吞 new）', () => {
    const resolved = router.resolve('/child/proposals/new')
    expect(resolved.matched[0].components?.default).toBe(ProposalEdit)
    expect(resolved.params).toEqual({})
  })

  it('AC-R34-1-4 家长端既有路由零改动回归：路径与组件不变、不带 child 视角标记', () => {
    const parentCases = [
      { path: '/proposals', component: Proposals },
      { path: '/proposals/new', component: ProposalEdit },
      { path: '/proposals/p1/edit', component: ProposalEdit },
      { path: '/proposals/p1', component: ProposalDetail },
    ]
    for (const { path, component } of parentCases) {
      const resolved = router.resolve(path)
      expect(resolved.matched, path).toHaveLength(1)
      expect(resolved.matched[0].components?.default, path).toBe(component)
      expect(resolved.meta.view, path).not.toBe('child')
    }
  })

  it('AC-R34-1-2 挂载导航 /child/proposals → 列表页组件真实渲染（data-page="proposals"）且 currentRoute.meta.view="child"', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    window.location.hash = '#/child/proposals'
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/child/proposals')
    })
    await flushPromises()
    expect(wrapper.find('[data-page="proposals"]').exists()).toBe(true)
    expect(router.currentRoute.value.meta.view).toBe('child')
    wrapper.unmount()
  })
})
