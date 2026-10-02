-- D1 版本化迁移 0006：家庭口令列（票 #190，ADR 0007 运营方发码制与双因子占家闸）
-- pairing_codes 新增 passphrase TEXT 可空列：与家庭码同表同口径存明文（4 位小写 a-z，格式由生成方
-- generatePassphrase 保证，不加 CHECK）；存量行为 NULL =「明确未设置态」——出示端点原样返回 null，
-- 直入比对 NULL 永不匹配。重置端点同批次签发新码+新口令，成对轮换。
ALTER TABLE pairing_codes ADD COLUMN passphrase TEXT;
