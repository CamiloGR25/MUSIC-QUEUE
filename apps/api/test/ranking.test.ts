import { describe, expect, it } from 'vitest'
import { rankQueue } from '../src/modules/queue/ranking.ts'

const t = (name: string, votes: number, createdAt: number, seq: number) => ({
  name,
  votes,
  createdAt,
  seq,
})

describe('rankQueue (R-COLA-01)', () => {
  it('más votos primero', () => {
    const ranked = rankQueue([t('a', 1, 1, 1), t('b', 3, 2, 2), t('c', 2, 3, 3)])
    expect(ranked.map((x) => x.name)).toEqual(['b', 'c', 'a'])
  })

  it('empate de votos: la más antigua primero', () => {
    const ranked = rankQueue([t('nueva', 2, 50, 2), t('vieja', 2, 10, 1)])
    expect(ranked.map((x) => x.name)).toEqual(['vieja', 'nueva'])
  })

  it('mismo milisegundo: orden de llegada', () => {
    const ranked = rankQueue([t('segunda', 1, 5, 2), t('primera', 1, 5, 1)])
    expect(ranked.map((x) => x.name)).toEqual(['primera', 'segunda'])
  })

  it('no modifica la lista original', () => {
    const list = [t('a', 1, 1, 1), t('b', 2, 2, 2)]
    rankQueue(list)
    expect(list.map((x) => x.name)).toEqual(['a', 'b'])
  })
})
