# #162 家长职责全景盘点：两形态现有能力与移动端差距

- 票据：[#162](https://github.com/darkyana/star-quiz/issues/162)，为地图 [#161](https://github.com/darkyana/star-quiz/issues/161) 的证据底座。
- 口径：只盘点当前分支已经存在的代码、现行 ADR 与仍开放的承接票；不把规划当成现状。
- 形态：**主 App 家长页**指家长设备可达的主 App 家长工作区及其子页；**独立改题工具**指 `tools/xingxing-parent`。主 App 在视口 `<600px` 时使用 480px 上限列，本文简称 **480 档**（[`src/App.vue#L60-L79`](../../src/App.vue#L60-L79)）。
- 移动端判定：`是` = 当前 480 档已有完整操作入口与落库路径；`勉强` = 控件可渲染，但桌面密度、文件搬运或浏览器下载使其不能算稳定闭环；`否` = 能力不存在或链路断裂。

## 1. 家长职责清单

| 家长今天要做的事 | 当前形态 | 数据通道 | 480 档能否完成 | 现状依据与说明 |
|---|---|---|---|---|
| 查看题库总题数、新题数、最近答题日期 | 主 App 家长页 | 本机副本；配对后云同步 | 是 | 家长页挂载时从题库与逐题答题记录计算摘要（[`Parent.vue#L55-L80`](../../src/pages/Parent.vue#L55-L80)）。 |
| 生成出题指令并复制给外部 AI | 主 App 家长页子页 | 不落业务数据；剪贴板 | 是 | 填孩子水平、出题内容、题数，校验后生成只读指令并复制（[`QuestionPrompt.vue#L34-L90`](../../src/pages/QuestionPrompt.vue#L34-L90)、[`QuestionPrompt.vue#L133-L176`](../../src/pages/QuestionPrompt.vue#L133-L176)）。“出题内容留空”仍是 icebox #138，不是现状。 |
| 把外部产出的新题带回 App | 主 App 家长页 | **学习文件**；导入后写本机并触发云同步 | 勉强 | 当前只能选择 JSON 学习文件，覆盖或追加导入（[`Parent.vue#L114-L173`](../../src/pages/Parent.vue#L114-L173)）；直接粘贴 AI 回复尚在 icebox #137。因此手机上要先在外部保存文件，再回 App 选文件。若回导独立工具改过的完整题库，必须选**覆盖**；追加模式会把来题重编号后全部追加，不能表达“修改原题”（[`useImport.ts#L31-L44`](../../src/composables/useImport.ts#L31-L44)）。 |
| 导出、覆盖导入、追加导入学习文件 | 主 App 家长页 | 学习文件 ↔ 本机副本 ↔ 云同步 | 是 | 学习文件含题库、红旗、逐题答题记录；覆盖替换三者，追加只合并题库（[`useExport.ts#L24-L33`](../../src/composables/useExport.ts#L24-L33)、[`useImport.ts#L25-L45`](../../src/composables/useImport.ts#L25-L45)）。 |
| 浏览全部题、优先查看红旗待查题、看最近一次答题结果 | 独立改题工具 | 学习文件载入内存 | 勉强 | 工具把红旗题置顶、其余题分组，并在折叠卡显示红旗和最近一次答对/答错（[`EditQuestions.vue#L40-L53`](../../tools/xingxing-parent/src/pages/EditQuestions.vue#L40-L53)、[`QuestionCard.vue#L23-L41`](../../tools/xingxing-parent/src/components/QuestionCard.vue#L23-L41)）。主 App 只有汇总，没有逐题家长视图。 |
| 单题修改题干、四个选项、正确答案、难度 | 独立改题工具 | 学习文件 → 工具内存 → 学习文件 | 勉强 | 展开卡内编辑全部字段并“保存本题”（[`QuestionEditor.vue#L90-L165`](../../tools/xingxing-parent/src/components/QuestionEditor.vue#L90-L165)）。主 App 没有题目编辑界面。 |
| 处置红旗：保留或清除 | 独立改题工具 | 学习文件 → 工具内存 → 学习文件 | 勉强 | 红旗题编辑区默认保留，可选择清除（[`QuestionEditor.vue#L130-L151`](../../tools/xingxing-parent/src/components/QuestionEditor.vue#L130-L151)）；保存时删除对应红旗键（[`useToolData.ts#L23-L33`](../../tools/xingxing-parent/src/composables/useToolData.ts#L23-L33)）。 |
| 删除单题 | 独立改题工具 | 学习文件 → 工具内存 → 学习文件 | 勉强 | 3 秒内二次点击确认，删除题目并同步清除其红旗（[`QuestionEditor.vue#L61-L83`](../../tools/xingxing-parent/src/components/QuestionEditor.vue#L61-L83)、[`useToolData.ts#L36-L44`](../../tools/xingxing-parent/src/composables/useToolData.ts#L36-L44)）。 |
| 全题库校验并保存修改后的 JSON | 独立改题工具 | 工具内存 → 学习文件 | 勉强 | 实时状态灯与错误列表；全量 schema 通过后才下载学习文件（[`EditQuestions.vue#L78-L92`](../../tools/xingxing-parent/src/pages/EditQuestions.vue#L78-L92)、[`validateQuestions.ts#L10-L45`](../../tools/xingxing-parent/src/utils/validateQuestions.ts#L10-L45)）。 |
| 创建、修改提议；同意或“再想想” | 主 App 提议板（家长与孩子共用数据） | 本机副本；配对后云同步 | 是 | 家长可新建/编辑提议、控制自己的表态；修订会按角色落盘（[`Proposals.vue#L139-L203`](../../src/pages/Proposals.vue#L139-L203)、[`ProposalEdit.vue#L61-L85`](../../src/pages/ProposalEdit.vue#L61-L85)）。 |
| 发布兑换项 | 主 App 提议板 | 本机副本；配对后云同步 | 是 | 家长在发布门槛满足且发布窗口内发布；家长超能力只旁路窗口，不旁路双方同意（[`Proposals.vue#L205-L218`](../../src/pages/Proposals.vue#L205-L218)）。 |
| 作废提议；清除已作废记录 | 主 App 提议板 | 本机副本；配对后云同步 | 是 | 作废仅家长可做且有二次确认（[`ProposalDetail.vue#L127-L142`](../../src/pages/ProposalDetail.vue#L127-L142)）；家长超能力开启后可物理删除已作废提议（[`Proposals.vue#L221-L238`](../../src/pages/Proposals.vue#L221-L238)）。 |
| 开关家长超能力并直接给孩子奖励 | 主 App 家长页 | 本机星星流水；配对后云同步 | 是 | 开关是会话级；奖励要求 1–99 正整数和原因，二次确认后记真实流水（[`SuperPowerCard.vue#L27-L64`](../../src/components/SuperPowerCard.vue#L27-L64)）。 |
| 开关测试模式，试答后回滚 | 主 App 家长页 | 仅本机快照；测试期间云同步静默 | 是 | 开启时快照星星流水与逐题答题记录，关闭时回滚并清会话（[`useTestModeState.ts#L59-L94`](../../src/composables/useTestModeState.ts#L59-L94)）；测试期间同步不推不拉（[`sync.ts#L350-L369`](../../src/cloud/sync.ts#L350-L369)、[`sync.ts#L562-L597`](../../src/cloud/sync.ts#L562-L597)）。 |
| 导出/覆盖导入兑换目录、提议、星星流水、进行中兑换 | 主 App 家长页 | **经济文件**；本机副本 ↔ 云同步 | 是 | 经济文件导出四类数据，导入整体替换四键（[`useExport.ts#L36-L45`](../../src/composables/useExport.ts#L36-L45)、[`useImport.ts#L47-L53`](../../src/composables/useImport.ts#L47-L53)）。当前没有逐项编辑兑换目录或流水的家长工作台；除发布提议外，只能整体导入替换。 |
| 查看星星余额与流水明细 | 主 App 的星星记事本（非家长页直属入口） | 本机副本；配对后云同步 | 是 | 页面按时间倒序显示来源、相对时间和增减额（[`StarLog.vue#L18-L31`](../../src/pages/StarLog.vue#L18-L31)、[`StarLog.vue#L71-L104`](../../src/pages/StarLog.vue#L71-L104)）。入口位于兑换页而非家长工作台。 |
| 批准/拒绝入家申请 | 主 App 家庭管理页 | 云端管理 API | 是 | 家长设备拉取申请并批准/拒绝，处理后刷新申请与名册（[`FamilyAdmin.vue#L67-L177`](../../src/pages/FamilyAdmin.vue#L67-L177)）。 |
| 查看设备名册、最后活跃时间并移除设备 | 主 App 家庭管理页 | 云端管理 API；被移除设备本地数据保留 | 是（行较密） | 名册显示名字、设备角色、本机、已移除、活跃时间，并提供移除确认（[`FamilyAdmin.vue#L351-L370`](../../src/pages/FamilyAdmin.vue#L351-L370)、[`FamilyAdmin.vue#L226-L246`](../../src/pages/FamilyAdmin.vue#L226-L246)）。480 档功能完整，但长设备名 + 多 chip + 操作按钮同排，存在拥挤风险。 |
| 出示、隐藏、重置家庭码 | 主 App 家庭管理页 | 云端管理 API | 是 | 家庭码平时隐藏，可出示/隐藏；重置有确认（[`FamilyAdmin.vue#L188-L204`](../../src/pages/FamilyAdmin.vue#L188-L204)、[`FamilyAdmin.vue#L372-L382`](../../src/pages/FamilyAdmin.vue#L372-L382)）。 |
| 查看并回滚家庭快照 | 主 App 家庭管理页 | 云端快照 | 是 | 列出快照并经强确认回滚（[`FamilyAdmin.vue#L262-L275`](../../src/pages/FamilyAdmin.vue#L262-L275)、[`FamilyAdmin.vue#L384-L399`](../../src/pages/FamilyAdmin.vue#L384-L399)）。 |
| 修改已配对设备的设备角色 | 两形态均无 | 应属云端设备管理 | 否 | `CONTEXT.md` 说家长设备上可改设备角色（[`CONTEXT.md#L96-L100`](../../CONTEXT.md#L96-L100)），但家庭管理页和 `src/cloud/admin.ts` 没有修改角色操作；当前只能查看角色、批准申请或移除设备。此为领域文档与实现不一致。 |
| 选择孩子下一轮的出题模式 | **不是现行家长职责**；孩子端首页 | 本机 `sq_quiz_mode`，现未进入同步域 | 不适用 | 领域口径明确由孩子端首页选择，下一轮生效（[`CONTEXT.md#L130-L138`](../../CONTEXT.md#L130-L138)）；ADR-0005 也记录 `sq_quiz_mode` 尚未进同步域（[`ADR-0005#L67-L71`](../adr/0005-同步域D1库表定稿与逃生舱契约门禁.md#L67-L71)）。家长页没有代选入口。 |

### 两形态边界小结

- 主 App 已覆盖家庭运营、提议协商、家长超能力、测试模式、学习/经济文件管理与出题指令；路由均在主 App 内（[`router/index.ts#L26-L53`](../../src/router/index.ts#L26-L53)）。
- 独立改题工具只有一页“星星改题”（[`tools/xingxing-parent/src/App.vue#L8-L15`](../../tools/xingxing-parent/src/App.vue#L8-L15)），其不可替代能力集中在**逐题查看、逐题编辑、红旗处置、删除、全库校验**。
- 工具不写 `localStorage`、没有内部数据库，只持有模块级内存态（[`useToolData.ts#L5-L20`](../../tools/xingxing-parent/src/composables/useToolData.ts#L5-L20)）；它也没有云端凭据或同步模块，因此与家庭数据的唯一桥梁仍是学习文件。

## 2. 移动端闭环与差距清单

地图 #161 的权重顺序是：移动端改题人体工学 > 维护成本 > 家长门槛 > 数据安全边界。依此把“能显示”与“能闭环”分开。

### 2.1 已闭环

| 能力簇 | 结论 | 理由 |
|---|---|---|
| 家庭运营 | 已闭环 | 批准/拒绝、名册、移除设备、家庭码、快照都在主 App 480 档的单列滚动页内；仅名册行存在拥挤风险。 |
| 提议协商与发布 | 已闭环 | 新建/编辑表单使用一屏展示 + 内容区滚动 + 底部操作栏，列表动作在卡内完成（[`ProposalEdit.vue#L100-L123`](../../src/pages/ProposalEdit.vue#L100-L123)）。 |
| 家长超能力与测试模式 | 已闭环 | 开关、奖励表单、越窗发布、删除已作废提议、测试回滚都有主 App 操作路径。 |
| 学习/经济文件的备份、恢复与追加 | 功能闭环 | 文件选择、二次确认、原子导入与下载均存在；但移动浏览器文件管理仍有操作成本，不等于出题/改题闭环。 |
| 出题指令生成 | 生成与复制已闭环 | 参数表单、生成、复制均可在 480 档完成；其后外部 AI 产物回流仍被“文件保存→文件导入”打断。 |

### 2.2 缺失与补齐量级

| 缺口 | 480 档现状 | 难度 | 一句话理由 |
|---|---|---:|---|
| 主 App 单题浏览/搜索/展开编辑 | 否 | **中** | 数据读写与云同步已经存在，但需新建适合触控的长题库浏览、定位与编辑界面。 |
| 单题编辑题干、四选项、正确答案、难度 | 否 | **中** | 单题表单字段不复杂；难点是小屏键盘反复弹起、长文本与正确答案选择的节奏，而非数据模型。 |
| 红旗待查队列与红旗处置 | 否 | **中** | 红旗和逐题记录数据已在主 App/云端，缺的是家长消费队列、上下题流转和保存反馈。 |
| 删除题目 | 否 | **小** | 题库整组写入已有；补受控删除和确认即可，但应同时清红旗/答题记录的即时语义需明确。现工具只清红旗并暂留逐题答题记录孤儿（[`useToolData.ts#L36-L44`](../../tools/xingxing-parent/src/composables/useToolData.ts#L36-L44)）；完整学习文件回到主 App 做覆盖导入时，校验器才清理孤儿记录（[`importExport.ts#L201-L209`](../../src/utils/importExport.ts#L201-L209)、[`importExport.ts#L241-L258`](../../src/utils/importExport.ts#L241-L258)）。 |
| 全库实时校验与错误定位 | 否 | **中** | 导入时已有校验规则，可复用；移动端需要把全库错误可靠定位到某张题卡。 |
| 批量难度调整 | 否 | **大** | 需要筛选、多选、批量动作、最近答题证据同时可见；这是高密度表格在窄屏上的核心人体工学风险，已有 #23 与 #163 专门承接。 |
| 重复题识别 | 否 | **中** | 判重算法小，但移动端还要解决重复组的定位、比较与处置；开放票 #26 当前为 `needs-grill`。 |
| AI 回复直接回流 | 否 | **中** | #137 的 JSON 剥壳、错误口径与复用导入确认链路尚未落地；缺失迫使手机端保存中间文件。 |
| 出题内容可留空并引用外部材料 | 否 | **小** | 仅生成器校验与模板条件分支，已在 icebox #138；本身不解决题目回流。 |
| 修改设备角色 | 否 | **中** | 要补 UI、管理 API、服务端“至少一台家长设备”约束与并发冲突处理，不是单纯加按钮。 |
| 逐项编辑兑换目录/修正流水 | 否 | **大** | 当前只支持提议发布或经济文件整体替换；流水是追加模型，若要“修正”需先拍板冲正语义，不能直接改历史。 |

### 2.3 独立改题工具的移动端判断

工具样式按桌面工作区设计：壳宽上限 960px（[`tools/xingxing-parent/src/App.vue#L104-L108`](../../tools/xingxing-parent/src/App.vue#L104-L108)），工具栏把两组计数、状态灯、导入、保存放在同一行且不换行（[`EditQuestions.vue#L110-L122`](../../tools/xingxing-parent/src/pages/EditQuestions.vue#L110-L122)、[`EditQuestions.vue#L172-L189`](../../tools/xingxing-parent/src/pages/EditQuestions.vue#L172-L189)）；四个选项各自与“正确”单选并排，难度和红旗处置也横排（[`QuestionEditor.vue#L97-L151`](../../tools/xingxing-parent/src/components/QuestionEditor.vue#L97-L151)、[`QuestionEditor.vue#L201-L230`](../../tools/xingxing-parent/src/components/QuestionEditor.vue#L201-L230)）。源码没有针对 480 档的断点，工具按钮也没有主 App `--touch-sm` 的 44px 最小命中区约束（[`EditQuestions.vue#L211-L224`](../../tools/xingxing-parent/src/pages/EditQuestions.vue#L211-L224)、[`QuestionEditor.vue#L283-L306`](../../tools/xingxing-parent/src/components/QuestionEditor.vue#L283-L306)）。

因此它在手机上**可能渲染并勉强逐项操作，但不能据此认定移动端已闭环**：长题库滚动、展开卡内多字段录入、横排控件、导入/下载文件往返共同放大失误和操作成本。是否可接受应由 #163 的 480 档原型实测，而不是由“页面没有被 CSS 隐藏”推断。

## 3. 独立改题工具职能依赖图

```text
学习文件导入
  ├─ 文件选择 / 拖放 / 版本与结构校验
  └─ 载入纯内存工作区
       ├─ 红旗待查置顶 + 题库其余
       ├─ 最近一次答题结果印章
       ├─ 展开单题
       │    ├─ 改题干 / 四选项 / 正确答案 / 难度
       │    ├─ 保留 / 清除红旗
       │    └─ 删除题目
       ├─ 保存本题到工具内存
       └─ 全库实时校验
            └─ 保存 JSON 学习文件
                 └─ 主 App 覆盖导入
```

| `EditQuestions` 当前能力 | 主 App 对应现状 | 承接票状态 |
|---|---|---|
| 选择学习文件并做版本/结构校验 | **已有一部分**：主 App 数据管理可选择文件并校验；没有拖放，也没有“进入编辑工作区” | #137 `icebox` 只承接“粘贴 AI 回复并剥壳”，不承接完整编辑器。 |
| 红旗待查置顶、其余题分组、显示题数/红旗数 | **完全空白（仅汇总）**：家长页只显示总题数、新题数、最近答题日 | 无独立实施票；属于 #85 已拍板但尚未落地的家长工作台迁移范围。 |
| 最近一次答对/答错印章 | **完全空白**：主 App 有逐题记录数据，但无家长逐题视图 | #23 `needs-grill` 规划“最近 5 次结果 + 当前难度”，覆盖范围更大但尚未实施。 |
| 折叠题卡与展开编辑区 | **完全空白** | 无独立实施票；#163 是人体工学原型，不是生产实现票。 |
| 修改题干、四选项、正确答案 | **完全空白** | 无单独开放实施票；仅 #85 决策要求未来收编。 |
| 修改单题难度 | **完全空白** | #23 `needs-grill` 承接批量难度管理，尚未实施。 |
| 保留/清除红旗 | **完全空白** | 无独立开放票。 |
| 删除单题并同步清红旗 | **完全空白** | 无独立开放票；删除时是否清逐题答题记录也未被当前工具处理。 |
| 保存本题到工作区内存、提示未保存修改 | **完全空白** | 主 App 若实现应直接写本机题库并同步，不应照搬工具的双层保存模型；无独立票。 |
| 全库实时校验、错误列表、状态灯 | **已有底层规则，缺编辑态 UI**：主 App 文件导入会校验，但没有编辑后实时校验与错误定位 | #16“题库快速验证”已 `wontfix` 关闭；无现役承接票。 |
| 保存 JSON 学习文件 | **已有**：主 App 可随时导出学习文件 | 已有，无缺口。 |
| 重复题识别 | **工具当前也没有** | #26 已转写为家长工作台票，当前 `needs-grill`；不能记作现有工具能力。 |
| 批量难度调整 | **工具当前也没有** | #23 已转写为家长工作台票，当前 `needs-grill`；不能记作现有工具能力。 |

反向边界也需写清：当前工具没有新增题、编辑 `id/type/wordId`、搜索/筛选、批量编辑、撤销、持久化、直接读写 App 或云同步；这些都不能因“工具是改题端”而推定为已有（现有页面动作全集见 [`EditQuestions.vue#L40-L157`](../../tools/xingxing-parent/src/pages/EditQuestions.vue#L40-L157)，现有内存 API 见 [`useToolData.ts#L10-L46`](../../tools/xingxing-parent/src/composables/useToolData.ts#L10-L46)）。

### #137 / #138 的边界

- #137“粘贴导入”与 #138“出题内容可留空”均为开放 `icebox`，且地图 #161 明确要求在路线结论前挂起；本盘点不把它们计入任一形态的现有能力。
- 两票解决的是**外部 AI 出题链路**的入口摩擦，不补逐题浏览、编辑、红旗处置、删除、全库校验等独立改题工具核心职能。

## 4. 题库真相源与“导出→改→导回”结论

### 4.1 事实

1. **主 App 的运行态题库是每台设备本地的 `sq_questions` 副本。** `questions()` / `writeQuestions()` 直接读写存储键，默认题库也注册到该键（[`useLearningData.ts#L135-L145`](../../src/composables/useLearningData.ts#L135-L145)、[`useLearningData.ts#L187-L195`](../../src/composables/useLearningData.ts#L187-L195)）。
2. **题库已经进入云同步域。** 同步引擎把 `sq_questions` 映射到 `question_banks`，按整组 LWW 合并，并限制家长设备推送（[`sync.ts#L222-L237`](../../src/cloud/sync.ts#L222-L237)、[`sync.ts#L360-L369`](../../src/cloud/sync.ts#L360-L369)）；D1 每家庭一行整组 JSON（[`ADR-0005#L10-L22`](../adr/0005-同步域D1库表定稿与逃生舱契约门禁.md#L10-L22)）。
3. **云端不是唯一真相源。** ADR-0002 明确采用“本地优先 + 双向同步”，每台设备保留全量本地副本，云端是汇合点而非真相源；题库语义是家长单写、最后导入方整组胜（[`ADR-0002#L1-L8`](../adr/0002-本地优先双向同步与分域合并.md#L1-L8)）。写入先本地生效，失败则 outbox 攒账、同步不阻塞本地操作（[`sync.ts#L350-L427`](../../src/cloud/sync.ts#L350-L427)）。新设备首次同步是特例：云端已有任一域时先自动留档本机双文件，再以云端逐域灌入；云端全空才把本机全量推上云（[`sync.ts#L485-L559`](../../src/cloud/sync.ts#L485-L559)）。
4. **学习文件是逃生舱和交换格式，不是主 App 的日常数据库。** ADR 要求学习/经济文件导出契约永不破坏（[`ADR-0002#L17-L23`](../adr/0002-本地优先双向同步与分域合并.md#L17-L23)、[`ADR-0005#L52-L57`](../adr/0005-同步域D1库表定稿与逃生舱契约门禁.md#L52-L57)）。
5. **独立改题工具仍只认识学习文件。** 它把文件加载到内存，编辑后重新下载完整学习文件（[`parseImport.ts#L99-L147`](../../tools/xingxing-parent/src/utils/parseImport.ts#L99-L147)、[`dataExport.ts#L32-L54`](../../tools/xingxing-parent/src/utils/dataExport.ts#L32-L54)），没有云同步通道。

### 4.2 结论

若必须在“本地文件”与“云端”二选一，答案会失真。准确表述是：

> **题库的运行真相是本地优先的多副本状态；云端负责跨设备汇合与恢复；导出的学习文件只是逃生舱/交换载体。**

因此，“导出→改→导回”有两层结论：

- **今天仍是独立改题工具的必经链路**：工具不接家庭云域，不拿到学习文件就没有数据，保存后也只能由主 App 再导入。
- **但它已经是架构上的历史包袱，而不是题库数据架构的必要步骤**：题库已经云端化为同步域；未来家长工作台若在主 App 内直接调用 `writeQuestions()`，改题可先本机生效再自动同步，无需中间文件。学习文件仍应保留为逃生舱，而不应继续承担两个产品之间的日常搬运。

这也解释了维护成本：ADR-0004 当前把主 App 与独立工具定义为独立产品，只以复制令牌保持视觉一致，因此天然承担两套 package、测试、发布和令牌同步债（[`ADR-0004#L1-L16`](../adr/0004-两产品独立与设计令牌复制同步.md#L1-L16)）。

## 保守处理与未覆盖情况

1. `gh issue view 162` 的默认查询因 GitHub Projects Classic 字段弃用报错；本次改用 `gh issue view --json number,title,body,state,labels,comments` 读取 #162/#161，工单正文与标签均成功取得。
2. `CONTEXT.md` 声称设备角色可改，但现有家庭管理 UI/API 无对应操作；本文按“实现缺失”列入差距，而没有用领域描述覆盖代码事实。
3. 主 App 路由守卫只直接拦 `/parent`，子路径依赖组件级防线或既有惯例（[`router/index.ts#L62-L68`](../../src/router/index.ts#L62-L68)）。本文只判定正常入口下的家长职责，不把直达子路径的防护完整性扩展为本票安全审计。
4. 移动端结论是源码层人体工学评估，不是 480 档真机可用性测试；批量改题的最终判断应交给 #163 原型验货。
