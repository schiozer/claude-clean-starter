import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const SKIP = [/^docs\/superpowers\//, /^examples\//, /(^|\/)node_modules\//]
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

const trackedMarkdown = () =>
  execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: ROOT })
    .toString('utf8')
    .split('\0')
    .filter((p) => p && !SKIP.some((re) => re.test(p)))

describe('links relativos da documentação', () => {
  it('todo link relativo aponta para um arquivo ou diretório existente', () => {
    const broken: string[] = []
    for (const file of trackedMarkdown()) {
      const text = readFileSync(join(ROOT, file), 'utf8').replace(/```[\s\S]*?```/g, '')
      for (const [, raw] of text.matchAll(LINK)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue
        const target = decodeURI(raw.split('#')[0])
        if (!existsSync(resolve(ROOT, dirname(file), target))) broken.push(`${file} → ${raw}`)
      }
    }
    expect(broken).toEqual([])
  })
})
