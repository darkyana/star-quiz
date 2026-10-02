// 小红书小工具构建开关：vite.config.minitool.ts 经 define 把 VITE_MINITOOL 注入为 '1'，
// 日常构建（PWA）与测试恒为 false。云端同步/配对/游戏 iframe/文件下载等容器不可用能力
// 均以此门控，构建期经 DCE tree-shake 移出小工具产物。
export const IS_MINITOOL = import.meta.env.VITE_MINITOOL === '1'
