import { z } from 'zod'

/** ID de cenário (`CT-<CTX>-NNN`): também vira caminho de arquivo, por isso o padrão estrito. */
export const ID_CENARIO = /^CT-[A-Z]{2,6}-\d{3}$/

const idCenario = z.string().regex(ID_CENARIO, 'ID de cenário inválido')

export const getAjudaSchema = z.object({ id: idCenario })

export const imagemAjudaSchema = z.object({
  id: idCenario,
  /** Número do passo, a partir de 1 (o screenshot `NN.png`). */
  n: z.coerce.number().int('Passo inválido').min(1, 'Passo inválido').max(99, 'Passo inválido'),
})

export type GetAjudaInput = z.infer<typeof getAjudaSchema>
export type ImagemAjudaInput = z.infer<typeof imagemAjudaSchema>
