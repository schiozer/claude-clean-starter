export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class DomainError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export class NotFoundError extends AppError {
  /** `mensagem` substitui o padrão quando o recurso pede outra concordância ("Página … encontrada"). */
  constructor(resource: string, mensagem = `${resource} não encontrado`) {
    super(mensagem, 'NOT_FOUND', 404)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autorizado') {
    super(message, 'UNAUTHORIZED', 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado') {
    super(message, 'FORBIDDEN', 403)
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Muitas requisições. Aguarde um instante e tente novamente.') {
    super(message, 'RATE_LIMITED', 429)
  }
}

/** Erro **técnico**: a operação estourou o prazo (rota de API ou chamada da UI). */
export class TimeoutError extends AppError {
  constructor(message = 'A operação demorou demais. Tente novamente.') {
    super(message, 'TIMEOUT', 504)
  }
}
