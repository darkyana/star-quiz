-- D1 版本化迁移 0001：同步域库表定稿（ADR 0005）
-- 只建结构与约束，零业务数据逻辑；全语句幂等（IF NOT EXISTS），可重复应用。
-- 时间戳约定：INTEGER = Date.now() 毫秒；question_results.answered_at 例外，保留本地 ISO 8601 字符串（TEXT）。
-- LWW 约定：updated_at = 客户端写时刻（裁决主依据）；server_at = Worker 接收时刻（时钟兜底/增量拉取游标）；
--          deleted 墓碑列承载可传播的删除（LWW 世界里物理 DELETE 不可合并）。

-- ===== 租户与设备凭据域（服务端自有，非合并数据）=====

-- 家庭（租户根表）：family_id 为 UUID
CREATE TABLE IF NOT EXISTS families (
  family_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- 配对码 → 家庭映射：code 为全表主键 = 全服唯一（非按家庭分区）
-- retired_at NULL = 现役；重置家庭码 = 现役码打戳 + 新码插入（只拦后续加入，#84）
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY CHECK (length(code) = 6 AND code GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'),
  family_id TEXT NOT NULL REFERENCES families (family_id),
  issued_at INTEGER NOT NULL,
  retired_at INTEGER
);

-- 已配对设备（设备凭据）：凭据只存摘要（认证协议 P1 定，#84）；移除设备 = revoked_at 打戳（断云不擦数据）
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families (family_id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  credential_hash TEXT NOT NULL,
  paired_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

-- ===== 题库域：家长单写、整组 LWW（每家庭一行当前题库，不逐题展开）=====

CREATE TABLE IF NOT EXISTS question_banks (
  family_id TEXT PRIMARY KEY REFERENCES families (family_id),
  content TEXT NOT NULL, -- QuestionBank JSON（version/generatedAt/questions 全量）
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  server_at INTEGER NOT NULL
);

-- ===== 纯追加流水域：复合主键承载「按条目唯一 id 并集」，同键重复上传幂等 =====

-- 星星流水（本地 sq_stars；StarEntry.id 为客户端 UUID）；余额 = Σ流水实时求和不落盘（C2）
CREATE TABLE IF NOT EXISTS star_entries (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL,
  quiz_id TEXT,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, id)
);

-- 逐题答题记录（本地 sq_question_results）：本地记录无独立 id，条目身份 = 题目 × 作答时刻（同轮共享同一时间戳）；
-- 云端全量保留，本地「最近 5 次」滚动窗口为客户端展示派生（ADR 0005）
CREATE TABLE IF NOT EXISTS question_results (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  question_id TEXT NOT NULL,
  answered_at TEXT NOT NULL, -- ISO 8601，本地 QuestionResult.timestamp 原样
  outcome TEXT NOT NULL CHECK (outcome IN ('correct', 'wrong', 'skipped')),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, question_id, answered_at)
);

-- 出词引擎增量（本地 sq_recent_words）：本地 seq 为设备局部轮次序号、跨设备不可比，
-- 云端条目身份 = 词 × 出现时刻（保守落位，ADR 0005 Consequences 缺口清单）
CREATE TABLE IF NOT EXISTS word_appearances (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  word_id TEXT NOT NULL,
  appeared_at INTEGER NOT NULL,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, word_id, appeared_at)
);

-- ===== 可编辑实体域：记录级 LWW（updated_at 裁决 + deleted 墓碑）=====

-- 兑换目录（本地 sq_rewards）：经济文件整体替换 = 存量打墓碑 + 新项 upsert
CREATE TABLE IF NOT EXISTS reward_items (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  emoji TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, id)
);

-- 提议板（本地 sq_proposals）：业务字段与本地 ProposalRecord 落盘 12 字段一一对应；
-- 修订即认同的写侧联动由客户端整行重写完成，库端只存最后写（LWW×修订即认同）
CREATE TABLE IF NOT EXISTS proposals (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  status TEXT NOT NULL CHECK (status IN ('discussing', 'agreed', 'published', 'voided')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  description TEXT NOT NULL,
  parent_status TEXT NOT NULL CHECK (parent_status IN ('agreed', 'notAgreed')),
  child_status TEXT NOT NULL CHECK (child_status IN ('agreed', 'notAgreed')),
  initiator TEXT NOT NULL CHECK (initiator IN ('parent', 'child')),
  last_action_by TEXT NOT NULL CHECK (last_action_by IN ('parent', 'child')),
  last_action_kind TEXT NOT NULL CHECK (last_action_kind IN ('proposed', 'changed', 'agreed', 'rethought')),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)), -- 超能力删除已作废提议 = 墓碑传播
  updated_by TEXT NOT NULL,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, id)
);

-- 进行中兑换（本地 sq_active_redemptions）：name/emoji 为兑换瞬间快照，展示不依赖 reward_id；
-- 核销/放弃 = deleted 墓碑
CREATE TABLE IF NOT EXISTS active_redemptions (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, id)
);

-- 红旗标记（本地 sq_flagged）：ADR 0002 未显式枚举，保守按可编辑实体记录级 LWW 落表；
-- 行存在且 deleted=0 = 已标记；取消标记 = 墓碑
CREATE TABLE IF NOT EXISTS question_flags (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  question_id TEXT NOT NULL,
  flagged_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, question_id)
);

-- ===== 每日快照（P1 实施，结构随定稿先行落库；按家庭隔离，保留窗口 ×30 天由 P1 Cron 清理）=====

CREATE TABLE IF NOT EXISTS family_snapshots (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  snapshot_id TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  content TEXT NOT NULL, -- 全域当前态 JSON
  PRIMARY KEY (family_id, snapshot_id)
);
