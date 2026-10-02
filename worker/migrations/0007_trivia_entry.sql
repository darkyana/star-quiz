-- #236: 惊喜题库入口显隐开关，按家庭单行整组 LWW（沿 question_banks 单值域形状）；
-- 无 deleted 墓碑列——开关只有显示/隐藏两个合法值，不存在删除语义（未设置 = 默认显示，由键缺失表达）。
CREATE TABLE trivia_entry (
  family_id TEXT NOT NULL REFERENCES families(family_id),
  visible INTEGER NOT NULL CHECK (typeof(visible) = 'integer' AND visible IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id)
);
CREATE INDEX idx_trivia_entry_family_server ON trivia_entry(family_id, server_at);
