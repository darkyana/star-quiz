import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TRIVIA_ENTRY_ID, TRIVIA_SET_SLOT } from '../trivia-set'

const read = (path: string) => readFileSync(resolve(process.cwd(), path))
const archive = 'docs/design/surprise-sticker'
const colors = ['A-soft-purple', 'B-berry-pink', 'C-sky-blue']

describe('#270 惊喜贴纸资源协议', () => {
  it('槽位沿用入口 id，贴纸图随现役题集文件夹分发（相对 public 的 icon 路径）', () => {
    expect(Object.isFrozen(TRIVIA_SET_SLOT)).toBe(true)
    expect(TRIVIA_SET_SLOT.id).toBe(TRIVIA_ENTRY_ID)
    expect(TRIVIA_SET_SLOT.icon).toBe('trivia/current/icon.svg')
  })

  it.each(colors)('%s 是可直接替换的 512 方形自包含 SVG，未烘焙宿主描边', color => {
    const png = read(`${archive}/${color}.png`)
    const svg = read(`${archive}/${color}.svg`).toString('utf8')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(512)
    expect(png.readUInt32BE(20)).toBe(512)
    expect(png[25]).toBe(6) // RGBA PNG
    expect(svg).toContain('viewBox="0 0 512 512"')
    expect(svg).toContain(`<title>惊喜答题</title>`)
    expect(svg).toContain(`href="data:image/png;base64,${png.toString('base64')}"`)
    expect(svg).not.toMatch(/<script|<filter|stroke=|var\(--|(?:href|src)="https?:/)
  })

  it('正式资源是归档三色之一，SVG 与 PNG 同步；换色无需改槽位或测试', () => {
    const svg = read(`public/${TRIVIA_SET_SLOT.icon}`)
    const png = read('public/trivia/current/icon.png')
    expect(colors.some(color => svg.equals(read(`${archive}/${color}.svg`)) && png.equals(read(`${archive}/${color}.png`)))).toBe(true)
  })
})
