# 研究：Capacitor 壳 App 路线的真实成本（不上架分发）

- 日期：2026-08-30
- 票据：#81（Part of #78 地图）
- 性质：纯研究，零代码改动
- 方法：一手来源优先（Apple 官方文档 / WebKit 官方博客 / Capacitor 官方文档），辅以带日期的二手口径；每条标注来源与查证时间（均为 2026-08-30）。事实与判断分开标注，未确证处显式声明。

## 现状输入（决策的公共事实）

来自 #78 基线与仓库盘点（`main` @ 1bb0ee5）：

- 纯前端 Vue 3 + Vite，hash 路由，`public/manifest.webmanifest` 已 standalone。
- **无 Service Worker**：`public/` 仅有 manifest，`vite.config.ts` 无任何 PWA 插件，`src` 无 SW 注册代码 → 当前主屏 PWA 打开即需网络。
- 数据全在 localStorage（~5MB 上限，现况远未到顶）。
- 部署：GitHub `darkyana/star-quiz` 经 Cloudflare Pages 前置，大陆网络可达性是既有变量。
- 已有学习文件/经济文件双轨导出导入（逃生舱契约，任何阶段不得破坏）。
- 用户画像：无原生开发经验、厌恶风险；孩子用家长一台 iPad（iOS 主战场）。

## TL;DR

1. **分发没有「装一次就一劳永逸」的路**：免费账号 7 天一签（每周仪式）；Ad Hoc 每年续期 + 每次改版线缆重装；TestFlight 每 90 天必须重传构建（代码零改动也要），否则孩子在 iPad 上点不开 App。
2. **包装工程量本身很小**（静态 Vite 产物天然适配，首次 1–2 天），**长期负担在于原生工具链与分发仪式的年复一年**。
3. **「怕丢数据」这个第一痛点的实质改善有限**：主屏 PWA 的存储本来就豁免 ITP 7 天清空且与 Safari 隔离（WebKit 官方口径）；壳 App 里的 localStorage/IndexedDB 仍是 WKWebView 瞬态存储、同样受存储压力驱逐（Capacitor 官方口径）。真要稳，得迁原生 Preferences/SQLite——那是改代码，不是包个壳。
4. 壳 App 的真实增量：真离线（但 PWA 加 Service Writer 也能平价买到）、无服务器的本地通知（壳独有）、清 Safari 数据不再波及应用数据。
5. **判断结论：当前不建议启动壳 App 路线**。增量收益配不上增量成本；「怕丢数据」的正解在数据安置/备份票，不在壳。

---

## ① 分发路径：不上 App Store 时，壳 App 怎么装到孩子的 iPad 上

iOS 不允许「装一次永远能用」的未上架分发。三条路的官方口径：

| | 免费 Apple ID（Xcode Personal Team） | 付费个人账号 $99/年 + Ad Hoc | 付费个人账号 $99/年 + TestFlight |
|---|---|---|---|
| 费用 | ¥0 | $99/年 | $99/年 |
| 装机方式 | Mac + Xcode 线缆直装 | 打 .ipa + 注册设备 UDID + 线缆（Xcode/Apple Configurator） | TestFlight App + 邀请链接（无线） |
| 有效期 | **7 天**后 App 拒绝启动 | 描述文件最长 **1 年**（且受账号续期日约束），过期拒绝启动 | 每个构建上传后 **90 天**过期，过期 TestFlight 拒绝启动 |
| 设备/人数上限 | 每平台 **3 台**测试设备、同时 **10 个** App ID（各 7 天过期） | 每产品族每会员年 **100 台**（开发+Ad Hoc 共享池） | 内部 100 人（须为 App Store Connect 用户）；外部 10,000 人 |
| 维持动作 | **每周**重签重装（52 次/年） | **每年**续账号→重做描述文件→重打包→线缆重装；每次改版也要线缆重装 | **每 ≤90 天重传一次构建**（4–5 次/年，零改动也要）；外部测试每版本首个构建过 Beta App Review |
| 首次额外门槛 | iPad 开开发者模式 + 信任开发者 | 同左（.ipa 安装明确要求 Developer Mode） | 孩子 iPad 装 TestFlight App + 接受邀请；首次需 Beta App Review（外部） |

事实来源：

- 免费 7 天 / 3 设备 / 10 App ID：Apple 官方「Choosing a Membership」——Personal Team「App IDs…limited to 10 and each expires after 7 days；test devices…limited to 3…；Provisioning profiles will expire 7 days from issuance, which may require you to rebuild and re-install your app」（现行页面，2026-08-30 查证）。developer.apple.com/support/compare-memberships/
- Ad Hoc 100 台/产品族/会员年、年中禁用不返还名额、会员年起点才可重置清单：Apple 官方 Account Help「Devices overview」。developer.apple.com/help/account/devices/devices-overview
- Ad Hoc/开发描述文件最长 1 年、受账号余期约束、过期后 App 留在设备上但拒绝运行：Apple 开发者论坛 DTS 工程师（KMT）口径。developer.apple.com/forums/thread/92953、thread/115245
- .ipa 安装需 Developer Mode、装法为 Xcode/Apple Configurator：Apple 官方 Xcode 文档「Distributing your app to registered devices」。developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices
- TestFlight 构建最长 90 天、内部 100（ASC 用户）/外部 10,000、外部首个构建需审核：Apple 官方「TestFlight 概述」。developer.apple.com/cn/help/app-store-connect/test-a-beta-version/testflight-overview/
- 过期 TestFlight 构建无法再启动（"This beta has expired"，无任何豁免或延期）：多份 2026 年二手口径一致（aitoolsguidebook 2026-06、drizz.dev 2026-06）。
- 免费重签后**应用数据保留**（只重置授权）：bryanfosler/til（2026-02 实测记录）。

本场景映射（判断）：一台孩子的 iPad + 家长自己维护。免费路线的每周仪式对「厌恶风险、无原生经验」不可接受；Ad Hoc 把频率降到每年 1 次 + 每次改版 1 次，但每次都要线缆和 Xcode；TestFlight 免线缆、孩子侧体验最好，但接受「每 90 天必须重传一次，否则 App 打不开」的永久节奏，且走 App Store Connect 体系（2026-04-28 起上传必须 Xcode 26/SDK 26，见②）。

> 注：EU 侧载/DMA 市场与 Apple 企业证书（$299 In-House）不适用本场景（中国大陆、个人、企业证书滥用会被吊销），不展开。

## ② 工程与维护：Capacitor 包装现有 Vite 应用

### 工程量（首次）

Capacitor 现状（2026-08）：v8（8.3.x，最新 minor 2026-03 发布），要求 **Node 22+ / Xcode 26.0+ / iOS 15+**，新 iOS 项目默认 Swift Package Manager。来源：capacitorjs.com/docs（v8 文档站）、Updating from Capacitor 7 to 8、GitHub issue #8325（2026-02）。

官方接入流程即四步：`npm i @capacitor/core @capacitor/cli` → `npx cap init`（webDir 指 `dist`）→ `npx cap add ios` → 每次发布 `npm run build && npx cap sync`。前提仅三条：有 package.json、有构建产物目录、产物根有 index.html。来源：capacitorjs.com/docs/getting-started。

对 star_quest 的具体判断：

- **无架构阻断**。本应用是纯静态 SPA（hash 路由、无 SSR、无 OAuth/Server Action），正是 Capacitor 的最佳适配形态。对照组：poke-memory（2026-05 spike）因其 Next.js SSR 架构静态导出被 Server Actions/POST Route Handlers/OAuth PKCE 三重阻断，被迫走远程 URL 模式并连带失去 Service Worker 与 Web Push，总估 8–16 天、结论放弃；本应用不沾其中任何一项。
- 首次工程量估算（判断，含无原生经验学习曲线与 Xcode 安装）：**1–2 个工作日**出第一个能跑的壳；此后每次发布「build + sync + Xcode 出包」为分钟级到半小时级。
- 建议但非必需的代码改动：把 localStorage 读写桥接到 `@capacitor/preferences`（原生 UserDefaults），理由见③；当前读写面单一且有测试覆盖，估 **0.5–2 天**。

### 长期维护（年度，无原生经验个人的口径）

事实基础：

- Apple 工具链年度节奏：Xcode 大版本每年 1 次（秋季）；**2026-04-28 起 App Store Connect 只收 Xcode 26 / iOS 26 SDK 构建**（Apple「Upcoming Requirements」；影响 TestFlight 路径；Ad Hoc 不经 ASC 不受此硬约束，但为新 iOS 出包仍需跟进 Xcode）。
- Capacitor 大版本约每年 1 次，且会抬工具链门槛（7→8 即要求 Xcode 26 + Node 22 + iOS 15）。
- 分发维持动作见①（TestFlight 4–5 次/年重传；Ad Hoc 年度证书/描述文件/重装）。

年度时间估算（判断）：**Xcode + Capacitor 升级与回归 1–2 天 + 分发仪式 0.5–1 天/次**；另有一项结构性成本——**每次功能更新 = 重新出包 + 重新分发**（PWA 是部署即全设备生效）。对自家单一 iPad 这个数字不大，但它把「发个改动」从 5 分钟变成半小时到半天，且任何一环（证书、描述文件、Xcode 版本、iOS 升级）出问题都需要原生侧排障能力。

## ③ 能力差：壳 App 相比主屏 PWA 真正多买到什么

### A. 存储持久性（本票特别查证项）

结论先行：**「壳 App 存储 > 主屏 PWA 存储」不成立为一般命题**。分层口径：

- **7 天 ITP 清空：主屏 PWA 本来就豁免。** WebKit 官方（现行 tracking-prevention 页）：ITP 确有「7 天无交互即删全部脚本可写存储（IndexedDB、LocalStorage、SessionStorage、Service Worker 注册与缓存等）」的上限，但同一页明确「**主屏 Web App 的一方域名豁免该 7 天上限**，ITP 始终跳过该域名；且主屏 Web App 的网站数据与 Safari 保持隔离，不受 Safari 侧 ITP 分类影响」。即：孩子 iPad 上已加主屏的 star_quest，其 localStorage 不会被 7 天机制清掉；该恐惧只适用于「只在 Safari 标签页访问、不加主屏」的用法。
- **存储压力驱逐：两边同样面对。** WebKit 官方存储策略（2023-08，Safari 17/iOS 17 起）：驱逐三条件——超总配额、系统存储压力、长期无交互（ITP）；按 origin 整删、LRU；主屏 Web App 与浏览器同配额（origin 约 60% 磁盘）。壳 App 一侧，Capacitor 官方存储指南明说：localStorage「**必须视为瞬态**——设备空间紧张时 OS 会回收 WebView 的 local storage」，IndexedDB 在 iOS 同理；要稳需用 Preferences API（UserDefaults）或 SQLite 插件。也就是说，包上壳之后数据仍躺在 WKWebView 数据仓里，同受存储压力驱逐——除非做③之外的存储迁移改码。
- **壳 App 的真实增量是「隔离边界」，不是「更强的持久化机制」**：清 Safari「网站数据」清不到 App 容器；不存在「误删主屏图标」这种 PWA 特有的意外（但删 App 本身同样全丢，严重度等同）；App 容器数据随 iCloud 备份/换机迁移恢复（iOS 标准行为）。
- **未找到可靠口径**（显式声明）：① Apple 无单页直说「删除主屏 Web App 图标即删除其数据」；#78 基线已将「删主屏图标」列为现实风险，保守按会丢处理。② 清 Safari 网站数据是否波及主屏 Web App 数据：WebKit 只声明不受 ITP 分类影响，未见官方单页；基线按「清网站数据=风险」保守处理。③ 主屏 Web App 数据是否随整机备份/换机恢复：未找到官方口径，不下重注。

### B. 推送与通知

- 主屏 PWA：iOS 16.4+ 支持 Web Push 与 Badging（**仅限已加主屏的 Web App**，Safari 标签页内不可用；WebKit 官方博客 + Apple 论坛官方回复）。但 Web Push 需要一台推送服务器经 APNs 发——本应用无后端。
- 壳 App：可用 `@capacitor/local-notifications` 做**无需服务器的本地通知**（如发布窗口 20:00 提醒、每周日窗口提醒）——这是对本产品最实在、且 PWA 买不到的能力（PWA 在 iOS 上没有可靠的本地通知调度）。原生 APNs 推送本应用用不上。
- 反向损失：WKWebView 默认不运行 Service Worker（需 App-Bound Domains 且限 10 个域）。对本应用当前无影响（现在也没有 SW）；若未来 PWA 侧上了 SW，壳内需另行评估。

### C. 离线

- 现状：PWA **无 Service Worker（仓库事实）**→ 主屏 PWA 打开需要网络，可达性押在 Cloudflare Pages 上。
- 壳 App 打包全部静态资源 → **完全离线可用**。这是真实增量，也实质缓解大陆网络可达性焦虑。
- 但此增量**并非壳独有**：PWA 加 `vite-plugin-pwa` 即可获得离线，成本远低于壳路线。买离线不是上壳的理由。

### D. 其他（判断级，非决策依据）

独立全屏体验与图标更「像 App」；孩子不会误入 Safari 界面；启动图可控。代价：自动更新变成手动出包分发（PWA 刷新即最新）。

## ④ 结论导向：对「孩子用家长 iPad」，增量收益配得上增量成本吗？

增量收益盘点（诚实版）：

| 收益 | 成色 |
|---|---|
| 真离线 | 真实，但 PWA + Service Worker 平价可得 |
| 无服务器本地通知 | 壳独有；当前非刚需（#78 把通知列为「等形态定了再问」） |
| 存储「更稳」 | **基本不成立**：主屏 PWA 已豁免 7 天 ITP；壳内同为 WKWebView 瞬态存储、同受存储压力驱逐 |
| 清 Safari 数据不波及 | 真实的隔离边界增量，但触发场景（清网站数据）本可由行为规避 + 导出习惯兜底 |
| 换机恢复 | 口径未确证，不下重注 |

增量成本盘点：

- 首次：壳工程 1–2 天 + （建议的）存储桥接 0.5–2 天 + $99/年（若付费路线）。
- 持续：免费路线每周仪式（不可接受）／Ad Hoc 每年 1 次 + 每改版 1 次线缆仪式／TestFlight 每 90 天强制重传；Xcode/Capacitor 年度跟进 1–2 天；**每次功能更新从「部署即生效」退化为「出包+重装」**；任何签名/证书/iOS 升级问题需要原生排障能力——与「无原生经验、厌恶风险」直接冲突。

判断（明确标注为判断）：

1. 第一痛点「怕丢数据」的解药在**数据安置与备份/同步**（#78 地图的正题，另有决策票），不在壳。壳对存储持久性几乎无所增益；而孩子的数据防线（定期导出/云端备份）在 PWA 形态下同样可建成。
2. 壳 App 引入的是**一条永久运转的原生分发流水线**，其运维频率（7 天/90 天/1 年）由 Apple 政策决定、不由我们控制，对个人自用场景是持续的真实负担。
3. 与 #78 已锁定的「App Store 上架路线已降优先」同理，**壳 App 路线当前不建议启动**。建议在「产品形态选型」决策票中记录以下重评触发条件（任一出现再议）：a) 主屏 PWA 数据在 iOS 升级中实际受损且无法归因/规避；b) 无服务器本地通知升级为刚需；c) 大陆网络对 Cloudflare Pages 的可达性长期不稳且 SW 缓存不足以兜底；d) 出现必须原生能力的功能需求。

## 来源清单（均为 2026-08-30 查证）

**Apple 官方**

- Choosing a Membership（免费 Personal Team 限制）：https://developer.apple.com/support/compare-memberships/
- Devices overview（Ad Hoc 100 台/产品族/会员年、清单重置规则）：https://developer.apple.com/help/account/devices/devices-overview
- TestFlight 概述（90 天、内部 100/外部 10,000、外部首构建审核）：https://developer.apple.com/cn/help/app-store-connect/test-a-beta-version/testflight-overview/
- Distributing your app to registered devices（Ad Hoc 流程、UDID、Developer Mode 要求）：https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices
- Certificates（过期影响）：https://developer.apple.com/support/certificates/
- 开发者论坛 DTS（KMT）：分发路径与描述文件有效期 https://developer.apple.com/forums/thread/92953 ；Ad Hoc 到期行为 https://developer.apple.com/forums/thread/115245
- 论坛官方回复：iOS 16.4+ 主屏 Web App 支持 Web Push（Safari 标签页不支持）：https://developer.apple.com/forums/thread/732594

**WebKit 官方**

- Tracking Prevention in WebKit（7 天脚本存储上限；主屏 Web App 豁免且与 Safari 隔离）：https://webkit.org/tracking-prevention/
- Updates to Storage Policy（2023-08；配额与驱逐三条件；主屏 Web App 同浏览器配额）：https://webkit.org/blog/14403/updates-to-storage-policy/
- Web Push for Web Apps on iOS and iPadOS（2023-02，iOS 16.4 Web Push/Badging 仅主屏 Web App）：https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit bug 181849（主屏 App 与 Safari 存储隔离为设计行为）：https://bugs.webkit.org/show_bug.cgi?id=181849

**Capacitor 官方**

- Installing Capacitor（接入既有 Web 应用流程）：https://capacitorjs.com/docs/getting-started
- Data Storage in Capacitor（localStorage/IndexedDB 须视为瞬态、OS 空间紧张会回收）：https://capacitorjs.com/docs/guides/storage
- Updating from Capacitor 7 to 8（Xcode 26+ / Node 22+ / iOS 15+ / SPM 默认）：https://capacitorjs.com/docs/updating/8-0
- GitHub issue #8325（2026-02，v8 环境要求）：https://github.com/ionic-team/capacitor/issues/8325

**同型案例与二手口径（带日期，仅作旁证）**

- poke-memory spike：Capacitor 包装 PWA 评估（2026-05，SSR 架构阻断 + 维护清单 + WKWebView 限制）：https://github.com/Frazzled-Productions/poke-memory/issues/1065
- TestFlight 90 天到期行为与限额汇总（aitoolsguidebook，2026-06；drizz.dev，2026-06）
- 免费账号侧载现状（builds.io，2026-07；bryanfosler/til，2026-02，含重签数据保留实测）
- Apple Xcode 26 上传要求（Capgo 转述 Apple Upcoming Requirements，2026-08）：https://developer.apple.com/news/upcoming-requirements/
