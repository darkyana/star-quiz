# 惊喜题集归档目录

`public/trivia/archive/` 存放**已下架**的惊喜题集文件夹；App **永不读取**本目录（代码只读现役槽位 `public/trivia/current/`，见 `src/data/trivia-set.ts` 的 `TRIVIA_SET_SLOT`）。

## 换题集流程（零代码，人工路径）

1. 出题：按 `docs/prompts/trivia-question-prompt.md` 的 set.json 输出契约让外部 AI 出题，**人工核对事实**后整理成新 `set.json`（explain 解释留在核对稿里，绝不入库）；
2. 归档：把现役 `public/trivia/current/` 整夹移入本目录，命名为 `<slug>/`（如 `builtin-trivia-minecraft/`），id 不回收（9 号段顺延续号，归档题的序号永不复用）；
3. 上架：把新题集文件夹放进 `public/trivia/current/`（`set.json` + 贴纸图 `icon.svg`/`icon.png`，画作沿用 `docs/design/surprise-sticker` 三色归档之一即可）；
4. 验收：跑 `npx vitest run src/data/__tests__/trivia-set.test.ts`（形状/9 号段唯一/名称一致的安全网），再跑全套测试。

## set.json 形状

与现役槽位同构（头部元数据 + 题目数组）：

- `category` / `book`：题库大类 / 分册（调度范围键），名称随题集内容走；
- `intro`：孩子侧介绍弹窗文案；
- `starRule`：**惊喜得星规则（可省，#289 已实现）**——门槛数组 `{ minAccuracy, stars }[]`（正确率下限 → 星数）：开局快照进会话、结算按命中的最高档取一档入账（来源「惊喜答题：{类别名}」）；每档 `minAccuracy ∈ (0,1]`、`stars` 正整数，形状非法整集按损坏拒绝；不含此字段 = 惊喜轮不产星；
- `questions`：题目数组，每题 `{ id, type, prompt, options, answerIndex }`；`id` 为 6 位补零序号字符串、占 9 号段（9xxxxx，归属判定的唯一依据，见 ADR 0014），`type` 固定 `'trivia'`，不携带 `category`/`book`（加载时由头部统一盖章）。

## 现有归档

- `builtin-trivia-minecraft/`：内置题集初版「我的世界」知识问答（30 道，id 900005–900034），2026 年被塞尔达版替换下架。
