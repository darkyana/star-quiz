# Design uniformity: 设计一致性（令牌 / 样式集 / 组件）

唯一目标：三层一致——样式值出自令牌、复用形态出自样式集与组件，不各写各的。

| 层 | 权威载体 | 内容 |
|---|---|---|
| 设计令牌 | `src/styles/variables.css` | 颜色 / 字号 / 间距 / 圆角 / z-index / 时长 |
| 样式集 | `src/styles/components.css` | 跨页复用的全局类（如 `.star-container`；状态色局部覆盖属合法使用） |
| 组件 | `src/components/registry.ts`（可视化对照 `/#/components`） | StarButtonStandard / StarModalStandard / StarNavBar / StarChip / StarIconBtn |

## 三条规则

1. **不硬编码样式**。样式值一律 `var(--*)` 引用令牌；裸 hex、表外 px、魔数零豁免。单页私有样式写在该页面 `<style scoped>`，不为「将来可能复用」预付抽象。
2. **新增令牌 / 新增样式集须老板允许**。主动提出、获批后才落地；开发中撞见缺口时，先用最接近的既有令牌 / 样式集保守实现，并在交付时明确提出待拍板。
3. **组件能用就用**。动手前查 registry，有可用组件（含 variant / size 组合）必须用。没有可用组件时，只在自己模块内部新建组件，不进全局 registry、不动对照页，开发完成后明确告知老板。
