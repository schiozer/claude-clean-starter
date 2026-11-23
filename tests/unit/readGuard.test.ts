import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PDF_MAX_BYTES,
  TEXT_MAX_BYTES,
  classifyRead,
  evaluateRead,
} from '../../hooks/read-guard/evaluate.mjs'

let dir = ''
const file = (name: string, bytes: number): string => {
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(bytes, 'a'))
  return path
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'read-guard-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('classifyRead', () => {
  it('nega texto acima de 60 KB sem fatia', () => {
    const grande = file('grande.log', TEXT_MAX_BYTES + 1)
    expect(classifyRead({ file_path: grande }, dir)).toMatch(/offset\/limit/)
    expect(classifyRead({ file_path: file('limite.log', TEXT_MAX_BYTES) }, dir)).toBeNull()
  })

  it('deixa passar fatia, arquivo pequeno, inexistente e entrada inválida', () => {
    const grande = file('grande2.log', TEXT_MAX_BYTES + 1)
    expect(classifyRead({ file_path: grande, limit: 200 }, dir)).toBeNull()
    expect(classifyRead({ file_path: grande, offset: 10 }, dir)).toBeNull()
    expect(classifyRead({ file_path: file('pequeno.log', 100) }, dir)).toBeNull()
    expect(classifyRead({ file_path: join(dir, 'x.txt') }, dir)).toBeNull()
    expect(classifyRead({}, dir)).toBeNull()
    expect(classifyRead(null, dir)).toBeNull()
  })

  it('não conta offset 0 nem limit 0 como fatia', () => {
    const grande = file('grande3.log', TEXT_MAX_BYTES + 1)
    expect(classifyRead({ file_path: grande, offset: 0 }, dir)).toMatch(/offset\/limit/)
    expect(classifyRead({ file_path: grande, limit: 0 }, dir)).toMatch(/offset\/limit/)
  })

  it('não aceita offset 1 sem limit como fatia (equivale a ler tudo)', () => {
    const grande = file('grande6.log', TEXT_MAX_BYTES + 1)
    expect(classifyRead({ file_path: grande, offset: 1 }, dir)).toMatch(/offset\/limit/)
    expect(classifyRead({ file_path: grande, offset: 2 }, dir)).toBeNull()
    expect(classifyRead({ file_path: grande, offset: 1, limit: 100 }, dir)).toBeNull()
  })

  it('ignora imagens e notebooks de qualquer tamanho', () => {
    for (const nome of ['a.png', 'a.JPG', 'a.svg', 'a.ipynb']) {
      expect(classifyRead({ file_path: file(nome, TEXT_MAX_BYTES * 2) }, dir)).toBeNull()
    }
  })

  it('resolve caminho relativo contra cwd', () => {
    file('rel.log', TEXT_MAX_BYTES + 1)
    expect(classifyRead({ file_path: 'rel.log' }, dir)).not.toBeNull()
  })

  it('nega PDF de 1 MB ou mais sem pages, com receita pdftotext', () => {
    const pdf = file('doc.pdf', PDF_MAX_BYTES)
    expect(classifyRead({ file_path: pdf }, dir)).toMatch(/pdftotext/)
    expect(classifyRead({ file_path: pdf, pages: '1-5' }, dir)).toBeNull()
    expect(classifyRead({ file_path: pdf, pages: '  ' }, dir)).toMatch(/pdftotext/)
    expect(classifyRead({ file_path: file('tiny.pdf', PDF_MAX_BYTES - 1) }, dir)).toBeNull()
  })

  it('julga PDF pela regra de PDF, não pela de texto', () => {
    expect(classifyRead({ file_path: file('mid.pdf', TEXT_MAX_BYTES * 3) }, dir)).toBeNull()
  })
})

describe('evaluateRead', () => {
  it('emite deny do PreToolUse só para Read', () => {
    const file_path = file('grande4.log', TEXT_MAX_BYTES + 1)
    const raw = JSON.stringify({ tool_name: 'Read', tool_input: { file_path }, cwd: dir })
    const out = JSON.parse(evaluateRead(raw, {}))
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    const grep = JSON.stringify({ tool_name: 'Grep', tool_input: { file_path }, cwd: dir })
    expect(evaluateRead(grep, {})).toBe('')
  })

  it('READ_GUARD=off, JSON inválido e payload vazio não opinam', () => {
    const file_path = file('grande5.log', TEXT_MAX_BYTES + 1)
    const raw = JSON.stringify({ tool_name: 'Read', tool_input: { file_path }, cwd: dir })
    expect(evaluateRead(raw, { READ_GUARD: 'off' })).toBe('')
    expect(evaluateRead('not json', {})).toBe('')
    expect(evaluateRead('', {})).toBe('')
  })
})
