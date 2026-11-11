import type { ApiError, ErrorCode } from '@musica/shared'
import type { FastifyError, FastifyInstance } from 'fastify'

/** Error esperado del dominio: se responde con su código y mensaje (docs/DISENO.md §4.4). */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details: Record<string, unknown> | undefined

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

function body(code: ErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return { error: details ? { code, message, details } : { code, message } }
}

/** Manejador central: errores conocidos con su código; desconocidos como 500 genérico. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.code, error.message, error.details))
    }
    if (error.validation) {
      return reply.status(400).send(body('VALIDATION_ERROR', 'Datos inválidos.'))
    }
    if (error.statusCode === 429) {
      return reply
        .status(429)
        .send(body('RATE_LIMITED', 'Vas muy rápido. Intenta en unos segundos.'))
    }
    request.log.error({ err: error }, 'Error no controlado')
    return reply.status(500).send(body('INTERNAL_ERROR', 'Algo falló en el servidor.'))
  })
}

export function notFoundBody(): ApiError {
  return body('NOT_FOUND', 'No existe esa ruta.')
}
