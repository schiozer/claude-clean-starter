// Reporter do `demos:gravar`: escreve `.e2e/demos/manifesto.json` com um vídeo por teste/projeto.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

interface Entrada {
  id: string
  projeto: string
  arquivo: string
  ok: boolean
}

export default class DemosReporter implements Reporter {
  private readonly entradas: Entrada[] = []
  private readonly saida: string

  constructor({ saida = '.e2e/demos/manifesto.json' }: { saida?: string } = {}) {
    this.saida = saida
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = /CT-[A-Z]{2,6}-\d{3}/.exec(test.title)?.[0]
    const arquivo = result.attachments.find((a) => a.name === 'video')?.path
    if (!id || !arquivo) return
    const projeto = test.parent.project()?.name ?? ''
    this.entradas.push({ id, projeto, arquivo, ok: result.status === 'passed' })
  }

  onEnd(): void {
    mkdirSync(dirname(this.saida), { recursive: true })
    writeFileSync(this.saida, `${JSON.stringify({ videos: this.entradas }, null, 2)}\n`)
  }
}
