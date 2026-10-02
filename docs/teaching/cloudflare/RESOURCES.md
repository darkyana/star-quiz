# Cloudflare 概念教学 Resources

所有链接均于 2026-09-02 验证真实可达、标题相符。正文引用一律从本表取链接。

## Knowledge

- [Cloudflare Fundamentals 官方文档](https://developers.cloudflare.com/fundamentals/)
  Cloudflare 全家桶的总目录与通用概念（账号、域名接入、跨产品术语）。用于：想知道「Cloudflare 一共有哪些产品、某词属哪个产品」时从这里进门。
- [Cloudflare Learning Center：What is DNS?](https://www.cloudflare.com/learning/dns/what-is-dns/)
  官方科普：DNS 是互联网的电话簿，把域名翻译成 IP。用于：理解「孩子设备怎么找到你的域名」的第一步。
- [Cloudflare Learning Center：What is a CDN?](https://www.cloudflare.com/learning/cdn/what-is-a-cdn/)
  官方科普：CDN 把内容缓存在离用户近的服务器上。用于：理解「为什么文件从 Cloudflare 边缘吐出来、大陆可达靠谁」。
- [MDN：How the web works](https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works)
  权威入门：客户端/服务器、DNS、HTTP 请求往返的完整链条。用于：第一课的主推荐读物，补齐 DNS/CDN 之外的地基。
- [MDN：What is a Domain Name?](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_domain_name)
  域名的结构与购买/注册常识。用于：分清「域名 vs 网址 vs 托管」时查它。
- [Cloudflare Pages 官方文档](https://developers.cloudflare.com/pages/)（自定义域见 [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)）
  Pages = 托管静态站点、连 GitHub 自动部署。用于：现役部署「push 到 main 就上线」这块拼图，及自定义域挂在 Pages 项目上。
- [Cloudflare Workers 官方文档](https://developers.cloudflare.com/workers/)（路由见 [Routing](https://developers.cloudflare.com/workers/configuration/routing/)，定时任务见 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)）
  Workers = 在边缘跑代码的计算平台。用于：将来态拼图——同步请求经路由进 Worker、Cron 每日快照。
- [Cloudflare D1 官方文档](https://developers.cloudflare.com/d1/)
  D1 = Cloudflare 的 SQL 数据库。用于：将来态拼图——云端账本数据的归宿。
- [Cloudflare KV 官方文档](https://developers.cloudflare.com/kv/)
  KV = 读多写少的快速键值存储。用于：分清「KV 和 D1 的分工」即可——star_quest 锁定栈没用它，账本式数据归 D1。

## Wisdom (Communities)

- [Cloudflare Community 官方论坛](https://community.cloudflare.com/)
  Cloudflare 官方社区，免费版用户的主要求助渠道（有 Cloudflare 员工与 MVP 参与）。用于：真出线上问题时的公开求助/搜旧帖。按需使用，不强求加入——日常第一求助对象仍是你的 AI。

## Gaps

- **大陆可达性视角的一手中文资料缺**：现有高信资源全是英文官方文档；面向「大陆访问 Cloudflare 链路」的中文一手资料未见可靠来源。该结论来自仓内研究（#80 及 ADR 0003 备胎条款），非外部资源检索所得，不硬凑。若后续真遇到大陆可达性劣化，再由 teach 会话专项检索。
