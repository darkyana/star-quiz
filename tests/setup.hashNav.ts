/** happy-dom 兼容垫片（#176）：hash 赋值派发 hashchange 但不派发 popstate
 *  （jsdom 与真实浏览器两者都派发），vue-router 4 仅监听 popstate，
 *  故桥接 hashchange → popstate 以还原浏览器行为。 */
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}
