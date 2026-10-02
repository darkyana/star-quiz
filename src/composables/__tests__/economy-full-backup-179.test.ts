import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as stars from '../useStarData'
import * as board from '../useProposals'
import * as vouchers from '../useActiveRedemptions'
import { downloadLedgerExport } from '../useExport'
import { applyEconomyImport, validateEconomyImport } from '../useImport'
import type { RewardItem, StarEntry } from '../../types'

beforeEach(() => localStorage.clear())
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('#179 业务动作后经济文件下载→校验→导入保留全孩同 id 数据、星种与附加要求', async () => {
  const reward: RewardItem = { id: 'r', name: '宝藏', price: 5, requirement: { kind: 'interest', amount: 2 } }
  const siblingStar: StarEntry = { id: 's', childId: 'sibling', kind: 'game', timestamp: 1, type: 'earn', amount: 20, source: '努力', quizId: 'q' }
  stars.writeRewards([reward])
  stars.writeLedger([siblingStar, { ...siblingStar, childId: 'default', kind: 'interest' }])
  const ownProposal = board.create({ name: '下一件宝藏', price: 6, description: '说明' })
  const siblingProposal = { ...ownProposal, childId: 'sibling' }
  board.writeProposals([siblingProposal, ownProposal])
  const ownVoucher = vouchers.create(reward)
  const siblingVoucher = { ...ownVoucher, childId: 'sibling' }
  vouchers.writeRecords([siblingVoucher, ownVoucher])
  stars.grant({ amount: 2, reason: '表现好' })
  expect(board.update(ownProposal.id, { name: '新的提议', price: 7, description: '' })).toBe(true)
  vouchers.complete(ownVoucher.id)
  const blobs: Blob[] = []
  vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { blobs.push(blob); return 'blob:backup' }, revokeObjectURL: () => {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadLedgerExport(new Date('2026-09-07T12:00:00Z'))
  const imported = validateEconomyImport(await blobs[0].text())
  if (!imported.ok) throw new Error(imported.reason)
  expect(imported.data.starLedger).toHaveLength(3)
  expect(imported.data.starLedger[0]).toEqual(siblingStar)
  expect(imported.data.proposals).toHaveLength(2)
  expect(imported.data.proposals[0]).toEqual(siblingProposal)
  expect(imported.data.activeRedemptions).toEqual([siblingVoucher])
  expect(imported.data.rewards).toEqual([reward])
  localStorage.clear()
  expect(applyEconomyImport(imported.data)).toEqual({ ok: true })
  expect(stars.allLedger()).toEqual(imported.data.starLedger)
  expect(board.allProposals()).toEqual(imported.data.proposals)
  expect(vouchers.allRecords()).toEqual([siblingVoucher])
  expect(stars.rewards()).toEqual([reward])
  expect(stars.balance()).toBe(22)
  expect(board.proposals()).toHaveLength(1)
  expect(vouchers.list()).toEqual([])
})
