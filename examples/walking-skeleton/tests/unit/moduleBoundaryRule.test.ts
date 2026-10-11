import { describe, it } from 'vitest'
import { RuleTester } from 'eslint'
import moduleBoundary from '../../eslint-rules/module-boundary.mjs'

RuleTester.describe = describe
RuleTester.it = it

const ROOT = '/repo'
const file = (rel: string) => `${ROOT}/${rel}`
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } })
const options = [{ srcDir: `${ROOT}/src` }]

tester.run('module-boundary', moduleBoundary, {
  valid: [
    { filename: file('src/ui/View.tsx'), code: "import { x } from '@/modules/resources'", options },
    { filename: file('src/ui/View.tsx'), code: "import { x } from '@/modules/resources/schemas'", options },
    { filename: file('src/ui/View.tsx'), code: "import { x } from '../modules/resources'", options },
    {
      filename: file('src/modules/resources/interfaces/mcp/tools.ts'),
      code: "import { x } from '../../application/dto'",
      options,
    },
    { filename: file('src/composition.ts'), code: "import { x } from './modules/resources/infrastructure/Repo'", options },
    { filename: file('src/ui/View.tsx'), code: "import { z } from 'zod'", options },
  ],
  invalid: [
    {
      filename: file('src/ui/View.tsx'),
      code: "import { x } from '@/modules/resources/domain/Title'",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      filename: file('src/ui/View.tsx'),
      code: "import { x } from '../modules/resources/domain/Title'",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      filename: file('src/modules/billing/application/BillingService.ts'),
      code: "import { x } from '../../resources/infrastructure/Repo'",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      filename: file('src/app/api/x/route.ts'),
      code: "export { x } from '@/modules/resources/application/ResourceService'",
      options,
      errors: [{ messageId: 'internal' }],
    },
  ],
})
