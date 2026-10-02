import type { RewardItem } from '../types'

// 当前兑换项默认值（Spec 20260821-R3 §2 REQ-5 / AC5-1，与 useAppState 原内联 DEFAULT_REWARDS 逐字段一致）
// 构建期静态 import 加载，运行时零网络请求（A1）；编辑方式：改本文件 → 重新构建；
// 已安装用户通过家长页「数据管理」弹窗导入更新（公理 B3：不做 UI 增删改）。
export const currentRewards: RewardItem[] = [
  { id: 'reward_pineapple', name: '菠萝油', price: 5, emoji: '🥐' },
  { id: 'reward_tv', name: '看 10 分钟电视', price: 15, emoji: '📺' },
  { id: 'reward_sukiyaki', name: '去吃寿喜锅', price: 25, emoji: '🍲' },
]
