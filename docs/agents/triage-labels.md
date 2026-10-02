# GitHub Issue 整理方式（标签体系与生命周期）

本仓 issue 多为自家产出的想法与票据，很少走完整 triage 流程（triage 面向外来请求，如 bug 报告）；常见的形态是想法标签（icebox）、wayfinder 标签，以及任何阶段直接 comment + close（含毙掉 `wontfix`）。

## 一、技能带来的标签集

### Triage 五角色（triage 技能）

The skills speak in terms of five canonical triage roles. This table maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

### Icebox 想法池（icebox-grooming 技能）

| 标签 | 含义 |
| ---- | ---- |
| `icebox` | 低成熟度产品想法池：无 ready-* 压力、无 assignee、无排期，一张票 = 一个想法 |

池内成熟度 Grade（维护在票顶状态行，格式 `Grade: raw (2026-09-01) | Summary: ...`）：

| Grade | 含义 |
| ----- | ---- |
| `raw` | 刚记下的原话，还没想清楚 |
| `brewing` | 有补充讨论，轮廓成形 |
| `ripe` | 一句话能说清要什么，值得 promote 出池 |

操作流（capture → groom → promote / kill）见 `.trae/skills/icebox-grooming`。

### Wayfinder

wayfinder 也维护自己的标签集（`wayfinder:map` / `wayfinder:task` / `wayfinder:research` / `wayfinder:grilling`），由该技能自管，此处不重复列举。

## 二、执行路由标签（规格完备后）

| 标签 | 含义 |
| ---- | ---- |
| `ready-for-agent` | 规格完备，可派会议室 subagent（派工扫描面，保持纯净） |
| `ready-for-orchestrator` | 规格完备，但活文档单写者收口——仅主会话在主目录执行，不建会议室、不派 subagent、不占会议室分支 |

## 三、内容分类：标题前缀体系

标题前缀与系列标签配套使用：

| 标题前缀 | 标签 | 含义 |
| ---------- | ---- | ---- |
| `R-` | `需求` | 需求系列 |
| `B-` | `缺陷` | 缺陷系列 |
| `T-` | `技术债` | 技术债系列 |
| `C-` | `组件` | 组件卡（建组件/加变体） |
| `CXReN` | `组件替换` | 替换卡 |
| `ED-` | 视性质配 `前端优化` 或 `缺陷` | 前端体验相关 |

## 四、Issue 生命周期（本仓主流线）

```
无标签 → icebox → needs-grill → ready-for-agent 或 ready-for-orchestrator → done & close
```

任何阶段都可能直接 comment + close（含毙掉 → `wontfix`）。外来请求（bug 报告等）才走 triage 五角色全程（可经 `needs-info` / `ready-for-human`）。

## 已废弃标签（不要再创建）

- `优先级:P0`~`P3`、`批次:*`、`状态:*`、`类型:*` —— 引入 triage 五角色前的旧流程残留，2026-08-30 清理，不要再建。
- `准备丢弃` —— 与 `wontfix` 重叠，已删除；软删除一律用 `wontfix`。
