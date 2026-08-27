import { DomainError } from '@/shared/errors'

export class Resource {
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly ownerId: string,
    public readonly createdAt: Date
  ) {
    if (title.length < 3 || title.length > 100) {
      throw new DomainError('Título deve ter entre 3 e 100 caracteres')
    }
  }
}
