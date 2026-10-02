# App 架构 Resources

## Knowledge

- [Parnas：On the Criteria To Be Used in Decomposing Systems into Modules](https://www.cs.lafayette.edu/~gexia/cs301/resources/parnas.html)
  1972 年原论文的大学托管转录，已阅读；转录页提示不保证完全准确。[正式出版记录](https://doi.org/10.1145/361598.361623)。第一课依据：按隐藏的设计决策划分，而非机械地把每个处理步骤拆成 module。初学者只读 The Criteria 与 Conclusion，允许由老师中文解释。
- [Ousterhout：A Philosophy of Software Design，作者提供的第二版节选](https://web.stanford.edu/~ouster/cgi-bin/aposd2ndEdExtract.pdf)
  已发现但尚未通读，留待后续课核对；不当作已读证据。本课的 Depth 词义采用仓库 codebase-design 技能的 leverage 口径，不用代码行数比。
- 本仓库源码：`src/pages/Proposals.vue`（137–168）、`src/composables/useProposals.ts`（161–188）、`src/utils/proposalState.ts`（19–47、78–103）。
  已阅读；是第一课现状证据。CONTEXT.md 兑换与提议板部分提供业务定义。源码之后可能变化，开后续课前重新核对。
- 本仓库 `.agents/skills/codebase-design/SKILL.md`。
  课程术语约定：Module、Interface、Implementation、Depth、Seam、Adapter、Leverage、Locality；属于工作约定，不伪装成学术定理。

## Wisdom (Communities)

尚未推荐社区；先在本项目的真实方案评审中练习，并由老师反馈。用户没有表示拒绝社区。

## Gaps

- 后续 seam 课需核实 Michael Feathers 的第一手定义及适合当前基础的实例。
- 独立 module、独立部署的成本比较尚未授课。
