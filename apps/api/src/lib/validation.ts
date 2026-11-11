import type { z } from 'zod'
import { AppError } from './errors.ts'

/** Valida una entrada con Zod; si falla responde 400 VALIDATION_ERROR con los campos. */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const fields = Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]),
  )
  throw new AppError(400, 'VALIDATION_ERROR', 'Datos inválidos.', { fields })
}
