-- #180: 临场状态按家庭 × 孩子保存，整行 LWW；无旧域缺省孩子兼容。
CREATE TABLE morale (
  family_id TEXT NOT NULL REFERENCES families(family_id),
  child_id TEXT NOT NULL CHECK (length(trim(child_id)) > 0),
  level INTEGER NOT NULL CHECK (typeof(level) = 'integer' AND level BETWEEN 1 AND 3),
  last_round_correct INTEGER CHECK (last_round_correct IS NULL OR (typeof(last_round_correct) = 'integer' AND last_round_correct BETWEEN 0 AND 10)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id)
);
CREATE INDEX idx_morale_family_server ON morale(family_id, server_at);
