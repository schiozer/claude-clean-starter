// Subpath público seguro para o cliente ('use client'): só schemas Zod, sem service/bordas
// (o index.ts puxa código de servidor como node:crypto para o bundle do browser).
export { createResourceSchema, listResourcesSchema } from './application/schemas'
export type { CreateResourceInput, ListResourcesInput } from './application/schemas'
