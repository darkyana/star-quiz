-- 0003：学习行孩子维度（#178 / ADR 0006）。旧行保真归 default。
-- 复合主键演进需重建表；只由版本化迁移账本应用一次。

CREATE TABLE question_results_child (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  child_id TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(child_id)) > 0),
  question_id TEXT NOT NULL,
  answered_at TEXT NOT NULL, -- ISO 8601，本地 QuestionResult.timestamp 原样
  outcome TEXT NOT NULL CHECK (outcome IN ('correct', 'wrong', 'skipped')),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id, question_id, answered_at)
);
INSERT INTO question_results_child (family_id, question_id, answered_at, outcome, server_at) SELECT family_id, question_id, answered_at, outcome, server_at FROM question_results;
DROP TABLE question_results;
ALTER TABLE question_results_child RENAME TO question_results;

CREATE TABLE word_appearances_child (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  child_id TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(child_id)) > 0),
  word_id TEXT NOT NULL,
  appeared_at INTEGER NOT NULL,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id, word_id, appeared_at)
);
INSERT INTO word_appearances_child (family_id, word_id, appeared_at, server_at) SELECT family_id, word_id, appeared_at, server_at FROM word_appearances;
DROP TABLE word_appearances;
ALTER TABLE word_appearances_child RENAME TO word_appearances;

CREATE TABLE question_flags_child (
  family_id TEXT NOT NULL REFERENCES families (family_id),
  child_id TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(child_id)) > 0),
  question_id TEXT NOT NULL,
  flagged_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id, question_id)
);
INSERT INTO question_flags_child (family_id, question_id, flagged_at, updated_at, updated_by, deleted, server_at) SELECT family_id, question_id, flagged_at, updated_at, updated_by, deleted, server_at FROM question_flags;
DROP TABLE question_flags;
ALTER TABLE question_flags_child RENAME TO question_flags;
