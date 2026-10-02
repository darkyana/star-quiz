-- #303 提议 emoji 同步域切片：proposals 新增可空 emoji 列（对齐本地 ProposalRecord.emoji? 可选语义，
-- T2 #301 已定：零物理迁移、读取侧缺省兜底 🎁）。
-- 可空列 + 无 CHECK：存量行自然为 NULL（与本地「无 emoji 键」等价，读取侧统一兜底 🎁）；
-- 不进同步域必填清单（worker/src/sync.ts proposals.required），省略列落 NULL 与 reward_items.emoji 先例一致；
-- 内容等价比较在客户端合并器（src/cloud/merge.ts proposalContentEqual）按规范化后比较——
-- NULL / 缺省与 '🎁' 视为同一内容（与 T2 读取兜底出口口径一致），仅实质改 emoji 产生待推 diff。
ALTER TABLE proposals ADD COLUMN emoji TEXT;
