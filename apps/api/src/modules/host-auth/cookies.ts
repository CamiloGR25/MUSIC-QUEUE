import type { CookieSerializeOptions } from '@fastify/cookie'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.ts'
import { decrypt, encrypt } from '../../lib/crypto.ts'

/**
 * Cookies del anfitrión (docs/DISENO.md §2.4 y §8):
 * - host_sid: firmada, sin estado; quién es el anfitrión.
 * - host_rt: refresh token cifrado (AES-256-GCM); recupera el permiso tras un reinicio.
 * - oauth_tx: state y code_verifier de PKCE cifrados, 10 minutos.
 */
export const HOST_SID = 'host_sid'
export const HOST_RT = 'host_rt'
export const OAUTH_TX = 'oauth_tx'

const DAY_MS = 24 * 60 * 60 * 1000
/** El refresh token de Spotify dura 6 meses: la sesión del panel también. */
export const HOST_COOKIE_MAX_AGE_MS = 180 * DAY_MS
export const OAUTH_TX_MAX_AGE_MS = 10 * 60 * 1000

const hostSidSchema = z.object({ sub: z.string(), name: z.string(), exp: z.number() })
const hostRtSchema = z.object({ sub: z.string(), rt: z.string(), at: z.number() })
const oauthTxSchema = z.object({ state: z.string(), verifier: z.string(), exp: z.number() })

export type HostSid = z.infer<typeof hostSidSchema>
export type HostRt = z.infer<typeof hostRtSchema>
export type OAuthTx = z.infer<typeof oauthTxSchema>

export function cookieOptions(
  config: AppConfig,
  path: string,
  maxAgeMs: number,
): CookieSerializeOptions {
  return {
    path,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

export const encodeHostSid = (value: HostSid) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** Lee la cookie ya verificada por su firma; null si no es válida o venció. */
export function decodeHostSid(raw: string, now: number): HostSid | null {
  try {
    const parsed = hostSidSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()))
    return parsed.success && parsed.data.exp > now ? parsed.data : null
  } catch {
    return null
  }
}

export const sealHostRt = (value: HostRt, key: Buffer) => encrypt(JSON.stringify(value), key)

export function openHostRt(raw: string, key: Buffer): HostRt | null {
  return openJson(raw, key, hostRtSchema)
}

export const sealOAuthTx = (value: OAuthTx, key: Buffer) => encrypt(JSON.stringify(value), key)

export function openOAuthTx(raw: string, key: Buffer): OAuthTx | null {
  return openJson(raw, key, oauthTxSchema)
}

function openJson<T>(raw: string, key: Buffer, schema: z.ZodType<T>): T | null {
  const plain = decrypt(raw, key)
  if (plain === null) return null
  try {
    const parsed = schema.safeParse(JSON.parse(plain))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
