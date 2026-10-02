/**
 * 版本 bump 单测（沿 R24 T8 模式，原 Spec 20260824-v0.7.0-R24 §AC-R24-11-1）
 * 锁 APP_VERSION 与 package.json 两处 0.14.0 一致。
 * 「版本更新记录文档含 v0.14.0 条目」由发布流程验收，不在本测试范围。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_VERSION } from '../app-version'

describe('版本 bump v0.14.0（两处一致）', () => {
  it('APP_VERSION === 0.14.0', () => {
    expect(APP_VERSION).toBe('0.14.0')
  })

  it('package.json version 与 APP_VERSION 一致（均为 0.14.0）', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as { version: string }
    expect(pkg.version).toBe(APP_VERSION)
    expect(pkg.version).toBe('0.14.0')
  })
})
