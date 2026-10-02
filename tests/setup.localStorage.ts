/**
 * 环境兼容垫片（#155 交付时引入）：Node 26 + vitest 2 + jsdom 组合下，
 * vitest jsdom 环境的 window 上 localStorage / sessionStorage 缺失
 * （jsdom 独立实例同 URL 下正常），验收套件的迁移与数据断言依赖它们，
 * 且多数测试以 vi.spyOn(Storage.prototype, 'setItem') 拦截——垫片必须
 * 挂在当前 realm 的 Storage.prototype 上才能被 spy 命中。
 * 故以 Map 后端覆写当前 realm 的 Storage.prototype，实例用 Proxy 转发
 * 属性存取与枚举（Object.keys(localStorage) 需列出已存键名）。
 */
const backend = new Map<string, string>()

const proto = Storage.prototype
const METHODS = ['setItem', 'getItem', 'removeItem', 'key', 'clear', 'length']
const def = (key: string, value: unknown) =>
  Object.defineProperty(proto, key, { value, configurable: true, writable: true })

def('setItem', function (k: string, v: string) {
  backend.set(String(k), String(v))
})
def('getItem', function (k: string) {
  const v = backend.get(String(k))
  return v === undefined ? null : v
})
def('removeItem', function (k: string) {
  backend.delete(String(k))
})
def('key', function (i: number) {
  return Array.from(backend.keys())[i] ?? null
})
def('clear', function () {
  backend.clear()
})
Object.defineProperty(proto, 'length', { get: () => backend.size, configurable: true })

function makeStore(): Storage {
  const target: Record<string, string> = {}
  const store = new Proxy(target, {
    get(t, k, r) {
      if (typeof k === 'string' && backend.has(k)) return backend.get(k)
      return Reflect.get(t, k, r)
    },
    set(t, k, v) {
      if (typeof k === 'string' && !METHODS.includes(k)) backend.set(k, String(v))
      return true
    },
    deleteProperty(_t, k) {
      if (typeof k === 'string') backend.delete(k)
      return true
    },
    ownKeys() {
      return Array.from(backend.keys())
    },
    getOwnPropertyDescriptor(_t, k) {
      if (typeof k === 'string' && backend.has(k)) {
        return { enumerable: true, configurable: true, writable: true, value: backend.get(k) }
      }
      return undefined
    },
  })
  return Object.setPrototypeOf(store, proto) as Storage
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const store = makeStore()
  Object.defineProperty(globalThis, name, { value: store, configurable: true, writable: true })
  const w = (globalThis as { window?: unknown }).window
  if (w && typeof w === 'object') {
    Object.defineProperty(w, name, { value: store, configurable: true, writable: true })
  }
}
