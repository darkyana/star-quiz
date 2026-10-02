/**
 * #185 useInfiniteScroll 单测：切片分页递增 / hasMore 翻转 / items 变更重置 / 卸载断开观察。
 * IntersectionObserver 在 happy-dom 下不会真实触发，测试用可操控 mock 替换全局观察器，
 * 手动派发 entries 回调模拟哨兵进入视口。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, defineComponent, type Ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useInfiniteScroll } from '../useInfiniteScroll'

type MockEntry = { isIntersecting: boolean }

/** 可操控的 IntersectionObserver mock：记录实例，测试手动派发回调 */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  static lastOptions: unknown = null

  callback: (entries: MockEntry[]) => void
  observed: Element[] = []
  disconnectCalls = 0

  constructor(callback: (entries: MockEntry[]) => void, options?: unknown) {
    this.callback = callback
    MockIntersectionObserver.lastOptions = options
    MockIntersectionObserver.instances.push(this)
  }

  observe(el: Element): void {
    this.observed.push(el)
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnectCalls += 1
  }

  /** 模拟哨兵进入 / 离开视口 */
  trigger(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }])
  }
}

function lastObserver(): MockIntersectionObserver {
  const inst = MockIntersectionObserver.instances.at(-1)
  if (!inst) throw new Error('未创建 IntersectionObserver 实例')
  return inst
}

beforeEach(() => {
  MockIntersectionObserver.instances = []
  MockIntersectionObserver.lastOptions = null
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 在真实组件 setup 中使用 composable（哨兵经模板 ref 挂上），返回测试句柄 */
type InfiniteScrollApi = ReturnType<typeof useInfiniteScroll<string>>
function mountHost(items: Ref<string[]>, pageSize?: number) {
  const holder: { api: InfiniteScrollApi | null } = { api: null }
  const Host = defineComponent({
    setup() {
      const api = useInfiniteScroll(items, pageSize)
      holder.api = api
      return { ...api }
    },
    template: '<div><ul><li v-for="x in visible" :key="x">{{ x }}</li></ul><div ref="sentinelRef"></div></div>',
  })
  const wrapper = mount(Host)
  const api = holder.api
  if (!api) throw new Error('composable 未初始化')
  return { wrapper, api }
}

const range = (n: number): string[] => Array.from({ length: n }, (_, i) => `item-${i + 1}`)

describe('useInfiniteScroll（#185）', () => {
  it('切片分页递增：首批 pageSize 条，哨兵进入视口逐批追加，封顶全量', async () => {
    const items = ref(range(45))
    const { api } = mountHost(items, 20)
    await flushPromises()

    expect(api.visible.value).toEqual(range(20))
    lastObserver().trigger(true)
    await flushPromises()
    expect(api.visible.value).toEqual(range(40))
    lastObserver().trigger(true)
    await flushPromises()
    // 余量不足一批 → 封顶到全量 45
    expect(api.visible.value).toEqual(range(45))
  })

  it('hasMore 翻转：有余量 true，切到全量后 false；切尽后哨兵再触发不再变化', async () => {
    const items = ref(range(30))
    const { api } = mountHost(items, 20)
    await flushPromises()

    expect(api.hasMore.value).toBe(true)
    lastObserver().trigger(true)
    await flushPromises()
    expect(api.visible.value).toEqual(range(30))
    expect(api.hasMore.value).toBe(false)
    lastObserver().trigger(true)
    await flushPromises()
    expect(api.visible.value).toEqual(range(30))
  })

  it('hasMore 为假时哨兵触发不追加；离开视口不追加', async () => {
    const items = ref(range(10))
    const { api } = mountHost(items, 20)
    await flushPromises()

    expect(api.visible.value).toEqual(range(10))
    lastObserver().trigger(false)
    await flushPromises()
    expect(api.visible.value).toEqual(range(10))
  })

  it('items 引用变更（筛选 / 排序）→ 切片重置到第一批', async () => {
    const items = ref(range(45))
    const { api } = mountHost(items, 20)
    await flushPromises()

    lastObserver().trigger(true)
    await flushPromises()
    expect(api.visible.value).toEqual(range(40))

    items.value = range(25).map((x) => `new-${x}`)
    await flushPromises()
    expect(api.visible.value.length).toBe(20)
    expect(api.visible.value[0]).toBe('new-item-1')
    expect(api.hasMore.value).toBe(true)
  })

  it('哨兵元素挂载后开始观察，rootMargin 200px（原型口径）', async () => {
    const items = ref(range(5))
    mountHost(items, 20)
    await flushPromises()

    const inst = lastObserver()
    expect(inst.observed.length).toBe(1)
    expect(inst.observed[0].tagName).toBe('DIV')
    expect(MockIntersectionObserver.lastOptions).toEqual({ rootMargin: '200px' })
  })

  it('组件卸载 → 断开观察（disconnect 被调用）', async () => {
    const items = ref(range(45))
    const { wrapper } = mountHost(items, 20)
    await flushPromises()

    const inst = lastObserver()
    expect(inst.disconnectCalls).toBe(0)
    wrapper.unmount()
    expect(inst.disconnectCalls).toBe(1)
  })
})
