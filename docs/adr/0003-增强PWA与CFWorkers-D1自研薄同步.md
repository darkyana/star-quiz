# 增强 PWA 形态与 Cloudflare Workers/D1 自研薄同步

star_quest 下一形态两个拍板（决策票 #83，2026-08-30）：

1. **产品形态 = 增强 PWA**：维持主屏安装（孩子 iPad 桌面图标不变、无需重装任何东西），「增强」= 补 Service Worker 真离线（现役无 SW，断网连壳都打不开）+ 接云同步（语义见 ADR 0002）。
2. **同步引擎 = Cloudflare Workers + D1 自研薄同步（¥0）**：ADR 0002 分域合并语义的实现载体；Cloudflare 账号复用现役部署（域名与大陆可达链路已被日常使用验证）。

## Considered Options

- **Capacitor 壳 App**（否决）：三条不上架分发路皆有周期性仪式（免费 7 天 / TestFlight 90 天 / 证书年审），壳内存储与主屏 PWA 同受驱逐——增量收益配不上增量成本；重评触发条件 4 条见 `docs/research/2026-08-30-capacitor-shell-cost.md`，触发时重开此决策。
- **云端 Web / 云优先**（否决）：孩子主屏图标入口退化为书签、Web Push 通道资格丢失、断网即瘫——与 ADR 0002 本地优先直接矛盾。
- **现成同步引擎（PowerSync / Electric / PouchDB 类）**（否决）：与分域合并语义贴合失败或可达性/预算出局，逐项核实见 `docs/research/2026-08-30-sync-engine-options.md`。
- **CloudBase 个人版 ¥19.9/月**（备而不用）：境内直连、境内存储合规更稳；代价为无回档（快照全自建）、多一个服务商、月费。备胎触发条件：①Cloudflare 链路大陆可达性实际劣化影响孩子使用；②免费档限额被真实数据逼近；③家庭对境内数据存储合规要求升级。

## Consequences

- Service Worker 离线随迁移路线（#86）实施：vite-plugin-pwa 一次性接入；SW 更新策略需考虑新版本发布后孩子端生效时机。
- 合并逻辑按 ADR 0002 分域表自写（TS、客户端为主）；Worker 提供：增量上传/冷启动拉取、服务器时间戳（闭合 ADR 0002 时钟缺口）、每日快照（Cron ×30 天）、家庭码门禁（门禁细节归设备角色票 #84）。
- 免费档限额富余约三个数量级（D1 写 10 万行/天 vs 现实 KB 级）；逃生舱 `wrangler d1 export` 标准 SQL。
- 提醒/通知不纳入本次迁移路线：留后续独立功能票，任何实施前置实测大陆 APNs 可达性（未确证项，见 #79 附录）。
