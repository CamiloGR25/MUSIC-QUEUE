import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from 'node:crypto'

const IV_BYTES = 12
const TAG_BYTES = 16

/** Cifra un texto con AES-256-GCM. Formato: base64url(iv | tag | cifrado). */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
}

/** Descifra lo que produjo `encrypt`; devuelve null si fue alterado o la clave no coincide. */
export function decrypt(sealed: string, key: Buffer): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url')
    if (raw.length <= IV_BYTES + TAG_BYTES) return null
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

/** Texto aleatorio en base64url con `bytes` bytes de entropía. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Alfabeto Crockford base32 (sin I, L, O, U: no se confunden al dictarlo). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Código público de la sesión: 10 caracteres ≈ 50 bits (docs/DISENO.md §2). */
export function randomCode(length = 10): string {
  let code = ''
  for (let i = 0; i < length; i++) code += CROCKFORD[randomInt(CROCKFORD.length)]
  return code
}

/**
 * Código estable de 10 caracteres Crockford derivado de `value` con HMAC (D-21): siempre el mismo
 * para la misma clave, sin guardarlo en ninguna parte, e imposible de adivinar sin la clave.
 */
export function stableCode(value: string, key: string, length = 10): string {
  const digest = createHmac('sha256', key).update(value).digest()
  let code = ''
  for (let i = 0; i < length; i++) code += CROCKFORD[digest[i]! % CROCKFORD.length]
  return code
}
