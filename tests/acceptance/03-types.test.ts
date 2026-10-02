/**
 * AC3-1 ~ AC3-4 数据模型类型定义（Spec §4 REQ-3 / §3.2）
 * 全部为 tsc 级断言（expectTypeOf，编译期校验）；运行时为声明性占位，
 * 另以 `tsc --noEmit tests/acceptance/03-types.test.ts` 做编译级验收。
 */
import { describe, it, expectTypeOf } from 'vitest'
import type { Question, DataExport, LedgerExport, StarEntry, RewardItem } from '../../src/types/index'

describe('AC3 数据模型类型定义（tsc 级断言）', () => {
  it('AC3-1 题型枚举锁定：Question["type"] 恰为 "zh2en" | "en2zh" | "cloze"', () => {
    expectTypeOf<Question['type']>().toEqualTypeOf<'zh2en' | 'en2zh' | 'cloze'>()
  })

  it('AC3-2 选项元组锁定：Question["options"] 恰为四元组', () => {
    expectTypeOf<Question['options']>().toEqualTypeOf<[string, string, string, string]>()
  })

  it('AC3-3 导出契约拆分双格式：DataExport / LedgerExport version 恰为字面量 "1.0"，字段齐全', () => {
    expectTypeOf<DataExport['version']>().toEqualTypeOf<'1.0'>()
    expectTypeOf<DataExport['exportedAt']>().toEqualTypeOf<string>()
    expectTypeOf<DataExport['questionPool']>().toEqualTypeOf<Question[]>()
    expectTypeOf<DataExport['rewards']>().toEqualTypeOf<RewardItem[]>()

    expectTypeOf<LedgerExport['version']>().toEqualTypeOf<'1.0'>()
    expectTypeOf<LedgerExport['exportedAt']>().toEqualTypeOf<string>()
    expectTypeOf<LedgerExport['starLedger']>().toEqualTypeOf<StarEntry[]>()
  })

  it('AC3-4 流水与兑换项字段锁定：StarEntry / RewardItem 逐字段', () => {
    expectTypeOf<StarEntry['id']>().toEqualTypeOf<string>()
    expectTypeOf<StarEntry['timestamp']>().toEqualTypeOf<number>()
    expectTypeOf<StarEntry['type']>().toEqualTypeOf<'earn' | 'redeem'>()
    expectTypeOf<StarEntry['amount']>().toEqualTypeOf<number>()
    expectTypeOf<StarEntry['source']>().toEqualTypeOf<string>()
    expectTypeOf<StarEntry['quizId']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<RewardItem['id']>().toEqualTypeOf<string>()
    expectTypeOf<RewardItem['name']>().toEqualTypeOf<string>()
    expectTypeOf<RewardItem['price']>().toEqualTypeOf<number>()
    expectTypeOf<RewardItem['emoji']>().toEqualTypeOf<string | undefined>()
  })
})
