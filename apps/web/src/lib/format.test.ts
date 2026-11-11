import { describe, expect, it } from 'vitest'
import { formatDuration } from './format.ts'

describe('formatDuration', () => {
  it('formatea como Spotify', () => {
    expect(formatDuration(215_493)).toBe('3:35')
    expect(formatDuration(5_000)).toBe('0:05')
    expect(formatDuration(724_000)).toBe('12:04')
    expect(formatDuration(3_730_000)).toBe('1:02:10')
  })
})
