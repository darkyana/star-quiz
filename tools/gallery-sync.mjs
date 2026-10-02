#!/usr/bin/env node
// 展厅同步脚本（ADR 0018 工作室与展厅两仓制）
// 按允许清单（include-only）把工作室工作树投影到展厅仓，产出策展提交。
//
// 用法（仓库根目录执行）：
//   node tools/gallery-sync.mjs --dry-run                            # 演练：只打印将发生的变更，不提交不推送
//   node tools/gallery-sync.mjs --init --msg "2026-10 首展：××"      # 首次开展：直接推展厅 main（空仓开不了 PR）
//   node tools/gallery-sync.mjs --msg "2026-10 策展：××"             # 日常：策展分支 + 开 PR，作者过目合并才生效
//
// 环境变量 GALLERY_ORIGIN 可覆盖 manifest 的展厅地址（他机 clone/别名不同时用）。
// .gallery 为一次性克隆（脚本内重建），已入 .gitignore；策展身份 = manifest.curator（bot noreply，作者身份不投影）。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tools/gallery/manifest.json'), 'utf8'))
const GALLERY_DIR = path.join(repoRoot, '.gallery')
const GLOBAL_IGNORE = new Set(['node_modules', 'dist', 'dist-minitool', '.wrangler', '.git', 'coverage'])

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const init = args.includes('--init')
const msgIdx = args.indexOf('--msg')
const msg = msgIdx >= 0 ? args[msgIdx + 1] : ''
if (!dryRun && !msg) {
  console.error('需要 --msg "<策展提交信息>"（或用 --dry-run 演练）')
  process.exit(1)
}

function run(cmd, cmdArgs, cwd = repoRoot, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', ...opts })
  if (r.status !== 0) {
    console.error(`命令失败：${cmd} ${cmdArgs.join(' ')}\n${r.stderr || r.stdout || ''}`)
    process.exit(1)
  }
  return r.stdout
}

// —— 1. 计算投影文件集：galleryPath -> studioPath ——
const renameSources = new Set(Object.values(manifest.rename))
const projection = new Map()

function excluded(rel) {
  return manifest.exclude.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p))
}
function addRel(rel) {
  if (excluded(rel) || renameSources.has(rel)) return
  projection.set(rel, rel)
}
function walkDir(absDir, prefix) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (GLOBAL_IGNORE.has(entry.name)) continue
    const rel = prefix + entry.name
    if (excluded(rel) || renameSources.has(rel)) continue
    if (entry.isDirectory()) walkDir(path.join(absDir, entry.name), rel + '/')
    else projection.set(rel, rel)
  }
}
for (const pattern of manifest.include) {
  if (pattern.endsWith('/')) {
    const abs = path.join(repoRoot, pattern)
    if (fs.existsSync(abs)) walkDir(abs, pattern)
    else console.warn(`⚠️ 清单目录不存在，跳过：${pattern}`)
  } else addRel(pattern)
}
for (const [galleryPath, studioPath] of Object.entries(manifest.rename)) projection.set(galleryPath, studioPath)

// —— 2. 一次性克隆展厅（策展身份 = 机器人，作者身份不投影）——
fs.rmSync(GALLERY_DIR, { recursive: true, force: true })
const origin = process.env.GALLERY_ORIGIN || manifest.galleryOrigin
run('git', ['clone', origin, GALLERY_DIR])
run('git', ['config', 'user.name', manifest.curator.name], GALLERY_DIR)
run('git', ['config', 'user.email', manifest.curator.email], GALLERY_DIR)

// —— 3. 镜像同步：删展厅多余（保留 preserve），再覆盖拷贝投影集 ——
function mirrorDir(absDir, prefix) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const rel = prefix + entry.name
    if (manifest.preserve.includes(rel)) continue
    if (entry.isDirectory()) {
      const keep = [...projection.keys()].some((p) => p.startsWith(rel + '/'))
      if (!keep) {
        fs.rmSync(path.join(absDir, entry.name), { recursive: true, force: true })
        continue
      }
      mirrorDir(path.join(absDir, entry.name), rel + '/')
    } else if (!projection.has(rel)) fs.rmSync(path.join(absDir, entry.name), { force: true })
  }
}
mirrorDir(GALLERY_DIR, '')

let missing = 0
for (const [galleryPath, studioPath] of projection) {
  const src = path.join(repoRoot, studioPath)
  if (!fs.existsSync(src)) {
    console.warn(`⚠️ 清单引用的工作室文件不存在，跳过：${studioPath}`)
    missing++
    continue
  }
  const dest = path.join(GALLERY_DIR, galleryPath)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

// —— 4. 变更呈现与收尾 ——
const status = run('git', ['status', '--porcelain'], GALLERY_DIR).trim()
if (!status) {
  console.log('展厅与投影一致，无变化。')
  process.exit(0)
}
const lines = status.split('\n')
console.log(`投影 ${projection.size} 个路径（${missing} 个缺失被跳过），本次变更 ${lines.length} 个：`)
console.log(lines.slice(0, 40).join('\n') + (lines.length > 40 ? `\n…（共 ${lines.length} 项）` : ''))

if (dryRun) {
  console.log('\n（dry-run：未提交未推送；.gallery 保留在本地供检查，可安全删除）')
  process.exit(0)
}

run('git', ['add', '-A'], GALLERY_DIR)
run('git', ['commit', '-m', msg], GALLERY_DIR)

if (init) {
  run('git', ['push', '-u', 'origin', 'main'], GALLERY_DIR)
  console.log('\n✅ 首展完成：已推送展厅 main。')
} else {
  const branch = 'curation/' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  run('git', ['switch', '-c', branch], GALLERY_DIR)
  run('git', ['push', '-u', 'origin', branch], GALLERY_DIR)
  run('gh', ['pr', 'create', '--repo', manifest.gallerySlug, '--base', 'main', '--head', branch,
    '--title', `策展：${msg}`,
    '--body', '按允许清单（tools/gallery/manifest.json）同步的策展快照。请过目 diff 后合并；机制见 tools/gallery-sync.mjs 与 ADR 0018。'], GALLERY_DIR)
  console.log(`\n✅ 策展 PR 已开出（分支 ${branch}），等作者过目合并。`)
}
