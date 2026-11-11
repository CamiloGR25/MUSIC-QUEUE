import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, randomCode } from '../src/lib/crypto.ts'

const key = Buffer.alloc(32, 1)

describe('cifrado AES-256-GCM', () => {
  it('descifra lo que cifró', () => {
    expect(decrypt(encrypt('refresh-token', key), key)).toBe('refresh-token')
  })

  it('cada cifrado es distinto aunque el texto sea igual', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key))
  })

  it('devuelve null si el texto fue alterado', () => {
    const sealed = encrypt('refresh-token', key)
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA')
    expect(decrypt(tampered, key)).toBeNull()
  })

  it('devuelve null con otra clave', () => {
    expect(decrypt(encrypt('refresh-token', key), Buffer.alloc(32, 2))).toBeNull()
  })

  it('devuelve null con basura', () => {
    expect(decrypt('no-es-cifrado', key)).toBeNull()
  })
})

describe('randomCode', () => {
  it('genera 10 caracteres Crockford sin I, L, O ni U', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
    }
  })
})
