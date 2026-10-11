import { DomainError } from '@/shared/errors'

export const TITLE_RULE = 'Título deve ter de 3 a 100 caracteres'

export class Title {
  private constructor(readonly value: string) {}

  static of(raw: string): Title {
    const value = raw.trim()
    if (value.length < 3 || value.length > 100) throw new DomainError(TITLE_RULE)
    return new Title(value)
  }
}
