# 研究：同步引擎与后端落点选型（分域合并语义的实现载体）

- 票据：[#87](https://github.com/darkyana/star-quiz/issues/87)（Part of #78）
- 调查日期：2026-08-30。定价/限额以**当日核实的官方页面**为准，页内自带更新日期随注；查不到现值的项标「截至 2026-08 未核实」。
- 方法：一手来源 = 各家官方定价/文档页（免费档限额逐项抄录原文数值）；产品方向性判断引自官方博客/文档。**Cloudflare/CloudBase/LeanCloud/VPS 的限额、定价、大陆可达性事实直接复用前序研究 #80**（`docs/research/2026-08-30-data-layer-china-options.md`），本票标注为「#80 [XX]」，不重查。
- 评估基准 = ADR-0002 锁定的分域合并语义（§1）。硬门槛沿 #80：大陆可达不劣于「GitHub Pages + Cloudflare 自定义域」基准线；免费起步；月上限 ¥50；小运维；无公共账号；涉未成年人数据。
- 汇率口径：$1≈¥7.2（约数，仅用于预算判断）。
- 本票只给事实与推荐，最终拍板归 #78 后续决策票。

---

## 0. 一页结论（对比总表）

评估七维：月成本 / 运维面（坏了谁修）/ 语义贴合 / 离线队列与写入即推 / 逃生舱 / 大陆可达 / 实施工作量（口径见 §6）。

| 候选 | 月成本 | 运维面 | 语义贴合（四域+快照） | 离线队列+写入即推 | 逃生舱 | 大陆可达 | 工作量粗估 |
|---|---|---|---|---|---|---|---|
| **① 自研薄同步：CF Workers + D1** | **¥0** 免费档（Paid $5≈¥36 备用）#80 [CF-W] | 最小：serverless，坏在 CF 侧 #80 | **按构造满分**：四域语义即服务端代码本身（§2） | 自写 outbox+fetch（~200 行） | 优：`wrangler d1 export` 标准 SQL 直灌 SQLite #80 [CF-D1X] | **=基准线**（同账号同自定义域）#80 [E1] | **3–5 人日** |
| ①′ 变体：RxDB + 自写后端（如 CF Worker 三端点） | ¥0（开源核免费；premium 仅性能件）[RX-PREM] | 同① + 无新增 | 可表达：insert-only=并集、自定义 conflictHandler=LWW、不复制集合=永不同步；**但需把客户端持久层从 localStorage 迁到 RxDB+Dexie**（§3.3） | 引擎内置（省自写）[RX-REP] | 同①（后端侧） | 同①（后端自定义域） | 4–7 人日 |
| ② PowerSync Cloud | ¥0 免费档（2GB 同步/月、50 峰值并发、**1 周不活跃停用**）；Pro $49≈¥353 超预算 [PS-P] | 小（托管）但免费档停用需保活 | authoritative-server + 上传走自家 handler——并集/LWW 仍需自写上传逻辑 [PS-DITTO] | 引擎内置（流式长连接） | 客户端 SQLite 本地即全量；源库侧看托管方 | **差**：区域仅 US/EU/JP/AU/BR 无大陆 [PS-REG]，跨境流式=最差工况 #80 [S2] | 5–8 人日 |
| ② Electric（electric.ax） | ¥0 实效（PAYG 月费 <$5 直接免；$1/1M 写）[EL-P] | 小（托管） | **半覆盖**：只做读路径同步（冷启动灌入/增量拉），离线写队列、冲突合并、快照全自建（§3.2）[EL-HOME] | 写路径=自建 fetch | 源库侧看托管方 | 未实测：electric-sql.cloud 跨境（截至 2026-08 未核实） | 4–6 人日 |
| ② PouchDB + 托管 CouchDB（Cloudant Lite） | ¥0（Lite 永久免费 1GB、20 读/秒、10 写/秒）[CD-LITE][CD-FAQ] | 小 | **贴不上**：rev-tree 冲突裁决是确定性算法非 LWW，提议板 LWW 需手工读 `_conflicts` 解冲突（§3.4） | 引擎内置（成熟） | 好：CouchDB 复制协议开放 | **未实测/存疑**：IBM Cloud 无大陆区域，跨境直连（截至 2026-08 未核实） | 3–5 人日（+语义补救） |
| ③ CloudBase 个人版 | **¥19.9**（40,000 资源点/月，家庭用量花不完）#80 [C1][C2] | 小：全托管；注意免费档须手动半年续期 #80 [C1] | 客户端合并自写（同①客户端半边）；`watch`/`serverDate` 开箱 [CL-W][CL-RECIPE] | SDK 写入即推 + 自写 outbox | 好：集合导出 JSON/CSV #80 [C6] | **全场最优**：上海境内直连 #80 [C1] | 3–5 人日 |
| ③ LeanCloud | 商用 ¥30/天≈**¥900 超预算（确认）**；开发版 ¥0 但政策解读风险 #80 [L1] | 小 | 同③：通道型，合并自写；LiveQuery 限额 100 订阅/5,000 下发每天 #80 [L1] | 同③ | 好：JSONL 导出 #80 [C8] | 优（境内）#80 [L4]；API 域名备案**未核实** #80 | 3–4 人日 |
| ③ 境内 VPS + SQLite 自建 | ¥35–50（预算内）#80 [V1] | **最大**：OS/证书/备份/监控自理 + **ICP 备案 1–2 周** #80 [V1][J1] | 按构造满分（同①，服务端换个进程跑） | 同① | **全场最优**：SQLite=文件，`scp` 走人 #80 | 最优（备案后）#80 | 6–10 人日（另加备案等待） |

**主备推荐（一句话版）**：

- **主：自研薄同步，Cloudflare Workers + D1**——分域合并语义本来就是自写才最直接（现成引擎为表达它所需的配置/自定义代码 ≈ 自写全部核心逻辑），零月费、运维面最小、逃生舱是标准 SQL、大陆可达与现役站点同链路；「写入即推+冷启动拉合、无长连接」与 ADR-0002 完全同构。
- **备：CloudBase 个人版 ¥19.9/月跑同一套客户端合并逻辑**——若 CF 跨境链路劣化或想把涉未成年人数据留在境内，服务端通道换成上海直连；代价是个人版无回档（快照全自建）+ 腾讯生态绑定。

---

## 1. 评估基准：ADR-0002 语义靶心

引擎/后端必须能表达以下语义（ADR-0002，#82 决议锁定），逐项对照见 §5：

| # | 语义 | 要求引擎做到 |
|---|---|---|
| S1 | 纯追加流水（星星流水/答题记录/出词增量） | 按 id **并集**、幂等去重；余额=Σ流水实时求和不落盘 |
| S2 | 可编辑实体（兑换目录/提议板/进行中兑换） | **记录级 LWW**（提议板 LWW 与「修订即认同」自洽） |
| S3 | 题库 | 家长单写，最后导入方胜（**整组**） |
| S4 | 设备本地键（测试开关/数据版本号/上次导出时间） | **永不同步** |
| S5 | 触发 | **写入即推增量 + 冷启动全量拉合，无长连接**（不养 WebSocket） |
| S6 | 快照 | 云端当前态 + **每日快照 × 30 天**（LWW 会忠实同步误操作，快照是唯一后悔药） |
| S7 | 换机 | 新设备配对后**云端为准**全量灌入，覆盖前本机自动导出留档 |
| S8 | 时钟 | 本地时间戳为主、id 字典序平手，引擎提供服务器时钟则兜底校正（ADR 留给本票的缺口） |

**本票核心判断**：S1–S4 是「分域差异化合并语义」，通用同步引擎（整库 LWW / CRDT / 流式复制）**没有一个是原生这么分的**——要么用配置裁剪（PowerSync sync rules、Electric shapes 管拉不管合），要么用自定义扩展点写代码（RxDB conflictHandler、PowerSync upload handler、CloudBase/LeanCloud 的客户端合并）。**绕一圈后，语义代码一行都省不掉，只是换了地方写**。这是主推荐的立足点。

---

## 2. 候选①：自研薄同步（Cloudflare Workers + D1）

### 2.1 形态草图（~几百行 TS，票内预估口径）

- **D1 表**：`events`（流水：`id` PK、`kind`、`payload` JSON、`client_ts`、`server_ts`）／`entities`（实体：`id` PK、`payload`、`updated_at`）／`bank`（题库：`version` PK、`payload`、`updated_at`）／`snapshots`（`date` PK、`dump` JSON）／`devices`（配对：token 哈希、设备名）。
- **端点**（纯 request/response，无长连接）：
  - `POST /sync/push`：批量上行。流水 `INSERT OR IGNORE`（主键即幂等并集）；实体按 `updated_at` 比较 LWW，Worker 顺手盖 `server_ts`（S8 兜底）；题库整组覆盖。
  - `GET /sync/pull?since=`：按 `server_ts` 增量下行（写入即推的下行半边：另一台设备冷启动/定期拉）。
  - `GET /sync/full`：冷启动/换机全量（S7：云端为准灌入）。
  - `POST /pair`：家庭码换设备 token（无公共账号；可再叠 Cloudflare Access 门禁，#80 [CF-A1]）。
  - **Cron Trigger 每日一次**：把当前态整包写 `snapshots` 一行，保留 30 天（S6；免费档每账号 5 个 Cron，占 1 个 [CF-LIM][CF-CRON]）。
- **客户端**：localStorage 照旧为真相源 + `outbox` 待推队列；写操作 → 本地落盘 → 入 outbox → fetch 推送（失败退避重试）；冷启动拉合按域分派（并集/LWW/跳过设备键）。ADR 的「导出文件留档」契约不动。
- **原子性**：`D1Database.batch()` 官方口径即 **SQL 事务**，「单条失败整批回滚」[CF-D1API]——批量推送的幂等重推安全。

### 2.2 免费档限额核对（复用 #80 + 本票新增三条）

- Workers：10 万请求/天、10ms CPU/请求（家庭 2–3 设备写推+拉取，富余 ≥2 个数量级）#80 [CF-W]；请求体上限 Free 100 MB（全量灌入远用不到）[CF-LIM]。
- D1：**行写 10 万/天、行读 500 万/天、5 GB**——每次答题 ≈1 行流水，全家一天几百行顶天 #80 [CF-D1]。
- **Cron Triggers 免费档每账号 5 个**（Paid 250），Cron CPU 10ms（每日快照=一次 SELECT+INSERT，够）[CF-LIM]。
- KV 不用（写 1,000/天最紧，#80 已建议不作主存储）；DO 不用（ADR 无长连接，WebSocket 原语无场景）——架构与免费档限制互相成全。

### 2.3 七维

- **月成本** ¥0；超限救援 = Workers Paid $5≈¥36 仍在预算内 #80 [CF-W]。
- **运维面** 最小：无服务器/OS/证书；坏在 CF 侧只能等；单点风险=CF 账号（封号/条款，#80 [T1] 口径免费档相对宽容）。
- **语义贴合**：按构造满分（§5 逐项）。
- **离线队列+写入即推**：自写 outbox+fetch+退避（无引擎依赖，逻辑透明可测）。
- **逃生舱**：`wrangler d1 export` 得标准 SQL，可直接灌进任意 SQLite = 回到今天的纯本地形态 #80 [CF-D1X]；另有 Time Travel 点位恢复（24h 窗口）#80 [CF-TT]。
- **大陆可达**：与现役站点同账号同自定义域 = 基准线本体（不加分不减分）#80 [J1][E1]。
- **工作量**：3–5 人日（§6）。
- **涉未成年人数据**：存境外边缘（D1 可选 apac location hint）——#80 §4 口径：仅列事实，本研究不下合规结论。

---

## 3. 候选②：现成同步引擎

### 3.1 PowerSync

**事实（官方页 2026-08-30 核实）**：

- 定价 [PS-P]：Free $0 = 2GB 同步流量/月、500MB 托管、50 峰值并发、2 实例、1 源库连接/实例、**1 周不活跃即停用**；Pro 起 $49≈¥353（超预算）；Team $599 起。
- 架构 [PS-DITTO]：authoritative-server；客户端 SQLite（Web=WASM/OPFS）；上传经「client-side write checkpoints」交给**你自己的 backend connector**——冲突语义（如 LWW）在服务端自己写；下载由 sync rules 定义。
- 区域 [PS-REG]（+Terraform 发布文 2026-07-02 [PS-TF]）：Cloud 实例仅 **US/EU/JP/AU/BR**，无大陆；底层 AWS + MongoDB 托管 [PS-SUB]。
- 自托管 [PS-FSL][PS-SH]：客户端 SDK Apache-2.0；Service 为 **FSL**（源可得，数年后转 Apache）；Open Edition 免费自托管，但生产基线 = 1×replication 容器 + 2×API 容器 + **3 节点 MongoDB 副本集** + 负载均衡 + 每日 compact job——对单家庭是数量级过剩的基建。
- 源库：Postgres/MongoDB/MySQL/SQL Server [PS-P]——**没有大陆可达的免费托管源库**（Supabase 已被 #80 出局；Neon 等同理跨境）。

**判定：出局**。理由叠加：① 免费档 1 周停用 vs 家庭应用天然低频（保活脚本=反模式）；② 无大陆区域，跨境**流式长连接**恰是 #80 口径下跨境链路最差工况（实时/流式受影响最大，#80 [S2]），还违反 ADR「无长连接」；③ 语义贴合靠 upload handler 自写——省不掉 S1/S2 的核心逻辑；④ Pro 超预算、自托管基建荒谬级过重。

### 3.2 ElectricSQL / Electric（electric.ax）

**事实（官方页 2026-08-30 核实）**：

- 产品已转向：2026-04 连发博客定位「**agent platform built on sync**」（Agents / Durable Streams）[EL-BLOG]；Postgres Sync（读路径）仍在产品线 [EL-HOME]。
- 架构 [EL-HOME]：**读路径同步**——客户端订阅 shape 实时拉 Postgres 数据；**写路径与鉴权「Through your backend / With your API」**——即离线写队列、冲突合并、分域语义全部自建；开源协议 Apache-2.0、纯 HTTP。
- 定价 [EL-P]：PAYG $1/100 万写 + $0.10/GB·月留存，**月费 <$5 直接免**、读/出流量/扇出免费；Postgres Sync 附加 +$2/100 万写；Pro $249。
- 大陆可达：electric-sql.cloud 跨境，无大陆节点口径——**截至 2026-08 未实测**。

**判定：出局（作为整案落点）**。它只覆盖 S5 的「冷启动灌入+增量拉」半边，S1/S2/S4/S6 全要自建——等于「自研薄同步 + 多一个外部读路径依赖」。其可取处（HTTP+按 updated_at 增量拉的 shape 思想）已被主案 `/sync/pull` 吸收。另注：产品重心已移向 agent 场景，Postgres Sync 的长期投入不确定。

### 3.3 RxDB（+ 自写后端的变体①′）

**事实（官方页 2026-08-30 核实，replication-http 页更 2026-04-23）**：

- 收费面 [RX-PREM]：开源核免费；premium 仅性能件（OPFS/IndexedDB/SQLite 存储、Sharding、Worker 包装等）。FAQ 原文：「required for replication, schema validation, encryption and so on, are totally free」——复制原语、Dexie 存储在开源核。
- 复制协议 [RX-REP][RX-HTTP]：后端只需三个「哑」端点——`pullHandler`（checkpoint 增量）/ `pushHandler`（带 assumedMasterState，返回冲突文档）/ `pullStream`（**可选**，后端不支持时可只发 RESYNC 旗标）——**与「无长连接」兼容**；官方明言 HTTP 复制无专用插件，直接用 `replicateRxCollection` 原语。
- 冲突处理 [RX-REP]：**客户端解决**；默认 conflictHandler=「丢本地 fork、用 master」（防长期离线设备覆写他人）；**可按集合自定义**（比 `updatedAt` 即 LWW）；另有 CRDT 插件（$inc/$max/$push 等算子自动合并）[RX-CRDT]。
- 语义逐项：insert-only 集合（流水）天然并集；实体=自定义 conflictHandler 表达 LWW；设备键=不建复制的集合/用 local documents；题库=单文档 LWW。**四域均可表达**。
- 集成：框架无关；响应式桥 Vue 需手写 RxJS observable→ref（reactivity 插件属 premium 阵营）。

**判定：不推荐为主案，记录为①的变体**。它能省的（传输/重试/checkpoint）在主案里本来就只有 ~200 行；它引入的（客户端持久层整体迁 RxDB+Dexie、RxJS 心智、schema 版本纪律、open-core 边界管理）远大于省下的一点点。且 star_quest 现行 localStorage 域模型会被连根换掉——爆炸半径大。若未来客户端数据面/查询面膨胀再评估。
附注：Safari 对 script-writable storage（含 IndexedDB 与 localStorage 同类）的历史 7 天 ITP 清除口径对两种方案同样存在（加主屏 PWA 豁免），非新增差异——实施票核验（§9）。

### 3.4 PouchDB / CouchDB

**事实（官方页 2026-08-30 核实）**：

- PouchDB 最新 v9.0.0（2024-05-24），此后官方博客再无大版本发布节奏信号 [PO-DB]；浏览器端成熟（IndexedDB）。
- 托管服务端缺位：无大陆可达的托管 CouchDB。唯一值得记的免费托管 = IBM Cloudant **Lite：永久免费 1GB、20 读/秒、10 写/秒、5 查询/秒** [CD-LITE][CD-FAQ]（Standard $75/月起）；IBM Cloud 无大陆区域，跨境直连可达性**截至 2026-08 未实测**。自建 CouchDB 则落回 §4.3 VPS 路线。

**判定：出局**。语义硬伤在 S2：CouchDB 冲突裁决=rev-tree 确定性算法（胜者非「最后写」），提议板记录级 LWW 需手工读 `_conflicts` 逐条解——比自写比较逻辑更绕；托管端要么跨境未实测、要么自建背 VPS 运维。

### 3.5 顺带扫描（不入围理由一句话，二手来源标注）

| 方案 | 一句话判定（来源） |
|---|---|
| Zero（Rocicorp） | **离线写不支持**（断网拒写，违反本地优先本体）；Postgres-only；自托管免费（Apache-2.0）[BSD，二手 2026-04-13] |
| InstantDB | LWW CRDT、自带 auth，但托管云跨境（同 Supabase 类可达性问题）[BSD，二手] |
| Ditto | 闭源商业 P2P，付费授权 [PS-DITTO] |
| cr-sqlite（CRDT SQLite 扩展） | 无托管、须自建服务端 → 落回 VPS [官方 README 口径] |
| Yjs / Automerge | 文档型 CRDT 杀鸡用牛刀：结构化记录域要按其数据建模整体重构，且仍需自建 host |

---

## 4. 候选③：国内通道

### 4.1 CloudBase（腾讯云开发）

复用 #80：套餐（免费体验版 3,000 点/月须**手动每 6 个月续期**；**个人版 ¥19.9/月** 40,000 点≈200 万次 DB 调用）；每日备份留 7 天但**个人版不支持回档**；集合导出 JSON/CSV；上海境内直连全场最优 #80 [C1][C2][C5][C6]。

本票新增核实：

- **实时推送 `watch()`**：文档型库支持，官方标注「支持地域：上海」；Web 端 `@cloudbase/js-sdk`（region 默认 ap-shanghai）npm 可入 Vite SPA [CL-W][CL-SDK]。本架构无长连接决议下 watch **可用可不用**（设备在线时少拉一次），非依赖项。
- **服务器时钟**：`db.serverDate()` 落库替换为数据库当前时间 [CL-RECIPE]——S8 兜底现成。
- **每日快照自建**：云函数**定时触发器**（timer 类型，7 字段 cron，一函数最多 10 触发器）每日跑一次，把各集合导出/复制到 `snapshots` 集合留 30 天 [CL-TIMER]——个人版无回档，快照集合+JSON 导出即后悔药。
- 权限模式注意：匿名登录每设备 openid 不同，「仅创建者可读写」挡家庭共享——写入需自定义安全规则或收口到云函数 [CL-RECIPE]（实现细节，非阻断）。

**判定：备选（推荐为 BACKUP）**。客户端合并逻辑与主案①同码，服务端从「Workers+D1」换成「CloudBase 集合+云函数」；¥19.9/月预算内；境内直连+境内存储（涉未成年人数据的加分项，#80 §4 口径）；代价=腾讯生态绑定 + 个人版无回档（全靠自建快照）+ 免费档不可用（须直接上个人版）。

### 4.2 LeanCloud

复用 #80 并**确认**：商用版最低消费 ¥30/天≈**¥900/月，超 ¥50 预算——出局（预算一票否决）** #80 [L1]。开发版 ¥0 虽可承载（API 30,000 次/天宽裕；LiveQuery 100 订阅/5,000 下发每天），但：① 长期留开发版是对官方 FAQ 的解释而非承诺（#80 已标注政策解读风险）；② 备份口径两说、开发版仅 BSON 导出不能在线恢复 #80 [L2]；③ Web 端 API 走绑定自定义域名，大陆节点绑域是否要求备案**未核实** #80 [L3]。即使不用 LiveQuery 只当存储通道，上述三点使其全面劣于 CloudBase——**无入选理由**。

### 4.3 境内轻量 VPS + SQLite 自建

复用 #80：腾讯轻量 2C2G ¥35–50/月（年付 85 折）；**ICP 备案 1–2 周**；OS/证书/备份/安全全自理，运维面全场最大 #80 [V1][J1]。服务端 = 一个小 HTTP 服务（hono/express + SQLite 文件），同步端点与主案①完全同构（代码可平移）。

**判定：不推荐为备选，定位终极兜底**。语义贴合同样按构造满分、逃生舱全场最优（`scp` 一个文件），但备案等待+持续运维心智与「小运维」约束冲突；仅当 CF 与 CloudBase 同时不可接受时启用。

---

## 5. 语义贴合度逐项对照（票内要求的灵魂表）

| 语义（§1） | ① CF 自研 | ①′ RxDB+自写后端 | PowerSync | Electric | CloudBase | LeanCloud | VPS+SQLite | PouchDB/CouchDB |
|---|---|---|---|---|---|---|---|---|
| S1 流水按 id 并集 | ✓ 服务端 `INSERT OR IGNORE` | ✓ insert-only 集合天然 | △ upload handler 自写 [PS-DITTO] | △ 写路径自写 [EL-HOME] | ✓ 客户端自写（doc id 去重） | ✓ 同左 | ✓ 同① | ✓ insert-only 天然 |
| S2 实体记录级 LWW | ✓ 服务端比 `updated_at` | ✓ 自定义 conflictHandler（默认是 master-wins，须改）[RX-REP] | △ upload handler 自写 | △ 写路径自写 | ✓ 客户端自写 | ✓ 同左 | ✓ 同① | **✗** rev-tree 裁决非 LWW，须手工解 `_conflicts` |
| S3 题库家长单写整组胜 | ✓ 整组覆盖一行 | ✓ 单文档 LWW | △ 自写 | △ 自写 | ✓ 整 doc set 覆盖 | ✓ | ✓ | ✗ 整组=多 doc rev 冲突 |
| S4 设备键永不同步 | ✓ 不进 API | ✓ 不建复制集合 | ✓ 不进 sync rules | ✓ 不进 shape | ✓ 不上传 | ✓ | ✓ | ✓ 单独本地 db 不复制 |
| S5 写入即推+冷启动拉合（无长连接） | ✓ 纯请求响应 | ✓ pullStream 可省略/RESYNC [RX-HTTP] | **✗** 流式长连接为常态 | **✗** HTTP 流（SSE/chunk） | ✓（watch 可不用） | ✓（LiveQuery 可不用） | ✓ | ✓ 复制按需触发 |
| S6 每日快照 ×30 | ✓ Cron 写一行（免费档 5 个 Cron 占 1）[CF-LIM][CF-CRON] | ✓ 后端同① | ✗ 源库侧（Supabase 免费档无自动备份，#80 [S1]） | △ 源库侧自建 | ✓ 定时触发器+快照集合（个人版无回档）[CL-TIMER] | △ 备份仅 7 天/开发版 BSON #80 [L2] | ✓ cron+SQLite 文件 | ✗ Cloudant 无此能力，自建 |
| S7 换机云端为准灌入 | ✓ `GET /sync/full`+覆盖前导出 | ✓ 删库重拉（引擎 checkpoint 重放） | ✓ 引擎强项（初始全量同步） | ✓ 引擎强项（shape 初始快照） | ✓ 集合全查 | ✓ | ✓ | ✓ 删本地 db 重复制 |
| S8 服务器时钟兜底 | ✓ Worker 盖 `server_ts` | ✓ 后端盖戳（同①） | ✓ 服务端时间 | △ 后端盖戳（写路径自建） | ✓ `db.serverDate()` [CL-RECIPE] | ✓ 服务端时间 | ✓ 服务端盖戳 | △ 服务端盖戳须自写 |

读法：**✓=语义直接表达；△=能做但该部分代码仍需自己写（引擎只给传输/框架）；✗=与语义冲突或缺失**。①①′③系（CloudBase/LeanCloud/VPS）在 S1–S4 上语义无本质差异（都是自写合并），分野在成本/运维/可达/快照；引擎系（PowerSync/Electric/PouchDB）恰好在**语义核心上 △/✗ 密集**。

---

## 6. 实施工作量粗估（人日）

口径：**无后端经验人类 + AI 代理执行**的工作流——人日按人类投入计（需求澄清、验收测试、双设备联调、决策），AI 代劳写码/脚手架；含换机流程与快照恢复演练各一次；不含 ICP 备案等待（+1–2 周，仅 VPS 线）。

| 候选 | 人日 | 构成 |
|---|---|---|
| ① CF Workers+D1 自研 | **3–5** | D1 表+5 端点+快照 Cron（~300 行）2；客户端 outbox+分域合并器（~250 行）1.5；双设备/换机/快照回滚联调 1–1.5 |
| ①′ RxDB 变体 | 4–7 | 后端三端点 1；客户端持久层迁移 localStorage→RxDB+Dexie+schema 2–3；conflictHandler+联调 1–3 |
| PowerSync Cloud | 5–8 | 源库开通（跨境）1；sync rules+upload handler 1.5；Web SDK(WASM OPFS)+鉴权 1.5–2；保活与免费档停用对策 1–2；联调 1 |
| Electric | 4–6 | 写路径全自建（=①的 push 半边）1.5–2；shape 定义+读路径接入 1；源库 1；联调 1–2 |
| PouchDB+Cloudant | 3–5+ | 复制协议零代码 0.5；S2/S3 冲突语义补救（`_conflicts` 手工解）2+；跨境链路验证风险另计 |
| ③ CloudBase 个人版 | 3–5 | SDK+登录/权限模式 1；客户端合并器（同①复用）1.5；快照云函数+导出 0.5–1；联调 1 |
| ③ LeanCloud 开发版 | 3–4 | 同 CloudBase 结构，LiveQuery 不启用 |
| ③ VPS+SQLite | 6–10 | 服务端 1.5；TLS/systemd/备份/加固 2–4；备案流程人工 1（等待另计）；联调 1.5 |

---

## 7. 出局判定表

| 候选 | 判定 | 出局原因（主因加粗） |
|---|---|---|
| PowerSync Cloud 免费档 | **出局** | **无大陆区域+跨境流式长连接（可达性硬门槛+违反无长连接决议）**；免费档 1 周停用；无大陆可达免费源库 [PS-P][PS-REG] + #80 [S1][S2] |
| PowerSync 付费/自托管 | 出局 | Pro $49≈¥353 超预算；自托管须 3 节点 Mongo 副本集等基建 [PS-P][PS-SH] |
| Electric | 出局 | **语义半覆盖**（读路径 only，写路径/合并/快照全自建）[EL-HOME]；产品重心已转向 agent 平台 [EL-BLOG]；大陆可达未实测 |
| PouchDB+CouchDB/Cloudant | 出局 | **S2 语义硬伤**（rev-tree 非 LWW）；无大陆可达托管（Cloudant 跨境未实测）[CD-LITE] |
| LeanCloud | 出局 | **商用 ¥900/月超预算（确认）**；开发版政策解读风险+备份口径两说 #80 [L1][L2] |
| VPS+SQLite | 不入围（终极兜底） | **运维面最大+ICP 备案**；其余七维不输，留作 CF 与 CloudBase 双失效时的预案 #80 [V1][J1] |
| Firebase/Supabase 系 | 出局（沿 #80） | 大陆可达性不达基准线 #80 [F1][S2] |

---

## 8. 主备推荐及理由

### 8.1 主：自研薄同步，Cloudflare Workers + D1（¥0）

1. **语义贴合是构造性的**：S1–S8 每一项都直接是服务端/客户端代码本身，无「翻译到引擎概念」的损耗层。对照 §5：所有现成引擎在语义核心处 △/✗ 密集——为表达分域语义写的配置与扩展代码 ≈ 自写全部逻辑，却额外背了引擎的传输层约束（长连接、WASM、协议纪律）。
2. **与既有决议零摩擦**：无长连接（S5）、写入即推+冷启动（纯 fetch）、快照一行一天（Cron 免费档内）、换机云端为准（一个 GET）、服务器时钟兜底（Worker 盖戳，恰好闭合 ADR-0002 留给本票的 S8 缺口）。
3. **成本与限额双富余**：¥0；D1 写 10 万行/天 vs 家庭实测量级差 3 个数量级；不用 KV/DO 恰好绕开全生态最紧的限额 #80。
4. **可达性=基准线本体**：与现役 GitHub Pages+CF 前置同账号同域，链路不变 #80。
5. **逃生舱强且双向**：`wrangler d1 export`→SQLite = 退回纯本地形态；反向迁移也只是一部 SQL 脚本 #80 [CF-D1X]。
6. **运维面最小**：无服务器/证书/OS；对「无后端经验人类+AI 代理」最友好的失败模式（坏=平台侧，看状态页即可）。

**风险与对策**：CF 账号单点（封号/条款）→ 对策=备选通道 + 每日快照本身可定时 `d1 export` 落本地一份；跨境链路劣化 → 备选即境内直连；涉未成年人数据境外存储的合规口径 → #80 §4 未下结论，决策票可就此一票定夺是否直接走备选。

### 8.2 备：CloudBase 个人版 ¥19.9/月（同一套客户端合并逻辑）

触发条件：CF 链路劣化不可忍 / 决策票认定未成年人数据须境内存储 / 想要境内直连的最优可达。语义贴合与主案同构（客户端合并器同码复用，换服务端通道）；`serverDate()`/定时触发器现成；境内存储+境内直连双优。已知代价：个人版无回档（自建快照是唯一后悔药，务必与主案同步落地）、腾讯生态绑定、导出迁出偏手工 #80 [C5][C6][C7]。

### 8.3 决策票需要的三个先答问题（本研究只列不答）

1. 未成年人数据境内/境外存储口径是否为一票否决项（决定主备互换）。
2. ¥0 与 ¥19.9/月的偏好排序（若强偏好 ¥0，备选退为「VPS 兜底」）。
3. 是否接受主案把「每日快照同时 `d1 export` 一份到本机」纳入实现票（双重后悔药，纯增量工作量）。

---

## 9. 未核实项清单（诚实边界）

1. **electric-sql.cloud 大陆可达性**——未实测；Electric 已出局（语义半覆盖），此项不影响结论。
2. **IBM Cloudant Lite 大陆直连可达性**——未实测；同上不影响结论（PouchDB 线已因 S2 语义出局）。
3. **RxDB 无 pullStream 时的轮询参数形态**（live 轮询间隔等具体选项）——协议可省略 pullStream 有官方教程口径 [RX-HTTP]，具体参数留实施票核验。
4. **Safari ITP script-writable storage 7 天清除口径的现值与 PWA 豁免细则**——影响所有浏览器存储方案（含现行 localStorage），非本票方案间差异；实施票核验。
5. **PowerSync 免费档「1 周不活跃」的保活是否合规可行**——未细查（出局项，不影响结论）。
6. CloudBase 免费体验版「小程序发布后到期规则」不适用 Web 场景的官方明文——按 #80 [C1] 保守口径处理。
7. 汇率 $1≈¥7.2 为约数，实际账单以支付渠道为准。

---

## 来源

**官方一手（2026-08-30 核实）**

- [CF-LIM] Cloudflare Workers 限额（免费档 10 万请求/天、Cron 5 个/账号、请求体 100MB）：https://developers.cloudflare.com/workers/platform/limits/ （页更 2026-07-28）
- [CF-CRON] Cron Triggers（scheduled handler、UTC、5 字段表达式）：https://developers.cloudflare.com/workers/configuration/cron-triggers/ （页更 2026-06-20）
- [CF-D1API] D1 Worker API（`batch()`=SQL 事务、失败整批回滚）：https://developers.cloudflare.com/d1/worker-api/d1-database/ （页更 2026-06-22）
- [PS-P] PowerSync 定价（Free 2GB 同步/月、500MB 托管、50 峰值并发、1 周不活跃停用；Pro $49 起）：https://www.powersync.co/pricing
- [PS-REG] PowerSync Cloud Instances（区域 US/EU/JP/AU/BR）：https://docs.powersync.com/configuration/powersync-service/cloud-instances
- [PS-TF] PowerSync 官方博客：Terraform Provider（区域 eu/us/jp/au/br，2026-07-02）：https://releases.powersync.com/announcements/an-official-terraform-provider-for-powersync-1
- [PS-SUB] PowerSync 子处理方清单（AWS+MongoDB，US/EU/AU/JP/BR）：https://powersync.com/legal/subprocessors
- [PS-FSL] PowerSync GitHub org（客户端 SDK Apache-2.0、Service FSL、Open Edition 自托管）：https://github.com/powersync-ja
- [PS-SH] PowerSync 自托管部署架构（生产基线：3 节点 Mongo 副本集+多容器+LB+每日 compact）：https://docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture
- [PS-DITTO] PowerSync 官方博客：Ditto vs PowerSync（authoritative-server、LWW 上传侧自写，2025-01-29）：https://powersync.com/blog/ditto-vs-powersync
- [EL-HOME] Electric 主页（agent platform 定位；Write=Through your backend、Auth=With your API；Apache-2.0、just HTTP）：https://electric.ax/
- [EL-P] Electric Cloud 定价（PAYG $1/1M 写+$0.10/GB·月、月费<$5 免、Postgres Sync +$2/1M）：https://electric.ax/pricing
- [EL-BLOG] Electric 博客：Introducing Electric Agents（2026-04-29，转向 agent 平台）：https://electric.ax/blog/2026/04/29/introducing-electric-agents
- [RX-REP] RxDB Sync Engine（三端点协议、客户端冲突解决、默认 handler=丢 fork 用 master）：https://rxdb.info/replication.html
- [RX-HTTP] RxDB HTTP 复制教程（开源核 `replicateRxCollection`、pullStream 可选/RESYNC 旗标，页更 2026-04-23）：https://rxdb.info/replication-http.html
- [RX-PREM] RxDB Premium 插件清单与 FAQ（复制/校验/加密等核心免费，premium=性能件）：https://rxdb.info/premium.html
- [RX-CRDT] RxDB CRDT 插件（MongoDB 风格算子自动合并）：https://rxdb.info/crdt.html
- [PO-DB] PouchDB 官网（v9.0.0，2024-05-24）：https://pouchdb.com/
- [CL-W] CloudBase 文档型数据库·实时推送（watch()，支持地域：上海；Web SDK 示例）：https://docs.cloudbase.net/database/realtime
- [CL-SDK] 腾讯云 CloudBase Web 端 SDK（@cloudbase/js-sdk，region ap-shanghai，页更 2025-12-16）：https://cloud.tencent.com/document/product/876/46332
- [CL-TIMER] CloudBase 云函数·定时触发器（timer、7 字段 cron、一函数最多 10 触发器）：https://docs.cloudbase.net/cloud-function/timer-trigger
- [CL-RECIPE] CloudBase Recipes：云数据库读写（`db.serverDate()`、四种权限模式表）：https://docs.cloudbase.net/recipes/add-database-wechat-miniprogram
- [CD-LITE] IBM Cloudant 迁移文档（Lite：1GB、20 读/秒、10 写/秒、5 查询/秒免费）：https://github.com/ibm-cloud-docs/Cloudant/blob/master/migration/migration-overview.md
- [CD-FAQ] IBM Cloudant FAQ（Lite 永久免费；Standard 起 $75/月）：https://www.ibm.com/cloud/cloudant/faq

**复用 #80 的来源**（编号沿用其来源清单，不在此重复展开）：CF 生态限额与导出 [CF-W][CF-K][CF-D1][CF-DO][CF-P][CF-D1X][CF-TT]；可达性实测 [J1][G1][T1][E1][S2]；CloudBase [C1]–[C7]；LeanCloud [L1]–[L4][C8]；VPS [V1][V2][V3]；Supabase/Firebase [S1][S4][F1]–[F3]。见 `docs/research/2026-08-30-data-layer-china-options.md` 来源节。

**第三方参考（二手，标注）**

- [BSD] next-digital-wall-calendar #131：Zero/InstantDB/PowerSync 横评要点（Zero 离线写不支持、InstantDB LWW CRDT；2026-04-13）：https://github.com/BenSeymourODB/next-digital-wall-calendar/issues/131
- [TEK] tekai.dev PowerSync 目录页（FSL 4 年转 Apache-2.0 等口径佐证）：https://tekai.dev/catalog/powersync
