// #248 契约测试加载声明：golden 名单经 vite 管线 ?raw 内联（workerd 沙箱无磁盘 fs，
// readFileSync 打不开仓库路径——见 sync-domains.test.ts 头注）。ambient 通配声明须在
// 脚本文件（无顶层 import/export）内才生效，模块内 declare module 会被判为增强（TS2664）。
declare module '*/sync-domains.golden.json?raw' {
  const goldenContent: string
  export default goldenContent
}
