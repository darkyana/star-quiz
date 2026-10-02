import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const indexHtml = readFileSync(resolve(rootDir, 'index.html'), 'utf-8')
const manifest = JSON.parse(readFileSync(resolve(rootDir, 'public/manifest.webmanifest'), 'utf-8'))

describe('主屏全屏入口 PWA（#50）', () => {
  it('index.html 声明 manifest 链接与 iOS standalone 元标签', () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest">')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes">')
    expect(indexHtml).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    )
  })

  it('manifest display 为 standalone，主屏图标全屏打开', () => {
    expect(manifest.display).toBe('standalone')
  })

  it('background_color 与页面渐变底部色一致（#54：standalone 安全区露出窗口底色时无缝；#146 夜幕值）', () => {
    const variables = readFileSync(resolve(rootDir, 'src/styles/variables.css'), 'utf-8')
    const accent = variables.match(/--color-bg-accent:\s*(#[0-9a-fA-F]+)/)?.[1]
    expect(accent).toBe('#0a1531')
    expect(manifest.background_color).toBe(accent)
  })

  it('theme-color 与夜幕基准同值（#146：index.html meta 与 manifest theme_color 均为 --color-bg）', () => {
    const variables = readFileSync(resolve(rootDir, 'src/styles/variables.css'), 'utf-8')
    const bg = variables.match(/--color-bg:\s*(#[0-9a-fA-F]+)/)?.[1]
    expect(indexHtml).toContain(`<meta name="theme-color" content="${bg}">`)
    expect(manifest.theme_color).toBe(bg)
  })

  it('图标接线：manifest 192/512（Chrome 安装条件）+ favicon 与 apple-touch-icon 链接，图标文件均落盘', () => {
    expect(Array.isArray(manifest.icons)).toBe(true)
    const any192 = manifest.icons.find((i: { sizes: string }) => i.sizes === '192x192')
    const any512 = manifest.icons.find((i: { sizes: string }) => i.sizes === '512x512')
    expect(any192?.purpose).toBe('any')
    expect(any512?.purpose).toContain('maskable')
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(rootDir, 'public', icon.src.replace(/^\//, '')))).toBe(true)
    }
    expect(indexHtml).toContain('<link rel="icon" type="image/png" sizes="48x48" href="/icons/favicon-48.png">')
    expect(indexHtml).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">')
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">')
    for (const icon of ['favicon-48.png', 'favicon-32.png', 'apple-touch-icon.png']) {
      expect(existsSync(resolve(rootDir, 'public/icons', icon))).toBe(true)
    }
  })
})
