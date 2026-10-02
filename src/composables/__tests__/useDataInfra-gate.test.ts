// #168 T-数据键收编与门禁：源码扫描类门禁测试。
// 规则（docs/data-keys.md「规则来源」T6）：useDataInfra 之外任何产品源码直用浏览器存储接口即红。
// 豁免模块（数据基础设施本体，收口落点）：
//   - src/composables/useDataInfra.ts（登记册与读写原语唯一合法落盘处）
//   - src/cloud/sync.ts（同步引擎四键自有回退策略，票内明示保留）
// 白名单必须为空：存量例外已全部收口，出现新违规文件 = 本测试失败。
// 测试自身豁免：__tests__ 目录 / *.test.ts 是测试代码（mock localStorage 属正常），不在扫描范围。

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC_ROOT = join(__dirname, '../../')

/** 数据基础设施模块（相对 src 的 POSIX 路径）：唯一直接落盘的豁免区，新增须票内拍板 */
const INFRA_MODULES = new Set(['composables/useDataInfra.ts', 'cloud/sync.ts'])

function collectProductFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'dist') continue
      collectProductFiles(full, out)
    } else if (/\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** 去掉行注释后再检测（防注释里的示意写法误报；字符串里出现属真违规，一并拦下） */
function stripLineComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('#168 门禁：数据基础设施模块之外禁止直用浏览器存储接口', () => {
  it('src 产品源码（含 .vue）零裸 localStorage 访问（白名单为空）', () => {
    const violations: string[] = []
    for (const file of collectProductFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split('\\').join('/')
      if (INFRA_MODULES.has(rel)) continue
      const stripped = stripLineComments(readFileSync(file, 'utf8'))
      const matches = stripped.match(/localStorage\s*\./g)
      if (matches) violations.push(`${rel}（${matches.length} 处）`)
    }
    expect(violations, `数据基础设施模块外出现裸存储访问：\n${violations.join('\n')}`).toEqual([])
  })

  it('豁免区仅限登记册本体与同步引擎（门禁覆盖面未被架空）', () => {
    // 反向防呆：豁免清单里的模块必须真实存在（改名 / 移动后此断言提醒同步更新门禁配置）
    for (const rel of INFRA_MODULES) {
      expect(statSync(join(SRC_ROOT, rel)).isFile(), `豁免模块不存在：${rel}`).toBe(true)
    }
  })
})
