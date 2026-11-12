import { z } from 'zod'

const port = z.coerce.number().int().min(1).max(65535)

/** 32 bytes en base64, para AES-256-GCM (docs/DISENO.md §6). */
const encryptionKey = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'Debe ser de 32 bytes en base64.',
})

/**
 * Variables de entorno validadas al arrancar (docs/DISENO.md §10).
 * Solo se exigen las que usa cada etapa.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Puerto en producción: lo define Render. */
  PORT: port.optional(),
  /**
   * Puerto de la API en desarrollo. Es distinto de PORT porque herramientas como la vista previa
   * definen PORT para el frontend (5180); Vite redirige /api a este puerto.
   */
  API_PORT: port.default(3180),
  /** Por defecto 127.0.0.1 en desarrollo y 0.0.0.0 en producción (Render lo exige). */
  HOST: z.string().min(1).optional(),
  PUBLIC_BASE_URL: z.url().refine((value) => !new URL(value).hostname.startsWith('localhost'), {
    message: 'Usa 127.0.0.1 en lugar de localhost (Spotify no acepta localhost).',
  }),
  TIMEZONE: z.string().min(1).default('America/Bogota'),

  // E1 · Spotify y anfitrión
  SPOTIFY_CLIENT_ID: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/, 'Debe ser el Client ID de 32 caracteres.'),
  SPOTIFY_CLIENT_SECRET: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/, 'Debe ser el Client Secret de 32 caracteres.'),
  SPOTIFY_REDIRECT_URI: z.url(),
  /** D-16: cuentas de Spotify que pueden ser anfitrionas, separadas por coma. */
  ALLOWED_HOST_SPOTIFY_IDS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .refine((ids) => ids.length > 0, {
      message: 'Agrega al menos un nombre de usuario de Spotify.',
    }),
  TOKEN_ENCRYPTION_KEY: encryptionKey,
  COOKIE_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres.'),
  DEFAULT_MARKET: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('CO'),

  // E2 · Invitados, barrido y KeepAwake
  /**
   * URL para los invitados (QR). Por defecto PUBLIC_BASE_URL. En desarrollo sirve para entrar
   * desde un celular en la misma red Wi-Fi (http://IP-del-PC:5180).
   */
  GUEST_BASE_URL: z.url().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24),
  KEEP_AWAKE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(600_000),
  /** D-14: cuánto antes del final de la canción se envía la siguiente a Spotify. */
  SYNC_LEAD_MS: z.coerce.number().int().min(5_000).max(60_000).default(20_000),
  KEEP_AWAKE_UNTIL: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:MM.')
    .default('04:00'),
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
  spotify: {
    clientId: string
    clientSecret: string
    redirectUri: string
    market: string
  }
  allowedHostIds: ReadonlySet<string>
  encryptionKey: Buffer
  cookieSecret: string
  /** Cookies con Secure solo en producción (en desarrollo se entra por HTTP). */
  secureCookies: boolean
  /** Base del enlace y el QR para invitados. */
  guestBaseUrl: string
  /** Orígenes aceptados en mutaciones (CSRF, docs/DISENO.md §8). */
  allowedOrigins: ReadonlySet<string>
  sessionTtlHours: number
  syncLeadMs: number
  /** R-AWAKE-05: solo en producción. */
  keepAwake: { enabled: boolean; intervalMs: number; until: string }
}

/**
 * En Render no hace falta escribir la URL pública ni la de retorno: Render define
 * RENDER_EXTERNAL_URL (https://<servicio>.onrender.com) y de ahí salen las dos.
 * Si se definen a mano, mandan las escritas.
 */
function withRenderDefaults(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const publicBaseUrl = source.PUBLIC_BASE_URL || source.RENDER_EXTERNAL_URL
  if (!publicBaseUrl) return source
  return {
    ...source,
    PUBLIC_BASE_URL: publicBaseUrl,
    SPOTIFY_REDIRECT_URI:
      source.SPOTIFY_REDIRECT_URI ||
      `${publicBaseUrl.replace(/\/$/, '')}/api/auth/spotify/callback`,
  }
}

export function loadConfig(
  source: Record<string, string | undefined>,
  webDistDir: string | null,
): AppConfig {
  const result = envSchema.safeParse(withRenderDefaults(source))
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Variables de entorno inválidas:\n${issues}`)
  }
  const env = result.data
  const production = env.NODE_ENV === 'production'
  const publicBaseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '')
  const guestBaseUrl = (env.GUEST_BASE_URL ?? publicBaseUrl).replace(/\/$/, '')
  return {
    env: env.NODE_ENV,
    port: production ? (env.PORT ?? env.API_PORT) : env.API_PORT,
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    publicBaseUrl,
    timezone: env.TIMEZONE,
    webDistDir,
    spotify: {
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
      redirectUri: env.SPOTIFY_REDIRECT_URI,
      market: env.DEFAULT_MARKET,
    },
    allowedHostIds: new Set(env.ALLOWED_HOST_SPOTIFY_IDS),
    encryptionKey: Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64'),
    cookieSecret: env.COOKIE_SECRET,
    secureCookies: production,
    guestBaseUrl,
    allowedOrigins: new Set([publicBaseUrl, guestBaseUrl]),
    sessionTtlHours: env.SESSION_TTL_HOURS,
    syncLeadMs: env.SYNC_LEAD_MS,
    keepAwake: {
      enabled: production,
      intervalMs: env.KEEP_AWAKE_INTERVAL_MS,
      until: env.KEEP_AWAKE_UNTIL,
    },
  }
}
