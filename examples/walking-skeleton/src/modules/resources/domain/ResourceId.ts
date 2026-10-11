import { DomainError } from '@/shared/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ResourceId {
  private constructor(readonly value: string) {}

  static new(): ResourceId {
    return new ResourceId(crypto.randomUUID())
  }

  static of(raw: string): ResourceId {
    if (!UUID.test(raw)) throw new DomainError('Identificador inválido')
    return new ResourceId(raw)
  }
}
