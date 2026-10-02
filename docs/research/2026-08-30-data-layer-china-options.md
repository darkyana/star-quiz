# 研究：国内可达的低成本数据层与同步后端选型事实

- 票据：[#80](https://github.com/darkyana/star-quiz/issues/80)（Part of #78）
- 调查日期：2026-08-30。定价/限额以**当日核实的官方页面**为准；可达性采用近期（2025-08 ~ 2026-08）社区实测口径，均标注信息日期。
- 方法：一手来源 = 各家官方定价/文档页（免费档限额逐项抄录原文数值）；可达性 = 近期社区实测与讨论（掘金/腾讯云开发者/独立博客/官方 FAQ）。查不到现值的项标「未核实」，不编造。
- 硬门槛：**大陆网络可达，基准线 = 现役 GitHub Pages + Cloudflare 前置**。比该链路更难访问的方案直接标记出局风险。
- 用量背景（来自 #78 规划基线）：单家庭、2–3 台设备（孩子 iPad / 家长 iPhone+Mac）、KB 级数据（题库+流水+兑换项+提议板）、无公共账号体系、数据涉未成年人。预算：免费起步，¥50+/月可接受上限。

---

## 0. 一页结论（对比总表）

| 候选 | 月成本 | 运维面 | 备份/同步开箱度 | 逃生舱（完整导出） | 大陆可达性 |
|---|---|---|---|---|---|
| **Cloudflare 生态**（Pages + Workers + D1/KV/DO） | ¥0 免费档；Workers Paid $5≈¥36/月 [CF-W] | 最小：serverless，无服务器/证书/OS 可管；坏在 Cloudflare 侧 | 备份：D1 Time Travel 点位恢复 + `wrangler d1 export` 全量 SQL [CF-D1X]；同步：**无现成同步引擎**，需自研（DO WebSocket / 轮询），同步引擎另票 [#78] | 好：D1 一条命令导出 SQL；KV 经 API 逐键导出；DO 无专用导出工具（未核实到）[CF-D1X] | **不劣于基准线**：须走自定义域（workers.dev/pages.dev 大陆基本不可用）；自定义域可达但慢（秒级首屏），优选 IP 可提速 [J1][G1][T1][E1] |
| **Cloudflare Access**（家庭门禁附加项） | ¥0（Free ≤50 用户）[CF-A1][CF-A2] | 近零：邮箱 OTP 策略即用 | — | — | 登录页 `*.cloudflareaccess.com` 社区口径「对大陆用户比 GitHub 友好」，**无系统实测，待验证** [N1] |
| **Supabase** | ¥0 免费档（**1 周不活跃即暂停**）；Pro $25≈¥180/月 超预算 [S1] | 小：托管 Postgres；免费档无备份、暂停需手动恢复 | 备份：免费档**无自动备份**；同步：Realtime 内置（免费 200 并发/200 万条消息/月）[S1] | **最优**：真 Postgres，`pg_dump` 全量导出；开源自托管 [S1] | **中位偏下，不达基准线体验**：未被整体封锁但无大陆节点，跨境慢/间歇超时；免费档**不含自定义域**，只能直连 `*.supabase.co` [S2][S3] |
| **Firebase** | 出局（免费档不再细查） | — | — | — | **出局**：Google 服务被 GFW 限制，Auth/Firestore/Hosting/FCM 全链路不可用 [F1][F2][F3] |
| **腾讯云开发 CloudBase** | ¥0 免费体验版（3,000 资源点/月，手动每 6 个月续期）；**个人版 ¥19.9/月**（预算内）[C1][C2] | 小：serverless 套件（库/函数/存储/认证） | 备份：每日备份留 7 天；**个人版不支持回档**；同步：文档型库/Pg 有 `watch` 实时订阅、行级权限 [C3][C4][C5] | 好：控制台导出 JSON/CSV；跨环境迁移无一键、逐模块手动、单文件 >50MB 分批 [C6][C7] | **最优**：上海境内节点直连 [C1][C4] |
| **LeanCloud** | ¥0 开发版（个人项目口径）；商用版最低消费 **¥30/天≈¥900/月 超预算** [L1] | 小：托管数据存储/LiveQuery | 备份：每日备份留 7 天、全档可下载备份（开发版仅 BSON 备份导出、不能在线恢复）[L1][L2]；同步：LiveQuery（开发版 100 订阅/天 + 5,000 条下发/天）[L1] | 好：Class 导出 JSONL；REST `/exportData`；备份下载 [L2][L3][C8] | **优**（国内版华北/华东节点）；Web 端 API 走「绑定的 API 自定义域名」，大陆节点绑域是否要求备案**未核实** [L3][L4] |
| **国内轻量 VPS + SQLite/Postgres**（腾讯云为主） | 腾讯云轻量锐驰型 2C2G ¥45/月（年付 85 折）、入门型 2C2G ¥35/月；新客活动 ¥9–11/月（续费回原价）[V1][V2]；阿里云轻量新客 ¥38–68/年（二手口径）[V3] | **最大**：OS/证书/备份/安全/监控全自理 + **ICP 备案**（1–2 周）；坏了自己修 | 备份：全自理（快照/文件复制）；同步：**零开箱**，全自研（但可自由上任何引擎） | **最优**（SQLite = 复制一个文件） | **最优**：境内节点直连；80/443 对外服务须备案 [V1][J1][V3] |

汇率口径：$1≈¥7.2（约数，仅用于预算判断）。

---

## 1. Cloudflare 生态（Pages / Workers / D1 / KV / Durable Objects / Access）

### 1.1 免费档限额（官方文档，2026-08-30 核实；文档页自身更新日期随注）

**Workers**（定价页更新 2026-07-07）[CF-W]：

- Free：**100,000 请求/天**，每次调用 **10ms CPU**；无时长计费；**静态资源请求免费且不限量**。
- Paid（Standard）：最低 **$5/月**，含 1,000 万请求/月 + 3,000 万 CPU-ms/月；无 egress/带宽费。
- Pages Functions 按 Workers 计费（同一配额池）。

**Workers KV**（2026-04-21 更新）[CF-K]：

| 项 | Free | Paid（$5/月起） |
|---|---|---|
| 读 | 100,000 / 天 | 1,000 万/月，超出 $0.50/百万 |
| 写 / 删 / 列表 | 各 1,000 / 天 | 各 100 万/月，超出 $5.00/百万 |
| 存储 | 1 GB | 1 GB 含，超出 $0.50/GB-月 |

- 注意：**写 1,000 次/天**对「星星流水」这类追加型写入是最紧的一根线（star_quest 每答一题记流水的话，一天几十次没问题，但若每次 UI 变化都写 KV 会撞线）。免费档超限即该类操作报错，次日 00:00 UTC 重置。

**D1**（2026-04-21 更新）[CF-D1]：

- Free：**行读 500 万/天**、**行写 10 万/天**、**总存储 5 GB**；无 egress 费。超限当天无法再执行查询。
- Paid：行读 250 亿/月、行写 5,000 万/月、存储 5 GB 含，超出 $0.75/GB-月。
- 对 star_quest 量级（百级题库 + 流水），免费档余量数量级富余。

**Durable Objects**（2026-08-25 更新）[CF-DO]：

- Free 仅可用 **SQLite 存储后端** 的 DO。
- 免费档：**100,000 请求/天**（含 HTTP/RPC/WebSocket 消息/告警）、**13,000 GB-s/天** 时长；SQLite 存储限额同 D1 免费档（500 万行读/天、10 万行写/天、5 GB）。
- WebSocket 计费细节：入站消息 20:1 折算请求；Hibernation API 可大幅压时长费用——对「设备间实时同步」场景是免费档内可行路径。
- 注意：Paid 版 SQLite 存储自 **2026-01-07** 起计费（changelog），免费档限额如上。

**Pages**（限额页 2026-07-16 更新）[CF-P]：

- Free：**500 构建/月**、单并发构建；**20,000 文件/站**；单文件 ≤25 MiB；**100 自定义域/项目**；100 项目/账号；Preview 部署不限数。
- 静态请求与带宽不限（官方定价页口径，经 2026-08 社区核文转述 [T1]）。
- star_quest 现状即 Cloudflare 前置，静态层零迁移成本。

**Cloudflare Access（Zero Trust Free）**：

- **$0，最多 50 用户**，支持 One-time PIN（邮箱验证码）登录，无需自建 IdP；付费 $7/用户/月（按年）[CF-A1]（官方中文页，2026-08 核实）[CF-A2]。
- 家庭 2–3 设备远低于 50 用户上限；用作「设备门禁」可行：对 `app.自家域/*` 套 Allow（邮箱白名单）策略，未认证请求一律拦在 Cloudflare 边缘。
- 已知摩擦：孩子 iPad 每次会话过期后需收邮箱验证码（会话时长可配）；社区有「用 Access 私有化个人站点」的成熟玩法 [T2]。

### 1.2 大陆可达性（硬门槛核验）

- **官方免费域基本不可用**：`*.workers.dev` 在大陆「访问极不稳定，移动网络下基本打不开」[J1]（掘金实测，2026-06-22）；「workers.dev 域名（大陆屏蔽）」[G1]（2025-12-01）；pages.dev 同病，需绑自定义域 [T1]（腾讯云开发者，2026-08-12）。根因：免费免备案域名拿不到大陆节点，DNS 曾被污染且滥用严重 [J2]（腾讯云开发者，2022-10，现象持续口径）。
- **自定义域 = 基准线**：Cloudflare 代理的自定义域大陆可达，但默认路由质量一般（社区实测首屏近 5 秒）[E1]（2025-12-03）；优选 IP / 优选 CNAME / 分运营商解析可约 3 倍提速 [E1][X1]（2026-01-06，更新 2026-07-10）。
- **与现役基准线的关系**：star_quest 现走 GitHub + Cloudflare 前置；把数据层放在同一 Cloudflare 账号同一自定义域下（Workers Routes / Pages 同域 API），可达性**与今天完全同链路**——不加分也不减分，满足硬门槛。
- **Access 登录页可达性**：`*.cloudflareaccess.com` 社区口径「相较于 GitHub 对中国大陆用户更加友好」（哪吒监控官方文档用它做大陆可用的 OAuth 替代）[N1]（2026-03-01 更新）；**但无针对本场景的系统实测，列为待实测项**。

### 1.3 四项评估

- **月成本**：¥0（免费档全家桶）；需要更高限额时 Workers Paid $5/月 ≈ ¥36，仍在 ¥50 预算内 [CF-W]。
- **运维面**：最小。无服务器/OS/证书可管；坏在 Cloudflare 侧（平台故障自己只能等）。单风险点：账号封禁/服务条款变更（社区有 Vercel 误判暂停先例，Cloudflare 免费档相对宽容 [T1]）。
- **备份/同步开箱度**：
  - 备份：D1 有 Time Travel 点位恢复（生产存储子系统）+ `wrangler d1 export` 全量 SQL 导出 [CF-D1X][CF-TT]；**免费档无自动异地备份**，导出需自己跑命令/脚本化。
  - 同步：**零现成**。KV/D1/DO 都是原语，多端冲突解决、增量拉取全要自研（或等 #78 同步引擎票选 PowerSync 类方案）。DO + WebSocket Hibernation 是免费档内做「单家庭小并发实时同步」的对口原语 [CF-DO]。
- **逃生舱**：D1 一条 `wrangler d1 export` 得到标准 SQL（可直灌任意 SQLite）[CF-D1X]；KV 可经 REST API/CLI 逐键遍历导出（官方 API 能力；**未核实到官方一键全量导出命令**）；DO **未核实到专用导出工具**（数据可经 SQL API 查询后自行落盘）。整体：能走，个别角落要自己写脚本。

---

## 2. 托管 BaaS

### 2.1 Supabase（重点：大陆可达性）

**免费档**（官方定价页 2026-08-30 核实）[S1]：

- 500 MB 数据库（专用 Postgres）、5 GB egress、1 GB 文件存储、50,000 MAU、API 请求不限。
- Realtime：200 并发峰值连接、200 万条消息/月、单条 ≤256 KB。
- Edge Functions 50 万次调用/月。
- **免费项目 1 周不活跃后暂停**（恢复需手动）；活跃项目上限 2 个。
- **无自动备份**（Pro 才有每日备份留 7 天）；**Custom Domains 不在免费档**（$10/月附加项，且属付费计划能力）[S1]。
- Pro：$25/月 ≈ ¥180（**超 ¥50 预算**）。

**大陆可达性**：

- 口径一（2026-07-16 审阅）：Supabase **未被封锁**，但**无大陆数据中心**，依赖它的应用在墙内「典型表现为加载慢或超时」[S2]。
- 口径二：跨境流量走拥塞国际网关 + GFW 检查，实时功能与 API 调用受影响最大 [S2]。
- 风险先例：2025-02 印度多家 ISP 对 supabase 做网络级封锁，官方建议换 DNS/VPN [S4]——ISP 级封锁对该域名是发生过的事实。
- 结论：**能连，但体验劣于现役基准线**（GitHub+CF 自定义域），且免费档无法用自定义域缓解（要么 $10/月加域 + 仍跨境，要么 $25 Pro）。标记**出局风险：可达性不达基准线 + 免费档暂停机制**。

**四项**：月成本 ¥0（有暂停风险）/ Pro ¥180 超预算；运维面小（托管）；备份免费档为零、同步 Realtime 开箱即用；逃生舱**全场最优**（pg_dump 全量、开源自托管）[S1]。与 PowerSync/ElectricSQL 等 Postgres 同步引擎天然兼容（同步引擎选型属 #78 后续票）。

### 2.2 Firebase（预期不可达 → 确认出局）

- 大陆确认不可达：Firebase 核心服务（Auth/Firestore/Realtime DB/Storage/Functions/Hosting/FCM）依赖 Google 域名与 IP，被 GFW 限制，实时同步 WebSocket「极易被阻断或高延迟」[F1]（2025-08-03）；Firestore「not reliably accessible in China」，且无大陆数据托管、与 PIPL 数据本地化冲突 [F2]（2025-10-30 更新）；社区共识「Firebase 在中国大陆并不运行」[F3]。
- **出局**：比现役基准线显著更差，免费档金额不再细查。

### 2.3 腾讯云开发 CloudBase

**套餐**（官方定价页 + 官方 FAQ，2026-08-30 核实）[C1][C2]：

| 套餐 | 价格 | 资源点（1,000 点 ≈ ¥1） |
|---|---|---|
| 免费体验版 | ¥0/月 | 3,000 点/月 |
| 个人版 | **¥19.9/月**（限时优惠价） | 40,000 点 |
| 标准版 | ¥199/月 | 330,000 点 |
| 企业版 | ¥999/月 | 1,500,000 点 |

- 免费体验版规则（2026-01-16 起口径）：每账号 1 个；**单次可续 6 个月，到期前 1 个月内可续**；**不支持自动续费**；不支持加购资源包/按量；小程序发布后到期规则另算（本票 Web 场景不适用）[C1]。
- 资源点换算（标准版口径）：**数据库调用 200 点/万次、云函数 13 点/万次、CDN 流量 210 点/GB、短信 50 点/条** [C2]。
  - 免费档 3,000 点/月 ≈ **15 万次 DB 调用/月**（≈5,000 次/天）或 ≈ **14 GB CDN 流量/月**——家庭 2–3 设备的量级可挤进，但余量小且要记得**手动半年续期**（忘续 = 环境销毁风险）。
  - 个人版 40,000 点/月 ≈ 200 万次 DB 调用或 ~190 GB 流量，家庭用量下几乎花不完。

**能力面**（官方文档 2026-04-21 更新）[C4]：

- 文档型数据库（MongoDB 兼容，上海地域）+ **PostgreSQL 环境可选**（上海支持 Pg；新加坡仅 Pg）[C1]。
- **实时订阅（watch）、行级权限**，官方自述「和 Supabase 一样顺手」[C3]；身份认证（微信/匿名/密码）、云函数/云托管/静态托管。

**备份/回档/导出**：

- 默认**每日备份，保留 7 天**；升配后实时备份保留 14 天；**个人版不支持回档**（官方限制表原文）[C5]。
- 导出：控制台集合导出 **JSON/CSV** [C6][C7]；**跨环境迁移无一键**，需按模块手动迁（数据模型/集合/函数/存储逐个来），权限与索引需在目标环境重建；导出单文件 >50 MB 分批 [C7]。

**大陆可达性**：上海境内节点直连，**全场最优档**[C1]。数据境内存储，账号实名（腾讯云个人实名）——未成年人数据不跨境 [C2]。

**四项**：月成本 ¥0（紧）/ **¥19.9 预算内**；运维面小（serverless 全托管）；备份每日有但**个人版不能回档**（只能导出 JSON 后自行恢复）、同步 watch 开箱；逃生舱 JSON/CSV 可全量导出，迁出手续偏手工。

### 2.4 LeanCloud

**开发版（免费）限额**（官方定价页 2026-08-30 核实）[L1]：

- API 请求 **30,000 次/天**（与即时通讯、消息推送共享额度）——家庭量级宽裕。
- 并发线程 3；数据存储 **免费 1 GB**（超出 ¥0.10/GB/天）。
- LiveQuery：**订阅 100 次/天、下发消息 5,000 条/天**（免费档）——够 2–3 台设备轻量实时订阅，但若高频同步可能顶到。
- 全文搜索 10,000 次/天。
- 自动备份：定价表标注开发版「**不支持**」[L1]；而官方数据安全文档口径：**所有应用每日自动备份保留 7 天、均可「备份导出」下载（BSON），但在线「备份恢复」仅商用版**[L2]——两处口径并存，保守按「能下载备份文件、不能一键在线恢复」计。
- **商用版最低消费 ¥30/天 ≈ ¥900/月**（国内节点），**远超 ¥50 预算**[L1]。官方 FAQ：开发版面向「开发阶段和个人项目」免费使用，对外发布的商业应用通常需升级 [L1]——本场景是自家家庭应用、不对外发布，长期留开发版是合理读法，但**这是对官方 FAQ 的解释而非承诺**，标注。

**大陆可达性**：国内版（华北/华东节点）境内直连，优 [L4]。注意：REST API 的 Base URL 是「应用绑定的 API 自定义域名」[L3]；**大陆节点给 Web 应用绑 API 域名是否要求已备案域名——未核实**（历史上国内节点对绑定域名有备案要求，需实测/问工单确认）。

**逃生舱**：Class 导出 **JSONL**（每行一个 JSON 对象）[C8]；REST `/exportData` API [L3]；备份文件下载 [L2]。甚至 CloudBase 官方提供「从 LeanCloud 迁移」指南（objectId→_id 映射脚本）[C8]——说明导出格式足够开放。

**四项**：月成本 ¥0（开发版长期用有政策解读风险）/ 商用 ¥900 超预算；运维面小；备份每日有文件可下、LiveQuery 开箱；逃生舱 JSONL 全量可导。

---

## 3. 自建轻后端：国内轻量 VPS + SQLite/Postgres

### 3.1 月成本（官方一手为主）

**腾讯云轻量应用服务器**（官方价格总览，页面日期 2026-06-15；2026-08-30 核实）[V1]：

| 套餐 | 配置 | 带宽/流量 | 价格 |
|---|---|---|---|
| 锐驰型 | 2C2G / 40GB SSD | 200Mbps 峰值 / **不限流量** | **¥45/月** |
| 锐驰型 | 2C2G / 50GB SSD | 200Mbps 峰值 / 不限流量 | ¥50/月 |
| 入门型 | 2C2G / 40GB SSD | 2Mbps / 100GB 月流量 | ¥35/月 |
| 入门型 | 2C2G / 50GB SSD | 4Mbps / 300GB 月流量 | ¥48/月 |

- 时长折扣：年付 85 折（锐驰型 2C2G 年付 ≈ ¥459/年 ≈ ¥38/月）[V1]。
- 新用户活动（至 2026-12-30）：2C4G3M **¥109/年**（≈¥9/月）；2C2G5M **3 年 ¥396**（≈¥11/月）——**续费回日常价**[V2]。

**阿里云侧写**（二手汇总口径，2026-08-05，官方页未核实）[V3]：轻量 2C2G 新客 ¥38–68/年（续费回原价）；ECS 经济型 2C2G ¥99/年**续费同价**。标「官方现值未核实」。

### 3.2 运维面（与托管方案的真实差距）

- **ICP 备案硬要求**：境内服务器对域名提供 80/443 Web 服务须完成备案（约 1–2 周、需实名）[J1]；免备案路线是香港/海外节点或 Cloudflare 代理绕行，但后者回到跨境链路 [J3]。
- 自理清单：OS 与安全补丁、TLS 证书轮换、SSH 加固、防火墙、快照/备份策略（快照存储另购）、监控告警、故障自己修（半夜挂了没人管）[V1][V3]。
- 低价陷阱口径：首购价与续费价差可达 5–8 倍；「200M 带宽」是峰值非保底 [V3]。
- 对「单人 + AI 代理团队」：AI 能代劳大部分脚本化运维，但**备案、账号实名、突发故障响应**仍落在一个人类身上；SQLite 方案把数据面压到「一个文件」，是唯一能让备份/逃生舱零摩擦的形态。
- 大陆可达性：境内节点直连，最优（前提：完成备案）。

### 3.3 四项

- 月成本：¥35–50（标准价，预算内）；新客 ¥9–11/月（3 年锁价存在续费悬崖）。
- 运维面：**最大**（备案 + 全套自理）。
- 备份/同步开箱：**零**——全自研；但自由度最高（想上 PowerSync/ElectricSQL/自写 CRDT 都行，同步引擎选型归 #78 后续票）。
- 逃生舱：**最优**——SQLite 就是文件，`scp` 走人。

---

## 4. 未成年人数据合规口径（横向，保守陈述）

- 数据存储地：CloudBase/LeanCloud 国内版 = 境内存储、账号实名 [C2][L4]；Supabase/Firebase = 境外存储，涉及个人信息跨境（Firestore 且与 PIPL 数据本地化要求冲突的社区口径）[F2][S2]。
- 本场景（单家庭自用、无公共账号体系、不对外发布）：合规面小；关键差异只在「数据出境与否」与「账号实名」。Cloudflare 生态数据存于境外边缘（D1 location hint 可选 apac）——**涉未成人数据的跨境存储无专门法律意见，本研究不下结论**，仅列事实。
- 国内平台对免费/体验环境的**内容审核与滥用风控**有权先行限制（CloudBase 免费环境条款明示「识别到资源使用异常将先行限制」[C1]）——家庭答题数据无违规内容，风险低但非零。

---

## 5. 出局项与出局原因

| 候选 | 判定 | 原因 |
|---|---|---|
| Firebase | **出局** | 大陆整体不可达，硬门槛不过 [F1][F2][F3] |
| Supabase 免费档 | **出局风险高** | 可达性劣于基准线（跨境慢/超时）+ 免费档 1 周暂停 + 免费档无自定义域可缓解；逃生舱虽最优但可达性是一票否决项 [S1][S2] |
| Supabase 付费档 | **超预算** | Pro $25≈¥180/月 > ¥50 上限 [S1] |
| LeanCloud 商用版 | **超预算** | 最低消费 ¥30/天≈¥900/月 [L1] |
| VPS + Postgres | **不建议（可保留为备选）** | 运维面最大 + 备案；若走 VPS，SQLite 优于 Postgres（备份/逃生舱零摩擦、量级远未到需要独立 DB 进程）|
| KV 作主存储 | **不建议** | 免费档写 1,000 次/天是全生态最紧限额，不适合追加型流水 [CF-K] |

**进入决赛圈的事实组合**（供 #78 决策票使用，本票不做选型）：

1. Cloudflare D1 + DO + Access（免费，可达性=基准线，同步自研）；
2. CloudBase 个人版 ¥19.9/月（境内直连最优，watch 开箱，个人版不能回档）；
3. LeanCloud 开发版免费（境内直连，LiveQuery 开箱，开发版长期留用的政策解读风险）；
4. 腾讯云轻量 + SQLite ¥35–50/月（境内最优，全自研，备案一次性成本）。

---

## 6. 未核实项清单（诚实边界）

1. `*.cloudflareaccess.com`（Access 登录页）大陆可达性——社区正面口径存在 [N1]，但**无本场景实测**；若走 Cloudflare 路线，实施前先在大陆裸网络实测一次 OTP 收发。
2. Cloudflare KV 官方一键全量导出命令、Durable Objects 专用导出工具——官方文档未检索到，保守按「API 可遍历、需自写脚本」计。
3. LeanCloud 大陆节点 Web 应用绑定 API 自定义域名是否强制备案——需工单/实测确认。
4. 阿里云轻量服务器官方现价（本文仅二手口径）[V3]。
5. 汇率取 $1≈¥7.2 为约数，实际账单以支付渠道为准。
6. Cloudflare「静态请求与带宽不限量」出自官方定价页营销口径（经 [T1] 转述核对），限额页 [CF-P] 未单列带宽项。

---

## 来源

**官方一手（定价/限额，2026-08-30 核实）**

- [CF-W] Cloudflare Workers 定价：https://developers.cloudflare.com/workers/platform/pricing/ （页更 2026-07-07）
- [CF-K] Workers KV 定价：https://developers.cloudflare.com/kv/platform/pricing/ （页更 2026-04-21）
- [CF-D1] D1 定价：https://developers.cloudflare.com/d1/platform/pricing/ （页更 2026-04-21）
- [CF-DO] Durable Objects 定价：https://developers.cloudflare.com/durable-objects/platform/pricing/ （页更 2026-08-25）
- [CF-P] Pages 限额：https://developers.cloudflare.com/pages/platform/limits/ （页更 2026-07-16）
- [CF-A1] Zero Trust/Access 定价（中文官网）：https://www.cloudflare.com/zh-cn/sase/products/access/
- [CF-D1X] D1 导入导出（`wrangler d1 export`）：https://developers.cloudflare.com/d1/best-practices/import-export-data/ （页更 2026-04-21）
- [CF-TT] D1 Time Travel：https://developers.cloudflare.com/d1/reference/backups/ （页更 2026-04-21；legacy 快照备份 2025-07-01 移除）
- [S1] Supabase 定价：https://supabase.com/pricing
- [C1] 腾讯云开发定价（免费体验版/套餐/地域）：https://buy.cloud.tencent.com/price/tcb/overview
- [C2] CloudBase 资源点 FAQ：https://docs.cloudbase.net/quick-start/resource-point
- [C3] CloudBase 官网（数据库 watch/RLS、身份认证能力）：https://tcb.cloud.tencent.com/
- [C4] 文档型数据库控制台（上海地域、MongoDB 兼容）：https://cloud.tencent.com/document/product/876/46897 （页更 2026-04-21）
- [C5] 备份/回档（每日备份 7 天、个人版不支持回档）：https://cloud.tencent.com/document/product/876/46897 （同 C4，2.1 节）
- [C6] 导入/导出（JSON/CSV）：https://docs.cloudbase.net/database/manage
- [C7] 跨环境迁移（无一键、逐模块、50MB 分批）：https://docs.cloudbase.net/quick-start/env-transfer
- [L1] LeanCloud 定价：https://www.leancloud.cn/pricing/
- [L2] LeanCloud 数据和安全（每日备份 7 天、备份导出/恢复分档）：https://docs.leancloud.cn/sdk/storage/guide/security/
- [L3] LeanCloud REST API（`/exportData`、API 自定义域名 Base URL）：https://docs.leancloud.cn/en/sdk/storage/guide/rest/
- [L4] LeanCloud 控制台指南（国内版/国际版节点）：https://docs.leancloud.cn/sdk/start/dashboard/
- [V1] 腾讯云轻量应用服务器价格总览：https://cloud.tencent.com/document/product/1207/73452 （页更 2026-06-15）
- [V2] 腾讯云轻量新客活动（至 2026-12-30）：https://cloud.tencent.com.cn/act/pro/lhsale
- [C8] CloudBase「从 LeanCloud 迁移」官方指南（JSONL 导出口径）：https://docs.cloudbase.net/quick-start/migration/leancloud

**可达性/社区实测（标注信息日期）**

- [J1] 掘金：免费托管 + 备案踩坑实录（workers.dev/edgeone 免费域大陆不可用、ICP 规则、备案 1–2 周），2026-06-22：https://juejin.cn/post/7653686112276496418
- [J2] 腾讯云开发者：workers.dev DNS 污染与自定义域解法，2022-10-04（现象持续口径）：https://cloud.tencent.com/developer/article/2133923
- [T1] 腾讯云开发者：迁站 Cloudflare Pages 全记录（pages.dev 大陆不稳、免费额度 2026-08 核对），2026-08-12：https://cloud.tencent.cn/developer/article/2724477
- [G1] 独立博客：Workers/Pages 区别与优选（「workers.dev 大陆屏蔽」），2025-12-01：https://blog.gemslyho.org/posts/cloudflare-pages-to-worker/
- [E1] eastondev：Astro on Cloudflare 大陆 3 倍提速实践（默认链路近 5s、优选 IP/CNAME），2025-12-03：https://eastondev.com/blog/en/posts/dev/20251203-astro-cloudflare-deploy/
- [X1] 独立博客：Pages 国内优选（华为云国际站分线路解析），2026-01-06 更新 2026-07-10：https://blog.xiaohanys.top/accelerate-cf-pages/
- [N1] 哪吒监控官方文档：以 Cloudflare Access 作 OAuth（「对大陆用户更友好」），页更 2026-03-01：https://nezhahq.github.io/guide/q8.html
- [T2] 腾讯云开发者：Cloudflare Access 打造个人私密站点（OTP 流程），2023-05-09：https://cloud.tencent.com/developer/article/2282769
- [S2] 21YunBox：Supabase in China（未被封但无大陆节点、慢/超时；ICP 口径），审阅 2026-07-16：https://www.21cloudbox.com/support/supabase-china.html
- [S4] GitHub：印度 ISP 封锁 Supabase 事件与自托管 workaround，2025：https://github.com/itsivag/supabase-on-cloud
- [F1] 365lvtu：Firebase 大陆可用性深度解析，2025-08-03：https://www.365lvtu.com/1754160878651914/
- [F2] AppInChina：Does Firestore Work in China?，页更 2025-10-30：https://appinchina.co/does-firestore-work-in-china/
- [F3] Back4App：中国三大 Firebase 替代方案（「Firebase 在中国大陆并不运行」）：https://blog.back4app.com/zhtw/%e4%b8%ad%e5%9b%bd%e4%b8%89%e5%a4%a7-firebase-%e6%9b%bf%e4%bb%a3%e6%96%b9%e6%a1%88/
- [V3] 今日热点网：2026 服务器租用避坑（阿里云轻量新客价/续费刺客/带宽口径），2026-08-05：https://m.tech.china.com/articles/20260805/202608051933557.html （**二手来源**，官方现值未核实）
- [J3] 博客园：服务器免备案办法（香港节点/CF 绕行），2024-12-23：https://www.cnblogs.com/hopeblaze/articles/18623721
