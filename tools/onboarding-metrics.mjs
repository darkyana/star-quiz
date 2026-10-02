#!/usr/bin/env node
// #310 independent anonymous daily counts; NOT the family/week exporter (ADR 0013).
import { readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseDatabaseName } from './operator.mjs'

export const exportSql = `SELECT day, event, family_status, count FROM onboarding_daily_counts
WHERE day >= date('now', '+8 hours', '-89 days') AND day <= date('now', '+8 hours')
ORDER BY day, event, family_status`

export function parseArgs(args) {
  if (args.some(arg => arg !== '--remote' && arg !== '--help')) throw new Error('仅支持 --remote / --help')
  return { remote: args.includes('--remote'), help: args.includes('--help') }
}
export function toCsv(rows) {
  const columns = ['day', 'event', 'family_status', 'count']
  const escape = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value)
  return [columns.join(','), ...rows.map(row => columns.map(key => escape(row[key])).join(','))].join('\n') + '\n'
}

const script = import.meta.url.startsWith('file:') ? fileURLToPath(import.meta.url) : import.meta.url
if (process.argv[1] && realpathSync(process.argv[1]) === script) {
  try {
    const { remote, help } = parseArgs(process.argv.slice(2))
    if (help) {
      console.log('用法：node tools/onboarding-metrics.mjs [--remote] > onboarding.csv\n缺省只读本地 D1；--remote 只读生产。北京时间今天及前 89 天，四列 day,event,family_status,count；无发生的组合省略，不代表独立人数或完整转化率。')
    } else {
      const cwd = resolve(dirname(script), '../worker')
      const database = parseDatabaseName(readFileSync(resolve(cwd, 'wrangler.jsonc'), 'utf8'))
      console.error(remote ? 'REMOTE：生产 D1，只读计数导出' : 'LOCAL：本地 D1，只读计数导出')
      const result = spawnSync('npx', ['wrangler', 'd1', 'execute', database, remote ? '--remote' : '--local', '--command', exportSql, '--json'], { cwd, encoding: 'utf8' })
      if (result.error || result.status !== 0) throw new Error('D1 导出失败；检查连接、权限与迁移状态')
      const statements = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')))
      if (!Array.isArray(statements[0]?.results) || statements[0]?.success === false) throw new Error('D1 返回结构异常')
      process.stdout.write(toCsv(statements[0].results))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : '导出失败')
    process.exitCode = 1
  }
}
