import path from 'node:path'

// Fronteira de módulo (ADR-011), para imports por alias (@/…) E relativos:
// fora de src/modules/<ctx>/ só se importa o index do módulo ou o subpath `schemas`
// (seguro para 'use client'). src/composition.ts é a única exceção.
const PUBLIC_ENTRIES = new Set(['', 'index', 'schemas'])

function resolveTarget(spec, filename, srcDir) {
  if (spec.startsWith('@/')) return path.join(srcDir, spec.slice(2))
  if (spec.startsWith('.')) return path.resolve(path.dirname(filename), spec)
  return null
}

function moduleOf(absPath, srcDir) {
  const rel = path.relative(path.join(srcDir, 'modules'), absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const [ctx, ...rest] = rel.split(path.sep)
  return { ctx, entry: rest.join('/').replace(/\.(ts|tsx|js|mjs)$/, '') }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { srcDir: { type: 'string' } }, additionalProperties: false }],
    messages: {
      internal:
        'Importe só pelo index do módulo (@/modules/{{ctx}}) ou por @/modules/{{ctx}}/schemas. Ver ADR-011.',
    },
  },
  create(context) {
    const filename = context.filename
    const srcDir = context.options[0]?.srcDir ?? path.join(context.cwd, 'src')
    if (path.resolve(filename) === path.join(srcDir, 'composition.ts')) return {}
    const importer = moduleOf(path.resolve(filename), srcDir)

    function check(node) {
      const spec = node.source?.value
      if (typeof spec !== 'string') return
      const resolved = resolveTarget(spec, filename, srcDir)
      if (!resolved) return
      const target = moduleOf(resolved, srcDir)
      if (!target || target.ctx === importer?.ctx) return
      if (PUBLIC_ENTRIES.has(target.entry)) return
      context.report({ node: node.source, messageId: 'internal', data: { ctx: target.ctx } })
    }

    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check }
  },
}
