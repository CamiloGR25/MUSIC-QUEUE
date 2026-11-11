import { describe, expect, it } from 'vitest'
import { ENDED_RETENTION_MS, MAX_PARTICIPANTS, MemoryStore } from '../src/modules/sessions/store.ts'
import { Clock } from './helpers.ts'

const HOUR_MS = 3_600_000

function setup() {
  const clock = new Clock()
  const store = new MemoryStore(clock.now, 24)
  const session = store.create({ hostSpotifyId: 'h', name: 'Fiesta', market: 'CO' })
  return { clock, store, session }
}

describe('barrido de sesiones (docs/DISENO.md §2.3)', () => {
  it('borra una sesión finalizada después de 30 minutos, con sus códigos', () => {
    const { clock, store, session } = setup()
    store.end(session.id)
    clock.advance(ENDED_RETENTION_MS - 1)
    expect(store.sweep()).toBe(0)
    clock.advance(1)
    expect(store.sweep()).toBe(1)
    expect(store.findById(session.id)).toBeUndefined()
    expect(store.lookupCode(session.code)).toBeUndefined()
  })

  it('borra una sesión activa a las 24 horas', () => {
    const { clock, store, session } = setup()
    clock.advance(24 * HOUR_MS - 1)
    expect(store.sweep()).toBe(0)
    clock.advance(1)
    expect(store.sweep()).toBe(1)
    expect(store.findActiveByHost('h')).toBeUndefined()
    expect(store.findById(session.id)).toBeUndefined()
  })

  it('no toca una sesión activa reciente', () => {
    const { clock, store } = setup()
    clock.advance(HOUR_MS)
    expect(store.sweep()).toBe(0)
  })
})

describe('participantes', () => {
  it('limita la cantidad por sesión', () => {
    const { store, session } = setup()
    for (let i = 0; i < MAX_PARTICIPANTS; i++) store.join(session.id, `hash${i}`, null)
    expect(() => store.join(session.id, 'otro', null)).toThrow(/llena/)
  })

  it('rotar dos veces retira ambos códigos anteriores', () => {
    const { store, session } = setup()
    const first = session.code
    const second = store.rotateCode(session.id).code
    const third = store.rotateCode(session.id).code
    expect(store.lookupCode(first)?.retired).toBe(true)
    expect(store.lookupCode(second)?.retired).toBe(true)
    expect(store.lookupCode(third)?.retired).toBe(false)
  })
})
