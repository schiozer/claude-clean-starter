# Fixture — spec falsa do selftest de `jornada()`

Usada só por `tests/e2e/support/jornada.selftest.spec.ts` (via `E2E_CENARIOS_CONFIG`). Não é
uma spec real: fica fora dos globs de `tests/e2e/cenarios.config.json`.

## Cenários de teste

### CT-JOR-001 — jornada em três passos

Tipo: @sistemico
Dado que abro a lista de "Recursos"
Quando crio o recurso "Plano de estudos"
Então vejo "Plano de estudos" na lista
