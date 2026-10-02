# Pages 静态资源与 404（#213）

## 配置落点

Vite 将 `public/404.html`、`public/_redirects`、`public/_headers` 原样复制到 `dist/`，随 Cloudflare Pages 构建发布；无需部署同步 Worker。

- 顶层 `404.html` 关闭 Pages 默认的「所有 miss 都返回 index.html」行为。缺失的 `/assets/*`（以及其他不存在的静态文件）返回真正的 404，正文不含应用入口。
- `_redirects` 仅对现有页面路径做 200 rewrite。不要添加 `/* /index.html 200` 或静态目录 rewrite，否则会复发。未知非 hash 路径返回 404；新页面如需非 hash URL 的 shell fallback，在此增加精确规则。
- 应用仍使用 hash router。`/#/quiz` 的 hash 不会发给服务器，直开和刷新请求的是 `/`。非 hash rewrite 只提供 shell，不把 `/quiz` 转成 `/#/quiz`，与原 fallback 行为相同。
- `_headers` 对响应要求 `no-cache, must-revalidate`（允许存储，但复用前必须验证）。本次不加 immutable：目录级 header 也会命中资源 miss，不应把 404 长期缓存。未改名的游戏文件同样需要重验证。

根因及平台语义：[Cloudflare Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)。无顶层 404 时默认启用 SPA fallback；顶层 404 加页面白名单避免把 HTML 当成 CSS/JS。此修复不能自动恢复已经打开的旧页面，也不能追溯清除浏览器已有的旧缓存。

## 回归与发布验收

```sh
npm ci
npm run test:pages
```

`test:pages` 构建后把产物复制到临时项目，以空 Pages 配置启动全新 runtime，分配临时端口，执行 HTTP 回归并在退出时清理进程和临时目录；CI 的 Pages job 运行同一命令。任何构建、启动或断言失败均返回非零退出码。

Pages 使用根项目固定版本的 Wrangler，不能改为调用 `worker/node_modules` 中的版本：Wrangler 会从内部静态 shim 的路径向上发现配置，单独改变 cwd 仍可能读到 `worker/wrangler.jsonc`。此命令不加载同步 Worker 的 D1/Cron 绑定，也不需要 Cloudflare 凭据。

每次验证启动新进程，避免 `_redirects`、`_headers` 的旧规则留在内存。不要用 Vite preview 判断 Pages 规则是否生效。

脚本断言：不存在的 CSS/JS/嵌套图片为 404 且不是应用 HTML；首页、hash URL、页面 rewrite 为应用 HTML；首页引用的真实 CSS/JS 为 200 且 MIME 正确；首页与错误响应要求重新验证或禁止存储。真实哈希资源允许正常缓存：本次线上验收中，自定义域的 JS 响应仍为 `max-age=14400, must-revalidate`（带全新查询参数的 MISS 也一样），而首页为 `no-cache, must-revalidate`、资源 miss 为 `no-store`。具体域级覆盖配置尚未读取确认，本次不修改；不能将仓库 `_headers` 等同于所有线上响应的最终策略。

发布后对预览地址和生产地址运行同一脚本：

```sh
node tools/verify-pages.mjs https://starquiz.link
```

另在浏览器直开首页和 `/#/quiz` 并刷新，确认渲染正常（HTTP 脚本不替代浏览器渲染验收）。若本地/预览通过但自定义域仍失败，检查该域 Cloudflare Cache Rules 或遗留缓存；不要未经确认清空整站缓存。线上脚本与浏览器验收通过前，不关闭 #213。
