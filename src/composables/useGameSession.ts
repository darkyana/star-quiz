// 游戏会话组合模块（#253，自 Home.vue 游戏会话子系统整体抽离）：扣星开局、加载看门狗与超时退星、
// iframe postMessage 协议校验（频道/版本/实例/请求/轮次多字段白名单）、防重放注册表、退出退星、重玩协议
// 全部私有于本模块；对外最小接口 = 阶段状态、提示、开局、退出、加载失败接线。星星流水一律经 useStarData
// （redeemGame / refundGame），模块不直写存储、不绕过幂等判定；游戏协议格式、扣退星金额、看门狗时长等
// 行为数值零变化。说明弹窗门禁、iframe 挂载点属页面职责，经注入接线
// （frame / onBlocked / onReplay）。
// 消息监听生命周期由模块内部成对管理（#253 防御性修正：原实现 setup 顶层注册、卸载钩子注销不对称；
// 现挂载注册 / 卸载注销对称。iframe 只在付费进 loading 后才创建，注册时点由 setup 推迟到挂载
// 不产生可见行为差异，票面认账）。

import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { redeemGame, refundGame } from './useStarData'
import { GAME_SLOT } from '../data/playable-games'
import { copy } from '../copy'

/** 会话五态：idle 未开局 / loading 已扣星待 ready / playing 已授权游玩 / ended 本局结束 / failed 加载失败已退星 */
export type GamePhase = 'idle' | 'loading' | 'playing' | 'ended' | 'failed'

/** 页面接线：frame = iframe 挂载点（消息来源校验与授权回发）；onBlocked = 扣星被拒（余额不足）页面刷新；onReplay = 重玩协议重开说明 */
export interface GameSessionOptions {
  frame: Ref<HTMLIFrameElement | null>
  onBlocked?: () => void
  onReplay?: () => void
}

// 加载看门狗非预加载保障：30 秒未 ready 即终结已付费实例并全额退星（#232），不重试。
const GAME_READY_TIMEOUT_MS = 30_000

export function useGameSession(options: GameSessionOptions) {
  const phase = ref<GamePhase>('idle')
  const toast = ref('')
  let submitting = false
  let roundId = ''
  let instanceId = ''
  let requestId = ''
  const authorizedInstances = new Set<string>()
  let loadTimer: ReturnType<typeof setTimeout> | undefined

  function failLoad(): void {
    if (phase.value !== 'loading') return
    clearTimeout(loadTimer)
    // #232 未收到 ready 的尝试全额退星：进 failed 前退回（phase 转移只发生一次 = 同次尝试恰好一退）
    if (!refundGame(GAME_SLOT.id)) toast.value = copy.home.game.refundFailed
    phase.value = 'failed'
  }

  /** 扣星开局：成功锁定已付费局并挂看门狗（返回 true）；被拒回调 onBlocked、写失败提示，均返回 false 零授权 */
  function start(): boolean {
    if (submitting || phase.value !== 'idle') return false
    submitting = true
    try {
      // 所有可预计算的环境操作先于扣星；成功后只锁定已付费局，不夹带刷新/读库。
      const nextRound = crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint32Array(4))].join('-')
      const result = redeemGame(GAME_SLOT.id)
      if (!result.ok) {
        options.onBlocked?.()
        return false
      }
      roundId = nextRound
      instanceId = ''
      requestId = ''
      toast.value = copy.home.game.success(GAME_SLOT.name)
      phase.value = 'loading'
      loadTimer = setTimeout(failLoad, GAME_READY_TIMEOUT_MS)
      return true
    } catch {
      toast.value = copy.home.game.writeFailed
      return false
    } finally {
      submitting = false
    }
  }

  function exit(): void {
    clearTimeout(loadTimer)
    // #232 loading 态退出 = 未收到 ready 的尝试，退回星星；ready 之后（playing/ended）退出维持不退
    if (phase.value === 'loading' && !refundGame(GAME_SLOT.id)) toast.value = copy.home.game.refundFailed
    phase.value = 'idle'
    instanceId = ''
    requestId = ''
    roundId = ''
  }

  function receive(event: MessageEvent): void {
    const source = options.frame.value?.contentWindow
    if (!source || event.source !== source || event.origin !== location.origin) return
    const message = event.data
    const fields = ['channel', 'version', 'type', 'instanceId', 'requestId', 'roundId']
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
      Object.keys(message).length !== fields.length || !fields.every(key => Object.prototype.hasOwnProperty.call(message, key)) ||
      message.channel !== GAME_SLOT.channel || message.version !== 1 ||
      typeof message.instanceId !== 'string' || !message.instanceId.trim() ||
      typeof message.requestId !== 'string') return
    if (message.type === 'ready' && phase.value === 'loading' && message.roundId === null &&
      message.requestId === `${message.instanceId}:1` && !authorizedInstances.has(message.instanceId)) {
      authorizedInstances.add(message.instanceId)
      clearTimeout(loadTimer)
      instanceId = message.instanceId
      requestId = message.requestId
      phase.value = 'playing'
      // ready 只消费人工已支付的这局，不扣费。
      source.postMessage({ ...message, type: 'start', roundId }, location.origin)
      return
    }
    if (!instanceId || message.instanceId !== instanceId || message.roundId !== roundId) return
    if (message.type === 'ended' && phase.value === 'playing' && message.requestId === requestId) {
      phase.value = 'ended'
    } else if (message.type === 'replay-request' && phase.value === 'ended' && message.requestId === `${instanceId}:2`) {
      // 不复用同一个 WindowProxy：重玩只回说明，下一次人工付款再创建新文档。
      exit()
      options.onReplay?.()
    } else if (message.type === 'exit' && (phase.value === 'playing' || phase.value === 'ended') && message.requestId === requestId) {
      exit()
    }
  }

  // 生命周期对称（#253）：消息监听挂载注册 / 卸载注销成对出现，看门狗随卸载清理
  onMounted(() => { window.addEventListener('message', receive) })
  onUnmounted(() => {
    window.removeEventListener('message', receive)
    clearTimeout(loadTimer)
  })

  return { phase, toast, start, exit, failLoad }
}
