#!/usr/bin/env node
// Hook PreToolUse (matcher Read): nega leitura inteira de arquivo grande. Sempre exit 0.
// stdin = payload do Claude Code; stdout = JSON de deny (ou vazio = liberado).

import { readFileSync } from 'node:fs'
import { evaluateRead } from './evaluate.mjs'

let raw = ''
try {
  raw = readFileSync(0, 'utf8')
} catch {
  // sem stdin: sem opinião
}
const saida = evaluateRead(raw)
if (saida) process.stdout.write(saida)
