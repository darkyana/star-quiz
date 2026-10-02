-- D1 版本化迁移 0002：配对申请-批准制第一步（#142，伞票 #129 共识 3）
-- devices 加 status 列：pending = 申请已发出待家长批准（挡在一切业务端点外，仅放行状态轮询）；
-- active = 已入家庭。既有行无感落 'active'（存量设备均已配对完成）；既有查询未选此列，行为不破。
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN 无 IF NOT EXISTS 形态，裸重放会 duplicate column——
-- 幂等由 D1 迁移账本保证（applyD1Migrations 二次调用零变更，口径见 test/index.test.ts）。
ALTER TABLE devices ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active'));
