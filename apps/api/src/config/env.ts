import { z } from 'zod'

/**
 * Variables de entorno validadas al arrancar (docs/DISENO.md §10).
 * Solo se exigen las que usa cada etapa; las de Spotify se agregan en E1.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Puerto en producción: lo define Render. */
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /**
   * Puerto de la API en desarrollo. Es distinto de PORT porque herramientas como la vista previa
   * definen PORT para el frontend (5180); Vite redirige /api a este puerto.
   */
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3180),
  /** Por defecto 127.0.0.1 en desarrollo y 0.0.0.0 en producción (Render lo exige). */
  HOST: z.string().min(1).optional(),
  PUBLIC_BASE_URL: z.url().refine((value) => !new URL(value).hostname.startsWith('localhost'), {
    message: 'Usa 127.0.0.1 en lugar de localhost (Spotify no acepta localhost).',
  }),
  TIMEZONE: z.string().min(1).default('America/Bogota'),
})

export type Env = z.infer<typeof envSchema>

export type AppConfig = {
  env: Env['NODE_ENV']
  port: number
  host: string
  publicBaseUrl: string
  timezone: string
  /** Carpeta con el frontend compilado; si no existe, la API no sirve el frontend. */
  webDistDir: string | null
}

export function loadConfig(
  source: Record<string, string | undefined>,
  webDistDir: string | null,
): AppConfig {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Variables de entorno inválidas:\n${issues}`)
  }
  const env = result.data
  return {
    env: env.NODE_ENV,
    port: env.NODE_ENV === 'production' ? (env.PORT ?? env.API_PORT) : env.API_PORT,
    host: env.HOST ?? (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
    timezone: env.TIMEZONE,
    webDistDir,
  }
}
