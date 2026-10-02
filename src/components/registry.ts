// 组件元数据注册表（定义单 §6）：列表页与展示页只读本表渲染，后续组件卡只增条目、页面零改动
import { h, ref, type Component, type VNode } from 'vue'
import StarButtonStandard from './StarButtonStandard.vue'
import StarModalStandard from './StarModalStandard.vue'
import StarNavBar from './StarNavBar.vue'
import StarChip from './StarChip.vue'
import StarIconBtn from './StarIconBtn.vue'
import StarModeEntry from './StarModeEntry.vue'
import StarToastStandard from './StarToastStandard.vue'
import StarGlyph from './StarGlyph.vue'
import StarCheckCircle from './StarCheckCircle.vue'
import CampAvatar from './CampAvatar.vue'
import StarFeedbackBar from './StarFeedbackBar.vue'
import StarOptionRow from './StarOptionRow.vue'
import StarProgressBar from './StarProgressBar.vue'
import StarSectionShell from './StarSectionShell.vue'
import StarEmptyState from './StarEmptyState.vue'
import StarRewardItem from './StarRewardItem.vue'
import StarProposalCardShell from './StarProposalCardShell.vue'
import StarProposalCamps from './StarProposalCamps.vue'
import StarProposalActions from './StarProposalActions.vue'
import StarSegmentTabs from './StarSegmentTabs.vue'
import StarBatchBar from './StarBatchBar.vue'
import StarListSelectable from './StarListSelectable.vue'
import StarIconClose from './StarIconClose.vue'
import { copy } from '../copy'

/** 展示页复用图标 path（与真实使用处同源：Quiz 平涂旗 24px；关闭 X 已抽 StarIconClose 共享件，#258 评审收口） */
const ICON_FLAG = 'M6.5 3.5v17h1.8v-7.2h10.2l-2.8-3.9 2.8-3.9H8.3V3.5z'

/** 图标钮槽位工厂：svg 自带尺寸（契约：图标尺寸归 slot 内容），fill/stroke 语义由使用处定 */
function iconSlot(size: number, path: string, kind: 'fill' | 'stroke'): () => VNode {
  return () =>
    h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' }, [
      kind === 'fill'
        ? h('path', { d: path, fill: 'currentColor' })
        : h('path', {
            d: path,
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.6,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          }),
    ])
}

/** #218 旗帜示例槽位工厂：槽位层自管切换状态（ref），点击在描边 / 填充两种 iconSlot 形态间往复；
 * 路径同一（ICON_FLAG），StarIconBtn 组件本体零改动（薄组件零 props 契约） */
function flagToggleSlot(size: number, path: string) {
  const filled = ref(false)
  return (): VNode =>
    h(
      StarIconBtn,
      {
        'aria-label': '旗帜示例（点击切换描边 / 填充）',
        onClick: () => {
          filled.value = !filled.value
        },
      },
      () => iconSlot(size, path, filled.value ? 'fill' : 'stroke')(),
    )
}

export interface ShowcaseSlotContext {
  /** 展示页反馈通道：槽位示例内可点击元素点击时调用，格内提示（展示不真的执行动作 / 跳转） */
  notify: (message: string) => void
}

export interface ShowcaseCase {
  /** 传给组件实例的 props 组合（组件契约 props，类型由各组件定义单约束） */
  props: Record<string, unknown>
  /** 每格标注（形态 / 参数，技术标注非产品文案） */
  label: string
  /** 弹窗类全屏组件：为 true 时展示页渲染「打开」触发器，点击后 v-if 展开实例 */
  openTrigger?: boolean
  /** 满宽组件（如导航栏）：为 true 时展示页该格跨全宽渲染（grid-column: 1 / -1），避免两列挤压（issue #9） */
  fullWidth?: boolean
  /** 具名槽位渲染工厂（定义单 §6 框架扩展点，C3 起）：key = slot 名，value = 槽位内容 VNode 工厂 */
  slots?: Record<string, (ctx: ShowcaseSlotContext) => VNode | VNode[]>
  /** 展示格真实接 v-model（#183）：静态 props 展示升级为可交互切换，点击 emit update:modelValue 并更新选中态 */
  interactive?: boolean
}

/** 组件级专属展示区（#217）：平铺展示格之外的补充区域（标题 + 若干实例 + 说明文字），渲染在既有展示格下方 */
export interface ShowcaseSection {
  /** 区域标题 */
  title: string
  /** 区域说明文字 */
  note: string
  /** 区域内实例（复用 ShowcaseCase 渲染框架，含 slots 工厂） */
  items: ShowcaseCase[]
}

export interface ComponentRegistryEntry {
  key: string
  name: string
  /** 组件代码名 = registry import 的组件文件名（#214：列表页 / 展示页小字展示） */
  file: string
  /** 分组 key（#214：componentGroups 定义组标题与组内顺序，页面只读渲染） */
  group: ComponentGroupKey
  component: Component
  showcase: ShowcaseCase[]
  /** 组件级专属展示区（#217，可选）：渲染在 showcase 平铺格下方 */
  showcaseSection?: ShowcaseSection
}

/** 组件分组 key（#214 四组定稿） */
export type ComponentGroupKey = 'atom' | 'selector' | 'alert' | 'block'

export interface ComponentGroup {
  key: ComponentGroupKey
  title: string
  /** 组内组件 key 顺序（#214 与老板定稿一致；新增组件 = registry 加条目 + 并入对应组 order） */
  order: string[]
}

/** 分组定稿（#214）：组标题 + 组内顺序唯一权威，列表页 / 展示页只读本表渲染 */
export const componentGroups: ComponentGroup[] = [
  {
    key: 'atom',
    title: 'Atom',
    order: ['star-button-standard', 'star-chip', 'star-icon-btn', 'star-glyph', 'camp-avatar'],
  },
  {
    key: 'selector',
    title: '选择控件',
    order: ['star-check-circle', 'star-segment-tabs', 'star-mode-entry', 'star-list-selectable', 'star-option-row'],
  },
  {
    key: 'alert',
    title: '提醒',
    order: ['star-modal-standard', 'star-toast-standard', 'star-feedback-bar', 'star-empty-state'],
  },
  {
    key: 'block',
    title: '区块',
    order: [
      'star-nav-bar',
      'star-progress-bar',
      'star-section-shell',
      'star-reward-item',
      'star-batch-bar',
      'star-proposal-card-shell',
      'star-proposal-camps',
      'star-proposal-actions',
    ],
  },
]

export const componentRegistry: ComponentRegistryEntry[] = [
  {
    key: 'star-button-standard',
    file: 'StarButtonStandard.vue',
    group: 'atom',
    name: '按钮',
    component: StarButtonStandard,
    showcase: [
      { props: { variant: 'primary', size: 'large' }, label: 'primary · large' },
      { props: { variant: 'primary', size: 'small' }, label: 'primary · small' },
      { props: { variant: 'standard', size: 'large' }, label: 'standard · large' },
      { props: { variant: 'standard', size: 'small' }, label: 'standard · small' },
      { props: { variant: 'primary', size: 'large', disabled: true }, label: 'primary · large · disabled' },
      { props: { variant: 'primary', size: 'small', disabled: true }, label: 'primary · small · disabled' },
      { props: { variant: 'standard', size: 'large', disabled: true }, label: 'standard · large · disabled' },
      { props: { variant: 'standard', size: 'small', disabled: true }, label: 'standard · small · disabled' },
    ],
  },
  {
    key: 'star-modal-standard',
    file: 'StarModalStandard.vue',
    group: 'alert',
    name: '弹窗',
    component: StarModalStandard,
    showcase: [
      { props: { message: '确定要重新开始吗？', variant: 'confirm' }, label: 'confirm · 默认（取消 / 确认）', openTrigger: true },
      { props: { message: '确定要返回吗？', variant: 'confirm', cancelText: '返回' }, label: 'confirm · 自定义左文（返回）', openTrigger: true },
      { props: { message: '本轮还未完成，确定重新开始吗？', variant: 'confirm', confirmText: '重新开始' }, label: 'confirm · 自定义右文（重新开始）', openTrigger: true },
      { props: { message: '确定要放弃本轮吗？', variant: 'confirm', confirmText: '放弃' }, label: 'confirm · 自定义右文（放弃）', openTrigger: true },
      { props: { message: '重新开始后，本轮进度将清空。', title: '重新开始本轮测验？', variant: 'confirm', confirmText: '重新开始' }, label: 'confirm · 带标题', openTrigger: true },
      { props: { message: '已完成本轮的星星记录，继续加油！', variant: 'notice', confirmText: '知道了' }, label: 'notice · 主色（知道了）', openTrigger: true },
      { props: { message: '设置已保存。', variant: 'notice', confirmText: '好的', noticeButtonVariant: 'standard' }, label: 'notice · 标准色（好的）', openTrigger: true },
      { props: { message: '这是一段用于验证长文本换行的提示内容，超过一行会自然折行并保持居中与行高，适合描述较复杂的说明文字。', variant: 'notice', confirmText: '知道了' }, label: 'message 长文本换行', openTrigger: true },
      // #59 扩展形态：管理弹窗形态（副标题 + 右上关闭钮，emit close）——与 Parent 数据/流水管理弹窗同构（无正文）
      { props: { title: '数据管理', desc: '管理题库和兑换项数据', showClose: true, closeLabel: '关闭' }, label: '管理形态 · 副标题 + 右上关闭钮（emit close）', openTrigger: true },
      // #59 扩展形态：actions 槽覆盖内置按钮行（Parent 导入确认弹窗三按钮形态，按钮参数同源 large + edgeInset 关闭）
      {
        props: { message: '本次导入将写入 3 题' },
        label: 'actions 槽 · 三按钮（导入确认弹窗形态）',
        openTrigger: true,
        slots: {
          actions: (ctx) => [
            h(StarButtonStandard, { variant: 'standard', size: 'large', edgeInset: false, class: 'confirm-cancel', onClick: () => ctx.notify('已点击 取消') }, () => '取消'),
            h(StarButtonStandard, { variant: 'primary', size: 'large', edgeInset: false, class: 'confirm-ok', onClick: () => ctx.notify('已点击 导入并重置') }, () => '导入并重置'),
            h(StarButtonStandard, { variant: 'primary', size: 'large', edgeInset: false, class: 'confirm-ok', onClick: () => ctx.notify('已点击 导入并追加') }, () => '导入并追加'),
          ],
        },
      },
    ],
  },
  {
    key: 'star-nav-bar',
    file: 'StarNavBar.vue',
    group: 'block',
    name: '导航栏',
    component: StarNavBar,
    showcase: [
      // 4 种在用形态平铺（定义单 §6 + issue #10）：C3Re1 后废弃形态（左星星钮 / 右双操作钮）不再推荐展示；
      // 槽位示例为纯结构渲染，可点元素点击仅格内提示；导航栏为满宽组件，全格跨全宽展示（issue #9）
      { props: { title: '星星答题' }, label: '仅标题（Home 形态）', fullWidth: true },
      {
        props: { title: '我的星星' },
        label: '左返回钮 + 标题',
        fullWidth: true,
        slots: {
          left: (ctx) => h(StarButtonStandard, { variant: 'standard', size: 'small', class: 'back-btn', onClick: () => ctx.notify('已点击 返回') }, () => '返回'),
        },
      },
      {
        props: { title: '星星余额' },
        label: '标题 + 右余额 chip（Redeem / StarLog 形态）',
        fullWidth: true,
        slots: {
          right: () =>
            h('div', { class: 'balance-chip', role: 'status' }, [h('span', '128'), h('span', { 'aria-hidden': 'true' }, ' ★')]),
        },
      },
      {
        props: { title: '星星流水' },
        label: '三区全（StarLog 完整形态）',
        fullWidth: true,
        slots: {
          left: (ctx) => h(StarButtonStandard, { variant: 'standard', size: 'small', class: 'back-btn', onClick: () => ctx.notify('已点击 返回') }, () => '返回'),
          right: () =>
            h('div', { class: 'balance-chip', role: 'status' }, [h('span', '128'), h('span', { 'aria-hidden': 'true' }, ' ★')]),
        },
      },
    ],
  },
  {
    key: 'star-chip',
    file: 'StarChip.vue',
    group: 'atom',
    name: '标签',
    component: StarChip,
    showcase: [
      // 4 形态平铺（定义单 §6）：默认 slot 注入示例文本（复用既有 slots 渲染框架，default 键 = 默认槽位）
      { props: { variant: 'default', size: 'sm' }, label: 'default · sm（Quiz 题类型 / Result 得分）', slots: { default: () => h('span', '看中文选英文') } },
      { props: { variant: 'default', size: 'md' }, label: 'default · md（未来预留）', slots: { default: () => h('span', '常规提示') } },
      { props: { variant: 'ghost', size: 'sm' }, label: 'ghost · sm（Redeem 余额不足）', slots: { default: () => h('span', '还差 3 星') } },
      { props: { variant: 'ghost', size: 'md' }, label: 'ghost · md（未来预留）', slots: { default: () => h('span', '今日已全部完成') } },
      // #186 新形态：selected 选中态（筛选标签，ghost + selected）与 tone 文字着色（难度易/中/难，default 底）
      { props: { variant: 'ghost', selected: true }, label: 'ghost + selected（难度筛选组选中态）', slots: { default: () => h('span', '难') } },
      { props: { variant: 'default', tone: 'go' }, label: 'tone go · 易（default 底）', slots: { default: () => h('span', '易') } },
      { props: { variant: 'default', tone: 'mist' }, label: 'tone mist · 中（default 底）', slots: { default: () => h('span', '中') } },
      { props: { variant: 'default', tone: 'warm' }, label: 'tone warm · 难（default 底）', slots: { default: () => h('span', '难') } },
    ],
    // #217 tone 专属展示区：default/sm 的 4 种字色形态（默认字色 + 三种 tone），tone 字色对 4 个变体都生效
    showcaseSection: {
      title: 'tone：(go, mist, warm)',
      note: 'tone 字色对 4 个变体都生效',
      items: [
        { props: { variant: 'default', size: 'sm' }, label: 'default · sm（默认字色）', slots: { default: () => h('span', '默认字色') } },
        { props: { variant: 'default', size: 'sm', tone: 'go' }, label: 'default · sm + tone go', slots: { default: () => h('span', '易') } },
        { props: { variant: 'default', size: 'sm', tone: 'mist' }, label: 'default · sm + tone mist', slots: { default: () => h('span', '中') } },
        { props: { variant: 'default', size: 'sm', tone: 'warm' }, label: 'default · sm + tone warm', slots: { default: () => h('span', '难') } },
      ],
    },
  },
  {
    key: 'star-icon-btn',
    file: 'StarIconBtn.vue',
    group: 'atom',
    name: '图标钮',
    component: StarIconBtn,
    showcase: [
      // C5（#56）：薄组件零 props——热区 44 / hover 洗底 / focus 环归组件；图标尺寸与 fill/stroke 归槽位内容（真实使用处同源）
      { props: {}, label: '关闭图标 18px（Parent 弹窗形态）', slots: { default: () => h(StarIconClose) } },
      // #218 旗帜示例：槽位层自管切换状态，点击在描边 / 填充两形态间往复（组件本体零改动）
      { props: {}, label: '旗帜图标 24px（Quiz 红旗形态，点击切换描边 / 填充）', slots: { default: flagToggleSlot(24, ICON_FLAG) } },
    ],
  },
  {
    key: 'star-mode-entry',
    file: 'StarModeEntry.vue',
    group: 'selector',
    name: '出题方式入口',
    component: StarModeEntry,
    showcase: [
      // #152 G3 三分段直显切换器（探针 P1-r2 mode-switch 形态）：三模式分段平铺、点选即切换、
      // 选中态星光金渐变段；展示格内点击仅触发 update:modelValue 提示语义（modelValue 静态展示选中态）
      { props: { modelValue: 'normal' }, label: 'normal · 普通段选中（Home 默认）' },
      { props: { modelValue: 'fresh' }, label: 'fresh · 新题优先段选中' },
      { props: { modelValue: 'wrong' }, label: 'wrong · 错题优先段选中' },
    ],
  },
  {
    key: 'star-toast-standard',
    file: 'StarToastStandard.vue',
    group: 'alert',
    name: 'Toast',
    component: StarToastStandard,
    showcase: [
      // #139 两格平铺：icon 默认关 / 开关开（done 勾）；静态挂载初值非空 = 常显不计时
      //（watch 不带 immediate，展示格不真跑计时）；toast 为 fixed 底部居中覆盖层，格内无锚定视觉属组件固有形态
      { props: { message: '兑换成功！宝物已放进星星宝藏箱' }, label: '默认（无 icon）' },
      { props: { message: '兑换成功！宝物已放进星星宝藏箱', icon: true }, label: 'icon=true（done 勾）' },
    ],
  },
  {
    key: 'star-glyph',
    file: 'StarGlyph.vue',
    group: 'atom',
    name: '星形',
    component: StarGlyph,
    showcase: [
      // #195 三档并列（probe #194 第 1 节直译：sm 18 / md 24 / lg 48）+ 价签星 sm 实例；fill 恒 color-star，微光内置
      { props: { size: 'sm' }, label: 'sm · 18px（余额 chip 星）' },
      { props: { size: 'md' }, label: 'md · 24px（默认档）' },
      { props: { size: 'lg' }, label: 'lg · 48px（空态大星）' },
      { props: { size: 'sm' }, label: '价签星 · sm（Redeem 奖品卡价格星）' },
    ],
  },
  {
    key: 'star-check-circle',
    file: 'StarCheckCircle.vue',
    group: 'selector',
    name: '勾选圆',
    component: StarCheckCircle,
    showcase: [
      // #182 四态并列（未选/选中 × sm/md，票面直译：sm 22 / md 28px）；受控组件，checked 静态展示各态
      { props: { checked: false, size: 'sm' }, label: '未选 · sm 22px（列表行内档）' },
      { props: { checked: true, size: 'sm' }, label: '选中 · sm 22px（primary 底 + ✓）' },
      { props: { checked: false, size: 'md' }, label: '未选 · md 28px（默认档）' },
      { props: { checked: true, size: 'md' }, label: '选中 · md 28px（primary 底 + ✓）' },
    ],
  },
  {
    key: 'camp-avatar',
    file: 'CampAvatar.vue',
    group: 'atom',
    name: '头像',
    component: CampAvatar,
    showcase: [
      // #197 三实例（probe #194 第 5 节）：有 label → role=img（aria 名取 copy 槽位，与 Proposals 页用法同源）；
      // mini 实例复现操作行 24px 形态——走既有 mini 修饰类降档、无 label 即 aria-hidden
      { props: { kind: 'child', label: copy.proposals.ariaChildSide }, label: 'child · 默认 44（touch-sm）· role=img' },
      { props: { kind: 'adult', label: copy.proposals.ariaParentSide }, label: 'adult · 默认 44（touch-sm）· role=img' },
      { props: { kind: 'child', class: 'camp-avatar--mini' }, label: 'mini · 24（touch-xs）· 无 label → aria-hidden' },
    ],
  },
  {
    key: 'star-feedback-bar',
    file: 'StarFeedbackBar.vue',
    group: 'alert',
    name: '反馈条',
    component: StarFeedbackBar,
    showcase: [
      // #198 三态并列（probe #194 第 8 节）：correct 金渐变 + 星光呼吸 / wrong 红系 / skipped 灰系；
      // text 用中性技术标注文案（真实文案判定归 Quiz 页）
      { props: { tone: 'correct', text: 'correct · 反馈文案样例' }, label: 'correct · 金渐变 + 星光呼吸' },
      { props: { tone: 'wrong', text: 'wrong · 反馈文案样例' }, label: 'wrong · 红系纯文字' },
      { props: { tone: 'skipped', text: 'skipped · 反馈文案样例' }, label: 'skipped · 灰系纯文字' },
    ],
  },
  {
    key: 'star-option-row',
    file: 'StarOptionRow.vue',
    group: 'selector',
    name: '选项块',
    component: StarOptionRow,
    showcase: [
      // #199 五形态并列（probe #194 第 7 节）：correct / reveal 同貌金高亮；跳过钮无专属样式，
      // 复用 normal（禁用复用 disabled）；label 用中性技术标注文案（真实文案判定归 Quiz 页）
      { props: { label: 'normal · 选项文案样例', state: 'normal' }, label: 'normal · 深蓝待选' },
      { props: { label: 'correct · 选项文案样例', state: 'correct' }, label: 'correct · 金高亮（答对）' },
      { props: { label: 'reveal · 选项文案样例', state: 'reveal' }, label: 'reveal · 金高亮（揭晓，与 correct 同貌）' },
      { props: { label: 'wrong · 选项文案样例', state: 'wrong' }, label: 'wrong · 红系（选中错项）' },
      { props: { label: 'disabled · 选项文案样例', state: 'normal', disabled: true }, label: 'disabled · 变淡禁点' },
    ],
  },
  {
    key: 'star-progress-bar',
    file: 'StarProgressBar.vue',
    group: 'block',
    name: '进度条',
    component: StarProgressBar,
    showcase: [
      // #200 四格（probe #194 第 3 节）：0% / 中段 / 满档 + label 与 slot 两种文字形态；
      // sticky 吸顶为组件内置（静态展示格不演示），填充纯 color-primary 实心（#200 probe 定稿）
      { props: { value: 0, max: 10, label: '0 / 10' }, label: '0% 起点 · label prop 文字' },
      { props: { value: 4, max: 10, label: '4 / 10' }, label: '中段 40% · label prop 文字' },
      { props: { value: 10, max: 10, label: '10 / 10' }, label: '满档 100% · label prop 文字' },
      {
        props: { value: 13, max: 26 },
        label: '中段 50% · default slot 复杂文字',
        slots: { default: () => h('span', '已选 13 题') },
      },
    ],
  },
  {
    key: 'star-section-shell',
    file: 'StarSectionShell.vue',
    group: 'block',
    name: '分区卡壳',
    component: StarSectionShell,
    showcase: [
      // #201 三态并列（probe #194 第 4 节）：正常（标题 + 内容 slot）/ 错误（错误行 + 刷新钮）/ 空态；
      // 文案中性技术标注；错误态刷新钮点击 emit refresh（展示页不接事件，无格内反馈属预期）；
      // 空态格显式传空 default slot（showcase 未传 slots 时会注入组件名文本，会挡住「slot 无内容」空态判定）
      { props: { title: '分区卡壳样例' }, label: '正常态 · 标题 prop + 内容 slot', slots: { default: () => h('span', '内容 slot · 列表等业务内容由页面传入') } },
      { props: { title: '分区卡壳样例', error: '加载失败样例（错误态文案由页面传入）' }, label: '错误态 · 错误行 alert + 刷新钮（emit refresh）' },
      { props: { title: '分区卡壳样例', empty: '空态样例 · 无内容时显示' }, label: '空态 · empty prop（slot 无内容才渲染）', slots: { default: () => [] } },
    ],
  },
  {
    key: 'star-empty-state',
    file: 'StarEmptyState.vue',
    group: 'alert',
    name: '空态块',
    component: StarEmptyState,
    showcase: [
      // #196 两态并列（probe #194 第 2 节）：默认 icon=true → 内部 StarGlyph lg（不自绘星形）；
      // icon=false = 纯文案态；文案中性技术标注（真实文案判定归页面）；
      // 显式传 default slot（showcase 未传 slots 时会注入组件名文本）
      { props: {}, label: '默认 · icon=true（内部 StarGlyph lg，Redeem / Prizes 形态）', slots: { default: () => h('span', '空态文案样例（由页面传入）') } },
      { props: { icon: false }, label: 'icon=false · 纯文案态（Proposals 形态）', slots: { default: () => h('span', '空态文案样例（由页面传入）') } },
    ],
  },
  {
    key: 'star-reward-item',
    file: 'StarRewardItem.vue',
    group: 'block',
    name: '奖品行',
    component: StarRewardItem,
    showcase: [
      // #202 两态并列（probe #194 第 6 节）：可兑换 / 锁态（暗槽底 + ghost chip + 禁用钮）；
      // locked 与 shortfall 差值判定留页面（受控），文案中性技术标注；redeem 事件展示页不接（无格内反馈属预期，StarSectionShell 同例）
      { props: { name: '奖品行样例 · 可兑换', price: 30 }, label: '可兑换 · StarGlyph sm + 金色文案（非 pill）' },
      { props: { name: '奖品行样例 · 锁态', price: 45, locked: true, shortfall: 12 }, label: '锁态 · surface-dim 底 + ghost chip + 禁用钮' },
    ],
  },
  {
    key: 'star-proposal-card-shell',
    file: 'StarProposalCardShell.vue',
    group: 'block',
    name: '提议卡壳',
    component: StarProposalCardShell,
    showcase: [
      // #203 三态并列（probe #194 第 9 节直译）：沟通中 / 已作废 / 已谈成；camps / actions 槽由展示页
      // 组装（StarProposalCamps + StarProposalActions 内套兄弟件，头像与钮沿用 registry 组件）；
      // 徽章 tone 驱动右上角色（done 金 / void 红），void 徽章同时驱动标题与价格文字淡化（probe 直译非整卡）
      {
        props: { name: '周末去动物园', price: 80 },
        label: '沟通中 · 无徽章（camps + actions 槽）',
        slots: {
          camps: () =>
            h(StarProposalCamps, null, {
              left: () => [
                h(CampAvatar, { kind: 'adult', label: copy.proposals.ariaParentSide }),
                h('span', { class: 'camp-state is-agree' }, '已点头'),
              ],
              right: () => [
                h(CampAvatar, { kind: 'child', label: copy.proposals.ariaChildSide }),
                h('span', { class: 'camp-state' }, '还在考虑'),
              ],
            }),
          actions: ({ notify }: ShowcaseSlotContext) =>
            h(StarProposalActions, null, {
              default: () => [
                h(CampAvatar, { kind: 'child', class: 'camp-avatar--mini' }),
                h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 同意') }, () => '同意'),
                h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 改提议') }, () => '改提议'),
                h(StarButtonStandard, { variant: 'primary', size: 'small', onClick: () => notify('已点击 发布') }, () => '发布'),
              ],
            }),
        },
      },
      {
        props: { name: '乐园年卡', price: 200, badge: { text: '已作废', tone: 'void' } },
        label: '已作废 · void 红徽章 + 标题价格淡化（actions 槽终态）',
        slots: {
          actions: ({ notify }: ShowcaseSlotContext) =>
            h(StarProposalActions, null, {
              default: () => [
                h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 查看详情') }, () => '查看详情'),
              ],
            }),
        },
      },
      {
        props: { name: '暑假图书套装', price: 60, badge: { text: '已谈成', tone: 'done' } },
        label: '已谈成 · done 金徽章 + 双阵营就绪（无 actions 槽）',
        slots: {
          camps: () =>
            h(StarProposalCamps, null, {
              left: () => [
                h(CampAvatar, { kind: 'adult', label: copy.proposals.ariaParentSide }),
                h('span', { class: 'camp-state is-agree' }, '已点头'),
              ],
              right: () => [
                h(CampAvatar, { kind: 'child', label: copy.proposals.ariaChildSide }),
                h('span', { class: 'camp-state is-agree' }, '已点头'),
              ],
            }),
        },
      },
    ],
  },
  {
    key: 'star-proposal-camps',
    file: 'StarProposalCamps.vue',
    group: 'block',
    name: '提议阵营区',
    component: StarProposalCamps,
    showcase: [
      // #203 双 camp 槽容器（probe #194 第 9 节直译）：surface-dim 圆角块各一，头像 + 阵营态文字由
      // 调用方组装；就绪态文字（is-agree）由调用方挂类，判定不在组件内
      {
        props: {},
        label: '双 camp 槽 · 头像 + 态文字（左就绪 / 右考虑）',
        slots: {
          left: () => [h(CampAvatar, { kind: 'adult', label: copy.proposals.ariaParentSide }), h('span', { class: 'camp-state is-agree' }, '已点头')],
          right: () => [h(CampAvatar, { kind: 'child', label: copy.proposals.ariaChildSide }), h('span', { class: 'camp-state' }, '还在考虑')],
        },
      },
      {
        props: {},
        label: '双 camp 槽 · 双侧就绪（is-agree 金色）',
        slots: {
          left: () => [h(CampAvatar, { kind: 'adult', label: copy.proposals.ariaParentSide }), h('span', { class: 'camp-state is-agree' }, '已点头')],
          right: () => [h(CampAvatar, { kind: 'child', label: copy.proposals.ariaChildSide }), h('span', { class: 'camp-state is-agree' }, '已点头')],
        },
      },
    ],
  },
  {
    key: 'star-proposal-actions',
    file: 'StarProposalActions.vue',
    group: 'block',
    name: '提议操作行',
    component: StarProposalActions,
    showcase: [
      // #203 actions 槽右对齐行（probe #194 第 9 节直译）：内容完全由调用方组装（mini 头像 + 钮一律 StarButtonStandard）
      {
        props: {},
        label: 'actions 槽 · 右对齐（mini 头像 + standard / primary 钮）',
        slots: {
          default: ({ notify }: ShowcaseSlotContext) => [
            h(CampAvatar, { kind: 'child', class: 'camp-avatar--mini' }),
            h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 同意') }, () => '同意'),
            h(StarButtonStandard, { variant: 'primary', size: 'small', onClick: () => notify('已点击 发布') }, () => '发布'),
          ],
        },
      },
    ],
  },
  {
    key: 'star-segment-tabs',
    file: 'StarSegmentTabs.vue',
    group: 'selector',
    name: '分段标签',
    component: StarSegmentTabs,
    showcase: [
      // #183 通用 N 项分段单选（三段 / 两段）：选中态金描边，与出题方式入口（渐变填充选中态）并存可区分；
      // interactive=true 展示格真实接 v-model，点击即切换选中段
      {
        props: { modelValue: 'all', items: [
          { key: 'all', label: '全部' },
          { key: 'flag', label: '红旗' },
          { key: 'wrong', label: '最近错' },
        ] },
        label: '三段 · 全部 / 红旗 / 最近错（筛选分区形态）',
        interactive: true,
      },
      {
        props: { modelValue: 'easy', items: [
          { key: 'easy', label: '易' },
          { key: 'hard', label: '难' },
        ] },
        label: '两段 · 易 / 难',
        interactive: true,
      },
    ],
  },
  {
    key: 'star-batch-bar',
    file: 'StarBatchBar.vue',
    group: 'block',
    name: '批量操作条',
    component: StarBatchBar,
    showcase: [
      // #184 三格并列（票内直译）：壳与计数组件内置，动作全经 actions 槽由使用方组装（StarButtonStandard，
      // 禁止组件内自绘按钮样式）；批量条为 sticky 底栏满宽组件，格内跨全宽展示（issue #9 同例）；
      // clear 事件展示页不接（无格内反馈属预期，StarSectionShell refresh 同例）
      {
        props: { count: 3 },
        label: 'standard · small 动作排（count 3 默认 unit）',
        fullWidth: true,
        slots: {
          actions: ({ notify }: ShowcaseSlotContext) => [
            h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 标星') }, () => '标星'),
            h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 设难度') }, () => '设难度'),
          ],
        },
      },
      {
        props: { count: 12, feedback: 'feedback 行样例（传了才渲染）' },
        label: 'primary · small 动作排 + feedback 行（count 12）',
        fullWidth: true,
        slots: {
          actions: ({ notify }: ShowcaseSlotContext) => [
            h(StarButtonStandard, { variant: 'primary', size: 'small', onClick: () => notify('已点击 应用修改') }, () => '应用修改'),
            h(StarButtonStandard, { variant: 'primary', size: 'small', onClick: () => notify('已点击 批量删除') }, () => '批量删除'),
          ],
        },
      },
      {
        props: { count: 5, unit: '项', feedback: '已导出 5 项（样例反馈）' },
        label: '不同动作 + 自定义 unit（导出场景，证明通用壳）',
        fullWidth: true,
        slots: {
          actions: ({ notify }: ShowcaseSlotContext) => [
            h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 全选') }, () => '全选'),
            h(StarButtonStandard, { variant: 'primary', size: 'small', onClick: () => notify('已点击 导出') }, () => '导出'),
            h(StarButtonStandard, { variant: 'standard', size: 'small', onClick: () => notify('已点击 删除') }, () => '删除'),
          ],
        },
      },
    ],
  },
  {
    key: 'star-list-selectable',
    file: 'StarListSelectable.vue',
    group: 'selector',
    name: '可选择列表项',
    component: StarListSelectable,
    showcase: [
      // #187 四格并列（未选/选中 × 带/不带 action 槽，票面直译）；受控组件，selected 静态展示各态；
      // 行主体经 default 槽由调用方组装（题干 + 元信息样例），action 槽为编辑钮样例（展示页格内提示，
      // stopPropagation 契约：槽内点击不触发 toggle）
      {
        props: { selected: false },
        label: '未选 · 无 action 槽',
        slots: { default: () => [h('span', '示例题干：勾选圆 + 主体'), h('span', '元信息样例')] },
      },
      {
        props: { selected: true },
        label: '选中 · 无 action 槽（primary 描边 + 外圈环）',
        slots: { default: () => [h('span', '示例题干：勾选圆 + 主体'), h('span', '元信息样例')] },
      },
      {
        props: { selected: false },
        label: '未选 · 带 action 槽（编辑钮）',
        slots: {
          default: () => [h('span', '示例题干：勾选圆 + 主体'), h('span', '元信息样例')],
          action: ({ notify }: ShowcaseSlotContext) =>
            h(StarIconBtn, { 'aria-label': '编辑（样例）', onClick: () => notify('已点击 编辑（不触发 toggle）') }, h(StarIconClose)),
        },
      },
      {
        props: { selected: true, disabled: true },
        label: '选中 · disabled（降透明度且不响应 toggle）',
        slots: {
          default: () => [h('span', '示例题干：勾选圆 + 主体'), h('span', '元信息样例')],
          action: ({ notify }: ShowcaseSlotContext) =>
            h(StarIconBtn, { 'aria-label': '编辑（样例）', onClick: () => notify('已点击 编辑（不触发 toggle）') }, h(StarIconClose)),
        },
      },
    ],
  },
]
