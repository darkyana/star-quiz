// Worker 运行时环境绑定（票 #254 公共约定收口）：Env 独立成模块，
// 业务模块与入口共用同一份定义，入口（index.ts）不再被反向依赖。

export interface Env {
  /** CORS 允许源（精确匹配单源）；dev 默认本地 Vite 端口，生产值部署时注入 */
  ALLOWED_ORIGIN: string
  /** D1 绑定（同步域库表，migrations/ 版本化迁移，ADR 0005 定稿） */
  DB: D1Database
}
