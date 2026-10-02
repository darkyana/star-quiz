// 即时游玩游戏槽位（#230）：单槽位可换游戏——换游戏 = 放入新游戏目录 + 改写本配置对象，宿主代码零改动。
// 配置内字段值允许是当前游戏的专属值（id / channel / path / name 等），其余代码一律读配置不写死。
// 不进入兑换目录；价格只在此配置。#264：开局时窗概念整体删除，入口可见 + 星余额足即任何时刻可开局。
export const GAME_SLOT = Object.freeze({
  id: 'mini-garage-prototype',
  name: '迷你车库',
  price: 15,
  path: 'games/mini-garage-prototype/index.html',
  channel: 'mini-garage',
  // icon 资产约定（#231）：icon.svg 是游戏自备画作——用游戏自身调色板、不画外层描边；宿主统一加令牌描边
  icon: 'games/mini-garage-prototype/icon.svg',
  instructions: '选择赛道、轮胎和装置，触摸出发后小车自动前进；拖动赛道或按住左右键左右转向，点按装置加速或弹跳。碰障只会减速，冲线结算。游戏得分不增加答题星星。',
})
