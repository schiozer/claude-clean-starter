import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

describe('workflow demos-treinamento.yml', () => {
  const yml = readFileSync(resolve(ROOT, '.github/workflows/demos-treinamento.yml'), 'utf8')

  it('dispara após a Release e por workflow_dispatch com a tag obrigatória', () => {
    expect(yml).toMatch(/^name: Demos & Treinamento$/m)
    expect(yml).toContain('workflow_run:')
    expect(yml).toContain('workflows: [Release]')
    expect(yml).toContain('types: [completed]')
    expect(yml).toMatch(
      /workflow_dispatch:\n {4}inputs:\n {6}tag:\n(?: {8}.+\n)*? {8}required: true/
    )
  })

  it('serializa sem cancelar', () => {
    expect(yml).toContain('group: demos-treinamento')
    expect(yml).toContain('cancel-in-progress: false')
  })

  it('checa o toggle num passo, não no if do job', () => {
    expect(yml).not.toMatch(/jobs:[\s\S]*?\n {4}if:[^\n]*DEMOS_BUNNY/)
    expect(yml).toContain("vars.DEMOS_BUNNY != 'on'")
    expect(yml).toContain('::warning::')
    expect(yml).toContain("steps.toggle.outputs.ligado == 'true'")
  })

  it('grava só contra o app do commit da tag', () => {
    expect(yml).not.toContain('E2E_BASE_URL')
    expect(yml).toContain('ref: ${{ steps.tag.outputs.tag }}')
  })

  it('avisa em caso de falha quando há tag', () => {
    expect(yml).toMatch(
      /if: failure\(\)[^\n]*\n(?:.*\n)*?\s+run: node scripts\/demos\/publicar\.mjs aviso/
    )
  })

  it('não interpola inputs.tag em run', () => {
    const runs = yml.match(/run: [|>-]*\n(?: {10}.*\n?)+|run: .*/g) ?? []
    for (const run of runs) expect(run).not.toContain('inputs.tag')
  })

  it('usa os segredos só como secrets.<NOME>', () => {
    for (const nome of [
      'BUNNY_STREAM_API_KEY',
      'BUNNY_LIBRARY_ID',
      'BUNNY_STORAGE_ZONE',
      'BUNNY_STORAGE_PASSWORD',
    ]) {
      expect(yml).toContain(`\${{ secrets.${nome} }}`)
      const usos = yml.match(new RegExp(`.*${nome}.*`, 'g')) ?? []
      for (const uso of usos) expect(uso).toContain(`secrets.${nome}`)
    }
  })

  it('valida a tag do dispatch com vX.Y.Z', () => {
    expect(yml).toContain('[[ "$INPUT_TAG" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]')
    expect(yml).not.toContain('-z "$INPUT_TAG$HEAD_SHA"')
  })

  it('o aviso exige toggle ligado e tag', () => {
    expect(yml).toContain(
      "if: failure() && steps.toggle.outputs.ligado == 'true' && steps.tag.outputs.tag != ''"
    )
  })

  it('tem a expressão do job, timeout, permissões e checkout sem credenciais', () => {
    expect(yml).toContain(
      "if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'"
    )
    expect(yml).toContain('timeout-minutes: 60')
    expect(yml).toMatch(/^permissions:\n {2}contents: write\n {2}pull-requests: read\n/m)
    expect(yml).toContain('fetch-depth: 0')
    expect(yml).toContain('persist-credentials: false')
  })

  it('guarda o CLI ausente em tags antigas', () => {
    expect(yml).toContain("hashFiles('scripts/demos/publicar.mjs') != ''")
  })

  it('o artefato é guardado por 7 dias sempre', () => {
    expect(yml).toContain('retention-days: 7')
    expect(yml).toMatch(/if: always\(\)[^\n]*\n\s+uses: actions\/upload-artifact/)
  })
})
