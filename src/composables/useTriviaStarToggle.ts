// #290 惊喜得星开关（家长控制）：键控惊喜题库入口的家庭级开关，默认开。
// 存储与同步搭入口显隐既有机制（域 sq_entry_visibility 内独立入口键，按行 LWW 全家生效，ADR 0016 同基座）：
// 开关键由惊喜入口 id 派生（builtin-trivia:star），不键控主题/题集——换 set.json 内容不重置；
// 「关」显式落 false、「开」显式落 true（与入口显隐同款「家长切换是可传播事实」口径）；
// 未设置 = 默认开（读取语义，空记录不出行不推云，与 morale 初始档位同口径）。
// 开局（startQuiz）读取一次，生效决定定格进会话 starRule 快照——结算/结果页绝不反查本开关，
// 进行中的轮不受之后改开关影响；孩子端对开关零感知（仅体现在结算行为）。
import { ref, type Ref } from 'vue'
import { readEntryVisibilityMap, writeEntryVisibilityValue } from './useEntryVisibility'
import { registerWriteListener, STORAGE_KEYS } from './useDataInfra'
import { TRIVIA_ENTRY_ID } from '../data/trivia-set'

/** 惊喜得星开关键：惊喜入口 id 派生（键控入口不键控主题，换题集不重置）；即云端同步行 entry_id */
export const TRIVIA_STAR_TOGGLE_KEY = `${TRIVIA_ENTRY_ID}:star`

/** 惊喜得星是否开启：显式 false 才关；未设置 = 默认开 */
export function readTriviaStarEarns(): boolean {
  return readEntryVisibilityMap()[TRIVIA_STAR_TOGGLE_KEY] !== false
}

/** 单点写（家长切换；经 writeValue 收口 → 同步引擎写入即推，LWW 全家生效） */
export function writeTriviaStarEarns(enabled: boolean): void {
  writeEntryVisibilityValue(TRIVIA_STAR_TOGGLE_KEY, enabled)
}

// 响应式 ref（家长面板消费）：与 useEntryVisibilityRef 同款共享 ref + 写监听管线（本机切换 / 云端拉合落库自动跟随）
let toggleRef: Ref<boolean> | null = null

/** 惊喜得星开关响应式 ref：页面渲染消费单一出口；每次取 ref 回读本地重对齐 */
export function useTriviaStarToggleRef(): Ref<boolean> {
  if (toggleRef !== null) {
    toggleRef.value = readTriviaStarEarns()
    return toggleRef
  }
  toggleRef = ref(readTriviaStarEarns())
  registerWriteListener((key) => {
    if (key === STORAGE_KEYS.entryVisibility) toggleRef!.value = readTriviaStarEarns()
  })
  return toggleRef
}
