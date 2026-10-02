/**
 * 产品版本号（单一版本源，首页底栏展示 V{APP_VERSION}）
 * 版本号以发布记录为准；自 v0.5.0 起 package.json 与 APP_VERSION 同步 bump（两处一致：APP_VERSION / package.json；原「release 文档」一处已随归档移出）。
 * 版本策略（产品负责人 2026-08-21 定稿；原落档模板 docs/templates/版本更新记录-vX.Y.Z-YYYYMMDD.md 已随 _Archived_docs/ 移出仓库、仅存 git 历史）：
 *   - 正式迭代（走 Spec/TDD）→ minor 递增（v0.X.0）
 *   - bug 修复 / 临时变更 → patch 递增（v0.X.Y+1）
 *   每次发布同步更新本常量并写版本更新记录。
 */
export const APP_VERSION = '0.14.0'
