-- #262：入口显隐键控同步域 entry_visibility（沿 trivia_entry 单值域形状泛化），
-- 行按 (family_id, entry_id) 键控——每家庭 × 每入口一行；无 deleted 墓碑列
-- （显隐只有显示/隐藏两个合法值，不存在删除语义；未设置 = 默认隐藏，由键缺失表达）。
-- 不做存量数据迁移：旧 trivia_entry 单布尔域直接弃表（默认语义反转为隐藏，已设显示的家庭重开一次开关即可）。
CREATE TABLE entry_visibility (
  family_id TEXT NOT NULL REFERENCES families(family_id),
  entry_id TEXT NOT NULL,
  visible INTEGER NOT NULL CHECK (typeof(visible) = 'integer' AND visible IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, entry_id)
);
CREATE INDEX idx_entry_visibility_family_server ON entry_visibility(family_id, server_at);

DROP TABLE trivia_entry;
DROP INDEX IF EXISTS idx_trivia_entry_family_server;
