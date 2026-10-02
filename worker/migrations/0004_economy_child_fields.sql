-- 0004：经济行孩子归属、星种与共享兑换附加要求（#179 / ADR 0006）。
-- 旧行原值保留；复合主键演进仅由迁移账本应用一次。

CREATE TABLE star_entries_child (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  child_id TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(child_id)) > 0),
  id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'game', 'interest')),
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL,
  quiz_id TEXT,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id, id)
);
INSERT INTO star_entries_child (family_id, id, timestamp, type, amount, source, quiz_id, server_at) SELECT family_id, id, timestamp, type, amount, source, quiz_id, server_at FROM star_entries;
DROP TABLE star_entries;
ALTER TABLE star_entries_child RENAME TO star_entries;

CREATE TABLE proposals_child (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  child_id TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(child_id)) > 0),
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
  PRIMARY KEY (family_id, child_id, id)
);
INSERT INTO proposals_child (family_id, id, name, price, status, created_at, updated_at, description, parent_status, child_status, initiator, last_action_by, last_action_kind, deleted, updated_by, server_at) SELECT family_id, id, name, price, status, created_at, updated_at, description, parent_status, child_status, initiator, last_action_by, last_action_kind, deleted, updated_by, server_at FROM proposals;
DROP TABLE proposals;
ALTER TABLE proposals_child RENAME TO proposals;

CREATE TABLE active_redemptions_child (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  child_id TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(child_id)) > 0),
  id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id, id)
);
INSERT INTO active_redemptions_child (family_id, id, reward_id, name, emoji, created_at, updated_at, updated_by, deleted, server_at) SELECT family_id, id, reward_id, name, emoji, created_at, updated_at, updated_by, deleted, server_at FROM active_redemptions;
DROP TABLE active_redemptions;
ALTER TABLE active_redemptions_child RENAME TO active_redemptions;

ALTER TABLE reward_items ADD COLUMN requirement TEXT CHECK (requirement IS NULL OR (json_valid(requirement) AND json_type(requirement) = 'object'));
