-- #278 限时通道：entry_visibility 域新增到期时间戳列 expires_at（可空）。
-- 四态编码：关闭 = visible 0 无到期；保持开启 = visible 1 无到期；限时 = visible 1 + expires_at
-- （epoch ms，写入方家长设备本地时钟计算，服务端不做时间校准；纯推导无写回）。
-- 可空列 + 无 CHECK：存量行自然为 NULL（可见无到期 = 保持开启，按拍板补充无感迁移，不做数据改写）；
-- 值域校验在 wire boundary（worker/src/sync.ts validRow），非法行整包拒绝。
ALTER TABLE entry_visibility ADD COLUMN expires_at INTEGER;
