/**
 * copy.ts 文案集中管理（归并自原 copy / copy-r6 / copy-r25 / copy-r34 / copy-r36 五文件，#95）
 * 按 copy.ts 结构分区 describe：home / quiz / result / redeem / starLog / parent / stars / proposals。
 * 静态文案值断言 + 动态文案函数形式；既有 key 未被改动的结构断言。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { copy } from '../copy'

describe('copy.ts 文案集中管理（AC-2.1）', () => {
  it('home 分组关键文案 + versionLabel 动态函数（tagline 已随 #108 定稿 D / #103 移除）', () => {
    expect(copy.home.brand).toBe('星星答题')
    expect(copy.home).not.toHaveProperty('tagline')
    expect(copy.home.startQuiz).toBe('开始答题')
    expect(copy.home.versionLabel('0.4.0')).toBe('V0.4.0')
  })

  it('quiz 分组进度/下一题/类型/反馈文案', () => {
    expect(copy.quiz.progressLabel(3, 10)).toBe('第 3 / 10 题')
    expect(copy.quiz.viewResult).toBe('查看结果')
    expect(copy.quiz.nextLabel).toBe('下一题')
    expect(copy.quiz.typeLabel.zh2en).toBe('看中文选英文')
    expect(copy.quiz.feedback.correct).toBe('答对了！')
  })

  it('result 分组得分角标 + 四档文案（AC-2.2）', () => {
    expect(copy.result.scoreBadge(8, 10)).toBe('得分 8 / 10')
    expect(copy.result.earnUnit).toBe('颗星')
    expect(copy.result.message.fullMark).toBe('满分通关！太棒了')
    expect(copy.result.message.good).toBe('答对了这么多，真厉害')
    expect(copy.result.message.practice).toBe('差一点点就满分了，再来一次')
    expect(copy.result.message.encourage).toBe('没关系，下次再来')
  })

  it('redeem 分组动态文案函数', () => {
    expect(copy.redeem.shortage(3)).toBe('还差 3 颗')
    expect(copy.redeem.price(5)).toBe('5 颗星')
    expect(copy.redeem.confirmText(5, '菠萝油', 0)).toBe('用 5 颗星兑换「菠萝油」？兑换后剩余 0 颗')
  })

  it('starLog 分组正负号文案', () => {
    expect(copy.starLog.earnSign).toBe('+')
    expect(copy.starLog.redeemSign).toBe('−')
  })

  it('parent 分组动态导入失败文案 + 确认文案', () => {
    expect(copy.parent.importFailReason('格式不对')).toBe('导入失败：格式不对')
    expect(copy.parent.confirmData).toContain('题库')
    expect(copy.parent.confirmLedger).toContain('流水')
  })

  it('#172 两档导入失败文案 + 家底键损坏恢复 Toast 文案（票内 Desired behavior 原文）', () => {
    expect(copy.parent.importFailChecked).toBe('文件未通过检查，没有写入任何数据')
    expect(copy.parent.importFailWrite).toBe('已恢复原状，建议清理设备存储后重试')
    expect(copy.corruptionRecoveryToast).toBe('检测到数据异常，已自动恢复，建议导出一份备份')
  })

  it('#212 粘贴导入文案槽位：剥壳失败反馈一条 + 粘贴视图界面文案（界面文案为票面「仅新增一条」的保守扩大解释）', () => {
    expect(copy.parent.importPasteNoJson).toBe('未在粘贴内容中找到有效 JSON')
    expect(copy.parent.pasteImportBtn).toBe('粘贴导入')
    expect(copy.parent.pasteImportTitle).toBe('粘贴导入')
    expect(copy.parent.pasteImportParseBtn).toBe('解析')
    expect(copy.parent.pasteImportBackBtn).toBe('返回')
    expect(copy.parent.pasteImportPlaceholder.length).toBeGreaterThan(0)
  })

  it('AC-2.4 stars.redeemSource 为函数且返回"兑换：{name}"', () => {
    expect(typeof copy.stars.redeemSource).toBe('function')
    expect(copy.stars.redeemSource('菠萝油')).toBe('兑换：菠萝油')
    expect(copy.stars.quizSource).toBe('答题得星')
    expect(copy.stars.fullMarkSource).toBe('满分奖励')
  })
})

describe('quiz 放弃答题文案（原 R6 ⑦⑧，老板定稿值）', () => {
  it('⑦⑧ 放弃答题按钮与确认弹窗文案落 quiz 分组（老板定稿值）', () => {
    expect(copy.quiz.abandon).toBe('放弃答题')
    expect(copy.quiz.abandonConfirm).toBe('确定放弃本轮答题？已答的题目不会计入星星。')
    expect(copy.quiz.confirmAbandon).toBe('放弃')
  })
})

describe('quiz.flag 红旗旗钮文案（原 R25，AC-R25-17，老板裁决正式文案）', () => {
  it('btnAriaLabel 未标态文案 = "标记这道题"', () => {
    expect(copy.quiz.flag.btnAriaLabel).toBe('标记这道题')
  })

  it('btnAriaLabelActive 已标态文案 = "取消标记这道题"', () => {
    expect(copy.quiz.flag.btnAriaLabelActive).toBe('取消标记这道题')
  })
})

describe('proposals 提议板文案槽位（原 R34，AC-R34-9-1）', () => {
  it('兑换页「提议板」入口槽位存在且已定稿（REQ-R34-1-1；#104 文案加「星星」前缀）', () => {
    expect(typeof copy.redeem.proposalsEntry).toBe('string')
    expect(copy.redeem.proposalsEntry).toBe('星星提议板')
  })

  it('列表页孩子视角槽位：标题 / 新建按钮 / 空态存在且已定稿（REQ-R34-2；#118 标题加「星星」前缀）', () => {
    expect(copy.proposals.childView.pageTitle).toBe('星星提议板')
    expect(copy.proposals.childView.createProposal).toBe('新建提议')
    expect(copy.proposals.childView.emptyState).toBe('还没有提议，先新建一个吧')
  })

  it('双端表态按钮「同意」「再想想」槽位存在且已定稿（REQ-R34-4）', () => {
    // R34 T4：双端共用双按钮，槽位提升至 proposals 层（AC-R34-2-2 家长视角同用）
    expect(copy.proposals.agreeBtn).toBe('同意')
    expect(copy.proposals.rethinkBtn).toBe('再想想')
  })

  it('新建表单 / 详情页槽位存在且已定稿；返回文案已 #38 收敛为顶层 copy.back（REQ-R34-3 / REQ-R34-6）', () => {
    expect(copy.proposals.childView.form.pageTitle).toBe('提议表单')
    expect(copy.proposals.childView.form.saveBtn).toBe('保存')
    expect(copy.proposals.childView.detail.pageTitle).toBe('提议详情')
    // #38（2026-08-29 老板拍板）：返回文案全局收敛——childView.back 已 [DEPRECATED]，统一断言 copy.back
    expect(copy.back).toBe('返回')
  })

  it('既有 R32 家长端提议槽位不受影响（只新增不改既有 key）', () => {
    expect(copy.proposals.pageTitle).toBe('提议板')
    expect(copy.proposals.childAgreeToggle).toBe('代孩子同意')
    expect(copy.parent.proposalsEntry).toBe('提议板')
    expect(copy.redeem.ledgerLink).toBe('星星记事本')
  })
})

describe('#265 发布窗口文案删除', () => {
  it('publishWindowHint 槽位随发布窗口一并删除（提议板不再有窗口说明行）', () => {
    expect(copy.proposals).not.toHaveProperty('publishWindowHint')
  })

  it('防回潮：copy.ts 源文零字面时间（HH:mm 格式零命中）——文案不承载任何时段限制', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'copy.ts'), 'utf-8')
    expect(/\d{2}:\d{2}/.test(source)).toBe(false)
  })
})

describe('parent 导入确认计数文案槽位（原 R36，AC-R36-5-4 / 6-2）', () => {
  it('confirmLearningImport 为函数：n=5 返回值含 5 与「题」（格式「N 题」语义）', () => {
    expect(typeof copy.parent.confirmLearningImport).toBe('function')
    const text = copy.parent.confirmLearningImport(5)
    expect(text).toContain('5')
    expect(text).toMatch(/5\s*题/)
  })

  it('confirmLearningImport n=0（空题库文件）仍含 0 题', () => {
    expect(copy.parent.confirmLearningImport(0)).toMatch(/0\s*题/)
  })

  it('confirmEconomyImport 为函数：(3, 4, 7) 返回值含「兑换项 3」「提议 4」与「流水 7」语义（R32 扩参）', () => {
    expect(typeof copy.parent.confirmEconomyImport).toBe('function')
    const text = copy.parent.confirmEconomyImport(3, 4, 7)
    expect(text).toMatch(/3\s*项/)
    expect(text).toMatch(/4\s*条/)
    expect(text).toMatch(/7\s*条/)
  })

  it('importVersionTooOld 逐字等于「文件版本过旧，请用最新版重新导出」且不带 [TBD] 前缀（AC-R36-3-x）', () => {
    expect(copy.parent.importVersionTooOld).toBe('文件版本过旧，请用最新版重新导出')
    expect(copy.parent.importVersionTooOld.startsWith('[TBD]')).toBe(false)
  })
})

describe('#106 「星星宝藏箱」宝藏系文案（R-孩子端奖品文案统一：对外宝藏系，内部术语不变）', () => {
  it('兑换页底部入口与 /prizes 页标题统一「星星宝藏箱」', () => {
    expect(copy.prizes.entry).toBe('星星宝藏箱')
    expect(copy.prizes.pageTitle).toBe('星星宝藏箱')
  })

  it('兑换成功 toast 指向星星宝藏箱', () => {
    expect(copy.redeem.toast).toBe('兑换成功！宝物已放进星星宝藏箱')
  })

  it('空态引导为宝藏系措辞（语义保留：宝箱空 + 引导去兑换）', () => {
    expect(copy.prizes.emptyState).toBe('宝藏箱还空着，去兑换一件宝物吧')
  })

  it('用一个按钮与二次确认为聚合语义口语版（#295 / #294 二轮拍板：带剩余数量 N−1）', () => {
    expect(copy.prizes.useUpBtn).toBe('用一个')
    expect(copy.prizes.useUpConfirm('10分钟电视', 2)).toBe('要用一个「10分钟电视」吗？用掉就少一个咯（还剩 2 个）')
    expect(copy.prizes.useUpToast('菠萝油')).toBe('用掉一个「菠萝油」！')
  })

  it('格卡日期人性化相对措辞按日历日分档（#294 二轮拍板：今天/昨天/2–6 天/一周/两周/21 天+兜底）', () => {
    expect(copy.prizes.redeemedAt(0, '8月30日')).toBe('今天获得')
    expect(copy.prizes.redeemedAt(1, '8月30日')).toBe('昨天获得')
    expect(copy.prizes.redeemedAt(2, '8月29日')).toBe('2天前获得')
    expect(copy.prizes.redeemedAt(6, '8月25日')).toBe('6天前获得')
    expect(copy.prizes.redeemedAt(7, '8月24日')).toBe('一周前获得')
    expect(copy.prizes.redeemedAt(13, '8月18日')).toBe('一周前获得')
    expect(copy.prizes.redeemedAt(14, '8月17日')).toBe('两周前获得')
    expect(copy.prizes.redeemedAt(20, '8月11日')).toBe('两周前获得')
    expect(copy.prizes.redeemedAt(21, '8月10日')).toBe('8月10日获得')
  })

  it('防回潮：删除路径槽位不复活——prizes 分组无 abandon 键、孩子端不出现「不要了」「放弃」', () => {
    expect(copy.prizes).not.toHaveProperty('abandonBtn')
    expect(copy.prizes).not.toHaveProperty('abandonConfirm')
    // 静态槽位 + 动态槽位求值后的全部孩子端文案（JSON.stringify 会丢函数，函数槽位需显式求值）
    const texts = [
      copy.prizes.pageTitle,
      copy.prizes.entry,
      copy.prizes.emptyState,
      copy.prizes.useUpBtn,
      copy.prizes.redeemedAt(3, '8月27日'),
      copy.prizes.useUpConfirm('菠萝油', 1),
      copy.prizes.useUpToast('菠萝油'),
    ]
    for (const text of texts) {
      for (const banned of ['不要了', '放弃', '星星不会退回']) {
        expect(text, `文案「${text}」不应含「${banned}」`).not.toContain(banned)
      }
    }
  })

  it('防回潮：孩子端宝藏系槽位值不出现「我的奖品」「奖品」「券」', () => {
    const visibleTexts = [
      copy.prizes.pageTitle,
      copy.prizes.entry,
      copy.prizes.emptyState,
      copy.prizes.redeemedAt(3, '8月27日'),
      copy.prizes.useUpBtn,
      copy.prizes.useUpConfirm('菠萝油', 1),
      copy.prizes.useUpToast('菠萝油'),
      copy.redeem.toast,
    ]
    for (const text of visibleTexts) {
      expect(text, `文案「${text}」不应含「我的奖品」`).not.toContain('我的奖品')
      expect(text, `文案「${text}」不应含「奖品」`).not.toContain('奖品')
      expect(text, `文案「${text}」不应含「券」`).not.toContain('券')
    }
  })
})

describe('pair 设备配对文案槽位（#125；#142 R-129a 申请化改造；#145 单屏化）', () => {
  it('入口 / 标题 / 说明 / 字段标签与主按钮文案已定稿（申请配对口径）', () => {
    expect(copy.pair.entryLink).toBe('加入家庭')
    expect(copy.pair.pageTitle).toBe('设备配对')
    expect(copy.pair.intro).toBe('输入家庭码，给设备取个名字。家长批准后，这台设备就加入家庭。')
    expect(copy.pair.codeLabel).toBe('家庭码')
    expect(copy.pair.nameLabel).toBe('给这台设备起个名字')
    expect(copy.pair.roleLabel).toBe('这台设备是谁的？')
    expect(copy.pair.roleParentName).toBe('家长设备')
    expect(copy.pair.roleChildName).toBe('孩子设备')
    expect(copy.pair.submitBtn).toBe('申请配对')
    expect(copy.pair.submittingBtn).toBe('申请中…')
  })

  it('防回潮：单屏化后不再出现分步按钮文案（#145：三步向导已并为一个表单）', () => {
    const source = JSON.stringify(copy.pair)
    for (const banned of ['下一步', '上一步']) {
      expect(source, `配对域文案不应含「${banned}」`).not.toContain(banned)
    }
  })

  it('反馈文案只剩限流与网络/未知兜底（#142：删尽码错/码重置类反馈）', () => {
    expect(copy.pair.error.locked(15)).toBe('试得太多次了，15 分钟后再试')
    expect(copy.pair.error.locked(1)).toBe('试得太多次了，1 分钟后再试')
    expect(copy.pair.error.network).toBe('网络连接失败，请检查网络后重试')
    expect(copy.pair.error.unknown).toBe('申请失败，请重试')
  })

  it('等待页文案槽位（伞票 #129 UI 文案初稿；#144 补「重新申请」按钮文案——2 分钟提示不再是无按钮空话）', () => {
    expect(copy.pair.wait.pageTitle).toBe('等待批准')
    expect(copy.pair.wait.main).toBe('申请已发给家长，等家长点一下批准。')
    expect(copy.pair.wait.longWaitHint).toBe('等了很久？和家长确认一下家庭码，或者重新申请')
    expect(copy.pair.wait.networkRetry).toBe('网络不稳，正在重试……')
    expect(copy.pair.wait.reapplyBtn).toBe('重新申请')
  })

  it('防回潮：配对域文案不再出现码错/码重置/首台家长类措辞（存在性盲探测口径，#142）', () => {
    const source = JSON.stringify(copy.pair)
    for (const banned of ['家庭码不正确', '已重置', '第一台设备必须是家长设备', '配对冲突']) {
      expect(source, `配对域文案不应含「${banned}」`).not.toContain(banned)
    }
  })

  it('#143 批准块文案槽位（伞票 #129 UI 文案初稿；行 = 名字 · 申请成为：角色 · 时间）', () => {
    const c = copy.parent.deviceAdmin.approvals
    expect(c.title).toBe('等家长批准的申请')
    expect(c.empty).toBe('没有等批准的申请')
    expect(c.appliedRole('孩子设备')).toBe('申请成为：孩子设备')
    expect(c.appliedRole('家长设备')).toBe('申请成为：家长设备')
    expect(c.approveBtn).toBe('批准')
    expect(c.rejectBtn).toBe('拒绝')
    expect(c.approvedToast('孩子的平板')).toBe('已同意「孩子的平板」加入家庭')
    expect(c.rejectedToast).toBe('已拒绝这次申请')
    expect(c.conflictToast).toBe('这条申请刚被处理过')
  })

  it('#143 批准域错误类别文案：conflict = 刚被处理过；防回潮不出现 IP 字样', () => {
    expect(copy.parent.deviceAdmin.error.conflict).toBe('这条申请刚被处理过')
    // 共识 16：批准列表不采集展示 IP——文案域同样不出现 IP 概念
    expect(JSON.stringify(copy.parent.deviceAdmin.approvals)).not.toMatch(/ip/i)
  })
})

describe('copy 对象结构总断言（既有 key 未被改动）', () => {
  it('顶层分组结构 + 代表性文案值保持（#38 back / #73 prizes / #77 superPower / #125 pair；文案收口批新增 common/components/showcase）', () => {
    expect(Object.keys(copy).sort()).toEqual([
      'back',
      'common',
      'components',
      'corruptionRecoveryToast',
      'dataSafety',
      'home',
      'pair',
      'parent',
      'parentGuide',
      'prizes',
      'proposals',
      'quiz',
      'redeem',
      'result',
      'showcase',
      'starLog',
      'stars',
      'superPower',
    ])
    expect(copy.quiz.restartConfirm).toBe('重新开始本轮测验？已答题目不计星。')
    expect(copy.quiz.cancel).toBe('取消')
    // R36（D6 有意变更）：confirmLedger 废弃加 [DEPRECATED] 前缀（key 保留，语义由 confirmEconomyImport 承接）
    expect(copy.parent.confirmLedger).toBe('[DEPRECATED]导入将覆盖当前所有星星流水，确定继续？')
  })
})

describe('文案收口批：散落在组件/页面的硬编码文案迁入 copy', () => {
  it('quiz.mode：出题方式标签 + 三模式 name/shortName/desc（原 QUIZ_MODE_META 硬编码，措辞 #108 r2 定稿组一）', () => {
    expect(copy.quiz.mode.label).toBe('出题方式')
    expect(copy.quiz.mode.normal.name).toBe('普通模式')
    expect(copy.quiz.mode.normal.shortName).toBe('普通')
    expect(copy.quiz.mode.fresh.name).toBe('新题优先')
    expect(copy.quiz.mode.fresh.shortName).toBe('新题优先')
    expect(copy.quiz.mode.wrong.desc).toBe('做错的题再来一次')
  })

  it('components：StarModalStandard 默认钮 / StarSectionShell 刷新 / StarBatchBar 计数与取消', () => {
    expect(copy.components.modal.cancel).toBe('取消')
    expect(copy.components.modal.confirm).toBe('确认')
    expect(copy.components.modal.close).toBe('关闭')
    expect(copy.components.sectionShell.refresh).toBe('刷新')
    expect(copy.components.batchBar.selectedPrefix).toBe('已选')
    expect(copy.components.batchBar.unitQuestion).toBe('题')
    expect(copy.components.batchBar.clear).toBe('取消选择')
  })

  it('common.monthDay：「X月X日」无前导零（Parent/Prizes 单一出口）', () => {
    // 本地时区构造：2026-03-05 12:00 本地 → 「3月5日」（无前导零）
    expect(copy.common.monthDay(new Date(2026, 2, 5, 12, 0, 0).getTime())).toBe('3月5日')
    expect(copy.common.monthDay(new Date(2026, 11, 25, 12, 0, 0).getTime())).toBe('12月25日')
  })

  it('showcase：组件展示页（开发用）打开钮 + 事件反馈动态文案', () => {
    expect(copy.showcase.open).toBe('打开')
    expect(copy.showcase.eventTriggered('confirm')).toBe('已触发 confirm')
  })
})
