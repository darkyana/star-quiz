# 运营查库：家庭使用情况（生产 D1 只读）

老板要按家庭码查各家使用情况（建家时间 / 设备数与加入时间 / 答题 / 兑换 / 提议）时的标准路径。**只读 SELECT，零写操作**；写操作（发码 / 退役 / 加口令）走 `tools/operator.mjs`，别用裸 SQL。

## 连接方式

```bash
cd worker && npx wrangler d1 execute star-quiz-sync --remote --json --command "<SQL>" 2>/dev/null
```

- 库名以 `worker/wrangler.jsonc` 的 `d1_databases[0].database_name` 为准（换库改这里，文档不改）。
- `--remote` = Cloudflare 生产库；`--local` = 本机 `.wrangler` 开发副本（两库互不相通，查使用情况永远 `--remote`）。
- 纯 SELECT 无确认横幅；提示走 stderr、数据走 stdout（`2>/dev/null` 后 stdout 即干净 JSON，`[0].results` 是行数组）。
- 一条 `--command` 一条语句；多视角查几张表就跑几次（可并行）。

## 时间口径（schema 真相源：`worker/migrations/*.sql` 头注释）

| 列 | 形态 | 语义 |
|---|---|---|
| `families.created_at`、`devices.paired_at / last_seen_at`、`star_entries.timestamp`、`proposals.created_at / updated_at`、`reward_items.updated_at` | INTEGER 毫秒 | **客户端本地墙钟**（设备时钟，非 UTC） |
| `*.server_at` | INTEGER 毫秒 | Worker 接收时刻，UTC |
| `question_results.answered_at` | TEXT ISO 8601 | UTC（客户端 `toISOString()`） |

北京墙钟显示：毫秒列 `datetime(x/1000,'unixepoch','+8 hours')`；ISO 列 `datetime(answered_at,'+8 hours')`；按日计数用 `date(...,'+8 hours')`。

## 一键总览（家庭码为中心）

```sql
SELECT pc.code AS family_code, f.family_id,
  datetime(f.created_at/1000,'unixepoch','+8 hours') AS family_created_bj,
  (SELECT COUNT(*) FROM devices d WHERE d.family_id=f.family_id AND d.revoked_at IS NULL) AS n_devices,
  (SELECT GROUP_CONCAT(d.name||'/'||d.role||'@'||datetime(d.paired_at/1000,'unixepoch','+8 hours'), '; ')
     FROM devices d WHERE d.family_id=f.family_id AND d.revoked_at IS NULL) AS devices_joined,
  (SELECT COUNT(*) FROM question_results q WHERE q.family_id=f.family_id) AS answers,
  (SELECT COUNT(DISTINCT date(q.answered_at,'+8 hours')) FROM question_results q WHERE q.family_id=f.family_id) AS quiz_days,
  (SELECT MAX(q.answered_at) FROM question_results q WHERE q.family_id=f.family_id) AS last_answer_utc,
  COALESCE((SELECT SUM(s.type='earn') FROM star_entries s WHERE s.family_id=f.family_id),0) AS earn_n,
  COALESCE((SELECT SUM(s.type='redeem') FROM star_entries s WHERE s.family_id=f.family_id),0) AS redeem_n,
  (SELECT COUNT(*) FROM proposals p WHERE p.family_id=f.family_id AND p.deleted=0) AS live_proposals,
  datetime((SELECT MAX(p.updated_at) FROM proposals p WHERE p.family_id=f.family_id)/1000,'unixepoch','+8 hours') AS proposal_last_bj,
  (SELECT COUNT(*) FROM reward_items r WHERE r.family_id=f.family_id AND r.deleted=0) AS live_rewards,
  (SELECT COUNT(*) FROM active_redemptions a WHERE a.family_id=f.family_id AND a.deleted=0) AS active_redemptions,
  datetime((SELECT MAX(d.last_seen_at) FROM devices d WHERE d.family_id=f.family_id)/1000,'unixepoch','+8 hours') AS last_seen_bj
FROM families f
LEFT JOIN pairing_codes pc ON pc.family_id=f.family_id AND pc.retired_at IS NULL
ORDER BY f.created_at;
```

列语义：`devices_joined` = 现役设备「名/角色@加入时刻」；`answers/quiz_days/last_answer` = 答题动作（2026-09-11 验证通过）；`earn_n/redeem_n` = 星星流水条数（redeem 即兑换动作）；`live_proposals/proposal_last_bj` = 现役提议数与最近提议动作；`live_rewards/active_redemptions` = 现役兑换目录项 / 进行中兑换；`last_seen_bj` = 全家最近在线。无动作的列为 NULL。

## 细化查询（按需单独跑）

```sql
-- 全部码（含退役；重置家庭码 = 旧码打戳 + 新码，历史可追溯）
SELECT pc.family_id, pc.code, datetime(pc.issued_at/1000,'unixepoch','+8 hours') AS issued_bj,
  CASE WHEN pc.retired_at IS NULL THEN 'active' ELSE 'retired' END AS status
FROM pairing_codes pc ORDER BY pc.family_id, pc.issued_at;

-- 设备全名册（含已移除；revoked_at 打戳 = 被移除，行仍在）
SELECT d.family_id, d.name, d.role, datetime(d.paired_at/1000,'unixepoch','+8 hours') AS paired_bj,
  CASE WHEN d.revoked_at IS NULL THEN 'active' ELSE 'removed' END AS status
FROM devices d ORDER BY d.family_id, d.paired_at;

-- 兑换目录明细（别家自定义了什么奖励）
SELECT family_id, name, price, datetime(updated_at/1000,'unixepoch','+8 hours') AS updated_bj, deleted
FROM reward_items ORDER BY family_id, updated_at;
```

## 口径与坑

- **现役判定**：码 `retired_at IS NULL`；设备 `revoked_at IS NULL`（移除=打戳，名册清除=物理删行——所以可能出现「有数据但 0 设备行」的家庭，那是被清过册）。
- **墓碑列**：`proposals / reward_items / active_redemptions / question_flags` 的 `deleted=1` 是业务删除，算现役一律 `deleted=0`。
- **空家庭** = 只发码未配对（families 有行、devices 无行）。多家 `created_at` 精确相同 = 台账批量发码的痕迹，不是异常。
- **「我家」识别**：靠设备名/老板台账自认，文档不固化（建库手工发的码，具体值见仓库外台账；其余为 `tools/operator.mjs` 批量签发）。
- **隐私边界**：此路径是运营方特权，能反查家庭码/设备名/兑换内容（ADR 0013 承认不设防）；**对外分享一律走 `node tools/metrics.mjs --weeks <N> --remote`**（匿名 ID × 自然周聚合，无可识别字段），别把家庭码、孩子信息、别家兑换项贴到公开场合。
- 发码/退役/加口令等写操作：`node tools/operator.mjs list|issue|retire|add-passphrase [--remote]`（见 `docs/adr/0007`）。
