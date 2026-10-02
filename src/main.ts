import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { init as initAppState, registerMigrationBackup } from './composables/useDataInfra'
import { runMigrationBackup } from './composables/useExport'
import { installCorruptionNotice } from './composables/useCorruptionNotice'
import { startSync } from './cloud/sync'
// #287 现役惊喜题集冷启动预热：fetch 静态资产槽位 set.json 并校验（失败只落空题库 + warn，不阻断启动）
import { warmTriviaSet } from './data/trivia-set'
import { IS_MINITOOL } from './minitool'
import './styles/variables.css'
import './styles/components.css'

// #172 家底键损坏恢复提示钩子：须在 initAppState() 之前注册（启动期 init 读键发现的损坏也要收到）
installCorruptionNotice()

// 组合根注册迁移前全量备份（REQ-1.5）：注册者由学习域上移至此，
// 域模块之间恢复严格单向依赖（useExport → useLearningData，剪环，架构评审 20260829）
registerMigrationBackup(runMigrationBackup)
initAppState()

// #287 惊喜题集预热不 await：冷启动不等内容，首页贴纸照常渲染；缺失/损坏时点开有「重试」兜底（warm 内部吞错）
void warmTriviaSet()

// 同步引擎冷启动拉合（#126，R-P1d）：触发点收在组合根、不散落页面；
// 未配对设备空转零网络（#125 挂载零请求口径）
// 小工具构建：容器纯离线禁网络，同步引擎不启动（cloud 模块随 DCE 移出产物）
if (!IS_MINITOOL) startSync()

createApp(App).use(router).mount('#app')
