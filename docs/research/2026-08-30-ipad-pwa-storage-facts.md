# 研究：iPad 场景下 PWA 存储持久性与平台能力事实（2026-08）

- 票据：#79（Part of #78）
- 日期：2026-08-30 ｜ 研究执行：agent/79 房间
- 方法：以 WebKit 官方博客 / Apple 官方文档为一手来源，MDN·caniuse 为权威二手，开发者论坛与真实项目事故为案例佐证；逐条挂来源编号（见[§7 来源清单](#7-来源清单)）。查证窗口优先 2023–2026 口径。
- 读法约定：**F** = 有来源的事实；**J** = 基于事实的判断（决策票引用时请注明是判断）。每条标注置信度：官方一手 / 权威二手 / 多来源一致 / 单一社区报告。

## 0. 结论速览

1. **「Safari 浏览器内」与「主屏 Web App」是两套存储策略**——ITP 的 7 天脚本可写存储上限只清 Safari 内的站点，主屏 Web App 被官方明确豁免（F2.2）。网上大量「iOS 7 天清 PWA 数据」「50MB 上限」说法是两者混淆的讹传（F2.8）。
2. 主屏 Web App 的真实丢失入口按概率排序：**人为动作**（删图标、清 Safari 数据、换机）＞ **存储压力驱逐**（可用 `navigator.storage.persist()` 显著压低）＞ **偶发不可归因**（iOS 升级/崩溃后，社区有报告、无官方口径）＞ **平台政策黑天鹅**（2024-02 EU 事件，5 天内反转）。
3. 配额完全不构成威胁：localStorage ~5MB/origin（现状用量远未到顶，与 #78 基线一致）；IndexedDB 等在 iOS 17.0+ 按「磁盘 60%」计 origin 配额，主屏 Web App 与 Safari 同等待遇（F3.1）。
4. 能力面 2026 年现状：主屏 Web App 支持 Web Push（16.4+，仅主屏可用）、Badging、离线（Service Worker/Cache），iOS 26 起「任何站点加主屏默认即 Web App」（F4.x）。
5. **本地优先在 iPad 主屏场景站得住，但不是免死金牌**（§6）：日常持久性有三重结构性豁免，剩余风险集中在人为与换机——恰好是云备份/导出逃生舱能覆盖的形状。

---

## 1. 核心概念：两种运行形态，两套存储分区

- **F1.1**（官方一手，[S4]）主屏 Web App = Safari「添加到主屏幕」安装的独立应用：出现在 App Switcher、独立于 Safari 的窗口、通知按应用管理。manifest `display: standalone/fullscreen` 即成为 Web App；无 manifest 的添加在 iOS 16.4+ 作为书签在默认浏览器打开。
- **F1.2**（官方一手，[S4]）iOS 支持同一 Web App 安装多份（Manifest ID + 自定义名称区分实例）；**每个安装实例有各自独立的数据持有**（另见实践佐证 [S11]：主屏 App 运行在独立 WebKit 容器、存储与浏览器分开）。
- **F1.3**（官方一手，[S9] Apple DMA 声明原文）Apple 自述主屏 Web App 的架构特征是「per-site 的存储隔离」（isolation of storage），并以此为安全模型的一部分。
- **推论（判断 J1.1）**：star_quest 孩子端主屏图标里的 localStorage，与「家长在 Safari 里打开同一网址」看到的是**不同分区**；但同一图标实例内的数据是唯一真身，删图标即删真身（见 F2.5）。

## 2. 存储丢失风险：逐触发器事实清单

### 2.1 ITP 7 天上限——**不适用主屏 Web App**

- **F2.1**（官方一手，[S1]）ITP 对 **Safari 内**站点的脚本可写存储（IndexedDB、localStorage、media keys、sessionStorage、Service Worker 注册与缓存）实施 7 天上限：连续 7 天使用 Safari 而未与该站点交互 → 整站非 cookie 网站数据删除。
- **F2.2**（官方一手，[S1]）WebKit 官方博客专节《A Note On Web Applications Added to the Home Screen》原文：主屏 Web App「不是 Safari 的一部分，拥有自己的使用天数计数器，其计数与实际使用一致并重置计时器。我们**预期**此类 Web App 中第一方的网站数据不会被删除。如果你的 Web App 确实发生数据删除，请报告——我们会视之为**严重 bug**。」
- **F2.3**（专家二手 [S10] + 实践二手 [S11]）2024-02 EU 事件期间的多方技术复盘均确认：「主屏 Web App 此前豁免于 Safari 的 7 天脚本可写存储上限」是社区与 Apple 共同认知。
- **判断 J2.1**：孩子哪怕假期两周不打开 App，主屏 Web App 数据**不应**因 ITP 被清。该豁免是结构性的（不在 Safari 计数器内），非偶然容忍。

### 2.2 存储压力 / 配额驱逐

- **F2.4**（官方一手，[S2]）WebKit 驱逐规则：仅当①超出整体配额、②系统存储压力、③长期无交互（ITP 语境）时触发；按 **origin 整体** LRU 删除；**persistent mode 的 origin 豁免驱逐**。默认所有 origin 为 best-effort（可被驱逐），可通过 Storage API 申请 persistent。
- **F2.5 同源加固**（官方一手，[S2]）`persist()` 的授予启发式明确包含「**该网站是否以主屏 Web App 形式打开**」——即主屏形态本身有利授予；且 Safari 17.0 修复了「storage mode 跨会话不被记住」的关键 bug（[S3]）。
- **案例**（单一社区报告，[S12]）Apple 开发者论坛（2023-05 起，2024-05 更新）：有开发者实测主屏 PWA 的 IndexedDB 在「设备低存储」与「Safari 移除网站数据」时被清；另一开发者报告隔夜随机清空（间隔仅 24h、与 7 天规则无关，无 Apple 员工回应）。

### 2.3 删除主屏图标

- **F2.6**（多来源一致，未见官方单句文档；[S10][S11] + [S9] 语境）删除主屏 Web App 图标 = 删除该实例的独立数据持有。EU 事件中 Apple 把主屏 App 降级为书签时，所有已存数据（IndexedDB/localStorage/sessionStorage/media keys/SW 注册与缓存/OPFS）无预警不可逆丢失（[S10] 逐项清单），反向印证「数据跟着图标实例走」。
- **判断 J2.2**：孩子误触/家长清理桌面删掉星星图标 = 数据全灭。这是**概率最高**的丢失入口，且无任何系统确认对话框保护（iOS 删图标只问「删除 App？」不提数据）。

### 2.4 清 Safari 数据（设置 → Safari → 清除历史记录与网站数据 / 高级 → 网站数据）

- **F2.7**（单一社区报告，[S12]）有开发者报告「Safari 移除网站数据」连带清掉了主屏 PWA 的 IndexedDB。**未找到 Apple 官方口径**说明该入口是否波及主屏 Web App 分区。
- **判断 J2.3**：保守假设**会清**。共用 iPad 场景下这是家长最顺手执行的「清理」动作之一，风险敞口真实存在。

### 2.5 iOS 系统升级 / 崩溃

- **F2.8**（案例佐证，[S12][S14]）未找到 Apple 官方承认「iOS 升级清空主屏 Web App 数据」的口径，也未找到可复现的升级清空报告；社区报告的偶发丢失（隔夜随机、崩溃后）均未能归因到明确机制。
- **真实项目案例**（[S14]，2026-06，高可信——公开 repo 带完整复盘）：儿童向 localStorage-only PWA「starlog」两次用户报告崩溃重开后**全库丢失**；根因之一是 WebKit 在内存压力/崩溃后丢弃 localStorage，叠加「读失败→内存态置空→下次写盘用空态覆盖好数据」的应用层放大。修复 = `persist()` + 空读写保护 + 迁 IndexedDB + 滚动快照。
- **判断 J2.4**：iOS 升级风险应记为「偶发、低概率、不可归因」，而非确定性威胁；但**应用层写空放大**是确定性可防的（见 J6.3）。

### 2.6 换机 / 备份迁移

- **F2.9**（单一社区报告，[S13]）Apple 开发者论坛 2022-02：有开发者观察主屏 PWA 状态**未包含**在设备加密备份中。**未找到官方口径**。
- **判断 J2.5**：换 iPad = 主屏 Web App 数据大概率不迁移（图标本身可恢复布局，数据不可）。#78 已把「换机」列为真风险，本条为其补上事实底色（低置信但方向一致）。

### 2.7 平台政策黑天鹅

- **F2.10**（官方一手 + 可靠二手，[S9][S10]）2024-01~02：Apple 以 DMA 合规为由在 iOS 17.4 EU beta 移除主屏 Web App（降级为默认浏览器书签），意味着推送、独立存储、ITP 豁免全部失去且**已存数据全部丢失**；2024-03-01 在监管与社区压力下正式反转，声明「继续在 EU 提供现有主屏 Web App 功能」。2026-08-30 抓取 Apple DMA 页，已无任何 Web App 相关变更条目。
- **判断 J2.6**：平台级政策风险存在先例（EU 限定、beta 期、5 天反转、未殃及正式版用户）；对国内自用场景（非 EU）敞口更小，但证明了「本地单点」的政策脆弱性上限。

### 2.8 社区讹传样例（警示）

- **F2.11**（低可信来源点名，[S20]）存在流传甚广的说法如「iOS PWA 存储上限 50MB」「7 天不用即清 PWA 数据」——与官方配额政策（[S2]）和 ITP 豁免（[S1]）**直接冲突**，属于 Safari/主屏两形态混淆的讹传。后续决策票**不应**引用此类口径。

## 3. localStorage vs IndexedDB：配额与持久化

### 3.1 配额数字（iOS 17.0+，即 2023-09 起）

- **F3.1**（官方一手，[S2]）存储 API 类数据（localStorage、Cache API、IndexedDB、Service Worker、File System）的配额：
  - **origin 配额**：浏览器 app ≤ **磁盘总量 60%**；其他 app ≤ 15%；**主屏 Web App（standalone）与浏览器 app 同等待遇**。
  - **整体配额**：浏览器 app ≤ 磁盘 80%（触发驱逐的总量线）。
- **F3.2**（官方一手 [S3] + 权威二手 [S15]）历史口径：iOS 17.0 之前 origin 起始配额 ~1GB，超出后主屏 Web App 直接写入失败、Safari 内弹窗询问用户；17.0 起改为上述百分比政策且不再弹窗。
- **F3.3**（权威/实践二手，[S18][S19]）localStorage 通行实现为 **~5MB/origin**（按 UTF-16 字符计费，中文/emoji 双倍开销），写满时 `setItem` 抛 `QuotaExceededError` 且无预警。IndexedDB 无此独立小上限，吃 origin 配额。
- **判断 J3.1**：家长 iPad 哪怕只剩 10GB 可用，origin 配额也在 GB 级——**容量对 IndexedDB 完全不构成约束**；localStorage 5MB 与现状（百级题库 + 流水）之间的余量结论与 #78 基线一致，数年内到不了顶。

### 3.2 持久化能力（Storage Persistence / navigator.storage）

- **F3.4**（官方一手，[S2]；权威二手 [S16]）`navigator.storage` 的 `estimate()/persisted()/persist()` 在 **Safari/iOS 17.0 起完整支持**；更早版本不可靠（caniuse：iOS 17.0 前标记不支持 estimate）。
- **F3.5**（官方一手，[S2]）persistent mode 的效果：**豁免自动驱逐**（存储压力/整体配额 LRU）；授予启发式含「是否为主屏 Web App」。
- **F3.6**（官方一手，[S2]）注意：配额是上限非保证，仍需处理 `QuotaExceededError`；`estimate()` 出于指纹防护可能随用量/访问频率浮动。
- **判断 J3.2**：`persist()` 是一行代码级别的加固（iOS 17+ 生效），对主屏形态授予概率高；**但它只挡「驱逐」，不挡删图标、清数据、换机、ITP 之外的任何人为/迁移路径**——不要把它当备份。

### 3.3 可靠性差异

- **F3.7**（案例佐证，[S12][S13][S14]）丢数据的公开案例几乎全部发生在 **localStorage**（同步 API、崩溃/内存压力下 WebKit 可丢弃）；starlog 复盘明确将迁移 IndexedDB 作为长期加固项。
- **F3.8**（权威二手，[S15]）IndexedDB 与 localStorage 同属 best-effort 默认档、同受驱逐政策管辖——**IndexedDB 不具备政策级更强持久性**，差别在实现健壮性（事务、异步、崩溃容忍）与容量。
- **判断 J3.3**：「迁 IndexedDB = 更安全」的准确表述是**实现层更抗崩溃**（事务 + 不在崩溃路径上同步写）+ 容量天花板消失；政策层的持久性两者同级，真正的政策级杠杆是 `persist()` + 主屏形态。

## 4. 能力面：Web Push、离线、图标/启动体验

- **F4.1**（官方一手，[S4]）**Web Push**：iOS/iPadOS **16.4（2023-03）**起支持，**仅限主屏 Web App**（Safari 普通标签页不可）。标准 Push/Notifications API + Service Worker；通知与原生 app 同级（锁屏/通知中心/Apple Watch）、走 APNs、**无需 Apple 开发者计划**；订阅须由用户手势触发；支持 Focus 联动与跨设备 Focus 同步。
- **F4.2**（官方一手 [S7] + 行业二手 [S17]）**Declarative Web Push**（纯 JSON、无需 SW 常活）：iOS/iPadOS **18.4（2025-03）**起可用于主屏 Web App；2026-04 现状：iPhone/iPad 上 Web Push 仍**仅主屏可用**（macOS Safari 普通标签页 18.5 起放开）。
- **F4.3**（官方一手，[S4]）**Badging API**：16.4+，仅主屏 Web App，`setAppBadge/clearAppBadge` 可后台更新图标角标。
- **F4.4**（官方一手，[S5][S6]）**离线**：Service Worker / Cache API 长期可用；iOS 26（2025-09）起「**每个站点都可以是 Web App**」——加主屏默认按 Web App 打开（可取消勾选变书签），Safari 对「可安装性」零要求（无需 manifest/SW 也能 Web App 化）。
- **F4.5**（官方一手，[S4]）**图标/启动**：`apple-touch-icon` 优先于 manifest icons；无图标时 16.4+ 生成首字母 monogram 回退图标；独立 App Switcher 卡片；通知权限在系统设置按应用管理。iOS **无 `beforeinstallprompt`**，安装只能靠 Safari 分享菜单手动「添加到主屏幕」（多来源一致，[S20] 等）——安装引导需自绘说明页。
- **判断 J4.1**：star_quest 若要「每日提醒孩子答题」，主屏形态（已具备）+ 16.4+ 设备即可用 Web Push，**不必为提醒上壳 App**；代价是需自建推送服务端（走 APNs）。**大陆网络下 APNs 推送端点可达性未查证**——决策票若考虑此路线需补查或真机验证。

## 5. 共用 iPad（孩子主用、家长同机）注意点

- **F5.1**（官方一手，[S4] 间接）消费级 iPad 无多用户/访客模式；「Shared iPad」是教育/企业 MDM 部署形态（WebKit 条件中明确将 Shared iPad 与普通 iPad 区分对待）。孩子与家长共用 = **同一系统用户会话**，无系统级数据隔离。
- **F5.2**（官方一手，[S8]）iCloud for Safari 的同步范围**官方枚举为**：书签、阅读列表、历史记录、打开的标签页、标签页组、用户场景（Profiles）、设置、扩展——**清单不含网站数据（localStorage/IndexedDB）**。密码走 iCloud 钥匙串（另列）。
- **判断 J5.1**：主屏 Web App 的数据是**设备本地、不随 Apple ID 漂移**的——同 Apple ID 不会把孩子的 localStorage 带到家长的 iPhone/Mac，也不会被云端合并/覆盖；反过来说，**也没有任何云端副本**可救。
- **判断 J5.2**：共用机的特有风险是**家长的清理动作**（删不认识的图标、清 Safari 历史/网站数据，见 J2.2/J2.3）；Safari 的「用户场景 Profiles」是 Safari 内功能，与主屏 Web App 分区无关，不构成隔离手段（推断，基于 F1.2 分区事实）。
- **判断 J5.3**：由 F1.2（每实例独立存储），「孩子版/家长版」可做成**两个图标两个数据空间**（安装两份、不同名），不需要账号系统即可实现共用机上的角色分离——是形态决策票可用的现成机制（注意：两份数据两份丢失敞口，云备份诉求反而更强）。

## 6. 「本地优先在 iPad 上站得住吗」——判断依据

**结论（判断 J6.1）：站得住，但定位应是「本地为主 + 可靠逃生舱」，而非「本地唯一」。**

事实依据（均为上文明线）：

| 维度 | 事实 | 对本地优先的含义 |
|---|---|---|
| 日常持久性 | 主屏豁免 ITP 7 天（F2.2）；配额 GB 级（F3.1）；`persist()` 可申请且主屏有利（F2.5/F3.5） | 无人为干预时，数据「放着不动被清」的概率被三重结构性豁免压到很低 |
| 容量 | localStorage 5MB（F3.3）vs 现状用量 | 数年不触顶（与 #78 基线互证） |
| 主要丢失入口 | 删图标（F2.6）、清 Safari 数据（F2.7 保守会清）、换机不迁移（F2.9） | 全是**人为/迁移路径**，浏览器层无解，只能靠**副本**解决 |
| 偶发与技术事故 | 崩溃/内存压力丢 localStorage 有真实案例（F2.8/[S14]）；应用层写空放大可防 | 迁 IndexedDB + 空读写保护可封死这类放大器 |
| 平台政策 | EU 2024 先例：政策可在一周内威胁主屏形态与全部数据（F2.10），也证明社区力量能拉回 | 黑天鹅概率低、国内敞口更小，但证明了单点脆弱上限 |

**判断 J6.2**：决策票「数据安置」的正确问法不是「本地能不能活」（能），而是「**丢一次的代价」**：星星/流水是孩子数年积累的资产，单设备单副本存在不可恢复路径。哪怕不做云同步，仅做**定期导出到家长可达的位置**（现有双轨导出即逃生舱，#78 已锁不可破坏）或轻量云备份，性价比都远高于全量云优先。

**判断 J6.3**（无论数据安置怎么定都成立的低成本加固，供拆票）：
1. 启动即调 `navigator.storage.persist()`（iOS 17+ 生效，挡驱逐）；
2. 读失败/空读不得初始化为可写空态（starlog 事故的直接教训，[S14]）；
3. 写盘处理 `QuotaExceededError` 并可见报错；
4. 长期看迁 IndexedDB（抗崩溃 + 解容量），localStorage 保留只读迁移过渡。

**判断 J6.4**：形态决策不必被存储问题绑架——主屏 Web App 在 2026 年的能力面（推送/角标/离线/全站可装）对 star_quest 的功能诉求（答题/攒星/提醒）已够用；存储风险由数据安置票单独兜底。这与 #78「体验非本阶段 critical」的拷问结论方向一致。

## 7. 来源清单

| # | 来源 | 日期 | 类型/可信度 |
|---|---|---|---|
| [S1] | WebKit Blog（John Wilander）《Full Third-Party Cookie Blocking and More》 https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ | 2020-03-24 | 官方一手（ITP 7 天上限 + 主屏豁免原文） |
| [S2] | WebKit Blog（Sihui Liu）《Updates to Storage Policy》 https://webkit.org/blog/14403/updates-to-storage-policy/ | 2023-08-10 | 官方一手（配额/驱逐/persist 启发式） |
| [S3] | WebKit Blog《WebKit Features in Safari 17.0》 https://webkit.org/blog/14445/webkit-features-in-safari-17-0/ | 2023-09-18 | 官方一手（旧 1GB 配额史、storage mode 记忆 bug 修复） |
| [S4] | WebKit Blog（Eidson & Simmons）《Web Push for Web Apps on iOS and iPadOS》 https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ | 2023-02-16 | 官方一手（16.4 推送/角标/Manifest ID/多实例/图标） |
| [S5] | WebKit Blog《WebKit Features in Safari 26.0》 https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ | 2025-09-15 | 官方一手（全站可装为 Web App） |
| [S6] | Safari 26.0 Release Notes https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes | 2025-09-15 | 官方一手 |
| [S7] | WebKit Blog《WebKit Features in Safari 18.4》 https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ ｜《Meet Declarative Web Push》 https://webkit.org/blog/16535/meet-declarative-web-push/ | 2025-03 | 官方一手（声明式推送） |
| [S8] | Apple Support《Keep Safari in sync across your devices with iCloud》 https://support.apple.com/en-euro/guide/icloud/mm9b8da4f328/icloud | 持续更新（2026-08 抓取） | 官方一手（iCloud 同步范围枚举） |
| [S9] | Apple《Update on apps distributed in the European Union》 https://developer.apple.com/support/dma-and-apps-in-the-eu/ （2026-08-30 抓取已无 Web App 条目）｜Apple 反转声明原文经 TechCrunch 报道 https://techcrunch.com/2024/03/01/apple-reverses-decision-about-blocking-web-apps-on-iphones-in-the-eu/ | 2024-03-01 | 官方一手 + 可靠二手 |
| [S10] | Thomas Steiner（Google DevRel 个人博客）《So, what exactly did Apple break in the EU?》 https://blog.tomayac.com/2024/02/28/so-what-exactly-did-apple-break-in-the-eu/ | 2024-02-28 | 专家二手（丢失存储面逐项清单、7 天豁免印证） |
| [S11] | Mayflower（德国软件公司技术博客）《iOS 17.4: PWAs sind tot – oder nicht?》 https://blog.mayflower.de/17231-ios-17-4-pwa.html | 2024-03-04 | 实践二手（独立容器/每实例独立存储/ITP 例外=主屏） |
| [S12] | Apple Developer Forums《losing data from IndexedDB》 https://developer.apple.com/forums/thread/730023 | 2023-05～2024-05 | 单一社区报告（低存储/清网站数据清 PWA、隔夜随机） |
| [S13] | Apple Developer Forums《Web Application - LocalStorage - Persistent?》 https://forums.developer.apple.com/forums/thread/684351 | 2021-07～2022-10 | 单一社区报告（WKWebView 丢 localStorage；PWA 疑似不进加密备份） |
| [S14] | stefanhoth/starlog GitHub issues #95/#96（含 PR #98） https://github.com/stefanhoth/starlog/issues/95 ｜ https://github.com/stefanhoth/starlog/issues/96 | 2026-06-01 | 真实项目事故复盘（高可信，公开 repo） |
| [S15] | MDN《Storage quotas and eviction criteria》 https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria | 持续更新（2026-08 抓取） | 权威二手 |
| [S16] | caniuse（MDN browser-compat-data）StorageManager.estimate https://caniuse.com/mdn-api_storagemanager_estimate | 持续更新 | 权威二手（Safari 17.0+ 支持） |
| [S17] | Aimtell《The State of Declarative Web Push in 2026》 https://aimtell.com/blog/state-of-declarative-web-push-2026 | 2026-04 | 行业二手（2026 推送现状） |
| [S18] | rizz.dev《Stop Treating localStorage Like a Database》 https://rizz.dev/blog/tutorials/localstorage-production-bugs | 2026-04-11 | 实践二手（5MB/UTF-16 计费口径，与通行实现一致） |
| [S19] | MDN《Web Storage API》 https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API | 持续更新 | 权威二手 |
| [S20] | hashhackers《PWA on iOS: Limitations, Workarounds, and Safari Quirks》 https://blog.hashhackers.com/blog/pwa-ios-limitations/ | 2025-03-10 | **低可信**（「50MB/7 天清 PWA」等说法与官方口径冲突，仅作讹传样例与 beforeinstallprompt 缺失佐证） |

## 附：未找到可靠口径的事项（不编造，供后续票追问）

1. 「删除主屏图标即删除该实例数据」的 Apple 官方单句文档——多来源一致 + EU 事件反向印证，按事实采信但置信度标注为「多来源一致」。
2. 「清除 Safari 历史与网站数据」是否连带清主屏 Web App 分区——仅有单一社区报告称会（[S12]），无官方口径；本文按保守假设处理（J2.3）。
3. iOS 系统升级清空主屏 Web App 数据——无官方承认、无可复现报告；归入偶发不可归因类（F2.8）。
4. 主屏 Web App 数据是否进入 iCloud/iTunes 备份、换机迁移行为——仅 2022 年社区报告称不进备份（[S13]）。
5. iOS 是否支持 Background Sync / Periodic Background Sync——多来源称不支持，未查官方发布说明，本文不作断言。
6. 大陆网络下 APNs/Web Push 端点可达性与延迟——未查证；若决策票考虑提醒路线需补查。
