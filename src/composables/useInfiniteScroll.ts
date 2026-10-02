// #185 无限滚动 composable：IntersectionObserver 哨兵观察 + 分页切片 + 数据变更重置，
// 逻辑从 #163 批量改题原型（方案 C）组件中独立成可复用模块（原见 fa5006e）。
// 只观察哨兵元素、不操作 DOM 滚动；「已到末尾」提示文案归调用方。
//
// 使用示例：
//   const items = computed(() => filteredQuestions.value) // 全量数据（通常为筛选后的列表）
//   const { visible, hasMore, sentinelRef } = useInfiniteScroll(items)
//   模板：<li v-for="q in visible" :key="q.id">…</li>
//         <div ref="sentinelRef"></div>  <!-- 列表底部常驻哨兵 -->
//         <p v-if="!hasMore">已到末尾</p> <!-- 文案归调用方 -->

import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'

/** 哨兵进入视口预载距离（px，原型口径 rootMargin 200px） */
const ROOT_MARGIN = '200px'

/**
 * 无限滚动：对全量 items 按 pageSize 切片，哨兵元素进入视口且还有余量时追加一批；
 * items 引用变更（筛选 / 排序变化）时切片重置到第一批；作用域销毁时自动断开观察。
 */
export function useInfiniteScroll<T>(
  items: Ref<T[]>,
  pageSize: number = 20,
): { visible: ComputedRef<T[]>; hasMore: ComputedRef<boolean>; sentinelRef: Ref<HTMLElement | null> } {
  /** 当前可见条数上限（k×pageSize，封顶 items.length） */
  const visibleCount = ref(pageSize)
  const sentinelRef: Ref<HTMLElement | null> = ref(null)

  const visible = computed(() => items.value.slice(0, visibleCount.value))
  const hasMore = computed(() => visibleCount.value < items.value.length)

  // 数据引用变更（筛选 / 排序）→ 切片重置到第一批
  watch(items, () => {
    visibleCount.value = pageSize
  })

  function loadMore(): void {
    if (hasMore.value) {
      visibleCount.value = Math.min(visibleCount.value + pageSize, items.value.length)
    }
  }

  let observer: IntersectionObserver | null = null

  function setupObserver(): void {
    observer?.disconnect()
    observer = null
    if (!sentinelRef.value) return
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore.value) {
          loadMore()
        }
      },
      { rootMargin: ROOT_MARGIN },
    )
    observer.observe(sentinelRef.value)
  }

  // 哨兵元素挂载 / 替换后重建观察
  watch(sentinelRef, () => {
    void nextTick(setupObserver)
  })

  // 卸载（作用域销毁）时断开观察
  onScopeDispose(() => {
    observer?.disconnect()
    observer = null
  })

  return { visible, hasMore, sentinelRef }
}
