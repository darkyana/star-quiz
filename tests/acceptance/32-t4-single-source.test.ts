/**
 * T4 单一真相源收敛验收（Spec 20260826-073，AC-T4-2-1 + 自主决策 #1 / #3 / #7）。
 * 守卫断言（源码级）：读星函数唯一入口 useStarData；
 * useAppState / useStars 彻底退役；
 * useQuiz 数据读取经 useLearningData / useStarData，sq_session 会话读写保留 useQuiz 现职责。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import * as starData from '../../src/composables/useStarData'
import * as learningData from '../../src/composables/useLearningData'
import * as dataInfra from '../../src/composables/useDataInfra'
import * as quizModule from '../../src/composables/useQuiz'

function srcPath(...parts: string[]): string {
  return resolve(process.cwd(), 'src', ...parts)
}

describe('AC-T4-2-1 读星函数唯一入口 useStarData', () => {
  it('useStarData 导出 balance / ledger / computeBalance', () => {
    expect(starData.balance).toBeTypeOf('function')
    expect(starData.ledger).toBeTypeOf('function')
    expect(starData.computeBalance).toBeTypeOf('function')
  })

  it('useLearningData / useDataInfra / useQuiz 公开导出不提供读星函数', () => {
    for (const mod of [learningData, dataInfra, quizModule]) {
      const names = Object.keys(mod)
      expect(names, '不含 balance').not.toContain('balance')
      expect(names, '不含 ledger').not.toContain('ledger')
      expect(names, '不含 computeBalance').not.toContain('computeBalance')
      expect(names, '不含 readStars').not.toContain('readStars')
    }
  })

  it('页面组件不引用重复读星助手模块 useStars（computeBalance 等仅经 useStarData）', () => {
    for (const page of ['Home.vue', 'Redeem.vue', 'StarLog.vue', 'Parent.vue', 'Quiz.vue', 'Result.vue']) {
      const source = readFileSync(srcPath('pages', page), 'utf-8')
      expect(source, page).not.toContain("composables/useStars'")
    }
  })
})

describe('自主决策 #1：useAppState 彻底删除（不留 re-export 转发壳）', () => {
  it('src/composables/useAppState.ts 文件不存在', () => {
    expect(existsSync(srcPath('composables', 'useAppState.ts'))).toBe(false)
  })

  it('核心调用方源码零 useAppState 引用', () => {
    for (const rel of ['main.ts', 'composables/useQuiz.ts', 'composables/useExport.ts']) {
      const source = readFileSync(srcPath(rel), 'utf-8')
      expect(source, rel).not.toContain('useAppState')
    }
  })
})

describe('自主决策 #7：useStars.ts 退役（账本函数族并入 useStarData 内部导出）', () => {
  it('src/composables/useStars.ts 文件不存在', () => {
    expect(existsSync(srcPath('composables', 'useStars.ts'))).toBe(false)
  })

  it('账本纯函数族随 useStarData 保持导出（computeBalance / earnForQuiz / redeemReward / hasQuizEarned）', () => {
    expect(starData.earnForQuiz).toBeTypeOf('function')
    expect(starData.redeemReward).toBeTypeOf('function')
    expect(starData.hasQuizEarned).toBeTypeOf('function')
  })
})

describe('useQuiz 数据读取切 useLearningData（自主决策 #3：sq_session 会话读写留守 useQuiz）', () => {
  it('useQuiz.ts 源码 import useLearningData 与 useStarData', () => {
    const source = readFileSync(srcPath('composables', 'useQuiz.ts'), 'utf-8')
    expect(source).toContain("from './useLearningData'")
    expect(source).toContain("from './useStarData'")
  })

  it('useQuiz 不再直接操作学习域 / 星星域业务键（SESSION_KEY 会话键除外）', () => {
    const source = readFileSync(srcPath('composables', 'useQuiz.ts'), 'utf-8')
    expect(source).not.toContain('STORAGE_KEYS.proficiency')
    expect(source).not.toContain('STORAGE_KEYS.recentWords')
    expect(source).not.toContain('STORAGE_KEYS.questionResults')
    expect(source).not.toContain('STORAGE_KEYS.stars')
    // sq_session 会话读写保持 useQuiz 现职责（#168 收编后键名经登记册单一来源，字面量不变）
    expect(source).toContain('SESSION_KEY = STORAGE_KEYS.session')
  })
})
