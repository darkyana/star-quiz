// 本次仅迁移位置，文案内容不变（NG-5）；术语沿用 docs/terms.md 既有外部 UI 用语（该文件已随 _Archived_docs/ 移出仓库、仅存 git 历史）。

import type { Question, StarRuleTier } from './types'
// #287 惊喜题集介绍文案随题集对象分发（现役资产槽位 set.json），页面经 trivia-set 的响应式状态读取；
// 文案表只收口固定 UI 文案（标题/按钮/缺失提示）
// #279 评审收口：「剩余 X 分钟」「不到 1 分钟」格式化单一出口（utils/relativeTime.entryRemainingText，
// 纯函数层零副作用）；槽位保留（测试锁定 key 与对外字符串），值委托共享函数，组件也直用该函数
import { entryRemainingText } from './utils/relativeTime'
import { monthDayText } from './utils/calendarDate'

export const copy = {
  // #38（2026-08-29 老板拍板）：返回文案全局收敛——所有返回按钮统一用顶层 copy.back；
  // 被替代的视角/页面级 back 字段保留字段名、值加 [DEPRECATED] 前缀（防误引用，不删 key）
  back: '返回',
  // #172 家底键损坏恢复提示（经 #169 钩子在「被发现那一刻」弹共享 Toast；答题进行中延后）
  corruptionRecoveryToast: '检测到数据异常，已自动恢复，建议导出一份备份',
  // #174 数据安全持续提示（App.vue 外壳横幅；与 #172 瞬时 Toast 区分：故障持续期间常显）
  dataSafety: {
    upgradeBlocked: '本地存储异常，数据升级已暂停（数据没有改动）。清理浏览器存储空间后重新打开，会自动重试。',
    syncIncompatible: '云端服务版本暂时不兼容，同步已暂停。本机数据完好，可继续离线使用，无需重新配对。',
  },
  home: {
    brand: '星星答题',
    game: {
      price: (amount: number): string => `每局 ${amount} 颗星`,
      // #264 开局时窗删除：window / closed 提示文案随窗口概念一并移除，星够即任何时刻可开局
      shortage: '星星不足，先去答题攒星星吧',
      start: '开始游戏',
      // #230 游戏名参数化（槽位配置提供），句式保留
      success: (name: string): string => `已兑换并使用《${name}》一次机会`,
      exit: '退出游戏',
      // #258 游戏会话全屏化：loading/failed 空态块内的小号「退出」钮（running 态 X 的 aria-label 仍用 exit）
      exitShort: '退出',
      // #232 开局未就绪自动退款：未收到 ready 的尝试（超时/加载失败/loading 期退出）全额退星，文案随新行为
      loading: '游戏加载中，未能开始会自动退回星星。',
      failed: '游戏未能加载，星星已退回。请返回首页。',
      // #232 退回流水 source（账本条目语感）与退款写账失败提示（本地存储异常不静默）
      refundSource: (name: string): string => `《${name}》未能开始，星星已退回`,
      refundFailed: '星星未能退回，请检查本地存储。',
      writeFailed: '未能完成兑换，游戏没有开始。请检查本地存储后再试。',
      cancel: '取消',
    },
    starAriaLabel: '星星',
    balanceLabel: '星星',
    // tagline「今天来攒几颗星？」已随 #108 定稿 D（#103 实施）移除：原位替换为出题方式入口（StarModeEntry）
    startQuiz: '开始答题',
    poolEmptyHint: '还没有题目哦，等爸爸妈妈加好题目就可以开始了',
    // #271 惊喜题库入口贴纸化：label 为贴纸可及名与弹窗标题，start 为弹窗主按钮；close 为弹窗右上关闭钮可及名
    // （#271 弹窗只有「开始」一个动作钮，无取消钮）。#272 起惊喜会话永远新题优先，无出题方式切换。
    // #287 介绍文案改随题集对象分发（Home 经 triviaSetRef 读取）；loadFailed/retry 为内容缺失/损坏的兜底态
    trivia: {
      label: '惊喜题库',
      start: '开始惊喜答题',
      close: '关闭',
      loadFailed: '惊喜内容在路上，重试一下',
      retry: '重试',
    },
    redeem: '兑换星星',
    // #280 限时剩余（游戏/惊喜两说明弹窗共用，分钟粒度倒计时）：限时开启显示「剩余 X 分钟」，
    // 不足 1 分钟显示「不到 1 分钟」；保持开启/关闭/未设置无此行；到期反馈完全静默（拍板 B1），无到期提示文案
    timedRemaining: (minutes: number): string => entryRemainingText(minutes),
    timedRemainingLess: entryRemainingText(0),
    configAriaLabel: '配置',
    configLink: '配置',
    versionLabel: (version: string): string => 'V' + version,
    // 检查更新（版本号可点击）：比对云端 version.json 的构建哈希（git 短哈希）与本机构建身份；
    // 业务版本号只作展示——有无新版本的判定不依赖人工 bump（新版本文案携带云端业务版本号供人确认）
    update: {
      title: '检查更新',
      ariaLabel: '检查更新',
      checking: '正在检查更新…',
      newVersion: (version: string): string => `发现新版本 V${version}，更新需要重新加载页面。`,
      latest: '已是最新版本。如页面显示异常，可重新加载。',
      error: '无法检查更新，请确认网络后重试。',
      update: '立即更新',
      reload: '重新加载',
      dismiss: '知道了',
    },
    // 页脚「当前家庭」字段（2026-09-09）：已配对设备显示现役家庭码（任何角色，老板拍板常显）；未配对明确提示
    familyLabel: (code: string): string => `家庭：${code}`,
    familyNone: '尚未加入家庭',
  },

  // #308 页面与导入反馈共用内测口径；UI/文案权威为 #309 定稿评论。
  parentGuide: {
    pageTitle: '给家长的话',
    sticker: '家长请看',
    triviaCapsule: '惊喜问答',
    steps: ['认真答题', '赢下星星', '兑换奖励', '商量提议'],
    questionsTitle: '示范题有点难？',
    questionsBody: '内置的只是 20 道示范题。你可以按照自己家的情况，出最适合孩子的题来替换。',
    tryNote: '不用先建家，这台设备上就能直接试；题和星星都会留着。',
    questionsAction: '出一套我家的题',
    rewardsTitle: '星星攒着做什么？',
    rewardsBody: '10 分钟电视、一个睡前故事……这些都是孩子眼里的真奖励，是真实世界的心愿。内置了 3 个示范兑换项，你们也完全可以和孩子在提议板上协商、发布自家的兑换项。',
    rewardsAction: '看看星星兑换',
    parentTitle: '家长还能做什么？',
    parentItems: [
      '孩子表现好，可以不经答题直接加星，落一笔「特别奖励」。',
      '游戏和惊喜答题的入口，随时可以关掉，或限时开一小段。',
      '不想和孩子抢一台手机？创建一个家庭，让孩子用自己的设备加入，全家共享数据；孩子的设备进不了家长配置。',
    ],
    familyAction: '创建我们的家',
    betaTitle: '创建家庭',
    betaMessage: '创建家庭还在内测——想多台设备共享家庭数据，到小红书找「毛线没有接住」申请一枚家庭码，就可以创建家庭。',
    dismiss: '知道了',
    // #321 通知视图读空后的正向收尾空态（本票唯一新增文案）：主句 + 说明，不配按钮，离开走既有返回栏
    allReadTitle: '都看完啦',
    allReadHint: '让孩子去答几道题吧',
    importNext: '让孩子试试吧。',
    help: '遇到问题？到小红书找「毛线没有接住」',
    statisticsTitle: '数据统计说明',
    statisticsParagraphs: [
      '为了解首次使用是否顺畅，联网版默认统计普通答题的开始、答完 10 题进入结果页，以及家长入口和本页各按钮的点击次数。统计次数，不统计人数，也不串联个人行为。',
      '只按北京时间日期、操作名称和设备最近确认的“已加入家庭／未加入家庭”状态汇总，保留 90 天。状态尚未确认或上报失败时不补报，不影响使用；纯离线小工具版不统计。',
      '不上传题目、答案、家庭编号、设备或会话标识；统计应用不保存 IP、浏览器信息或逐条行为记录。网络服务商接收请求时仍会处理 IP 等必要连接信息，不能理解为 IP 从未被处理。',
    ],
  },

  // #125 设备配对（R-P1c）；#145 单屏化：码/命名/角色三字段同屏一个表单 + 主按钮「申请配对」（分步文案已删尽）；
  // 错误文案与服务端错误类别一一对应（src/cloud/api.ts PairErrorKind → 页面映射）
  pair: {
    entryLink: '加入家庭',
    pageTitle: '设备配对',
    // #142 申请化说明（伞票 #129 UI 文案初稿），替代旧 codeHint（旧提示隐含「码一定在家长设备上」，与盲探测口径不符）
    intro: '输入家庭码，给设备取个名字。家长批准后，这台设备就加入家庭。',
    codeLabel: '家庭码',
    nameLabel: '给这台设备起个名字',
    defaultDeviceName: '星星设备',
    roleLabel: '这台设备是谁的？',
    // 角色二选一改 StarSegmentTabs 分段标签（2026-09-09）：分段项只留角色名（选项卡描述文案随形态退役）
    roleParentName: '家长设备',
    roleChildName: '孩子设备',
    // #192 双因子（R-130c）：家长角色选填家庭口令——仅家庭没有现役家长设备时（首台入驻/恢复）与家庭码成对校验直入，日常入家申请留空
    passphraseLabel: '家庭口令（选填）',
    passphrasePlaceholder: '仅首台设备填写，日常申请留空',
    // #145：三步向导并为单屏表单，主按钮「申请配对」（下一步/上一步文案随状态机一并删除）
    submitBtn: '申请配对',
    submittingBtn: '申请中…',
    // #142：删尽码错/码重置类反馈（错码与真申请同构进等待页），仅剩限流（服务端秒数换算分钟）与网络/未知兜底
    error: {
      locked: (minutes: number) => `试得太多次了，${minutes} 分钟后再试`,
      network: '网络连接失败，请检查网络后重试',
      unknown: '申请失败，请重试',
    },
    // 等待页（#142，伞票 #129 UI 文案初稿；#144 补「重新申请」按钮：回配对页重填，带旧凭据替换旧申请）
    wait: {
      pageTitle: '等待批准',
      main: '申请已发给家长，等家长点一下批准。',
      longWaitHint: '等了很久？和家长确认一下家庭码，或者重新申请',
      networkRetry: '网络不稳，正在重试……',
      reapplyBtn: '重新申请',
    },
  },

  quiz: {
    pageTitle: '答题页',
    restart: '重新开始',
    typeLabel: { zh2en: '看中文选英文', en2zh: '看英文选中文', cloze: '挖空选词', trivia: '惊喜问答' } as const, // #173 type 加 trivia（惊喜题；孩子端文案去「趣味」化，见 CONTEXT.md 惊喜题库词条）
    feedback: { correct: '答对了！', wrong: '正确答案是这个', skipped: '记住它，下次就会了' } as const,
    progressLabel: (current: number, total: number): string => `第 ${current} / ${total} 题`,
    nextLabel: '下一题',
    viewResult: '查看结果',
    skip: '不会',
    restartConfirm: '重新开始本轮测验？已答题目不计星。',
    cancel: '取消',
    confirmRestart: '重新开始',
    // R6 放弃答题（Spec 20260824）：按钮 + 确认弹窗（取消按钮复用上方 cancel，对齐既有弹窗惯例）
    abandon: '放弃答题',
    abandonConfirm: '确定放弃本轮答题？已答的题目不会计入星星。',
    confirmAbandon: '放弃',
    // R25 红旗旗钮（Spec 20260825-v0.7.1）：无障碍标签两态（放行门老板裁决正式文案）
    flag: { btnAriaLabel: '标记这道题', btnAriaLabelActive: '取消标记这道题' } as const,
    // 出题方式三分段切换器（#152 G3，文案 = #108 r2 定稿组一直白系零自拟）：
    // label 为 StarModeEntry 弱标签与 radiogroup 可及名；三模式 name/shortName/desc 原散在
    // useQuizMode 的 QUIZ_MODE_META 内（desc 现无展示位，随槽位一并收口备将来用）
    mode: {
      label: '出题方式',
      normal: { name: '普通模式', shortName: '普通', desc: '和平时一样，星星来出题' },
      fresh: { name: '新题优先', shortName: '新题优先', desc: '没做过的题先出场' },
      wrong: { name: '错题优先', shortName: '错题优先', desc: '做错的题再来一次' },
    } as const,
  },

  result: {
    pageTitle: '结算页',
    scoreBadge: (score: number, total: number): string => `得分 ${score} / ${total}`,
    // #288 无得星规则惊喜轮主结果行：「答对 X / Y 题」式（替换「+N 颗星」数字位）
    triviaResult: (score: number, total: number): string => `答对 ${score} / ${total} 题`,
    earnUnit: '颗星',
    goHome: '回到首页',
    message: {
      fullMark: '满分通关！太棒了',
      // R24 差一题满分档（Spec 20260824-v0.7.0-R24 REQ-R24-7-1 定稿）：correctCount === totalCount − 1 时触发；学科轮沿用
      nearFullMark: '就差 1 题就满分啦！满分还有 3 颗奖励星哦！',
      // #289 文案随票修正：无规则惊喜轮不产星，差一题档的「3 颗奖励星」许诺落空——惊喜无星轮改用本档（学科文案不动）
      nearFullMarkStarless: '就差 1 题就满分啦！再来一次一定行！',
      good: '答对了这么多，真厉害',
      practice: '差一点点就满分了，再来一次',
      encourage: '没关系，下次再来',
    },
  },

  redeem: {
    back: '[DEPRECATED]返回',
    pageTitle: '兑换页',
    emptyState: '还没有可兑换的奖品，快去答题攒星星吧',
    shortage: (n: number): string => `还差 ${n} 颗`,
    price: (n: number): string => `${n} 颗星`,
    redeemBtn: '兑换',
    ledgerLink: '星星记事本',
    // R34（Spec 20260828-R34 REQ-R34-1-1）：兑换页底部「提议板」入口（与「星星记事本」并列同款样式）
    // #104：三钮文案统一「星星」前缀，「提议板」→「星星提议板」（仅孩子端，家长端 parent.proposalsEntry 不动）
    proposalsEntry: '星星提议板',
    confirmText: (price: number, name: string, remaining: number): string =>
      `用 ${price} 颗星兑换「${name}」？兑换后剩余 ${remaining} 颗`,
    cancel: '取消',
    confirm: '确认',
    // R-72-1（#73 已拍板）→ #106：兑换成功 toast 指向「星星宝藏箱」（宝藏系）
    toast: '兑换成功！宝物已放进星星宝藏箱',
  },

  // R-72-1（#73）原「我的奖品」页文案 → #106 孩子端宝藏系 → #295（#293/#294 拍板）奖品聚合格子：
  // 同名奖品聚成一格、单「用一个」按钮（原核销），删除路径（原「放弃」）彻底移除——abandon 槽位随之裁撤
  prizes: {
    pageTitle: '星星宝藏箱',
    emptyState: '宝藏箱还空着，去兑换一件宝物吧',
    // 格卡日期（#294 二轮拍板终稿）：人性化相对措辞、按日历日计——今天 / 昨天 / N天前（2–6 天）/
    // 一周前（7–13 天）/ 两周前（14–20 天）/ 21 天及以上兜底「X月X日获得」；页面只传日历日差与兜底日期
    redeemedAt: (days: number, fallbackDate: string): string => {
      if (days <= 0) return '今天获得'
      if (days === 1) return '昨天获得'
      if (days <= 6) return `${days}天前获得`
      if (days <= 13) return '一周前获得'
      if (days <= 20) return '两周前获得'
      return `${fallbackDate}获得`
    },
    // 兑换页底部第三入口（与星星记事本/提议板并列）
    entry: '星星宝藏箱',
    // 用一个（#74 原核销 → #295 聚合语义）：按钮 / 二次确认（口语版带剩余数量，#294 拍板措辞）
    useUpBtn: '用一个',
    useUpConfirm: (name: string, remaining: number): string =>
      `要用一个「${name}」吗？用掉就少一个咯（还剩 ${remaining} 个）`,
    // #295：toast 沿原型改口语版「用掉一个…！」——与确认弹窗口语语气一致；原「核销成功」是内部术语
    // 且偏成人化，聚合语义下「哪一件被用掉」比「核销成功」更贴近孩子视角
    useUpToast: (name: string): string => `用掉一个「${name}」！`,
  },

  starLog: {
    back: '[DEPRECATED]返回',
    pageTitle: '星星记事本',
    emptyState: '还没有记录，快去答题攒星星吧',
    earnSign: '+',
    redeemSign: '−',
  },

  parent: {
    pageTitle: '家长页',
    backChild: '[DEPRECATED]返回孩子端',
    // #38 需求 1：题库情况卡片文案（一行三组「·」分隔；fresh=0 / 无最近答题时对应段不输出）
    questionBankSummary: (total: number, fresh: number, lastDate?: string): string => {
      const parts = [`共 ${total} 题`, fresh > 0 ? `有 ${fresh} 新题` : '', lastDate ? `最近答题 ${lastDate}` : '']
      return parts.filter((p) => p !== '').join(' · ')
    },
    dataManage: '数据管理',
    ledgerManage: '流水管理',
    closeAriaLabel: '关闭',
    dataManageDesc: '管理题库和兑换项数据',
    ledgerManageDesc: '管理星星收支流水',
    exportBtn: '导出',
    importBtn: '导入',
    importSuccess: '导入成功',
    importFailReason: (reason: string): string => `导入失败：${reason}`,
    importFailRead: '导入失败：文件读取失败',
    // #172 两档导入失败文案（票内 Desired behavior 原文）：前三类内部码（文件坏/版本不支持/校验不过）共用户文案，
    // 写失败单列；内部码→文案映射见 useImport.importErrorText。旧 reason 拼接槽（importFailReason/importFailRead）
    // 不再被页面引用，保留 key 防误引用口径不变。
    importFailChecked: '文件未通过检查，没有写入任何数据',
    importFailWrite: '已恢复原状，建议清理设备存储后重试',
    // R21（Spec 20260826-R21 REQ-R21-5）：数据导入双模式确认；R36 起改用 confirmLearningImport，本槽位废弃保留
    importOverwrite: '导入并重置',
    importAppend: '导入并追加',
    confirmDataMode: (n: number): string =>
      `[DEPRECATED]文件包含 ${n} 道题。「导入并重置」会覆盖当前全部题库和兑换项；「导入并追加」会把这 ${n} 道题加到题库最后并重新编号，兑换项仍按文件覆盖。`,
    confirmData: '[DEPRECATED]导入将覆盖当前所有题库和兑换项数据，确定继续？',
    // R36 起流水导入改用 confirmEconomyImport，本槽位废弃保留
    confirmLedger: '[DEPRECATED]导入将覆盖当前所有星星流水，确定继续？',
    // R36（Spec 20260827-v0.10.0-R36 REQ-R36-6）：两组导入确认计数文案 + 1.x 断代「版本过旧」提示（暂定值，文案方只改 value 不改 key）
    confirmLearningImport: (n: number): string => `本次导入将写入 ${n} 题`,
    // R32（Spec D6 有意变更 / 自主决策 #6）：扩提议计数参数（M 兑换项 / P 提议 / K 流水）；
    // 显示顺序提议计数追加在流水后，保持 R36 锁定验收断言「兑换项 M 项 + 流水 K 条」连续子串不破坏（验收测试本 Task 不可改）
    confirmEconomyImport: (m: number, p: number, k: number): string =>
      `本次导入将写入兑换项 ${m} 项 + 流水 ${k} 条 + 提议 ${p} 条`,
    importVersionTooOld: '文件版本过旧，请用最新版重新导出',
    // #212 粘贴导入：反馈文案族仅新增剥壳失败一条（票面「仅新增一行」口径，#137 二次 grill 拍板）；
    // 粘贴视图界面文案（按钮/标题/解析/返回/占位）为该口径的保守扩大解释（票面语境指反馈文案族），
    // 按 copy.ts 单一事实源惯例就近开槽，交付报告缺口清单单列供老板复核
    importPasteNoJson: '未在粘贴内容中找到有效 JSON',
    pasteImportBtn: '粘贴导入',
    pasteImportTitle: '粘贴导入',
    pasteImportPlaceholder: '把 AI 回复整段粘贴到这里，点「解析」自动提取题目数据',
    pasteImportParseBtn: '解析',
    pasteImportBackBtn: '返回',
    cancel: '取消',
    confirm: '确认',
    // C1 组件库预览页（组件卡 v0.7.5）：入口按钮 + 页面标题 + 返回
    componentsLibrary: '组件库',
    componentsListTitle: '组件库',
    back: '[DEPRECATED]返回',
    // #263 家长控制功能卡（家长工作台；卡片标题 + 两个入口开关行；家庭级偏好，开关经云同步全家生效；未开启 = 默认隐藏）
    parentControlTitle: '家长控制功能',
    gameEntryTitle: '游戏入口',
    gameEntryDesc: '开启后孩子设备首页才显示游戏入口，全家设备同步生效',
    triviaEntryTitle: '惊喜入口',
    // #273 惊喜入口新形态（#269）：贴纸 + 点击弹介绍弹窗一键开局，说明文案与新形态一致
    triviaEntryDesc: '开启后孩子设备首页才显示惊喜题库贴纸，点贴纸弹介绍弹窗、一键开始惊喜答题，全家设备同步生效',
    // #279 四态单选（拍板 A1）：文案缩短硬排一段（关闭 / 保持 / 30 分钟 / 1 小时），窄屏以缩文案适配不做垂直列表；限时剩余分钟文案
    entryOptionOff: '关闭',
    entryOptionKeepOn: '保持',
    entryOptionTimed30: '30分钟',
    entryOptionTimed60: '1小时',
    entryRemainingMinutes: (n: number) => entryRemainingText(n),
    entryLessThanOneMinute: entryRemainingText(0),
    // #290 惊喜条目两行组装（题集对象 + 规则单一事实源，无自由文本）：主题行 / 奖励行 / 得星开关两档
    triviaSetTheme: (category: string, book: string, count: number): string => `本期为${category}：${book}，${count}道惊喜问答`,
    triviaRewardNone: '奖励：无',
    // 奖励行按规则自动渲染：档按正确率升序（低门槛在前、全对收尾），100% 档固定「全对得 N 颗星」
    triviaRewardRule: (tiers: StarRuleTier[]): string => '奖励：' + [...tiers]
      .sort((a, b) => a.minAccuracy - b.minAccuracy)
      .map((tier) => (tier.minAccuracy >= 1 ? `全对得 ${tier.stars} 颗星` : `答对 ${Math.round(tier.minAccuracy * 100)}% 得 ${tier.stars} 颗星`))
      .join('，'),
    triviaStarOptionOn: '得星开',
    triviaStarOptionOff: '得星关',
    // R32（Spec 20260827-R32 REQ-R32-1-1）：家长页「提议板」入口按钮
    proposalsEntry: '提议板',
    // #136 家长页「出题指令」生成器：入口按钮 + 独立页文案（模板单一真相源 = docs/question-tool/prompt.md，构建时打包）
    questionPrompt: {
      entryBtn: '出题指令',
      pageTitle: '出题指令',
      intro: '填好下面的信息，生成一段指令，复制给任意 AI（如 ChatGPT / 豆包），它就能帮你出题。',
      levelLabel: '为谁出题',
      levelPlaceholder: '孩子年龄/年级/水平',
      contentLabel: '根据什么内容出题',
      // #138：内容可留空（占位符首词告知；留空时把材料直接发给外部 AI，指令注入材料兜底句）
      contentPlaceholder: '可留空，如：人教版 PEP 四年级上册 Unit 1–3；留空时把 PDF/图片材料直接发给 AI',
      countLabel: '出几道题',
      // 2026-09-09 老板拍板：题数字段就近常显建议量提示（题太多 AI 出题质量会降）
      countHint: '建议生成 100 题以下，题太多 AI 出题质量容易下降',
      generateBtn: '生成指令',
      copyBtn: '复制指令',
      outputLabel: '生成的出题指令',
      copyToast: '复制成功，去粘贴给 AI 吧',
      copyFail: '复制失败，请长按文本框全选内容手动复制',
      // #311 复制后就地接住：点「复制指令」后本页出现后续步骤指引 + 直达导入入口（跳 /parent?import=paste 自动开粘贴导入弹窗）
      nextStepHint: '下一步：把指令粘贴给 AI，等它生成题目；回来后点下方按钮，把 AI 的回复整段粘贴进去就能导入题库。',
      goImportBtn: '去导入题目',
      templateBroken: '指令模板异常，请更新 App 后重试',
      error: {
        levelRequired: '请填写孩子的年龄/年级/水平',
        levelTooLong: '「孩子年龄/年级/水平」不能超过 100 字',
        contentTooLong: '「根据什么内容出题」不能超过 100 字',
        countRequired: '请填写出几道题',
        countInvalid: '出几道题需是 20–600 的整数',
      } as const,
    } as const,
    // #132 家庭管理：家长页第 5 个入口按钮 + 独立页顶栏标题（grill 拍板词序「家庭管理」；
    // deviceAdmin 既有槽位随页面迁往 /parent/family，值不动）
    familyAdminEntry: '家庭管理',
    familyAdminTitle: '家庭管理',
    // #323 家长页第 6 个入口按钮（末位、同权重）：带 from=parent 进入家长通知页归档形态
    parentGuideEntry: '给家长的话',
    // #127（R-P1e）：家长页「设备与家庭」管理区——设备列表/移除、家庭码出示/重置、快照列表/回滚；
    // 域术语对齐 CONTEXT.md 设备角色节（移除=断云不擦本机数据；重置=只拦后续加入；避「注销/远程擦除/密码」）
    deviceAdmin: {
      sectionTitle: '设备与家庭',
      // #143（R-129b）：等家长批准的申请块（管理区顶部；伞票 #129 UI 文案初稿，行 = 名字 · 申请成为：角色 · 时间）
      approvals: {
        title: '等家长批准的申请',
        empty: '没有等批准的申请',
        appliedRole: (role: string): string => `申请成为：${role}`,
        approveBtn: '批准',
        rejectBtn: '拒绝',
        approvedToast: (name: string): string => `已同意「${name}」加入家庭`,
        rejectedToast: '已拒绝这次申请',
        conflictToast: '这条申请刚被处理过',
      },
      devicesTitle: '设备',
      roleParent: '家长设备',
      roleChild: '孩子设备',
      selfDevice: '本机',
      revokedChip: '已移除',
      lastSeen: (time: string): string => `最后活跃 ${time}`,
      lastSeenUnknown: '最后活跃 未知',
      revokeBtn: '移除',
      revokeConfirmTitle: '移除设备',
      revokeConfirm: (name: string): string =>
        `确定移除「${name}」吗？该设备将与云端断开，本机数据保留不擦除。`,
      revokeSelfConfirm: (name: string): string =>
        `确定移除「${name}」（本机）吗？移除后本机回到未配对状态，本地数据保留不擦除。`,
      // 清除已移除设备（CONTEXT.md 同名词条）：名册末尾标准按钮入口（StarButtonStandard standard·small），
      // 批量硬删全部「已移除」墓碑行（ADR 0012）；无已移除设备不渲染
      clearRevokedBtn: '删除已移除设备',
      clearRevokedConfirm: (n: number): string => `将从名册中删除全部 ${n} 台已移除设备，不可恢复。`,
      clearedToast: (n: number): string => `已删除 ${n} 台已移除设备`,
      codeTitle: '家庭码',
      codeHidden: '······',
      codeShowBtn: '出示家庭码',
      codeHideBtn: '隐藏',
      codeResetBtn: '重置家庭码',
      codeResetConfirmTitle: '重置家庭码',
      codeResetConfirm: '重置后只拦住后续加入，已配对设备不受影响。',
      // #192 双因子（R-130c）：家庭码与家庭口令成对出示（口令未设置 → 明确未设置态文案，不显示空白）
      passphraseHidden: '····',
      passphraseUnset: '家庭口令：未设置',
      passphraseValue: (value: string): string => `家庭口令：${value}`,
      snapshotsTitle: '快照回滚',
      snapshotsEmpty: '近 30 天暂无快照',
      restoreBtn: '回滚',
      restoreConfirmTitle: '回滚快照',
      restoreConfirm: (time: string): string =>
        `回滚会覆盖当前云端状态，各设备下次同步生效。确定回滚到 ${time} 吗？`,
      restoreDone: '已回滚，各设备下次同步生效',
      refreshBtn: '刷新',
      error: {
        unpaired: '本设备未配对或凭据已失效，请重新配对',
        forbidden: '仅家长设备可管理设备与家庭',
        conflict: '这条申请刚被处理过', // #143：仅批准/拒绝流出现（另一家长刚处理完同一条申请）
        notFound: '内容不存在或已失效，请刷新后重试',
        network: '网络连接失败，请检查网络后重试',
        unknown: '操作失败，请重试',
      } as const,
    },
  },

  stars: {
    quizSource: '答题得星',
    fullMarkSource: '满分奖励',
    // #289 带规则惊喜轮入账来源文案：快照式「惊喜答题：{类别名}」（类别名取会话 scope 快照，不反查题集）
    triviaSource: (category: string): string => '惊喜答题：' + category,
    redeemSource: (name: string): string => '兑换：' + name,
  },

  // 家长超能力（#266 收敛：无总开关、仅超能力奖励，仅家长端可见；术语上「家长超能力」只指超能力奖励，将来可扩展）；
  // D5 来源文案「特别奖励：{原因}」与既有「满分奖励」语感一致，标注非答题得星、不泄机制黑话
  superPower: {
    cardTitle: '家长超能力',
    cardDesc: '不经答题直接给孩子加星，落「特别奖励」流水',
    rewardBtn: '超能力奖励',
    rewardTitle: '超能力奖励',
    rewardAmountLabel: '星数（1–99）',
    rewardReasonLabel: '加星原因',
    rewardConfirm: (amount: number, reason: string): string =>
      `给孩子加 ${amount} 颗星，原因：${reason}。确认记入星星流水？`,
    cancel: '取消',
    confirm: '确认',
    rewardSource: (reason: string): string => '特别奖励：' + reason,
  },

  // R32 提议空间（Spec 20260827-R32）：提议板列表 / 新建编辑表单 / 详情三页文案（只改 value 不改 key）
  proposals: {
    pageTitle: '提议板',
    createProposal: '新建提议',
    emptyState: '还没有提议，先新建一个吧',
    priceLabel: (price: number): string => `消耗 ${price} 颗星`,
    statusBadge: {
      discussing: '沟通中',
      agreed: '已达成一致',
      published: '已发布',
      voided: '已作废',
    } as const,
    childAgreeToggle: '代孩子同意',
    publishBtn: '发布兑换项',
    viewDetail: '查看详情',
    // #266 已作废删除常驻化：删除从超能力降级为提议板常驻家长功能（仅已作废可删；二次确认含不可恢复文案）
    deleteBtn: '删除',
    deleteConfirm: (name: string): string => `确定删除「${name}」吗？删除后不可恢复`,
    form: {
      pageTitle: '提议表单',
      // 表单标签口语化（2026-08-30 老板拍板）：由「兑换物名称/兑换消耗」改为「想换什么/花多少星星」
      // 补录说明：63d2409 的 commit message 声称已改，实际漏改，本条为补做
      nameLabel: '想换什么',
      priceLabel: '花多少星星',
      descriptionLabel: '说明文字',
      saveBtn: '保存',
      validationHint: '名称不能为空，消耗要是正整数',
      // #299 提议图标宫格（#300 方案 B 行内收起/展开定稿）：收起行「{当前emoji} 换一个」/ 展开后「收起」/ 宫格无障碍名
      emojiLabel: '图标',
      emojiSwapBtn: '换一个',
      emojiCollapseBtn: '收起',
      ariaEmojiGroup: '提议图标',
    },
    detail: {
      pageTitle: '提议详情',
      nameLabel: '兑换物名称',
      priceLabel: '兑换消耗',
      descriptionLabel: '说明文字',
      createdAtLabel: '创建时间',
      updatedAtLabel: '最后变更',
      // R34 非目标（简报 4.3.10）：本版本不显示 initiator，详情页发起人行移除，槽位废弃保留
      initiatorLabel: '[DEPRECATED]发起人',
      parentStatusLabel: '家长状态',
      childStatusLabel: '孩子状态',
      statusLabel: '整体状态',
    },
    initiatorParent: '[DEPRECATED]家长',
    voidBtn: '作废',
    // R32 T7：详情页非终态提议「编辑」入口按钮（Spec 未开槽，编码方按 ui-copy.md 开槽）
    editBtn: '编辑',
    voidConfirm: (name: string): string => `确定作废「${name}」吗？作废后不可恢复`,
    agreementValue: {
      agreed: '已同意',
      notAgreed: '未同意',
    } as const,
    // R34 T4（REQ-R34-2-2 双端统一双按钮）：「同意」「再想想」提升至 proposals 层双端共用
    agreeBtn: '同意',
    rethinkBtn: '再想想',
    // #63 双阵营卡（Spec #61 终稿 2026-08-30 + 拍板补录）：阵营状态文案 / 右上角标识 / 卡上修改入口 / 头像 aria 标签
    campStateAgreed: '已点头',
    campStateNotAgreed: '还在考虑',
    campStateDone: '已谈成',
    // 对方阵营富化文案（#63 拍板 2026-08-30：按对方最后动作归因，仅用于对方侧展示）
    campStateProposed: '刚刚提议',
    campStateChanged: '已修改提议',
    // 卡上「改提议」入口（2026-08-30 老板拍板键名 changeBtn：非常规编辑，是沟通中一方表示要改提案本身；文案 2026-08-30 由「我要改改」改为「改提议」）
    changeBtn: '改提议',
    ariaChildSide: '孩子',
    ariaParentSide: '家长',
    // R34 孩子端提议板（Spec 20260828-R34 T1 / REQ-R34-1~6）：孩子视角文案槽位
    childView: {
      back: '[DEPRECATED]返回',
      // #118 follow-up（#104 口径统一）：孩子端列表页标题加「星星」前缀，与兑换页入口按钮一致
      pageTitle: '星星提议板',
      createProposal: '新建提议',
      emptyState: '还没有提议，先新建一个吧',
      form: {
        pageTitle: '提议表单',
        saveBtn: '保存',
      },
      detail: {
        pageTitle: '提议详情',
      },
    },
  },

  // 共享组件自持文案（文案收口批）：组件内置默认/固定文案的单一出口，槽位随组件走、不并入页面分区
  // （组件是自洽单元，将来整体替换语言时按组件归位）。既有各页面槽位 cancel/confirm 等不动、不并入本组。
  components: {
    // StarModalStandard 弹窗按钮默认文案（调用方未传 cancelText/confirmText/closeLabel 时的兜底）
    modal: { cancel: '取消', confirm: '确认', close: '关闭' } as const,
    // StarSectionShell 分区卡壳错误行刷新钮
    sectionShell: { refresh: '刷新' } as const,
    // StarBatchBar 批量操作条：selectedPrefix + 数字强调 span + unit（模板保留数字 span 结构）；
    // unitQuestion 为 unit prop 默认值（导出等场景可由使用方换单位）
    batchBar: { selectedPrefix: '已选', unitQuestion: '题', clear: '取消选择' } as const,
  },

  // 组件展示页（/components/:componentKey，开发用页面）文案
  showcase: {
    open: '打开',
    eventTriggered: (event: string): string => `已触发 ${event}`,
  },

  // 跨页共享文案：日历日期单一出口（沿 #279 先例，值委托 utils 纯函数；调用方 Parent/Prizes）
  common: {
    monthDay: (ts: number): string => monthDayText(ts),
  },
}

// 让 TS 校验 typeLabel 键集与 Question['type'] 一致（索引安全）
type _TypeLabelCheck = Record<Question['type'], string>
const _typeLabelCheck: _TypeLabelCheck = copy.quiz.typeLabel
void _typeLabelCheck
